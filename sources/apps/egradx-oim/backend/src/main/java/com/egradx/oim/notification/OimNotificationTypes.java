package com.egradx.oim.notification;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.egradx.notification.template.EgradxNotificationType;

/**
 * The messages this application sends outside the app. Declaring a type is what lets its templates
 * (under {@code notification-templates/}) be checked at startup, and what lets an organization's
 * administrator reword them.
 */
@Configuration(proxyBeanMethods = false)
public class OimNotificationTypes {

    /**
     * The low-stock alert. People may opt out of it on their notification settings page, so bulk
     * sends skip them without being asked to.
     */
    @Bean
    // docs:region notification-type
    EgradxNotificationType oimInventoryLow() {
        return EgradxNotificationType.builder(OimNotificationKeys.INVENTORY_LOW)
            .description("Stock of a product in a warehouse fell below the low-stock threshold")
            .requires("productName", "productSku", "warehouseName", "remainingQuantity", "threshold")
            .userCanOptOut()
            .build();
    }
    // docs:end
}
