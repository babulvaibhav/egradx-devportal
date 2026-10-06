package com.egradx.oim.notification;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

import com.egradx.notification.inbox.EgradxInAppMessage;
import com.egradx.notification.inbox.EgradxNotificationPublisher;
import com.egradx.oim.inventory.application.InventoryResponse;
import com.egradx.oim.inventory.application.InventoryTransferRequest;
import com.egradx.oim.inventory.domain.Inventory;
import com.egradx.oim.order.application.OrderResponse;

/**
 * The in-app notifications this application publishes — the bell in the frontend. Each is
 * organization-wide, and each is published inside the caller's transaction, so it exists if and
 * only if the change it describes commits; connected browsers are told after the commit.
 *
 * <p>Before egradx-notification, these went through a domain-event outbox and RabbitMQ to a consumer
 * that dispatched on the event type to a "message strategy" per type. With the publisher called
 * directly there is nothing to dispatch, so each strategy became a method here, keeping its text.</p>
 *
 * <p>Metadata carries ids as strings, for the frontend to link to what the notification is about.</p>
 */
@Component
public class OimNotifications {

    private final EgradxNotificationPublisher publisher;
    private final ApplicationEventPublisher events;

    public OimNotifications(EgradxNotificationPublisher publisher, ApplicationEventPublisher events) {
        this.publisher = publisher;
        this.events = events;
    }

    public void orderCreated(UUID organizationId, OrderResponse order) {
        publish(organizationId, OimNotificationKeys.ORDER_CREATED, "New order",
            "New order created (total: " + plain(order.totalAmount()) + ")",
            meta("orderId", order.id(), "customerId", order.customerId(), "status", order.status(),
                "totalAmount", plain(order.totalAmount()), "itemCount", order.items() == null ? null : order.items().size()));
    }

    public void orderCancelled(UUID organizationId, OrderResponse order) {
        publish(organizationId, OimNotificationKeys.ORDER_CANCELLED, "Order cancelled",
            "Order " + order.id() + " was cancelled",
            meta("orderId", order.id(), "customerId", order.customerId(), "totalAmount", plain(order.totalAmount())));
    }

    public void inventoryUpdated(UUID organizationId, InventoryResponse inventory) {
        publish(organizationId, OimNotificationKeys.INVENTORY_UPDATED, "Inventory updated",
            "Inventory updated: " + inventory.availableQuantity() + " now available",
            meta("inventoryId", inventory.id(), "productId", inventory.productId(),
                "warehouseId", inventory.warehouseId(), "availableQuantity", inventory.availableQuantity(),
                "reservedQuantity", inventory.reservedQuantity()));
    }

    public void inventoryTransferred(UUID organizationId, InventoryTransferRequest transfer) {
        publish(organizationId, OimNotificationKeys.INVENTORY_TRANSFER_COMPLETED, "Transfer completed",
            "Transferred " + transfer.quantity() + " unit(s) between warehouses",
            meta("productId", transfer.productId(), "sourceWarehouseId", transfer.sourceWarehouseId(),
                "destinationWarehouseId", transfer.destinationWarehouseId(), "quantity", transfer.quantity()));
    }

    /**
     * In-app, and — once the transaction commits — an alert on the organization's outbound channels
     * ({@link LowStockAlerts}).
     */
    // docs:region low-stock-in-app
    public void inventoryLow(UUID organizationId, Inventory inventory, int threshold) {
        publish(organizationId, OimNotificationKeys.INVENTORY_LOW, "Low stock",
            "Inventory running low: " + inventory.getAvailableQuantity() + " left",
            meta("inventoryId", inventory.getId(), "productId", inventory.getProductId(),
                "warehouseId", inventory.getWarehouseId(), "remainingQuantity", inventory.getAvailableQuantity(),
                "threshold", threshold));
        events.publishEvent(new LowStockDetected(organizationId, inventory.getId(), inventory.getProductId(),
            inventory.getWarehouseId(), inventory.getAvailableQuantity(), threshold));
    }

    private void publish(UUID organizationId, String key, String title, String body, Map<String, Object> metadata) {
        publisher.publishToOrganization(organizationId, new EgradxInAppMessage(key, title, body, metadata));
    }
    // docs:end

    /** Alternating name, value; nulls are left out (the library refuses null values) and ids become strings. */
    static Map<String, Object> meta(Object... namesAndValues) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        for (int i = 0; i < namesAndValues.length; i += 2) {
            Object value = namesAndValues[i + 1];
            if (value == null) {
                continue;
            }
            metadata.put((String) namesAndValues[i],
                value instanceof Number || value instanceof Boolean ? value : value.toString());
        }
        return metadata;
    }

    private static String plain(java.math.BigDecimal amount) {
        return amount == null ? null : amount.toPlainString();
    }
}
