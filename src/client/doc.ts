/**
 * Doc - Client-side document representation
 *
 * Reference: lib/client/doc.js in ShareDB
 *
 * The Doc class is the heart of client-side OT. It manages:
 * - Local document state (type, data, version)
 * - Pending operations (inflightOp, pendingOps)
 * - Synchronization with the server
 * - OT transformations for concurrent operations
 *
 * KEY CONCEPTS:
 *
 * 1. Operation Pipeline:
 *    [pendingOps] -> [inflightOp] -> Server -> Ack
 *
 *    - pendingOps: Queue of operations waiting to be sent
 *    - inflightOp: The single operation currently being sent to server
 *    - Only ONE operation can be in-flight at a time!
 *
 * 2. Optimistic Updates:
 *    Operations are applied locally IMMEDIATELY, then sent to server.
 *    This makes the UI feel responsive.
 *
 * 3. Transformation:
 *    When a remote op arrives while we have pending ops, we must:
 *    - Transform our inflightOp against the remote op
 *    - Transform all pendingOps against the remote op
 *    - Apply the remote op to our local state
 */

import { EventEmitter } from 'events';
import { Connection, OpMessage } from './connection';
import { OTType, types } from '../core/types';
import { Snapshot } from '../core/snapshot';
import { Op, isCreateOp, isEditOp, isDeleteOp, CreateOp, EditOp, DeleteOp } from '../core/ot';

/**
 * Internal operation with callbacks and metadata
 */
type PendingOp = Op & {
  /** The OT type at the time of submission (for transformation) */
  type?: OTType;
  /** Callbacks to call when op is acknowledged or errors */
  callbacks: Array<((error?: Error) => void) | undefined>;
  /** Source identifier */
  source?: unknown;
  /** Source client ID (set when sending) */
  src?: string;
  /** Sequence number (set when sending) */
  seq?: number;
};

/**
 * Transform op1 against op2, modifying both in place.
 *
 * Reference: lib/client/doc.js transformX function
 *
 * This is different from the server-side transform because:
 * - We transform BOTH directions (client vs server)
 * - Client's delete dominates (if both delete, server becomes no-op)
 */
function transformX(client: PendingOp, server: OpMessage): Error | undefined {
  // Client delete dominates
  if ('del' in client && client.del) {
    // Transform server to no-op
    delete server.op;
    delete server.create;
    delete server.del;
    return;
  }

  // Server delete causes error (document was deleted remotely)
  if (server.del) {
    return new Error('Document was deleted');
  }

  // Server create causes error (document was created remotely)
  if (server.create) {
    return new Error('Document already created');
  }

  // Ignore no-op from server
  if (!('op' in server) || server.op === undefined) {
    return;
  }

  // Client create causes error
  if ('create' in client && client.create) {
    return new Error('Document already created');
  }

  // Both are edit operations - do the real OT transform
  if ('op' in client && client.type) {
    const type = client.type;

    // Transform both directions
    const clientOp = type.transform(client.op as any, server.op as any, 'left');
    const serverOp = type.transform(server.op as any, client.op as any, 'right');

    client.op = clientOp;
    server.op = serverOp;
  }

  return;
}

/**
 * Doc class - represents a document on the client side
 */
export class Doc extends EventEmitter {
  /** Parent connection */
  public readonly connection: Connection;

  /** Collection name */
  public readonly collection: string;

  /** Document ID */
  public readonly id: string;

  /** Current version (null if never fetched) */
  public version: number | null = null;

  /** Current OT type (null if document doesn't exist) */
  public type: OTType | null = null;

  /** Current document data */
  public data: unknown = undefined;

  /** Whether we are subscribed to updates */
  public subscribed: boolean = false;

  /**
   * The operation currently being sent to the server.
   *
   * IMPORTANT: Only ONE operation can be in-flight at a time!
   * This is crucial for OT correctness - we need to know exactly
   * which operations the server has seen.
   */
  public inflightOp: PendingOp | null = null;

  /**
   * Queue of operations waiting to be sent.
   *
   * When inflightOp is acknowledged, we pop the first pendingOp
   * and make it the new inflightOp.
   */
  public pendingOps: PendingOp[] = [];

  constructor(connection: Connection, collection: string, id: string) {
    super();
    this.connection = connection;
    this.collection = collection;
    this.id = id;
  }

  /**
   * Subscribe to document updates.
   *
   * This fetches the current document state and starts receiving
   * real-time updates from other clients.
   *
   * @param callback - Called when subscribed (or on error)
   */
  subscribe(callback?: (error?: Error) => void): void {
    if (this.subscribed) {
      callback?.();
      return;
    }

    if (this.connection.canSend) {
      this.connection.sendSubscribe(this);
    }

    if (callback) {
      this.once('subscribe', callback);
    }
  }

