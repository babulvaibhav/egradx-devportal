package com.egradx.oim.common.config;

import com.egradx.auth.security.EgradxAuthenticationFilter;
import com.egradx.auth.security.EgradxAuthenticationEntryPoint;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.autoconfigure.security.servlet.EndpointRequest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

/**
 * Security for this application. Authentication itself is entirely the SDK's:
 * this class no longer owns a JWT filter, a token utility, a
 * {@code UserDetailsService} or a {@code PasswordEncoder} — all four are gone,
 * replaced by {@code egradx-auth}.
 *
 * <p><b>The one line that matters most</b> is the
 * {@code addFilterBefore(egradxAuthenticationFilter, ...)} below. Defining any
 * {@link SecurityFilterChain} bean of our own makes the SDK's permissive
 * default chain back off ({@code @ConditionalOnMissingBean}), and with it the
 * filter that establishes who the caller is. Without that line the application
 * still starts, still serves requests, and silently has no authenticated user
 * on any of them — every {@code @PreAuthorize} would reject, and
 * {@code CurrentTenant} would find no organization. It is the documented
 * pitfall in the SDK's own javadoc, and this app is the reference for getting
 * it right.</p>
 *
 * <p>The {@code PasswordEncoder} bean is intentionally absent too: the SDK
 * registers an Argon2 one (also {@code @ConditionalOnMissingBean}), and
 * declaring a BCrypt bean here would silently override the encoder the SDK
 * hashes and verifies passwords with.</p>
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    private final EgradxAuthenticationFilter egradxAuthenticationFilter;
    private final EgradxAuthenticationEntryPoint egradxAuthenticationEntryPoint;

    /**
     * Comma-separated list of allowed origins, or "*" for any origin. Defaults to the frontend's
     * dev-server and Docker ports rather than a wildcard. Override with CORS_ALLOWED_ORIGINS for
     * a real deployment's actual frontend origin.
     */
    @Value("${app.cors.allowed-origins:http://localhost:5173,http://localhost:3000}")
    private String allowedOrigins;

    public SecurityConfig(EgradxAuthenticationFilter egradxAuthenticationFilter,
                           EgradxAuthenticationEntryPoint egradxAuthenticationEntryPoint) {
        this.egradxAuthenticationFilter = egradxAuthenticationFilter;
        this.egradxAuthenticationEntryPoint = egradxAuthenticationEntryPoint;
    }

    @Bean
    // docs:region identity-chain
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(ex -> ex.authenticationEntryPoint(egradxAuthenticationEntryPoint))
            .authorizeHttpRequests(auth -> auth
                // Matchers are relative to server.servlet.context-path (/api).
                //
                // /egradx/auth/** is the SDK's own controllers — all of this application's user,
                // role and organization management, which it therefore does not implement itself.
                // permitAll here does NOT mean unauthenticated: login and refresh must be open
                // (you cannot present a token to get your first token), and everything else in
                // that tree carries its own @PreAuthorize, checking both an egradx.* authority
                // and that the caller belongs to the organization being acted on. Gating it a
                // second time here would only be able to do so more crudely.
                .requestMatchers("/egradx/auth/**", "/swagger-ui/**", "/swagger-ui.html", "/api-docs/**").permitAll()
                // Health for the orchestrator, metrics for Prometheus. Open on the application port
                // for this demo only — the frontend's nginx refuses /api/actuator/ so they are not
                // public through it. A real deployment puts them on management.server.port, which
                // is not published at all.
                .requestMatchers(EndpointRequest.to("health", "info", "metrics", "prometheus")).permitAll()
                .anyRequest().authenticated()
            )
            // See the class javadoc: omit this and the app silently has no identity on any request.
            .addFilterBefore(egradxAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }
    // docs:end

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        if ("*".equals(allowedOrigins.trim())) {
            configuration.setAllowedOriginPatterns(List.of("*"));
        } else {
            configuration.setAllowedOrigins(Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toList());
        }
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("*"));
        // So the browser lets the frontend read the id it shows beside an error.
        configuration.setExposedHeaders(List.of("X-Request-ID"));
        configuration.setAllowCredentials(false);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
