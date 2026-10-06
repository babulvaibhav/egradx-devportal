package com.egradx.oim.product.application;

import com.egradx.audit.EgradxAuditor;
import com.egradx.core.audit.EgradxAuditEvent;
import com.egradx.oim.common.audit.OimAuditActions;
import com.egradx.oim.common.exception.ResourceConflictException;
import com.egradx.oim.common.exception.ResourceNotFoundException;
import com.egradx.oim.common.tenant.CurrentTenant;
import com.egradx.oim.dashboard.application.DashboardCacheEvictor;
import com.egradx.oim.product.domain.Product;
import com.egradx.oim.product.infrastructure.ProductRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class ProductService {

    private final ProductRepository productRepository;
    private final EgradxAuditor auditor;
    private final DashboardCacheEvictor dashboardCacheEvictor;
    private final CurrentTenant currentTenant;

    public ProductService(ProductRepository productRepository, EgradxAuditor auditor,
                           DashboardCacheEvictor dashboardCacheEvictor, CurrentTenant currentTenant) {
        this.productRepository = productRepository;
        this.auditor = auditor;
        this.dashboardCacheEvictor = dashboardCacheEvictor;
        this.currentTenant = currentTenant;
    }

    @Transactional
    public ProductResponse createProduct(ProductRequest request) {
        UUID organizationId = currentTenant.organizationId();

        if (productRepository.existsByOrganizationIdAndSku(organizationId, request.sku())) {
            throw new ResourceConflictException("Product with SKU " + request.sku() + " already exists in this organization");
        }

        Product product = new Product(
            organizationId,
            request.sku(),
            request.name(),
            request.description(),
            request.price()
        );

        if (request.status() != null) {
            product.setStatus(request.status());
        }

        // docs:region create-product-audit (apps/egradx-devportal shows this)
        Product saved = productRepository.save(product);
        ProductResponse response = ProductResponse.from(saved);
        auditor.record(EgradxAuditEvent.of(OimAuditActions.PRODUCT_CREATED)
            .organization(organizationId)
            .entity("product", saved.getId(), saved.getName())
            .after(response)
            .build());
        // docs:end
        dashboardCacheEvictor.evict(organizationId);
        return response;
    }

    @Transactional
    public ProductResponse updateProduct(UUID id, ProductRequest request) {
        UUID organizationId = currentTenant.organizationId();

        Product product = productRepository.findByIdAndOrganizationId(id, organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Product not found"));

        if (!product.getSku().equals(request.sku()) &&
            productRepository.existsByOrganizationIdAndSku(organizationId, request.sku())) {
            throw new ResourceConflictException("Product with SKU " + request.sku() + " already exists in this organization");
        }

        // docs:region update-product-audit
        ProductResponse before = ProductResponse.from(product);
        product.setSku(request.sku());
        product.setName(request.name());
        product.setDescription(request.description());
        product.setPrice(request.price());

        if (request.status() != null) {
            product.setStatus(request.status());
        }

        Product saved = productRepository.save(product);
        ProductResponse response = ProductResponse.from(saved);
        auditor.record(EgradxAuditEvent.of(OimAuditActions.PRODUCT_UPDATED)
            .organization(organizationId)
            .entity("product", saved.getId(), saved.getName())
            .before(before)
            .after(response)
            .build());
        // docs:end
        dashboardCacheEvictor.evict(organizationId);
        return response;
    }

    @Transactional
    public void disableProduct(UUID id) {
        UUID organizationId = currentTenant.organizationId();

        Product product = productRepository.findByIdAndOrganizationId(id, organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Product not found"));

        ProductResponse before = ProductResponse.from(product);
        product.setStatus(Product.Status.DISABLED);
        Product saved = productRepository.save(product);
        auditor.record(EgradxAuditEvent.of(OimAuditActions.PRODUCT_DISABLED)
            .organization(organizationId)
            .entity("product", id, saved.getName())
            .before(before)
            .after(ProductResponse.from(saved))
            .build());
        dashboardCacheEvictor.evict(organizationId);
    }

    public ProductResponse getProduct(UUID id) {
        UUID organizationId = currentTenant.organizationId();
        
        Product product = productRepository.findByIdAndOrganizationId(id, organizationId)
            .orElseThrow(() -> new ResourceNotFoundException("Product not found"));
        
        return ProductResponse.from(product);
    }

    public Page<ProductResponse> getProducts(Pageable pageable) {
        UUID organizationId = currentTenant.organizationId();
        
        return productRepository.findByOrganizationId(organizationId, pageable)
            .map(ProductResponse::from);
    }

    public Page<ProductResponse> searchProducts(String search, Pageable pageable) {
        UUID organizationId = currentTenant.organizationId();
        
        return productRepository.findByOrganizationIdAndSearch(organizationId, search, pageable)
            .map(ProductResponse::from);
    }

    public Page<ProductResponse> getProductsByStatus(Product.Status status, Pageable pageable) {
        UUID organizationId = currentTenant.organizationId();
        
        return productRepository.findByOrganizationIdAndStatus(organizationId, status, pageable)
            .map(ProductResponse::from);
    }
}