  /**
   * Handle subscribe response from server.
   */
  _handleSubscribe(error: { code: string; message: string } | undefined, snapshot?: Snapshot): void {
    if (error) {
      this.emit('subscribe', new Error(error.message));
      return;
    }

    this.subscribed = true;

    if (snapshot) {
      this._ingestSnapshot(snapshot);
    }

    this.emit('subscribe');
    this.emit('load');
  }

  /**
   * Ingest a snapshot from the server.
   *
   * @param snapshot - The snapshot to ingest
   */
  private _ingestSnapshot(snapshot: Snapshot): void {
    this.version = snapshot.v;

    if (snapshot.type) {
      const type = types.get(snapshot.type);
      if (!type) {
        this.emit('error', new Error('Unknown type: ' + snapshot.type));
        return;
      }
      this.type = type;
      this.data = snapshot.data;
    } else {
      this.type = null;
      this.data = undefined;
    }
  }

  /**
   * Handle an operation from the server.
   *
   * This could be:
   * 1. Acknowledgement of our inflightOp
   * 2. A remote operation from another client
   *
   * Reference: lib/client/doc.js _handleOp
   */
  _handleOp(
    error: { code: string; message: string } | undefined,
    message: OpMessage
  ): void {
    if (error) {
      // Server rejected our op - need to rollback
      if (this.inflightOp) {
        this._rollback(new Error(error.message));
      } else {
        this.emit('error', new Error(error.message));
      }
      return;
    }

    // Check if this is acknowledgement of our inflightOp
    if (
      this.inflightOp &&
      message.src === this.inflightOp.src &&
      message.seq === this.inflightOp.seq
    ) {
      // Our op was acknowledged!
      this._opAcknowledged(message);
      return;
    }

    // This is a remote op from another client
    // Check version
    if (this.version === null || message.v === undefined) {
      return;
    }

    if (message.v > this.version) {
      // We're behind - need to fetch
      // In a real implementation, we'd fetch missing ops
      console.warn('Received op from the future, version mismatch');
      return;
    }

    if (message.v < this.version) {
      // Duplicate old op, ignore
      return;
    }

    // Transform our pending ops against this remote op
    if (this.inflightOp) {
      const err = transformX(this.inflightOp, message);
      if (err) {
        this._hardRollback(err);
        return;
      }
    }

    for (const pendingOp of this.pendingOps) {
      const err = transformX(pendingOp, message);
      if (err) {
        this._hardRollback(err);
        return;
      }
    }

    // Apply the remote op to our local state
    this.version++;
    this._otApply(message, false);
  }

  /**
   * Apply an operation to local state.
   *
   * @param op - The operation to apply
   * @param source - true if this is our own op, false if remote
   */
  private _otApply(op: OpMessage, source: boolean): void {
    if (op.op !== undefined) {
      // Edit operation
      if (!this.type) {
        this.emit('error', new Error('Cannot apply op to uncreated document'));
        return;
      }

      this.emit('before op', op.op, source);
      this.data = this.type.apply(this.data, op.op);
      this.emit('op', op.op, source);
    } else if (op.create) {
      // Create operation
      const type = types.get(op.create.type);
      if (!type) {
        this.emit('error', new Error('Unknown type: ' + op.create.type));
        return;
      }
      this.type = type;
      this.data = type.create(op.create.data);
      this.emit('create', source);
    } else if (op.del) {
      // Delete operation
      const oldData = this.data;
      this.type = null;
      this.data = undefined;
      this.emit('del', oldData, source);
    }
  }

  /**
   * Our inflightOp was acknowledged by the server.
   */
  private _opAcknowledged(message: OpMessage): void {
    const inflightOp = this.inflightOp!;

    // Update version
    if ('create' in inflightOp && inflightOp.create) {
      this.version = message.v!;
    } else {
      this.version!++;
    }

    // Call callbacks
    for (const callback of inflightOp.callbacks) {
      callback?.();
    }

    // Clear inflight and send next pending op
    this.inflightOp = null;
    this.flush();

    this.emit('ack');
  }

  /**
   * Rollback after server rejected our op.
   *
   * For simplicity, this implementation does a hard rollback.
   * A real implementation might try to invert the op.
   */
  private _rollback(error: Error): void {
    this._hardRollback(error);
  }

  /**
   * Hard rollback - reset state and fetch fresh from server.
   */
  private _hardRollback(error: Error): void {
    const allOps = this.inflightOp
      ? [this.inflightOp, ...this.pendingOps]
      : this.pendingOps;

    this.inflightOp = null;
    this.pendingOps = [];
    this.type = null;
    this.data = undefined;
    this.version = null;

    // Call all callbacks with the error
    for (const op of allOps) {
      for (const callback of op.callbacks) {
        callback?.(error);
      }
    }

    // Re-subscribe to get fresh state
    this.subscribed = false;
    this.subscribe();

    this.emit('error', error);
  }

