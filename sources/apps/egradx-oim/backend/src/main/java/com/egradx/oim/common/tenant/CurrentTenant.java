package com.egradx.oim.common.tenant;

import java.util.UUID;

import org.springframework.stereotype.Component;

import com.egradx.auth.security.EgradxTenantContext;
import com.egradx.auth.security.EgradxTenantContextAccessor;
import com.egradx.oim.common.exception.TenantAccessDeniedException;

/**
 * This application's one adapter onto the SDK's request-scoped tenant
 * context.
 *
 * <p>Before the move to egradx-auth this was a static {@code TenantContextHolder}
 * that ~50 call sites reached into directly. The SDK deliberately exposes
 * {@link EgradxTenantContextAccessor} as an <em>injectable interface</em>
 * instead of a static holder (so it can be faked in tests and swapped for a
 * reactive implementation later), which means the "no context" case has to be
 * unwrapped somewhere. Doing that in one place — here — keeps every call site
 * a one-liner and gives a single, honest answer to "what does it mean to ask
 * for the organization when nobody is authenticated".</p>
 *
 * <p>Registered as the bean name {@code currentTenant} because
 * {@code DashboardService}'s {@code @Cacheable} key references it by name in
 * SpEL — see that class.</p>
 */
@Component("currentTenant")
public class CurrentTenant {

	private final EgradxTenantContextAccessor accessor;

	public CurrentTenant(EgradxTenantContextAccessor accessor) {
		this.accessor = accessor;
	}

	/**
	 * The organization the caller is acting in.
	 *
	 * <p>Note a platform administrator <em>does</em> get an organization here — the platform
	 * organization, which is a real one. They simply have no business data in it, so this app's
	 * screens are empty rather than forbidden for them, and its endpoints refuse them on
	 * authorities instead (they hold none of this app's).</p>
	 *
	 * @throws TenantAccessDeniedException if there is no authenticated caller on this request, or
	 *         the caller belongs to no organization at all
	 */
	// docs:region current-tenant
	public UUID organizationId() {
		UUID organizationId = require().organizationId();
		if (organizationId == null) {
			throw new TenantAccessDeniedException("This operation requires acting within an organization");
		}
		return organizationId;
	}

	/**
	 * @throws TenantAccessDeniedException if there is no authenticated caller on this request
	 */
	public UUID userId() {
		return require().userId();
	}

	/**
	 * Whether the caller holds this authority right now. Resolved fresh from
	 * the database on every request by the SDK, so this reflects a role edit
	 * immediately rather than whatever was true when the token was issued.
	 */
	public boolean hasAuthority(String authority) {
		return accessor.current().map(context -> context.hasAuthority(authority)).orElse(false);
	}
	// docs:end

	public boolean isPlatformSession() {
		return accessor.current().map(EgradxTenantContext::platformSession).orElse(false);
	}

	private EgradxTenantContext require() {
		return accessor.current()
				.orElseThrow(() -> new TenantAccessDeniedException("No authenticated caller on this request"));
	}
}
