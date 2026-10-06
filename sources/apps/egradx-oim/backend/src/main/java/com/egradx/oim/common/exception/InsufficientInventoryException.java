package com.egradx.oim.common.exception;

import com.egradx.core.exception.DuplicateResourceException;

/** Not enough stock for the change asked: 409 INSUFFICIENT_INVENTORY. Answered by the SDK's exception handling, as every core exception is. */
// docs:region own-error-code
public class InsufficientInventoryException extends DuplicateResourceException {
    public InsufficientInventoryException(String message) {
        super(message, "INSUFFICIENT_INVENTORY");
    }
}
// docs:end
