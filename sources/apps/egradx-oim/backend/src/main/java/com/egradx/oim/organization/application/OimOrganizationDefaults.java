package com.egradx.oim.organization.application;

import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import com.egradx.auth.EgradxRoleService;
import com.egradx.auth.event.EgradxOrganizationCreatedEvent;
import com.egradx.oim.common.security.PermissionCodes;

/**
 * What a new organization starts with <em>in this product</em>.
 *
 * <p>egradx-auth guarantees every organization an {@code Admin} role and a first administrator,
 * and stops there — deliberately, because "which roles should a new tenant have" is a product
 * decision, not an authentication one. This is where that decision lives for an order and
 * inventory platform: Admin also gets the business permissions, and Manager and Staff exist from
 * day one. A different product built on the same SDK would write a different class here and
 * nothing else — a school might seed teaching-staff and administrative-staff instead.</p>
 *
 * <p>This is the entirety of what this application does about roles. There is no role controller,
 * no user controller and no organization controller anywhere in it: those are the SDK's, and its
 * frontend calls them directly.</p>
 */
@Component
public class OimOrganizationDefaults {

    private static final Logger log = LoggerFactory.getLogger(OimOrganizationDefaults.class);

    private final EgradxRoleService roleService;

    public OimOrganizationDefaults(EgradxRoleService roleService) {
        this.roleService = roleService;
    }

    /**
     * Runs inside the SDK's provisioning transaction, before the first administrator is created —
     * so the roles below exist by the time anyone can log in, and if this throws, the whole
     * organization is rolled back rather than left half-built.
     */
    // docs:region organization-defaults
    @EventListener
    public void onOrganizationCreated(EgradxOrganizationCreatedEvent event) {
        // The SDK seeded Admin with the permissions to manage users and roles; this adds what it
        // means to administer *this* product on top, rather than replacing a role we didn't create.
        roleService.addAuthoritiesToRole(event.organizationId(), event.adminRoleName(),
                Set.copyOf(PermissionCodes.DEFAULT_ADMIN));

        roleService.createSystemRole(event.organizationId(), PermissionCodes.ROLE_NAME_MANAGER,
                "Products, inventory and orders", Set.copyOf(PermissionCodes.DEFAULT_MANAGER));
        roleService.createSystemRole(event.organizationId(), PermissionCodes.ROLE_NAME_STAFF,
                "Read access plus order creation", Set.copyOf(PermissionCodes.DEFAULT_STAFF));
    // docs:end

        log.info("Seeded default roles for organization '{}': {}, {}, {}", event.organizationName(),
                event.adminRoleName(), PermissionCodes.ROLE_NAME_MANAGER, PermissionCodes.ROLE_NAME_STAFF);
    }
}
