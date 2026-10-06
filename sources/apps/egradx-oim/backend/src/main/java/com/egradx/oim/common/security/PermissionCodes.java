package com.egradx.oim.common.security;

import com.egradx.audit.EgradxAuditAuthorities;

import java.util.List;

/**
 * Every authority string <em>this application</em> defines — its business vocabulary.
 *
 * <p>Identity and access permissions are deliberately absent: managing users, roles and
 * organizations is egradx-auth's own surface now, gated by its own {@code egradx.*} authorities
 * (see {@link com.egradx.auth.EgradxAuthorities}), which it seeds itself. This app defines only
 * what is meaningful to an order and inventory platform — nothing here has an equivalent in any
 * other product, which is exactly why it isn't in the SDK.</p>
 *
 * <p>These are referenced by the {@code @PreAuthorize} annotations on this app's business
 * controllers, and seeded into the SDK's authority catalog at startup by {@code DataSeeder}.
 * {@code description}/{@code category} exist so the SDK's permission catalog endpoint can feed a
 * grouped permission matrix.</p>
 */
public final class PermissionCodes {

    private PermissionCodes() {
    }

    // docs:region permission-catalog
    public static final String PRODUCT_READ = "product.read";
    public static final String PRODUCT_WRITE = "product.write";
    public static final String WAREHOUSE_READ = "warehouse.read";
    public static final String WAREHOUSE_WRITE = "warehouse.write";
    public static final String INVENTORY_READ = "inventory.read";
    public static final String INVENTORY_UPDATE = "inventory.update";
    public static final String ORDER_READ = "order.read";
    public static final String ORDER_CREATE = "order.create";
    public static final String ORDER_CANCEL = "order.cancel";
    public static final String CUSTOMER_READ = "customer.read";
    public static final String CUSTOMER_WRITE = "customer.write";

    /** One entry of the catalog seeded into the SDK. */
    public record Authority(String code, String description, String category) {
    }

    /** Every authority this application defines, with the metadata an admin UI groups by. */
    public static final List<Authority> CATALOG = List.of(
        new Authority(PRODUCT_READ, "View products", "product"),
        new Authority(PRODUCT_WRITE, "Create, edit and disable products", "product"),
        new Authority(WAREHOUSE_READ, "View warehouses", "warehouse"),
        new Authority(WAREHOUSE_WRITE, "Create, edit and disable warehouses", "warehouse"),
        new Authority(INVENTORY_READ, "View inventory levels", "inventory"),
        new Authority(INVENTORY_UPDATE, "Adjust, transfer and reserve inventory", "inventory"),
        new Authority(ORDER_READ, "View orders", "order"),
        new Authority(ORDER_CREATE, "Create orders and advance their status", "order"),
        new Authority(ORDER_CANCEL, "Cancel orders", "order"),
        new Authority(CUSTOMER_READ, "View customers", "customer"),
        new Authority(CUSTOMER_WRITE, "Create and edit customers", "customer")
    );
    // docs:end

    /**
     * What this product adds to the {@code Admin} role egradx-auth creates for every new
     * organization — the business half. The identity half (managing that organization's users and
     * roles) is already on that role, put there by the SDK.
     */
    public static final List<String> DEFAULT_ADMIN = List.of(
        PRODUCT_READ, PRODUCT_WRITE,
        WAREHOUSE_READ, WAREHOUSE_WRITE,
        INVENTORY_READ, INVENTORY_UPDATE,
        ORDER_READ, ORDER_CREATE, ORDER_CANCEL,
        CUSTOMER_READ, CUSTOMER_WRITE
    );

    /**
     * Default authority set for a newly-created organization's Manager role. Reading the audit trail is
     * egradx-audit's authority, not this app's: Admin already has it from the SDK; Manager is given it here.
     */
    public static final List<String> DEFAULT_MANAGER = List.of(
        PRODUCT_READ, PRODUCT_WRITE,
        WAREHOUSE_READ, WAREHOUSE_WRITE,
        INVENTORY_READ, INVENTORY_UPDATE,
        ORDER_READ, ORDER_CREATE, ORDER_CANCEL,
        CUSTOMER_READ, CUSTOMER_WRITE,
        EgradxAuditAuthorities.READ
    );

    /** Default authority set for a newly-created organization's Staff role. */
    public static final List<String> DEFAULT_STAFF = List.of(
        PRODUCT_READ,
        WAREHOUSE_READ,
        INVENTORY_READ,
        ORDER_READ, ORDER_CREATE,
        CUSTOMER_READ
    );

    /**
     * {@code Admin} is egradx-auth's, not this app's — it creates one for every organization and
     * names it from {@code egradx.auth.default-admin-role-name}. The constant is kept here only
     * so seed code can refer to it; {@code Manager} and {@code Staff} are this product's own.
     *
     * <p>There is no "Platform Owner" role any more. Administering the platform is membership of
     * the platform organization, which egradx-auth seeds and whose own {@code Admin} role holds
     * the {@code egradx.organization.*} permissions — and those the SDK now actively refuses to
     * grant to any other organization's role, which is what closes the escalation gap this
     * constant used to carry a warning about.</p>
     */
    public static final String ROLE_NAME_ADMIN = "Admin";
    public static final String ROLE_NAME_MANAGER = "Manager";
    public static final String ROLE_NAME_STAFF = "Staff";
}
