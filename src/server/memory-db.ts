/**
 * Memory Database - In-memory storage for documents and operations
 *
 * Reference: lib/db/memory.js in ShareDB
 *
 * This provides a simple in-memory implementation of the database interface.
 * In production, you would use sharedb-mongo or sharedb-postgres instead.
 *
 * The database stores:
 * - Snapshots: Current state of each document
 * - Ops: History of all operations (for transformation and playback)
 */

import { Snapshot, createEmptySnapshot, cloneSnapshot } from '../core/snapshot';
import { Op } from '../core/ot';

/**
 * Stored operation with metadata
 *
 * This is the operation as stored in the database, including
 * collection/document info and metadata.
 */
export type StoredOp = Op & {
  /** Collection name */
  c: string;
  /** Document ID */
  d: string;
  /** Metadata */
  m?: {
    ts: number;
    [key: string]: unknown;
  };
};

/**
 * Memory Database implementation
 */
export class MemoryDb {
  /** Map of collection -> id -> snapshot */
  private snapshots: Map<string, Map<string, Snapshot>> = new Map();

  /** Map of collection -> id -> ops array */
  private ops: Map<string, Map<string, StoredOp[]>> = new Map();

  /**
   * Get a snapshot for a document.
   *
   * @param collection - Collection name
   * @param id - Document ID
   * @returns Promise resolving to the snapshot
   *
   * If the document doesn't exist, returns an empty snapshot (v=0, type=null).
   */
  async getSnapshot(collection: string, id: string): Promise<Snapshot> {
    const collectionSnapshots = this.snapshots.get(collection);
    const snapshot = collectionSnapshots?.get(id);

    if (snapshot) {
      return cloneSnapshot(snapshot);
    }

    // Return empty snapshot for non-existent document
    return createEmptySnapshot(id);
  }

  /**
   * Get operations for a document within a version range.
   *
   * @param collection - Collection name
   * @param id - Document ID
   * @param fromVersion - Start version (inclusive)
   * @param toVersion - End version (exclusive), or undefined for all
   * @returns Promise resolving to array of operations
   *
   * This is used for transforming ops when there's a version mismatch.
   */
  async getOps(
    collection: string,
    id: string,
    fromVersion: number,
    toVersion?: number
  ): Promise<StoredOp[]> {
    const collectionOps = this.ops.get(collection);
    const docOps = collectionOps?.get(id) || [];

    // Filter ops by version range
    return docOps.filter((op) => {
      const v = op.v!;
      return v >= fromVersion && (toVersion === undefined || v < toVersion);
    });
  }

  /**
   * Commit an operation and update the snapshot atomically.
   *
   * @param collection - Collection name
   * @param id - Document ID
   * @param op - Operation to commit
   * @param snapshot - New snapshot after applying the operation
   * @returns Promise resolving to true if committed, false if version conflict
   *
   * This implements optimistic locking:
   * - If op.v matches current snapshot version, commit succeeds
   * - If versions don't match (another client committed first), return false
   *
   * Reference: lib/db/memory.js commit in ShareDB
   */
  async commit(
    collection: string,
    id: string,
    op: Op,
    snapshot: Snapshot
  ): Promise<boolean> {
    // Get or create collection maps
    let collectionSnapshots = this.snapshots.get(collection);
    if (!collectionSnapshots) {
      collectionSnapshots = new Map();
      this.snapshots.set(collection, collectionSnapshots);
    }

    let collectionOps = this.ops.get(collection);
    if (!collectionOps) {
      collectionOps = new Map();
      this.ops.set(collection, collectionOps);
    }

    // Get current snapshot
    const currentSnapshot = collectionSnapshots.get(id);
    const currentVersion = currentSnapshot?.v ?? 0;

    // Optimistic lock check: op version must match current version
    if (op.v !== currentVersion) {
      return false; // Version conflict!
    }

    // Store the operation
    let docOps = collectionOps.get(id);
    if (!docOps) {
      docOps = [];
      collectionOps.set(id, docOps);
    }

    // Add metadata to op
    const storedOp: StoredOp = {
      ...op,
      c: collection,
      d: id,
      m: {
        ts: Date.now(),
      },
    };
    docOps.push(storedOp);

    // Update snapshot
    collectionSnapshots.set(id, cloneSnapshot(snapshot));

    return true;
  }

  /**
   * Delete all data (for testing).
   */
  clear(): void {
    this.snapshots.clear();
    this.ops.clear();
  }

  /**
   * Get all documents in a collection (for debugging).
   */
  getAllSnapshots(collection: string): Snapshot[] {
    const collectionSnapshots = this.snapshots.get(collection);
    if (!collectionSnapshots) {
      return [];
    }
    return Array.from(collectionSnapshots.values()).map(cloneSnapshot);
  }
}
