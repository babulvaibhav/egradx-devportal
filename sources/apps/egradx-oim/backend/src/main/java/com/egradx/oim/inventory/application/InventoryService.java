package com.egradx.oim.inventory.application;

import com.egradx.audit.EgradxAuditor;
import com.egradx.core.audit.EgradxAuditEvent;
import com.egradx.oim.common.audit.OimAuditActions;
import com.egradx.oim.common.exception.InsufficientInventoryException;
import com.egradx.oim.common.exception.ResourceConflictException;
import com.egradx.oim.common.exception.ResourceNotFoundException;
import com.egradx.oim.common.tenant.CurrentTenant;
import com.egradx.oim.dashboard.application.DashboardCacheEvictor;
import com.egradx.oim.inventory.domain.Inventory;
import com.egradx.oim.inventory.infrastructure.InventoryRepository;
import com.egradx.oim.notification.OimNotifications;
import com.egradx.oim.product.infrastructure.ProductRepository;
import com.egradx.oim.warehouse.infrastructure.WarehouseRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class InventoryService {

    /** Matches the threshold DashboardService uses to count "low stock" rows. */
    public static final int LOW_STOCK_THRESHOLD = 10;

    private final InventoryRepository inventoryRepository;
    private final WarehouseRepository warehouseRepository;
    private final ProductRepository productRepository;
    private final OimNotifications notifications;
    private final EgradxAuditor auditor;
    private final DashboardCacheEvictor dashboardCacheEvictor;
    private final CurrentTenant currentTenant;

    public InventoryService(InventoryRepository inventoryRepository, WarehouseRepository warehouseRepository,
                             ProductRepository productRepository, OimNotifications notifications,
                             EgradxAuditor auditor, DashboardCacheEvictor dashboardCacheEvictor, CurrentTenant currentTenant) {
        this.inventoryRepository = inventoryRepository;
        this.warehouseRepository = warehouseRepository;
        this.productRepository = productRepository;
        this.notifications = notifications;
        this.auditor = auditor;
        this.dashboardCacheEvictor = dashboardCacheEvictor;
        this.currentTenant = currentTenant;
    }

    @Transactional
    public InventoryResponse createInventory(InventoryRequest request) {
        UUID organizationId = currentTenant.organizationId();

        // Defense in depth: the warehouse/product FKs in the schema are single-column, so nothing
        // at the DB level stops a row referencing another tenant's warehouse/product. Confirm both
        // belong to the caller's organization before creating the inventory row.
        warehouseRepository.findByIdAndOrganizationId(request.warehouseId(), organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Warehouse not found"));
        productRepository.findByIdAndOrganizationId(request.productId(), organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Product not found"));

        Inventory existing = inventoryRepository.findByOrganizationIdAndWarehouseIdAndProductId(
            organizationId, request.warehouseId(), request.productId()
        ).orElse(null);

        if (existing != null) {
            throw new ResourceConflictException("Inventory already exists for this warehouse and product");
        }

        Inventory inventory = new Inventory(
            organizationId,
            request.warehouseId(),
            request.productId(),
            request.quantity(),
            0
        );

        Inventory saved = inventoryRepository.save(inventory);
        InventoryResponse response = InventoryResponse.from(saved);
        auditor.record(EgradxAuditEvent.of(OimAuditActions.INVENTORY_CREATED)
            .organization(organizationId)
            .entity("inventory", saved.getId())
            .after(response)
            .build());
        dashboardCacheEvictor.evict(organizationId);
        return response;
    }

    @Transactional
    public InventoryResponse adjustInventory(InventoryAdjustRequest request) {
        UUID organizationId = currentTenant.organizationId();

        Inventory before = inventoryRepository.findByIdAndOrganizationId(request.inventoryId(), organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Inventory not found"));
        InventoryResponse beforeResponse = InventoryResponse.from(before);

        // Atomic conditional update — never a read-modify-write, so concurrent adjustments can't lose an update.
        int affectedRows = request.quantity() >= 0
            ? inventoryRepository.addInventory(request.inventoryId(), organizationId, request.quantity())
            : inventoryRepository.subtractInventory(request.inventoryId(), organizationId, -request.quantity());

        if (affectedRows == 0) {
            throw new InsufficientInventoryException("Insufficient inventory for adjustment");
        }

        Inventory saved = inventoryRepository.findByIdAndOrganizationId(request.inventoryId(), organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Inventory not found"));
        InventoryResponse response = InventoryResponse.from(saved);

        auditor.record(EgradxAuditEvent.of(OimAuditActions.INVENTORY_ADJUSTED)
            .organization(organizationId)
            .entity("inventory", saved.getId())
            .before(beforeResponse)
            .after(response)
            .build());
        notifications.inventoryUpdated(organizationId, response);
        notifyIfLowStockCrossed(organizationId, saved, -request.quantity());
        dashboardCacheEvictor.evict(organizationId);

        return response;
    }

    @Transactional
    public void transferInventory(InventoryTransferRequest request) {
        UUID organizationId = currentTenant.organizationId();

        if (request.sourceWarehouseId().equals(request.destinationWarehouseId())) {
            throw new ResourceConflictException("Source and destination warehouses cannot be the same");
        }

        // Defense in depth: confirm both warehouses and the product belong to the caller's
        // organization before touching any inventory row.
        warehouseRepository.findByIdAndOrganizationId(request.sourceWarehouseId(), organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Source warehouse not found"));
        warehouseRepository.findByIdAndOrganizationId(request.destinationWarehouseId(), organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Destination warehouse not found"));
        productRepository.findByIdAndOrganizationId(request.productId(), organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Product not found"));

        Inventory source = inventoryRepository.findByOrganizationIdAndWarehouseIdAndProductId(
            organizationId, request.sourceWarehouseId(), request.productId()
        ).orElseThrow(() -> new ResourceNotFoundException("Source inventory not found"));

        Inventory destination = inventoryRepository.findByOrganizationIdAndWarehouseIdAndProductId(
            organizationId, request.destinationWarehouseId(), request.productId()
        ).orElse(null);

        // docs:region transfer-lock-order
        // Deterministic lock order between the two existing rows (lower UUID first) so two
        // transfers running in opposite directions (A->B and B->A) can't deadlock at the database
        // level. Only matters when both rows already exist; a brand-new destination row has
        // nothing to lock against yet.
        boolean sourceFirst = destination == null || source.getId().compareTo(destination.getId()) <= 0;

        if (sourceFirst) {
            debitSource(source, organizationId, request.quantity());
            creditDestination(destination, organizationId, request);
        } else {
            creditDestination(destination, organizationId, request);
            debitSource(source, organizationId, request.quantity());
        }
        // docs:end

        Inventory refreshedSource = inventoryRepository.findByIdAndOrganizationId(source.getId(), organizationId).orElse(source);

        auditor.record(EgradxAuditEvent.of(OimAuditActions.INVENTORY_TRANSFERRED)
            .organization(organizationId)
            .entity("inventory", source.getId())
            .detail("productId", request.productId())
            .detail("fromWarehouseId", request.sourceWarehouseId())
            .detail("toWarehouseId", request.destinationWarehouseId())
            .detail("quantity", request.quantity())
            .build());
        notifications.inventoryTransferred(organizationId, request);
        notifyIfLowStockCrossed(organizationId, refreshedSource, request.quantity());
        dashboardCacheEvictor.evict(organizationId);
    }

    private void debitSource(Inventory source, UUID organizationId, Integer quantity) {
        // Atomic, floor-guarded debit — replaces the old read-then-write (lost-update race).
        int debited = inventoryRepository.subtractInventory(source.getId(), organizationId, quantity);
        if (debited == 0) {
            throw new InsufficientInventoryException("Insufficient inventory in source warehouse");
        }
    }

    private void creditDestination(Inventory destination, UUID organizationId, InventoryTransferRequest request) {
        if (destination == null) {
            inventoryRepository.save(new Inventory(
                organizationId, request.destinationWarehouseId(), request.productId(), request.quantity(), 0
            ));
        } else {
            inventoryRepository.addInventory(destination.getId(), organizationId, request.quantity());
        }
    }

    @Transactional
    public void reserveInventory(UUID inventoryId, Integer quantity) {
        UUID organizationId = currentTenant.organizationId();

        // ATOMIC RESERVATION - Critical for concurrency control
        int affectedRows = inventoryRepository.reserveInventory(inventoryId, organizationId, quantity);

        if (affectedRows == 0) {
            throw new InsufficientInventoryException("Requested quantity is unavailable");
        }

        inventoryRepository.findByIdAndOrganizationId(inventoryId, organizationId)
            .ifPresent(inventory -> notifyIfLowStockCrossed(organizationId, inventory, quantity));
        dashboardCacheEvictor.evict(organizationId);
    }

    @Transactional
    public void releaseInventory(UUID inventoryId, Integer quantity) {
        UUID organizationId = currentTenant.organizationId();

        int affectedRows = inventoryRepository.releaseInventory(inventoryId, organizationId, quantity);

        if (affectedRows == 0) {
            throw new ResourceConflictException("Failed to release inventory - insufficient reserved quantity");
        }
        dashboardCacheEvictor.evict(organizationId);
    }

    /**
     * Finalizes a reservation when an order completes: the stock has shipped, so it comes off
     * {@code reservedQuantity} for good rather than going back to {@code availableQuantity}
     * (that's {@link #releaseInventory}, used for cancellations instead). Without this,
     * reservedQuantity for completed orders is never cleared and grows without bound.
     */
    @Transactional
    public void consumeReservedInventory(UUID inventoryId, Integer quantity) {
        UUID organizationId = currentTenant.organizationId();

        int affectedRows = inventoryRepository.consumeReservedInventory(inventoryId, organizationId, quantity);

        if (affectedRows == 0) {
            throw new ResourceConflictException("Failed to consume reservation - insufficient reserved quantity");
        }
    }

    public InventoryResponse getInventory(UUID id) {
        UUID organizationId = currentTenant.organizationId();

        Inventory inventory = inventoryRepository.findByIdAndOrganizationId(id, organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Inventory not found"));

        return InventoryResponse.from(inventory);
    }

    public Page<InventoryResponse> getInventory(Pageable pageable) {
        UUID organizationId = currentTenant.organizationId();

        return inventoryRepository.findByOrganizationId(organizationId, pageable)
            .map(InventoryResponse::from);
    }

    public Page<InventoryResponse> getInventoryByWarehouse(UUID warehouseId, Pageable pageable) {
        UUID organizationId = currentTenant.organizationId();

        return inventoryRepository.findByOrganizationIdAndWarehouseId(organizationId, warehouseId, pageable)
            .map(InventoryResponse::from);
    }

    public Page<InventoryResponse> getInventoryByProduct(UUID productId, Pageable pageable) {
        UUID organizationId = currentTenant.organizationId();

        return inventoryRepository.findByOrganizationIdAndProductId(organizationId, productId, pageable)
            .map(InventoryResponse::from);
    }

    /**
     * Notifies once, when this change takes available stock from at or above the threshold to below
     * it — not on every change while it stays low, which filled the bell (and would fill inboxes,
     * now that the alert also goes out by email, Slack and WhatsApp). A restock above the threshold
     * re-arms it.
     *
     * <p>"Before" is worked out from the change rather than from a row read earlier: that read took
     * no lock and may be stale, while {@code after} was re-read after the locked update.</p>
     *
     * @param decrease how much this change took off available stock (negative for an increase)
     */
    private void notifyIfLowStockCrossed(UUID organizationId, Inventory after, int decrease) {
        if (crossesBelowThreshold(after.getAvailableQuantity(), decrease)) {
            notifications.inventoryLow(organizationId, after, LOW_STOCK_THRESHOLD);
        }
    }

    static boolean crossesBelowThreshold(int availableAfter, int decrease) {
        return availableAfter < LOW_STOCK_THRESHOLD && availableAfter + decrease >= LOW_STOCK_THRESHOLD;
    }
}
