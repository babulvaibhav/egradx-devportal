package com.egradx.oim.order.infrastructure;

import java.util.UUID;

import org.springframework.stereotype.Component;

import com.egradx.files.spi.EgradxFileAccessPolicy;
import com.egradx.oim.common.security.PermissionCodes;

/**
 * Who may see and add an order's attachments (egradx-file-storage, attachedType {@code order}): those who may see the
 * order may see its files; those who may create orders may add and delete them. An id that is not an order of the
 * caller's organization is refused.
 */
@Component
public class OrderFileAccess implements EgradxFileAccessPolicy {

    private final OrderRepository orders;

    public OrderFileAccess(OrderRepository orders) {
        this.orders = orders;
    }

    @Override
    public String attachedType() {
        return "order";
    }

    @Override
    public Decision decide(Request request) {
        UUID orderId;
        try {
            orderId = UUID.fromString(request.attachedId());
        } catch (IllegalArgumentException notAnId) {
            return Decision.DENY;
        }
        if (orders.findByIdAndOrganizationId(orderId, request.organizationId()).isEmpty()) {
            return Decision.DENY;
        }
        String needed = request.action() == Action.READ ? PermissionCodes.ORDER_READ : PermissionCodes.ORDER_CREATE;
        return request.authorities().contains(needed) ? Decision.ALLOW : Decision.DENY;
    }
}
