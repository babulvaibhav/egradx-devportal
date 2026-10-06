package com.egradx.oim.product.api;

import com.egradx.oim.product.application.ProductRequest;
import com.egradx.oim.product.application.ProductResponse;
import com.egradx.oim.product.application.ProductService;
import com.egradx.oim.product.domain.Product;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/v1/products")
public class ProductController {

    private final ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    // docs:region create-product-endpoint (apps/egradx-devportal shows this; keep it compiling)
    @PostMapping
    @PreAuthorize("hasAuthority('product.write')")
    public ResponseEntity<ProductResponse> createProduct(@Valid @RequestBody ProductRequest request) {
        ProductResponse response = productService.createProduct(request);
        return ResponseEntity.ok(response);
    }
    // docs:end

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('product.read')")
    public ResponseEntity<ProductResponse> getProduct(@PathVariable UUID id) {
        ProductResponse response = productService.getProduct(id);
        return ResponseEntity.ok(response);
    }

    @GetMapping
    @PreAuthorize("hasAuthority('product.read')")
    public ResponseEntity<Page<ProductResponse>> getProducts(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Product.Status status,
            Pageable pageable) {
        
        Page<ProductResponse> response;
        if (search != null && !search.isEmpty()) {
            response = productService.searchProducts(search, pageable);
        } else if (status != null) {
            response = productService.getProductsByStatus(status, pageable);
        } else {
            response = productService.getProducts(pageable);
        }
        
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{id}")
    @PreAuthorize("hasAuthority('product.write')")
    public ResponseEntity<ProductResponse> updateProduct(
            @PathVariable UUID id,
            @Valid @RequestBody ProductRequest request) {
        ProductResponse response = productService.updateProduct(id, request);
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{id}/disable")
    @PreAuthorize("hasAuthority('product.write')")
    public ResponseEntity<Void> disableProduct(@PathVariable UUID id) {
        productService.disableProduct(id);
        return ResponseEntity.ok().build();
    }
}
