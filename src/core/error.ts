/**
 * OT Error class - Custom error for OT operations
 *
 * Reference: lib/error.js in ShareDB
 *
 * This provides structured errors with error codes, making it easier
 * to handle different error conditions programmatically.
 */

// Error codes - used for programmatic error handling
export const ERROR_CODES = {
  // Apply errors
  ERR_APPLY_OP_VERSION_DOES_NOT_MATCH_SNAPSHOT: 'ERR_APPLY_OP_VERSION_DOES_NOT_MATCH_SNAPSHOT',
  ERR_APPLY_SNAPSHOT_NOT_PROVIDED: 'ERR_APPLY_SNAPSHOT_NOT_PROVIDED',

  // Document errors
  ERR_DOC_ALREADY_CREATED: 'ERR_DOC_ALREADY_CREATED',
  ERR_DOC_DOES_NOT_EXIST: 'ERR_DOC_DOES_NOT_EXIST',
  ERR_DOC_TYPE_NOT_RECOGNIZED: 'ERR_DOC_TYPE_NOT_RECOGNIZED',
  ERR_DOC_WAS_DELETED: 'ERR_DOC_WAS_DELETED',

  // Operation errors
  ERR_OT_OP_BADLY_FORMED: 'ERR_OT_OP_BADLY_FORMED',
  ERR_OT_OP_NOT_APPLIED: 'ERR_OT_OP_NOT_APPLIED',
  ERR_OT_OP_NOT_PROVIDED: 'ERR_OT_OP_NOT_PROVIDED',
  ERR_OP_VERSION_MISMATCH_DURING_TRANSFORM: 'ERR_OP_VERSION_MISMATCH_DURING_TRANSFORM',
  ERR_OP_ALREADY_SUBMITTED: 'ERR_OP_ALREADY_SUBMITTED',

  // Submit errors
  ERR_SUBMIT_TRANSFORM_OPS_NOT_FOUND: 'ERR_SUBMIT_TRANSFORM_OPS_NOT_FOUND',
  ERR_MAX_SUBMIT_RETRIES_EXCEEDED: 'ERR_MAX_SUBMIT_RETRIES_EXCEEDED',

  // Connection errors
  ERR_CONNECTION_CLOSED: 'ERR_CONNECTION_CLOSED',
  ERR_CONNECTION_SEQ_INTEGER_OVERFLOW: 'ERR_CONNECTION_SEQ_INTEGER_OVERFLOW',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

/**
 * Custom error class for OT operations.
 * Extends Error with a code property for programmatic handling.
 */
export class OTError extends Error {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'OTError';
    this.code = code;

    // Maintain proper stack trace in V8 engines (Chrome, Node.js)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OTError);
    }
  }
}
