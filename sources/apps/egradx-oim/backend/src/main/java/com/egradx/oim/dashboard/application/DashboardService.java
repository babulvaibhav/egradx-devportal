package com.egradx.oim.dashboard.application;

import com.egradx.oim.common.tenant.CurrentTenant;
import com.egradx.oim.customer.domain.Customer;
import com.egradx.oim.customer.infrastructure.CustomerRepository;
import com.egradx.oim.inventory.application.InventoryService;
import com.egradx.oim.inventory.infrastructure.InventoryRepository;
import com.egradx.oim.order.domain.Order;
import com.egradx.oim.order.infrastructure.OrderRepository;
import com.egradx.oim.product.infrastructure.ProductRepository;
import com.egradx.oim.warehouse.infrastructure.WarehouseRepository;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class DashboardService {

    private final ProductRepository productRepository;
    private final WarehouseRepository warehouseRepository;
    private final InventoryRepository inventoryRepository;
    private final OrderRepository orderRepository;
    private final CustomerRepository customerRepository;
    private final CurrentTenant currentTenant;

    public DashboardService(ProductRepository productRepository, WarehouseRepository warehouseRepository,
                          InventoryRepository inventoryRepository, OrderRepository orderRepository,
                          CustomerRepository customerRepository, CurrentTenant currentTenant) {
        this.productRepository = productRepository;
        this.warehouseRepository = warehouseRepository;
        this.inventoryRepository = inventoryRepository;
        this.orderRepository = orderRepository;
        this.customerRepository = customerRepository;
        this.currentTenant = currentTenant;
    }

    // docs:region dashboard-cache
    // Key format is dashboard:{organizationId}:summary and MUST stay byte-identical to what
    // DashboardCacheEvictor evicts, or entries go stale invisibly.
    //
    // This used to be a T(...) static-type reference into the old TenantContextHolder. The SDK's
    // tenant context is an injected bean, not a static, so SpEL reaches it by bean name instead —
    // hence CurrentTenant being registered as @Component("currentTenant"). Note this expression is
    // resolved at runtime: a typo here compiles fine and fails only when the cache is first used.
    @Cacheable(value = "dashboard", key = "'dashboard:' + @currentTenant.organizationId() + ':summary'")
    public DashboardSummaryResponse getDashboardSummary() {
    // docs:end
        UUID organizationId = currentTenant.organizationId();

        long totalProducts = productRepository.countByOrganizationId(organizationId);
        long totalWarehouses = warehouseRepository.countByOrganizationId(organizationId);
        long totalAvailableInventory = inventoryRepository.sumAvailableQuantityByOrganizationId(organizationId);
        long pendingOrders = orderRepository.countByOrganizationIdAndStatus(organizationId, Order.Status.PENDING);
        long completedOrders = orderRepository.countByOrganizationIdAndStatus(organizationId, Order.Status.COMPLETED);
        // Was a second hardcoded `10` here, independent of InventoryService's own threshold —
        // the two could silently drift. See KNOWN_LIMITATIONS.md "Addressed in this pass".
        long lowStockProducts = inventoryRepository.countLowStockByOrganizationId(organizationId, InventoryService.LOW_STOCK_THRESHOLD);

        List<Order> recentOrders = orderRepository.findTop5ByOrganizationIdOrderByCreatedAtDesc(organizationId);
        // One query for all their customers, scoped to the organization (was one findById per order).
        Map<UUID, String> customerNames = customerRepository.findByOrganizationIdAndIdIn(organizationId,
                        recentOrders.stream().map(Order::getCustomerId).collect(Collectors.toSet()))
                .stream()
                .collect(Collectors.toMap(Customer::getId, Customer::getName));
        List<DashboardSummaryResponse.RecentOrder> recentOrderResponses = recentOrders.stream()
                .map(order -> new DashboardSummaryResponse.RecentOrder(
                        order.getId(),
                        customerNames.getOrDefault(order.getCustomerId(), "Unknown"),
                        order.getTotalAmount(),
                        order.getStatus().name()
                ))
                .collect(Collectors.toList());

        return new DashboardSummaryResponse(
                totalProducts,
                totalWarehouses,
                totalAvailableInventory,
                pendingOrders,
                completedOrders,
                lowStockProducts,
                recentOrderResponses
        );
    }
}
