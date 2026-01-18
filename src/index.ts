/**
 * ShareDB Tutorial - A simplified TypeScript implementation for learning OT
 *
 * This package provides a simplified but complete implementation of:
 * - OT (Operational Transformation) core functions
 * - Type system with counter and text examples
 * - Client-side document synchronization
 * - Server-side operation handling
 *
 * Use this to learn how real-time collaboration systems work!
 */

// Core modules
export { OTError, ERROR_CODES, ErrorCode } from './core/error';
export { OTType, TypeRegistry, types } from './core/types';
export {
  Snapshot,
  SnapshotMeta,
  createEmptySnapshot,
  createSnapshot,
  cloneSnapshot,
} from './core/snapshot';
export {
  Op,
  CreateOp,
  EditOp,
  DeleteOp,
  isCreateOp,
  isEditOp,
  isDeleteOp,
  checkOp,
  apply,
  transform,
  applyOps,
} from './core/ot';

// Types
export {
  counterType,
  CounterSnapshot,
  CounterOp,
} from './types/counter';
export {
  textType,
  TextSnapshot,
  TextOp,
  InsertOp,
  DeleteOp as TextDeleteOp,
  isInsertOp,
  isDeleteOp as isTextDeleteOp,
} from './types/text';

// Client
export {
  Connection,
  Transport,
  Message,
  MessageType,
} from './client/connection';
export { Doc } from './client/doc';

// Server
export { MemoryDb, StoredOp } from './server/memory-db';
export { submitOp, SubmitOptions, SubmitResult } from './server/submit-request';
export { Backend, Agent, BackendOptions } from './server/backend';
