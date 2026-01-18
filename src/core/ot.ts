/**
 * OT Core Functions
 *
 * Reference: lib/ot.js in ShareDB
 *
 * This module contains the master OT functions that work at the document level.
 * They handle create, delete, and edit operations, understanding versions
 * and dealing with edge cases.
 *
 * Key functions:
 * - checkOp: Validate operation format
 * - apply: Apply an operation to a snapshot (mutates snapshot)
 * - transform: Transform an operation against another operation (mutates op)
 */

import { OTError, ERROR_CODES } from './error';
import { OTType, types } from './types';
import { Snapshot } from './snapshot';

/**
 * Operation types - the three fundamental operations
 *
 * Create: Creates a new document with a type and optional initial data
 * Op (Edit): Modifies an existing document
 * Del (Delete): Deletes a document
 */

/** Create operation - creates a new document */
export interface CreateOp {
  create: {
    type: string;
    data?: unknown;
  };
  v?: number;
  src?: string;
  seq?: number;
}

/** Edit operation - modifies an existing document */
export interface EditOp {
  op: unknown;
  v?: number;
  src?: string;
  seq?: number;
}

/** Delete operation - deletes a document */
export interface DeleteOp {
  del: true;
  v?: number;
  src?: string;
  seq?: number;
}

/** Union type for all operation types */
export type Op = CreateOp | EditOp | DeleteOp;

/** Type guard for create operations */
export function isCreateOp(op: Op): op is CreateOp {
  return 'create' in op && op.create != null;
}

/** Type guard for edit operations */
export function isEditOp(op: Op): op is EditOp {
  return 'op' in op;
}

/** Type guard for delete operations */
export function isDeleteOp(op: Op): op is DeleteOp {
  return 'del' in op && op.del === true;
}

/**
 * Validate operation format.
 *
 * Reference: lib/ot.js:13-52 in ShareDB
 *
 * Checks that:
 * - Op is an object
 * - Create ops have valid type
 * - Delete ops have del: true
 * - Edit ops have op property
 * - src and seq are set together
 *
 * @param op - Operation to validate
 * @throws OTError if operation is invalid
 */
export function checkOp(op: unknown): asserts op is Op {
  if (op == null || typeof op !== 'object') {
    throw new OTError(ERROR_CODES.ERR_OT_OP_BADLY_FORMED, 'Op must be an object');
  }

  const opObj = op as Record<string, unknown>;

  // Check create operation
  if ('create' in opObj && opObj.create != null) {
    if (typeof opObj.create !== 'object') {
      throw new OTError(ERROR_CODES.ERR_OT_OP_BADLY_FORMED, 'Create data must be an object');
    }
    const create = opObj.create as Record<string, unknown>;
    if (typeof create.type !== 'string') {
      throw new OTError(ERROR_CODES.ERR_OT_OP_BADLY_FORMED, 'Missing create type');
    }
    if (!types.has(create.type)) {
      throw new OTError(ERROR_CODES.ERR_DOC_TYPE_NOT_RECOGNIZED, 'Unknown type: ' + create.type);
    }
  }
  // Check delete operation
  else if ('del' in opObj && opObj.del != null) {
    if (opObj.del !== true) {
      throw new OTError(ERROR_CODES.ERR_OT_OP_BADLY_FORMED, 'del value must be true');
    }
  }
  // Check edit operation
  else if (!('op' in opObj)) {
    throw new OTError(ERROR_CODES.ERR_OT_OP_BADLY_FORMED, 'Missing op, create, or del');
  }

  // Validate src and seq (must be set together)
  if (opObj.src != null && typeof opObj.src !== 'string') {
    throw new OTError(ERROR_CODES.ERR_OT_OP_BADLY_FORMED, 'src must be a string');
  }
  if (opObj.seq != null && typeof opObj.seq !== 'number') {
    throw new OTError(ERROR_CODES.ERR_OT_OP_BADLY_FORMED, 'seq must be a number');
  }
  if ((opObj.src == null && opObj.seq != null) || (opObj.src != null && opObj.seq == null)) {
    throw new OTError(ERROR_CODES.ERR_OT_OP_BADLY_FORMED, 'Both src and seq must be set together');
  }
}

/**
 * Apply an operation to a snapshot.
 *
 * Reference: lib/ot.js:61-102 in ShareDB
 *
 * This is the "super apply" function that:
 * - Handles create, delete, and edit operations
 * - Validates version matching
 * - MUTATES the snapshot in place (increments version, updates data)
 *
 * @param snapshot - Document snapshot (will be mutated!)
 * @param op - Operation to apply
 * @throws OTError if operation cannot be applied
 *
 * Example:
 *   const snapshot = { id: 'doc1', v: 0, type: null, data: undefined };
 *   apply(snapshot, { create: { type: 'counter', data: 5 } });
 *   // snapshot is now { id: 'doc1', v: 1, type: 'counter', data: 5 }
 */
