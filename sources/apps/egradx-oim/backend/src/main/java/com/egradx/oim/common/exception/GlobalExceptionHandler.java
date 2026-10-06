package com.egradx.oim.common.exception;

import java.util.stream.Collectors;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.egradx.core.error.EgradxErrorResponse;
import com.egradx.core.error.EgradxErrors;
import com.egradx.core.web.EgradxExceptionHandlerSupport;

/**
 * This application's error handling, on the SDK's: every failure is answered in the envelope the SDK's libraries
 * use (contracts/schemas/error.json, with the request and trace ids), by the same rules. This application's own
 * exceptions extend the core ones with their codes (INSUFFICIENT_INVENTORY, TENANT_ACCESS_DENIED…), so
 * {@link EgradxExceptionHandlerSupport} answers them; what is left here is what only this application decides.
 */
// docs:region error-handler
@RestControllerAdvice
public class GlobalExceptionHandler extends EgradxExceptionHandlerSupport {

    /** Bean Validation on this application's request bodies: its messages, which name the field themselves. */
    @Override
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<EgradxErrorResponse> handleBeanValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
            .map(FieldError::getDefaultMessage)
            .collect(Collectors.joining(", "));
        return respond(HttpStatus.BAD_REQUEST, EgradxErrors.INVALID_REQUEST, message);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<EgradxErrorResponse> handleConstraintViolation(ConstraintViolationException ex) {
        String message = ex.getConstraintViolations().stream()
            .map(ConstraintViolation::getMessage)
            .collect(Collectors.joining(", "));
        return respond(HttpStatus.BAD_REQUEST, EgradxErrors.INVALID_REQUEST, message);
    }

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<EgradxErrorResponse> handleBadCredentials(BadCredentialsException ex) {
        return respond(HttpStatus.UNAUTHORIZED, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
    }

    /**
     * A refused {@code @PreAuthorize}, or {@link AccessDeniedBusinessException}: a check that depends on the request
     * (e.g. "you can't deactivate your own account"), whose message is safe to show. A raw {@code @PreAuthorize}
     * failure has no message worth showing, so it gets the generic one.
     */
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<EgradxErrorResponse> handleAccessDenied(AccessDeniedException ex) {
        String message = ex instanceof AccessDeniedBusinessException
            ? ex.getMessage()
            : "You do not have permission to access this resource";
        return respond(HttpStatus.FORBIDDEN, EgradxErrors.ACCESS_DENIED, message);
    }

    /**
     * Everything else: Spring MVC's own refusals (no such endpoint, a method it doesn't take) with their status and
     * headers, in this envelope rather than through /error, which the security chain refuses; any other failure a
     * logged 500 whose message reveals nothing.
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<EgradxErrorResponse> handleUnexpected(Exception ex) {
        return answer(answerFor(ex), ex);
    }
}
// docs:end
