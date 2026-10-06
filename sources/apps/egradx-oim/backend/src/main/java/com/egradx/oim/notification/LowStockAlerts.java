package com.egradx.oim.notification;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

import com.egradx.notification.EgradxChannel;
import com.egradx.notification.delivery.EgradxChannelRegistry;
import com.egradx.notification.messenger.EgradxMessageRequest;
import com.egradx.notification.messenger.EgradxMessenger;
import com.egradx.notification.messenger.EgradxSendReceipt;
import com.egradx.observability.EgradxMetrics;
import com.egradx.observability.EgradxObservations;
import com.egradx.oim.product.infrastructure.ProductRepository;
import com.egradx.oim.warehouse.infrastructure.WarehouseRepository;

/**
 * Sends the low-stock alert on the organization's outbound channels — email, Slack, WhatsApp, SMS —
 * to every member who has an address on that channel and has not opted out.
 *
 * <p><b>Best effort, never in the way.</b> It runs only after the inventory change has committed,
 * and each channel's send runs in a transaction of its own; any failure is logged and counted, never
 * thrown. Three reasons it is not simply called inside the inventory transaction:</p>
 * <ul>
 *   <li>a failure inside the messenger (it is {@code @Transactional}) would mark the inventory
 *       transaction rollback-only even if caught here, and a stock adjustment would fail because,
 *       say, a template had been edited badly;</li>
 *   <li>an order that crosses the threshold on its first line and then fails on its second rolls
 *       back — an alert sent in the meantime would describe stock that never changed;</li>
 *   <li>an exception thrown after commit still reaches the caller as an error, for a change that
 *       did happen.</li>
 * </ul>
 * <p>The price: an alert is lost if the process stops between the commit and this listener. The
 * in-app low-stock notification is written in the inventory transaction and is the durable record.</p>
 *
 * <p>Which channels: {@code app.notifications.low-stock.channels}, each skipped quietly while the
 * organization has not configured it. A bulk send reaches only members with a verified address on
 * the channel (for email, their sign-in address will do); the rest are counted as unreachable on the
 * bulk send, visible in the delivery log.</p>
 */
@Component
public class LowStockAlerts {

    private static final Logger log = LoggerFactory.getLogger(LowStockAlerts.class);

    private final EgradxMessenger messenger;
    private final EgradxChannelRegistry channels;
    private final ProductRepository products;
    private final WarehouseRepository warehouses;
    private final EgradxMetrics metrics;
    private final TransactionTemplate newTransaction;
    private final TransactionTemplate newReadOnlyTransaction;
    private final List<String> channelIds;

    public LowStockAlerts(EgradxMessenger messenger, EgradxChannelRegistry channels, ProductRepository products,
                          WarehouseRepository warehouses, EgradxMetrics metrics,
                          PlatformTransactionManager transactionManager,
                          @Value("${app.notifications.low-stock.channels:email,slack,whatsapp,sms}") String channelIds) {
        this.messenger = messenger;
        this.channels = channels;
        this.products = products;
        this.warehouses = warehouses;
        this.metrics = metrics;
        this.newTransaction = new TransactionTemplate(transactionManager);
        this.newTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.newReadOnlyTransaction = new TransactionTemplate(transactionManager);
        this.newReadOnlyTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.newReadOnlyTransaction.setReadOnly(true);
        this.channelIds = Arrays.stream(channelIds.split(",")).map(String::trim).filter(id -> !id.isEmpty()).toList();
    }

    // After commit, the finished transaction is still bound to the thread: a REQUIRED call would join
    // it and never commit. Hence REQUIRES_NEW for everything below.
    // docs:region low-stock-alert
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onLowStock(LowStockDetected event) {
        try {
            Map<String, Object> model = newReadOnlyTransaction.execute(status -> describe(event));
            for (String channelId : channelIds) {
                sendOn(channelId, event, model);
            }
        } catch (RuntimeException e) {
            log.warn("Low-stock alert for inventory {} not sent: {}", event.inventoryId(), e.toString());
        }
    }

    private void sendOn(String channelId, LowStockDetected event, Map<String, Object> model) {
        EgradxChannel channel = EgradxChannel.of(channelId);
        Optional<String> unavailable = channels.find(channel)
            .map(registered -> registered.unavailableFor(event.organizationId()))
            .orElse(Optional.of("no such channel is installed"));
        if (unavailable.isPresent()) {
            log.debug("Low-stock alert not sent on {}: {}", channelId, unavailable.get());
            count(channelId, "skipped");
            return;
        }
        try {
            EgradxSendReceipt receipt = newTransaction.execute(status -> messenger.send(EgradxMessageRequest.on(channel)
                .organization(event.organizationId())
                .template(OimNotificationKeys.INVENTORY_LOW, model)
                .toOrganizationMembers()
                .build()));
            log.info("Low-stock alert queued on {} for up to {} member(s) (bulk send {})", channelId,
                receipt == null ? 0 : receipt.recipients(), receipt == null ? null : receipt.bulkSendId());
            count(channelId, "queued");
        } catch (RuntimeException e) {
            log.warn("Low-stock alert not queued on {}: {}", channelId, e.toString());
            count(channelId, "failed");
        }
    }
    // docs:end

    private Map<String, Object> describe(LowStockDetected event) {
        Map<String, Object> model = new LinkedHashMap<>();
        products.findByIdAndOrganizationId(event.productId(), event.organizationId()).ifPresentOrElse(product -> {
            model.put("productName", product.getName());
            model.put("productSku", product.getSku());
        }, () -> {
            model.put("productName", "Product " + event.productId());
            model.put("productSku", "-");
        });
        model.put("warehouseName", warehouses.findByIdAndOrganizationId(event.warehouseId(), event.organizationId())
            .map(warehouse -> warehouse.getName()).orElse("Warehouse " + event.warehouseId()));
        model.put("remainingQuantity", event.remainingQuantity());
        model.put("threshold", event.threshold());
        return model;
    }

    private void count(String channelId, String outcome) {
        try {
            metrics.increment("egradx.oim.low_stock.alert", EgradxObservations.CHANNEL, channelId,
                EgradxObservations.OUTCOME, outcome);
        } catch (RuntimeException e) {
            log.debug("Could not count a low-stock alert", e);
        }
    }
}
