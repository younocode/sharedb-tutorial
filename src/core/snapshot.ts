/**
 * Snapshot - Document state at a point in time
 *
 * Reference: lib/snapshot.js in ShareDB
 *
 * A snapshot represents the complete state of a document at a specific version.
 * It contains:
 * - id: Unique document identifier
 * - v: Version number (increments with each operation)
 * - type: The OT type name/URI (null if document doesn't exist)
 * - data: The actual document data
 * - m: Optional metadata (timestamps, etc.)
 */

/**
 * Metadata associated with a snapshot
 */
export interface SnapshotMeta {
  /** Creation timestamp */
  ctime?: number;
  /** Last modification timestamp */
  mtime?: number;
  /** Custom metadata */
  [key: string]: unknown;
}

/**
 * Snapshot interface - represents document state
 *
 * @template T - The type of the document data
 *
 * Example snapshot for a counter document:
 * {
 *   id: 'counter-1',
 *   v: 3,
 *   type: 'counter',
 *   data: 10,
 *   m: { ctime: 1699999999, mtime: 1700000000 }
 * }
 */
export interface Snapshot<T = unknown> {
  /** Document ID */
  id: string;

  /** Version number - starts at 0, increments with each op */
  v: number;

  /** OT type name or URI. null means document doesn't exist */
  type: string | null;

  /** The actual document data. undefined if type is null */
  data: T | undefined;

  /** Optional metadata */
  m?: SnapshotMeta;
}

/**
 * Create an empty snapshot for a document.
 *
 * An empty snapshot represents a document that has never been created.
 * It has version 0, null type, and undefined data.
 *
 * @param id - Document ID
 * @returns Empty snapshot
 *
 * Reference: This is what ShareDB returns when you fetch a non-existent document.
 * The document "exists" in the sense that you can subscribe to it and create it,
 * but it has no type or data yet.
 */
export function createEmptySnapshot(id: string): Snapshot {
  return {
    id,
    v: 0,
    type: null,
    data: undefined,
  };
}

/**
 * Create a snapshot with initial data.
 *
 * @param id - Document ID
 * @param version - Version number
 * @param type - OT type name/URI
 * @param data - Document data
 * @returns Snapshot
 */
export function createSnapshot<T>(
  id: string,
  version: number,
  type: string,
  data: T
): Snapshot<T> {
  return {
    id,
    v: version,
    type,
    data,
  };
}

/**
 * Clone a snapshot (deep copy).
 *
 * @param snapshot - Snapshot to clone
 * @returns Cloned snapshot
 *
 * Note: This does a shallow clone of the snapshot object itself,
 * but for data, you might want to deep clone depending on your use case.
 * For simplicity, this implementation uses JSON parse/stringify for deep cloning.
 */
export function cloneSnapshot<T>(snapshot: Snapshot<T>): Snapshot<T> {
  return {
    id: snapshot.id,
    v: snapshot.v,
    type: snapshot.type,
    data: snapshot.data !== undefined
      ? JSON.parse(JSON.stringify(snapshot.data))
      : undefined,
    m: snapshot.m ? { ...snapshot.m } : undefined,
  };
}