export function apply(snapshot: Snapshot, op: Op): void {
  if (typeof snapshot !== 'object' || snapshot == null) {
    throw new OTError(ERROR_CODES.ERR_APPLY_SNAPSHOT_NOT_PROVIDED, 'Missing snapshot');
  }

  // Version check: if both have versions, they must match
  if (snapshot.v != null && op.v != null && snapshot.v !== op.v) {
    throw new OTError(
      ERROR_CODES.ERR_APPLY_OP_VERSION_DOES_NOT_MATCH_SNAPSHOT,
      `Version mismatch: snapshot v=${snapshot.v}, op v=${op.v}`
    );
  }

  // Handle CREATE operation
  if (isCreateOp(op)) {
    if (snapshot.type) {
      throw new OTError(ERROR_CODES.ERR_DOC_ALREADY_CREATED, 'Document already exists');
    }

    const type = types.get(op.create.type);
    if (!type) {
      throw new OTError(ERROR_CODES.ERR_DOC_TYPE_NOT_RECOGNIZED, 'Unknown type: ' + op.create.type);
    }

    // Create initial document data using the type's create function
    snapshot.data = type.create(op.create.data);
    snapshot.type = type.uri;
    snapshot.v++;
    return;
  }

  // Handle DELETE operation
  if (isDeleteOp(op)) {
    snapshot.data = undefined;
    snapshot.type = null;
    snapshot.v++;
    return;
  }

  // Handle EDIT operation
  if (isEditOp(op)) {
    if (!snapshot.type) {
      throw new OTError(ERROR_CODES.ERR_DOC_DOES_NOT_EXIST, 'Document does not exist');
    }

    if (op.op === undefined) {
      throw new OTError(ERROR_CODES.ERR_OT_OP_NOT_PROVIDED, 'Missing op');
    }

    const type = types.get(snapshot.type);
    if (!type) {
      throw new OTError(ERROR_CODES.ERR_DOC_TYPE_NOT_RECOGNIZED, 'Unknown type: ' + snapshot.type);
    }

    // Apply the type-specific operation
    snapshot.data = type.apply(snapshot.data, op.op);
    snapshot.v++;
    return;
  }

  // No-op (no create, del, or op) - just increment version
  snapshot.v++;
}

/**
 * Transform an operation against another operation.
 *
 * Reference: lib/ot.js:132-167 in ShareDB
 *
 * When two operations are concurrent, we need to transform one against
 * the other. This function handles all 16 combinations of op types:
 *
 * | op / appliedOp | create | delete | edit | noop |
 * |----------------|--------|--------|------|------|
 * | create         | error  | ok     | error| ok   |
 * | delete         | noop   | noop   | noop | noop |
 * | edit           | error  | error  | transform | ok |
 * | noop           | ok     | ok     | ok   | ok   |
 *
 * IMPORTANT: This function MUTATES the op argument!
 *
 * @param type - The document type (for edit transformations)
 * @param op - The operation to transform (will be mutated!)
 * @param appliedOp - The operation that has already been applied
 * @throws OTError if transformation is not possible
 *
 * Example (two concurrent edits on a counter):
 *   const op = { op: 3, v: 1 };
 *   transform('counter', op, { op: 5, v: 1 });
 *   // op is now { op: 3, v: 2 } (unchanged because addition commutes)
 */
export function transform(
  type: OTType | string | null,
  op: Op,
  appliedOp: Op
): void {
  // Version check
  if (op.v != null && appliedOp.v != null && op.v !== appliedOp.v) {
    throw new OTError(
      ERROR_CODES.ERR_OP_VERSION_MISMATCH_DURING_TRANSFORM,
      `Version mismatch during transform: op v=${op.v}, appliedOp v=${appliedOp.v}`
    );
  }

  // Case: appliedOp is delete
  if (isDeleteOp(appliedOp)) {
    if (isCreateOp(op) || isEditOp(op)) {
      throw new OTError(ERROR_CODES.ERR_DOC_WAS_DELETED, 'Document was deleted');
    }
    // Delete against delete or noop: just update version
  }
  // Case: appliedOp is create, op is create/edit/del
  else if (isCreateOp(appliedOp) && (isEditOp(op) || isCreateOp(op) || isDeleteOp(op))) {
    throw new OTError(ERROR_CODES.ERR_DOC_ALREADY_CREATED, 'Document was created remotely');
  }
  // Case: appliedOp is edit, op is create
  else if (isEditOp(appliedOp) && isCreateOp(op)) {
    throw new OTError(ERROR_CODES.ERR_DOC_ALREADY_CREATED, 'Document was created remotely');
  }
  // Case: both are edits - this is where the real OT happens!
  else if (isEditOp(appliedOp) && isEditOp(op)) {
    if (!type) {
      throw new OTError(ERROR_CODES.ERR_DOC_DOES_NOT_EXIST, 'Document does not exist');
    }

    // Resolve type from string if needed
    let resolvedType: OTType;
    if (typeof type === 'string') {
      const t = types.get(type);
      if (!t) {
        throw new OTError(ERROR_CODES.ERR_DOC_TYPE_NOT_RECOGNIZED, 'Unknown type: ' + type);
      }
      resolvedType = t;
    } else {
      resolvedType = type;
    }

    // Transform the operation using the type's transform function
    // 'left' means our op has priority for tie-breaking
    op.op = resolvedType.transform(op.op, appliedOp.op, 'left');
  }

  // Increment version
  if (op.v != null) {
    op.v++;
  }
}

/**
 * Apply multiple operations to a snapshot.
 *
 * @param snapshot - Document snapshot (will be mutated!)
 * @param ops - Array of operations to apply
 * @throws OTError if any operation cannot be applied
 */
export function applyOps(snapshot: Snapshot, ops: Op[]): void {
  for (const op of ops) {
    // Update snapshot version to match op version before applying
    if (op.v != null) {
      snapshot.v = op.v;
    }
    apply(snapshot, op);
  }
}
