package com.acme.notes;

import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import com.egradx.auth.EgradxOrganizationProvisioningService;
import com.egradx.auth.EgradxRoleService;
import com.egradx.auth.dto.EgradxCreateAuthorityRequest;
import com.egradx.auth.dto.EgradxCreateOrganizationRequest;
import com.egradx.auth.event.EgradxOrganizationCreatedEvent;
import com.egradx.auth.repository.EgradxUserRepository;

/** The application's own permissions, and a demo organization to sign in to. */
@Component
@Order(100) // after the SDK's own start-up seeding
class Setup implements CommandLineRunner {

    static final String NOTE_READ = "note.read";
    static final String NOTE_WRITE = "note.write";
    static final String DEMO_ADMIN = "ada@example.com";

    private final EgradxRoleService roles;
    private final EgradxOrganizationProvisioningService provisioning;
    private final EgradxUserRepository users;
    private final String demoPassword;

    Setup(EgradxRoleService roles, EgradxOrganizationProvisioningService provisioning, EgradxUserRepository users,
            @Value("${DEMO_PASSWORD:demo-password}") String demoPassword) {
        this.roles = roles;
        this.provisioning = provisioning;
        this.users = users;
        this.demoPassword = demoPassword;
    }

    // docs:region seed-permission
    @Override
    public void run(String... args) {
        // The application's permissions, in the SDK's catalog (once).
        Set<String> known = roles.listAuthorities().stream().map(authority -> authority.name()).collect(Collectors.toSet());
        if (!known.contains(NOTE_READ)) {
            roles.createAuthority(new EgradxCreateAuthorityRequest(NOTE_READ, "See the organization's notes", "note"));
        }
        if (!known.contains(NOTE_WRITE)) {
            roles.createAuthority(new EgradxCreateAuthorityRequest(NOTE_WRITE, "Create, change and delete notes", "note"));
        }
        // A demo organization with its first administrator, created as the SDK creates any organization.
        if (users.findByUsername(DEMO_ADMIN).isEmpty()) {
            provisioning.provisionOrganization(new EgradxCreateOrganizationRequest("Demo",
                    new EgradxCreateOrganizationRequest.Admin(DEMO_ADMIN, DEMO_ADMIN, demoPassword, "Ada Admin")));
        }
    }

    /** Every new organization's Admin role gets the application's permissions, in the same transaction. */
    @EventListener
    public void onOrganizationCreated(EgradxOrganizationCreatedEvent event) {
        roles.addAuthoritiesToRole(event.organizationId(), event.adminRoleName(), Set.of(NOTE_READ, NOTE_WRITE));
    }
    // docs:end
}
