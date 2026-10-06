package com.egradx.oim.dashboard.application;

import com.egradx.oim.common.util.TransactionUtils;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Previously the dashboard cache was pure TTL (up to 60s stale after any mutation) with nothing
 * ever calling evict on it, despite AGENTS.md §22 explicitly asking for eviction on
 * product/inventory/order/warehouse changes. Injected into those services and called after a
 * successful mutation. See KNOWN_LIMITATIONS.md "Addressed in this pass".
 * <p>
 * A separate component (rather than a method on {@link DashboardService} itself) so that
 * product/warehouse/inventory/order services don't need to depend on DashboardService — this is
 * the only thing about the dashboard they need to know about.
 * <p>
 * Uses {@link CacheManager} directly (not a declarative {@code @CacheEvict}) so the actual evict
 * can be deferred to after the caller's transaction commits via {@link TransactionUtils} — the
 * same fix applied to {@code RolePermissionService.evict}: evicting mid-transaction leaves a
 * window where a concurrent read can repopulate the cache with the pre-change value.
 */
@Component
public class DashboardCacheEvictor {

    private final CacheManager cacheManager;

    public DashboardCacheEvictor(CacheManager cacheManager) {
        this.cacheManager = cacheManager;
    }

    public void evict(UUID organizationId) {
        TransactionUtils.runAfterCommit(() -> {
            Cache cache = cacheManager.getCache("dashboard");
            if (cache != null) {
                cache.evict("dashboard:" + organizationId + ":summary");
            }
        });
    }
}
