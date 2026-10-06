package com.egradx.oim.inventory.infrastructure;

import com.egradx.oim.inventory.domain.Inventory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface InventoryRepository extends JpaRepository<Inventory, UUID> {
    
    Optional<Inventory> findByIdAndOrganizationId(UUID id, UUID organizationId);
    
    Optional<Inventory> findByOrganizationIdAndWarehouseIdAndProductId(
        UUID organizationId, UUID warehouseId, UUID productId
    );
    
    Page<Inventory> findByOrganizationId(UUID organizationId, Pageable pageable);
    
    Page<Inventory> findByOrganizationIdAndWarehouseId(UUID organizationId, UUID warehouseId, Pageable pageable);
    
    Page<Inventory> findByOrganizationIdAndProductId(UUID organizationId, UUID productId, Pageable pageable);
    
    // clearAutomatically = true on every @Modifying query below: without it, a findById/
    // findByIdAndOrganizationId call later in the *same* persistence context can return the
    // entity as Hibernate had it cached before this bulk UPDATE ran, not the row the UPDATE just
    // wrote (stale read). See KNOWN_LIMITATIONS.md "Addressed in this pass".
    //
    // flushAutomatically = true alongside it: clearing discards every change not yet written, so
    // an entity saved earlier in the transaction (a new destination inventory row, an order,
    // a notification) would silently never reach the database. Flushing first writes them.

    // docs:region stock-reserve
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Inventory i SET i.availableQuantity = i.availableQuantity - :quantity, " +
           "i.reservedQuantity = i.reservedQuantity + :quantity " +
           "WHERE i.id = :id AND i.organizationId = :organizationId AND i.availableQuantity >= :quantity")
    int reserveInventory(
        @Param("id") UUID id,
        @Param("organizationId") UUID organizationId,
        @Param("quantity") Integer quantity
    );
    // docs:end

    /**
     * Releases a reservation back to available stock (order cancelled, or a manual /release
     * call). Must restore {@code availableQuantity} as well as decrementing
     * {@code reservedQuantity} — a release that only decremented reservedQuantity would destroy
     * stock instead of returning it. See KNOWN_LIMITATIONS.md "Addressed in this pass".
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Inventory i SET i.availableQuantity = i.availableQuantity + :quantity, " +
           "i.reservedQuantity = i.reservedQuantity - :quantity " +
           "WHERE i.id = :id AND i.organizationId = :organizationId AND i.reservedQuantity >= :quantity")
    int releaseInventory(
        @Param("id") UUID id,
        @Param("organizationId") UUID organizationId,
        @Param("quantity") Integer quantity
    );

    /**
     * Consumes a reservation on order completion: the stock has shipped, so it comes off
     * reservedQuantity permanently without going back to availableQuantity (unlike
     * {@link #releaseInventory}, which is for cancellations). See AGENTS.md §46.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Inventory i SET i.reservedQuantity = i.reservedQuantity - :quantity " +
           "WHERE i.id = :id AND i.organizationId = :organizationId AND i.reservedQuantity >= :quantity")
    int consumeReservedInventory(
        @Param("id") UUID id,
        @Param("organizationId") UUID organizationId,
        @Param("quantity") Integer quantity
    );

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Inventory i SET i.availableQuantity = i.availableQuantity + :quantity " +
           "WHERE i.id = :id AND i.organizationId = :organizationId")
    int addInventory(
        @Param("id") UUID id,
        @Param("organizationId") UUID organizationId,
        @Param("quantity") Integer quantity
    );

    /** Atomic, floor-guarded decrement — used for negative adjustments and transfer debits. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Inventory i SET i.availableQuantity = i.availableQuantity - :quantity " +
           "WHERE i.id = :id AND i.organizationId = :organizationId AND i.availableQuantity >= :quantity")
    int subtractInventory(
        @Param("id") UUID id,
        @Param("organizationId") UUID organizationId,
        @Param("quantity") Integer quantity
    );
    
    @Query("SELECT COALESCE(SUM(i.availableQuantity), 0) FROM Inventory i WHERE i.organizationId = :organizationId")
    long sumAvailableQuantityByOrganizationId(@Param("organizationId") UUID organizationId);
    
    @Query("SELECT COUNT(i) FROM Inventory i WHERE i.organizationId = :organizationId AND i.availableQuantity < :threshold")
    long countLowStockByOrganizationId(@Param("organizationId") UUID organizationId, @Param("threshold") int threshold);
}
