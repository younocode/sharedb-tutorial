/**
 * Submit Request - Handles operation submission on the server
 *
 * Reference: lib/submit-request.js in ShareDB
 *
 * When a client submits an operation, the server needs to:
 * 1. Fetch the current snapshot
 * 2. Check if the op version matches
 * 3. If not, transform the op against any ops that happened since
 * 4. Apply the op to the snapshot
 * 5. Commit to the database (with optimistic locking)
 * 6. If commit fails (concurrent write), retry from step 1
 * 7. Broadcast the op to other subscribers
 */

import { MemoryDb, StoredOp } from './memory-db';
import { Snapshot, cloneSnapshot } from '../core/snapshot';
import { Op, apply, transform, checkOp } from '../core/ot';
import { OTError, ERROR_CODES } from '../core/error';
import { types } from '../core/types';

/**
 * Options for submit request
 */
export interface SubmitOptions {
  /** Maximum number of retries on version conflict */
  maxRetries?: number;
}

/**
 * Result of a submit operation
 */
export interface SubmitResult {
  /** The operation (possibly transformed) */
  op: Op;
  /** The new snapshot after applying the op */
  snapshot: Snapshot;
  /** Operations that were applied between op.v and current version */
  ops: StoredOp[];
}

/**
 * Process a submitted operation.
 *
 * @param db - The database
 * @param collection - Collection name
 * @param id - Document ID
 * @param op - The operation to submit
 * @param options - Submit options
 * @returns The submit result
 * @throws OTError if submit fails after max retries
 *
 * This function handles the complete submit flow:
 * 1. Fetch current snapshot
 * 2. Transform op if needed
 * 3. Apply op to snapshot
 * 4. Commit with retry on conflict
 */
export async function submitOp(
  db: MemoryDb,
  collection: string,
  id: string,
  op: Op,
  options: SubmitOptions = {}
): Promise<SubmitResult> {
  const maxRetries = options.maxRetries ?? 10;
  let retries = 0;

  // Validate op format
  checkOp(op);

  while (true) {
    // Step 1: Fetch current snapshot
    const snapshot = await db.getSnapshot(collection, id);
    const transformedOps: StoredOp[] = [];

    // Clone the op so we don't mutate the original on retry
    const opCopy = JSON.parse(JSON.stringify(op)) as Op;

    // Step 2: Set version if not provided
    if (opCopy.v === undefined) {
      opCopy.v = snapshot.v;
    }

    // Step 3: Transform if needed
    if (opCopy.v !== snapshot.v) {
      if (opCopy.v > snapshot.v) {
        throw new OTError(
          ERROR_CODES.ERR_OT_OP_BADLY_FORMED,
          `Op version ${opCopy.v} is greater than current version ${snapshot.v}`
        );
      }

      // Fetch ops between op.v and snapshot.v
      const ops = await db.getOps(collection, id, opCopy.v, snapshot.v);

      if (ops.length !== snapshot.v - opCopy.v) {
        throw new OTError(
          ERROR_CODES.ERR_SUBMIT_TRANSFORM_OPS_NOT_FOUND,
          `Missing ops for transformation. Expected ${snapshot.v - opCopy.v}, got ${ops.length}`
        );
      }

      // Transform the op against each historical op
      for (const historicalOp of ops) {
        // Check for duplicate submission
        if (opCopy.src && opCopy.src === historicalOp.src && opCopy.seq === historicalOp.seq) {
          throw new OTError(
            ERROR_CODES.ERR_OP_ALREADY_SUBMITTED,
            'Op already submitted'
          );
        }

        // Transform against this historical op
        const type = snapshot.type;
        transform(type, opCopy, historicalOp as Op);

        transformedOps.push(historicalOp);
      }
    }

    // Step 4: Apply the op to the snapshot
    const newSnapshot = cloneSnapshot(snapshot);
    apply(newSnapshot, opCopy);

    // Step 5: Commit to database
    const committed = await db.commit(collection, id, opCopy, newSnapshot);

    if (committed) {
      // Success!
      return {
        op: opCopy,
        snapshot: newSnapshot,
        ops: transformedOps,
      };
    }

    // Step 6: Commit failed (concurrent write), retry
    retries++;
    if (retries > maxRetries) {
      throw new OTError(
        ERROR_CODES.ERR_MAX_SUBMIT_RETRIES_EXCEEDED,
        `Max submit retries (${maxRetries}) exceeded`
      );
    }

    // Reset op version for retry
    op.v = undefined;
  }
}