  /**
   * Called when connection state changes.
   */
  _onConnectionStateChanged(): void {
    if (this.connection.canSend) {
      this.flush();
    } else {
      // Connection lost - move inflight back to pending
      if (this.inflightOp) {
        this.pendingOps.unshift(this.inflightOp);
        this.inflightOp = null;
      }
      this.subscribed = false;
    }
  }

  /**
   * Send the next pending operation to the server.
   *
   * Reference: lib/client/doc.js flush and _sendOp
   *
   * Only one operation can be in-flight at a time!
   */
  flush(): void {
    // Can't send if not connected or already have an inflight op
    if (!this.connection.canSend || this.inflightOp) {
      return;
    }

    // Nothing to send
    if (this.pendingOps.length === 0) {
      return;
    }

    // Pop the first pending op and make it inflight
    this.inflightOp = this.pendingOps.shift()!;
    const op = this.inflightOp;

    // Assign src and seq for identifying this op
    if (op.seq === undefined) {
      op.seq = this.connection.seq++;
    }
    if (op.src === undefined) {
      (op as any).src = this.connection.id;
    }

    // Send to server
    this.connection.sendOp(this, op as Op & { src: string; seq: number });
  }

  /**
   * Submit an edit operation.
   *
   * @param component - The operation component (type-specific)
   * @param callback - Called when acknowledged or on error
   *
   * Example (counter):
   *   doc.submitOp(5); // Increment by 5
   *
   * Example (text):
   *   doc.submitOp({ type: 'insert', pos: 0, text: 'Hello' });
   */
  submitOp(component: unknown, callback?: (error?: Error) => void): void {
    if (!this.type) {
      callback?.(new Error('Document does not exist'));
      return;
    }

    const op: PendingOp = {
      op: component,
      v: this.version!,
      type: this.type,
      callbacks: [callback],
    };

    this._submit(op);
  }

  /**
   * Create the document.
   *
   * @param type - The OT type (name or URI)
   * @param data - Initial data (optional)
   * @param callback - Called when acknowledged or on error
   *
   * Example:
   *   doc.create('counter', 10);
   *   doc.create('simple-text', 'Hello World');
   */
  create(
    type: string,
    data?: unknown,
    callback?: (error?: Error) => void
  ): void {
    if (this.type) {
      callback?.(new Error('Document already exists'));
      return;
    }

    const typeObj = types.get(type);
    if (!typeObj) {
      callback?.(new Error('Unknown type: ' + type));
      return;
    }

    const op: PendingOp = {
      create: { type: typeObj.uri, data },
      v: this.version ?? 0,
      type: typeObj,
      callbacks: [callback],
    };

    this._submit(op);
  }

  /**
   * Delete the document.
   *
   * @param callback - Called when acknowledged or on error
   */
  del(callback?: (error?: Error) => void): void {
    if (!this.type) {
      callback?.(new Error('Document does not exist'));
      return;
    }

    const op: PendingOp = {
      del: true,
      v: this.version!,
      type: this.type,
      callbacks: [callback],
    };

    this._submit(op);
  }

  /**
   * Internal submit method.
   *
   * Reference: lib/client/doc.js _submit
   *
   * 1. Apply the op locally (optimistic update)
   * 2. Add to pending queue
   * 3. Schedule flush
   */
  private _submit(op: PendingOp): void {
    // Apply locally first (optimistic update)
    this._otApply(op as any, true);

    // If it's a create op, update local type
    if ('create' in op && op.create) {
      const type = types.get(op.create.type);
      if (type) {
        this.type = type;
        this.data = type.create(op.create.data);
      }
    }

    // Update version for local tracking
    if (this.version !== null) {
      // The version we send to server is our current version
      // but locally we've already applied it
    }

    // Add to pending queue
    this.pendingOps.push(op);

    // Schedule flush (using setTimeout to batch multiple submits)
    setTimeout(() => this.flush(), 0);
  }

  /**
   * Check if there are pending writes.
   */
  hasWritePending(): boolean {
    return !!(this.inflightOp || this.pendingOps.length);
  }

  /**
   * Wait for all pending operations to complete.
   *
   * @param callback - Called when no operations are pending
   */
  whenNothingPending(callback: () => void): void {
    if (!this.hasWritePending()) {
      setTimeout(callback, 0);
      return;
    }
    this.once('ack', () => this.whenNothingPending(callback));
  }
}
