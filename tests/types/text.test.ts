/**
 * Tests for simple text OT type
 */

import { describe, it, expect } from 'vitest';
import { textType, InsertOp, DeleteOp, TextOp } from '../../src/types/text';

describe('Text Type', () => {
  describe('create', () => {
    it('should create empty string by default', () => {
      expect(textType.create()).toBe('');
    });

    it('should create with provided string', () => {
      expect(textType.create('hello')).toBe('hello');
    });

    it('should handle non-string data', () => {
      expect(textType.create(123)).toBe('');
    });
  });

  describe('apply', () => {
    describe('insert', () => {
      it('should insert at beginning', () => {
        const op: InsertOp = { type: 'insert', pos: 0, text: 'X' };
        expect(textType.apply('hello', op)).toBe('Xhello');
      });

      it('should insert in middle', () => {
        const op: InsertOp = { type: 'insert', pos: 2, text: 'X' };
        expect(textType.apply('hello', op)).toBe('heXllo');
      });

      it('should insert at end', () => {
        const op: InsertOp = { type: 'insert', pos: 5, text: 'X' };
        expect(textType.apply('hello', op)).toBe('helloX');
      });

      it('should insert multiple characters', () => {
        const op: InsertOp = { type: 'insert', pos: 2, text: 'XYZ' };
        expect(textType.apply('hello', op)).toBe('heXYZllo');
      });
    });

    describe('delete', () => {
      it('should delete from beginning', () => {
        const op: DeleteOp = { type: 'delete', pos: 0, count: 2 };
        expect(textType.apply('hello', op)).toBe('llo');
      });

      it('should delete from middle', () => {
        const op: DeleteOp = { type: 'delete', pos: 2, count: 2 };
        expect(textType.apply('hello', op)).toBe('heo');
      });

      it('should delete from end', () => {
        const op: DeleteOp = { type: 'delete', pos: 3, count: 2 };
        expect(textType.apply('hello', op)).toBe('hel');
      });
    });
  });

  describe('transform', () => {
    describe('insert vs insert', () => {
      it('should shift position when op2 inserts before op1', () => {
        const op1: InsertOp = { type: 'insert', pos: 5, text: 'X' };
        const op2: InsertOp = { type: 'insert', pos: 2, text: 'Y' };

        const result = textType.transform(op1, op2, 'left') as InsertOp;

        expect(result.pos).toBe(6); // Shifted by 1
        expect(result.text).toBe('X');
      });

      it('should not shift when op2 inserts after op1', () => {
        const op1: InsertOp = { type: 'insert', pos: 2, text: 'X' };
        const op2: InsertOp = { type: 'insert', pos: 5, text: 'Y' };

        const result = textType.transform(op1, op2, 'left') as InsertOp;

        expect(result.pos).toBe(2); // Not shifted
      });

      it('should use side for tie-breaking at same position', () => {
        const op1: InsertOp = { type: 'insert', pos: 3, text: 'X' };
        const op2: InsertOp = { type: 'insert', pos: 3, text: 'Y' };

        const resultLeft = textType.transform(op1, op2, 'left') as InsertOp;
        const resultRight = textType.transform(op1, op2, 'right') as InsertOp;

        expect(resultLeft.pos).toBe(3); // Left wins, stays at 3
        expect(resultRight.pos).toBe(4); // Right loses, shifts to 4
      });
    });

    describe('insert vs delete', () => {
      it('should shift position left when delete is before insert', () => {
        const op1: InsertOp = { type: 'insert', pos: 5, text: 'X' };
        const op2: DeleteOp = { type: 'delete', pos: 2, count: 2 };

        const result = textType.transform(op1, op2, 'left') as InsertOp;

        expect(result.pos).toBe(3); // 5 - 2 = 3
      });

      it('should not shift when delete is after insert', () => {
        const op1: InsertOp = { type: 'insert', pos: 2, text: 'X' };
        const op2: DeleteOp = { type: 'delete', pos: 5, count: 2 };

        const result = textType.transform(op1, op2, 'left') as InsertOp;

        expect(result.pos).toBe(2); // Not shifted
      });

      it('should move insert to delete position when delete overlaps', () => {
        const op1: InsertOp = { type: 'insert', pos: 4, text: 'X' };
        const op2: DeleteOp = { type: 'delete', pos: 2, count: 4 };

        const result = textType.transform(op1, op2, 'left') as InsertOp;

        expect(result.pos).toBe(2); // Moved to start of delete
      });
    });

    describe('delete vs insert', () => {
      it('should shift delete position right when insert is before', () => {
        const op1: DeleteOp = { type: 'delete', pos: 5, count: 2 };
        const op2: InsertOp = { type: 'insert', pos: 2, text: 'XY' };

        const result = textType.transform(op1, op2, 'left') as DeleteOp;

        expect(result.pos).toBe(7); // 5 + 2 = 7
        expect(result.count).toBe(2);
      });
    });

    describe('delete vs delete', () => {
      it('should shift position when non-overlapping delete is before', () => {
        const op1: DeleteOp = { type: 'delete', pos: 6, count: 2 };
        const op2: DeleteOp = { type: 'delete', pos: 2, count: 2 };

        const result = textType.transform(op1, op2, 'left') as DeleteOp;

        expect(result.pos).toBe(4); // 6 - 2 = 4
        expect(result.count).toBe(2);
      });

      it('should reduce count for overlapping deletes', () => {
        const op1: DeleteOp = { type: 'delete', pos: 3, count: 4 }; // Delete positions 3,4,5,6
        const op2: DeleteOp = { type: 'delete', pos: 5, count: 3 }; // Delete positions 5,6,7

        const result = textType.transform(op1, op2, 'left') as DeleteOp;

        // op2 deleted 5,6,7. op1 wanted to delete 3,4,5,6.
        // 5,6 are already gone, so op1 only deletes 3,4
        expect(result.count).toBe(2);
      });

      it('should become no-op when fully covered by other delete', () => {
        const op1: DeleteOp = { type: 'delete', pos: 3, count: 2 }; // Delete positions 3,4
        const op2: DeleteOp = { type: 'delete', pos: 2, count: 5 }; // Delete positions 2,3,4,5,6

        const result = textType.transform(op1, op2, 'left') as DeleteOp;

        expect(result.count).toBe(0); // Nothing left to delete
      });
    });
  });

  describe('OT Property: Convergence', () => {
    it('should converge when two clients insert at different positions', () => {
      const initial = 'hello';
      const opA: InsertOp = { type: 'insert', pos: 1, text: 'A' }; // "hAello"
      const opB: InsertOp = { type: 'insert', pos: 4, text: 'B' }; // "hellBo"

      // Path 1: Apply A, then transform and apply B
      const afterA = textType.apply(initial, opA);
      const transformedB = textType.transform(opB, opA, 'right');
      const result1 = textType.apply(afterA, transformedB);

      // Path 2: Apply B, then transform and apply A
      const afterB = textType.apply(initial, opB);
      const transformedA = textType.transform(opA, opB, 'left');
      const result2 = textType.apply(afterB, transformedA);

      // Both paths should converge
      expect(result1).toBe(result2);
      expect(result1).toBe('hAellBo');
    });

    it('should converge when two clients insert at the same position', () => {
      const initial = 'hello';
      const opA: InsertOp = { type: 'insert', pos: 2, text: 'A' };
      const opB: InsertOp = { type: 'insert', pos: 2, text: 'B' };

      // Path 1: Apply A first (A wins tie-break)
      const afterA = textType.apply(initial, opA);
      const transformedB = textType.transform(opB, opA, 'right');
      const result1 = textType.apply(afterA, transformedB);

      // Path 2: Apply B first
      const afterB = textType.apply(initial, opB);
      const transformedA = textType.transform(opA, opB, 'left');
      const result2 = textType.apply(afterB, transformedA);

      // Both paths should converge (order depends on tie-breaking)
      expect(result1).toBe(result2);
      // With left/right tie-breaking, A comes first
      expect(result1).toBe('heABllo');
    });
  });
});
