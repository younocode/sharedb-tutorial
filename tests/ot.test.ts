/**
 * Tests for OT core functions (checkOp, apply, transform)
 *
 * These tests verify the fundamental OT operations work correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { checkOp, apply, transform, isCreateOp, isEditOp, isDeleteOp, Op } from '../src/core/ot';
import { Snapshot, createEmptySnapshot } from '../src/core/snapshot';
import { types } from '../src/core/types';
import { counterType } from '../src/types/counter';
import { OTError, ERROR_CODES } from '../src/core/error';

// Ensure counter type is registered
types.register(counterType);

describe('OT Core Functions', () => {
  describe('checkOp', () => {
    it('should accept valid create op', () => {
      expect(() => checkOp({ create: { type: 'counter', data: 0 } })).not.toThrow();
    });

    it('should accept valid edit op', () => {
      expect(() => checkOp({ op: 5 })).not.toThrow();
    });

    it('should accept valid delete op', () => {
      expect(() => checkOp({ del: true })).not.toThrow();
    });

    it('should reject null op', () => {
      expect(() => checkOp(null)).toThrow(OTError);
    });

    it('should reject op without create, op, or del', () => {
      expect(() => checkOp({})).toThrow(OTError);
    });

    it('should reject create without type', () => {
      expect(() => checkOp({ create: {} })).toThrow(OTError);
    });

    it('should reject unknown type', () => {
      expect(() => checkOp({ create: { type: 'unknown-type' } })).toThrow(OTError);
    });

    it('should reject del with non-true value', () => {
      expect(() => checkOp({ del: false })).toThrow(OTError);
    });

    it('should accept op with src and seq together', () => {
      expect(() => checkOp({ op: 5, src: 'client1', seq: 1 })).not.toThrow();
    });

    it('should reject op with src but no seq', () => {
      expect(() => checkOp({ op: 5, src: 'client1' })).toThrow(OTError);
    });

    it('should reject op with seq but no src', () => {
      expect(() => checkOp({ op: 5, seq: 1 })).toThrow(OTError);
    });
  });

  describe('apply', () => {
    let snapshot: Snapshot;

    beforeEach(() => {
      snapshot = createEmptySnapshot('doc1');
    });

    it('should apply create op to empty snapshot', () => {
      const op: Op = { create: { type: 'counter', data: 10 } };
      apply(snapshot, op);

      expect(snapshot.v).toBe(1);
      expect(snapshot.type).toBe(counterType.uri);
      expect(snapshot.data).toBe(10);
    });

    it('should apply edit op to existing document', () => {
      // First create the document
      apply(snapshot, { create: { type: 'counter', data: 10 } });

      // Then apply an edit
      const op: Op = { op: 5, v: 1 };
      apply(snapshot, op);

      expect(snapshot.v).toBe(2);
      expect(snapshot.data).toBe(15);
    });

    it('should apply delete op', () => {
      // First create the document
      apply(snapshot, { create: { type: 'counter', data: 10 } });

      // Then delete
      const op: Op = { del: true, v: 1 };
      apply(snapshot, op);

      expect(snapshot.v).toBe(2);
      expect(snapshot.type).toBeNull();
      expect(snapshot.data).toBeUndefined();
    });

    it('should reject create on existing document', () => {
      apply(snapshot, { create: { type: 'counter', data: 10 } });

      expect(() => {
        apply(snapshot, { create: { type: 'counter', data: 20 } });
      }).toThrow(OTError);
    });

    it('should reject edit on non-existent document', () => {
      expect(() => {
        apply(snapshot, { op: 5 });
      }).toThrow(OTError);
    });

    it('should reject version mismatch', () => {
      apply(snapshot, { create: { type: 'counter', data: 10 } });

      expect(() => {
        apply(snapshot, { op: 5, v: 5 }); // Wrong version
      }).toThrow(OTError);
    });
  });

  describe('transform', () => {
    it('should transform two edit ops', () => {
      const op1: Op = { op: 3, v: 1 };
      const op2: Op = { op: 5, v: 1 };

      transform(counterType, op1, op2);

      // Counter ops don't change (addition commutes)
      expect(op1.op).toBe(3);
      expect(op1.v).toBe(2); // Version incremented
    });

    it('should reject version mismatch during transform', () => {
      const op1: Op = { op: 3, v: 1 };
      const op2: Op = { op: 5, v: 2 };

      expect(() => {
        transform(counterType, op1, op2);
      }).toThrow(OTError);
    });

    it('should handle delete against edit', () => {
      const deleteOp: Op = { del: true, v: 1 };
      const editOp: Op = { op: 5, v: 1 };

      // Delete dominates - server op becomes no-op
      transform(counterType, deleteOp, editOp);

      expect(deleteOp.v).toBe(2);
    });

    it('should reject edit against delete', () => {
      const editOp: Op = { op: 5, v: 1 };
      const deleteOp: Op = { del: true, v: 1 };

      expect(() => {
        transform(counterType, editOp, deleteOp);
      }).toThrow(OTError);
    });

    it('should reject create against create', () => {
      const create1: Op = { create: { type: 'counter', data: 10 }, v: 0 };
      const create2: Op = { create: { type: 'counter', data: 20 }, v: 0 };

      expect(() => {
        transform(counterType, create1, create2);
      }).toThrow(OTError);
    });

    it('should reject edit against create', () => {
      const editOp: Op = { op: 5, v: 0 };
      const createOp: Op = { create: { type: 'counter', data: 10 }, v: 0 };

      expect(() => {
        transform(counterType, editOp, createOp);
      }).toThrow(OTError);
    });
  });

  describe('Type Guards', () => {
    it('should correctly identify create ops', () => {
      expect(isCreateOp({ create: { type: 'counter' } })).toBe(true);
      expect(isCreateOp({ op: 5 })).toBe(false);
      expect(isCreateOp({ del: true })).toBe(false);
    });

    it('should correctly identify edit ops', () => {
      expect(isEditOp({ op: 5 })).toBe(true);
      expect(isEditOp({ create: { type: 'counter' } })).toBe(false);
      expect(isEditOp({ del: true })).toBe(false);
    });

    it('should correctly identify delete ops', () => {
      expect(isDeleteOp({ del: true })).toBe(true);
      expect(isDeleteOp({ op: 5 })).toBe(false);
      expect(isDeleteOp({ create: { type: 'counter' } })).toBe(false);
    });
  });
});
