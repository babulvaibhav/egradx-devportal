package com.egradx.oim.order.application;

import com.egradx.audit.EgradxAuditor;
import com.egradx.core.audit.EgradxAuditEvent;
import com.egradx.oim.common.audit.OimAuditActions;
import com.egradx.oim.common.exception.AccessDeniedBusinessException;
import com.egradx.oim.common.exception.InsufficientInventoryException;
import com.egradx.oim.common.exception.InvalidStatusTransitionException;
import com.egradx.oim.common.exception.ResourceConflictException;
import com.egradx.oim.common.exception.ResourceNotFoundException;
import com.egradx.oim.common.security.PermissionCodes;
import com.egradx.oim.common.tenant.CurrentTenant;
import com.egradx.oim.customer.domain.Customer;
import com.egradx.oim.customer.infrastructure.CustomerRepository;
import com.egradx.oim.dashboard.application.DashboardCacheEvictor;
import com.egradx.oim.inventory.application.InventoryService;
import com.egradx.oim.inventory.domain.Inventory;
import com.egradx.oim.inventory.infrastructure.InventoryRepository;
import com.egradx.oim.notification.OimNotifications;
import com.egradx.oim.order.domain.Order;
import com.egradx.oim.order.domain.OrderItem;
import com.egradx.oim.order.infrastructure.OrderRepository;
import com.egradx.oim.product.domain.Product;
import com.egradx.oim.product.infrastructure.ProductRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class OrderService {

    private final OrderRepository orderRepository;
    private final CustomerRepository customerRepository;
    private final ProductRepository productRepository;
    private final InventoryRepository inventoryRepository;
    private final InventoryService inventoryService;
    private final OimNotifications notifications;
    private final EgradxAuditor auditor;
    private final DashboardCacheEvictor dashboardCacheEvictor;
    private final CurrentTenant currentTenant;

    public OrderService(OrderRepository orderRepository, CustomerRepository customerRepository,
                       ProductRepository productRepository, InventoryRepository inventoryRepository,
                       InventoryService inventoryService, OimNotifications notifications,
                       EgradxAuditor auditor, DashboardCacheEvictor dashboardCacheEvictor, CurrentTenant currentTenant) {
        this.orderRepository = orderRepository;
        this.customerRepository = customerRepository;
        this.productRepository = productRepository;
        this.inventoryRepository = inventoryRepository;
        this.inventoryService = inventoryService;
        this.notifications = notifications;
        this.auditor = auditor;
        this.dashboardCacheEvictor = dashboardCacheEvictor;
        this.currentTenant = currentTenant;
    }

    @Transactional
    public OrderResponse createOrder(OrderRequest request) {
        UUID organizationId = currentTenant.organizationId();

        Customer customer = customerRepository.findByIdAndOrganizationId(request.customerId(), organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Customer not found"));

        // Look up products server-side — price and status must never be trusted from the client.
        Map<UUID, Product> productsById = request.items().stream()
            .map(OrderItemRequest::productId)
            .distinct()
            .collect(Collectors.toMap(id -> id, id -> productRepository.findByIdAndOrganizationId(id, organizationId)
                .orElseThrow(() -> new ResourceNotFoundException("Product not found: " + id))));

        productsById.values().stream()
            .filter(product -> product.getStatus() == Product.Status.DISABLED)
            .findFirst()
            .ifPresent(product -> {
                throw new ResourceConflictException("Product \"" + product.getName() + "\" is disabled and cannot be ordered");
            });

        // Prepare inventory reservations - sort by (inventory ID, request) pairs together, not by
        // index into two independently-ordered lists. Sorting a separate inventories list and then
        // re-pairing it with request.items() by position (the previous bug) reserves item A's
        // requested quantity against item B's inventory row as soon as the sort reorders anything.
        record ReservationLine(Inventory inventory, OrderItemRequest itemRequest) {
        }
        List<ReservationLine> reservationLines = new ArrayList<>();
        for (OrderItemRequest itemRequest : request.items()) {
            Inventory inventory = inventoryRepository.findByOrganizationIdAndWarehouseIdAndProductId(
                organizationId, itemRequest.warehouseId(), itemRequest.productId()
            ).orElseThrow(() -> new ResourceNotFoundException("Inventory not found for warehouse and product"));

            reservationLines.add(new ReservationLine(inventory, itemRequest));
        }
        reservationLines.sort(Comparator.comparing(line -> line.inventory().getId()));

        BigDecimal totalAmount = BigDecimal.ZERO;
        Order order = new Order(organizationId, customer.getId(), BigDecimal.ZERO, request.notes());
        order.setStatus(Order.Status.PENDING);

        for (ReservationLine line : reservationLines) {
            OrderItemRequest itemRequest = line.itemRequest();
            Inventory inventory = line.inventory();
            Product product = productsById.get(itemRequest.productId());

            try {
                inventoryService.reserveInventory(inventory.getId(), itemRequest.quantity());
            } catch (InsufficientInventoryException e) {
                // Rollback happens automatically via @Transactional.
                throw new InsufficientInventoryException("INSUFFICIENT_INVENTORY for product: " + itemRequest.productId());
            }

            BigDecimal unitPrice = product.getPrice();
            OrderItem orderItem = new OrderItem(itemRequest.productId(), itemRequest.quantity(), unitPrice, itemRequest.warehouseId());
            order.addItem(orderItem);
            totalAmount = totalAmount.add(orderItem.getTotalPrice());
        }
        order.setTotalAmount(totalAmount);

        Order savedOrder = orderRepository.save(order);
        OrderResponse response = OrderResponse.from(savedOrder);

        auditor.record(EgradxAuditEvent.of(OimAuditActions.ORDER_CREATED)
            .organization(organizationId)
            .entity("order", savedOrder.getId())
            .after(response)
            .build());
        notifications.orderCreated(organizationId, response);
        // Pending-orders count changed (reserveInventory above already evicted for the
        // available-inventory count, but that doesn't cover this one).
        dashboardCacheEvictor.evict(organizationId);

        return response;
    }

    @Transactional
    public OrderResponse updateOrderStatus(UUID id, Order.Status newStatus) {
        UUID organizationId = currentTenant.organizationId();

        Order order = orderRepository.findByIdAndOrganizationId(id, organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Order not found"));

        Order.Status currentStatus = order.getStatus();
        if (!isValidStatusTransition(currentStatus, newStatus)) {
            throw new InvalidStatusTransitionException("Invalid status transition from " + currentStatus + " to " + newStatus);
        }

        // Cancelling is gated by order.cancel; every other forward transition only needs order.create
        // (which STAFF also holds, per the assignment's "Staff: process orders" role description).
        String requiredPermission = newStatus == Order.Status.CANCELLED ? PermissionCodes.ORDER_CANCEL : PermissionCodes.ORDER_CREATE;
        if (!currentTenant.hasAuthority(requiredPermission)) {
            throw new AccessDeniedBusinessException("Missing permission: " + requiredPermission);
        }

        OrderResponse before = OrderResponse.from(order);
        // Force-load the items before the compare-and-swap update below clears the persistence
        // context (Order.items is lazy; the detached `order` reference can't load it afterward).
        List<OrderItem> items = new ArrayList<>(order.getItems());

        // docs:region order-status-cas
        // Atomic compare-and-swap: only succeeds if the order is still in `currentStatus`. This is
        // what stops two concurrent requests (e.g. two PENDING->CANCELLED calls racing each other)
        // from both passing the transition check above and both running the inventory side effect
        // below — a double release/consume. See KNOWN_LIMITATIONS.md "Addressed in this pass".
        int updated = orderRepository.updateStatusIfCurrent(id, organizationId, currentStatus, newStatus);
        if (updated == 0) {
            throw new InvalidStatusTransitionException(
                "Order status changed concurrently — expected " + currentStatus + ", please retry");
        }
        // docs:end

        if (newStatus == Order.Status.CANCELLED) {
            for (OrderItem item : items) {
                if (item.getWarehouseId() != null) {
                    inventoryRepository.findByOrganizationIdAndWarehouseIdAndProductId(
                        organizationId, item.getWarehouseId(), item.getProductId()
                    ).ifPresent(inventory -> inventoryService.releaseInventory(inventory.getId(), item.getQuantity()));
                }
            }
        } else if (newStatus == Order.Status.COMPLETED) {
            // The stock has shipped: consume the reservation for good instead of leaving
            // reservedQuantity to grow without bound (previously not handled at all — see
            // KNOWN_LIMITATIONS.md "Addressed in this pass").
            for (OrderItem item : items) {
                if (item.getWarehouseId() != null) {
                    inventoryRepository.findByOrganizationIdAndWarehouseIdAndProductId(
                        organizationId, item.getWarehouseId(), item.getProductId()
                    ).ifPresent(inventory -> inventoryService.consumeReservedInventory(inventory.getId(), item.getQuantity()));
                }
            }
        }

        // Re-fetch: the compare-and-swap's clearAutomatically detached the entity loaded above.
        Order saved = orderRepository.findByIdAndOrganizationId(id, organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Order not found"));
        OrderResponse response = OrderResponse.from(saved);

        auditor.record(EgradxAuditEvent.of(OimAuditActions.ORDER_STATUS_CHANGED)
            .organization(organizationId)
            .entity("order", saved.getId())
            .before(before)
            .after(response)
            .detail("from", currentStatus.name())
            .detail("to", newStatus.name())
            .build());
        if (newStatus == Order.Status.CANCELLED) {
            notifications.orderCancelled(organizationId, response);
        }
        // Pending/completed-orders counts changed (the CANCELLED branch's releaseInventory call
        // above already evicted for the available-inventory count, but not for these).
        dashboardCacheEvictor.evict(organizationId);

        return response;
    }

    // readOnly transactions: Order.items is lazy and open-in-view is disabled, so the Hibernate
    // session must still be open while OrderResponse.from(...) reads it — without this the mapping
    // throws LazyInitializationException as soon as an order has any items.
    @Transactional(readOnly = true)
    public OrderResponse getOrder(UUID id) {
        UUID organizationId = currentTenant.organizationId();

        Order order = orderRepository.findByIdAndOrganizationId(id, organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Order not found"));

        return OrderResponse.from(order);
    }

    @Transactional(readOnly = true)
    public Page<OrderResponse> getOrders(Pageable pageable) {
        UUID organizationId = currentTenant.organizationId();

        return orderRepository.findByOrganizationId(organizationId, pageable)
            .map(OrderResponse::from);
    }

    @Transactional(readOnly = true)
    public Page<OrderResponse> getOrdersByStatus(Order.Status status, Pageable pageable) {
        UUID organizationId = currentTenant.organizationId();

        return orderRepository.findByOrganizationIdAndStatus(organizationId, status, pageable)
            .map(OrderResponse::from);
    }

    @Transactional(readOnly = true)
    public Page<OrderResponse> searchOrders(String search, Pageable pageable) {
        UUID organizationId = currentTenant.organizationId();

        return orderRepository.findByOrganizationIdAndCustomerSearch(organizationId, search, pageable)
            .map(OrderResponse::from);
    }

    private boolean isValidStatusTransition(Order.Status current, Order.Status newStatus) {
        return switch (current) {
            case PENDING -> newStatus == Order.Status.CONFIRMED || newStatus == Order.Status.CANCELLED;
            case CONFIRMED -> newStatus == Order.Status.PROCESSING || newStatus == Order.Status.CANCELLED;
            case PROCESSING -> newStatus == Order.Status.COMPLETED;
            case COMPLETED -> false;
            case CANCELLED -> false;
        };
    }
}
