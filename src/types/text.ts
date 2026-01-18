/**
 * Simple Text Type - Demonstrates real OT transformation
 *
 * Unlike the counter type where operations commute, text operations
 * do NOT commute! This means we need actual transformation logic.
 *
 * This is a simplified text type that only supports:
 * - Single insert at a position
 * - Single delete at a position
 *
 * Real text types (like ot-text) are more complex, supporting
 * multiple operations in one message, retain operations, etc.
 * This simplified version makes the OT concepts easier to understand.
 *
 * Example of why transform is needed:
 *   Text: "hello"
 *   Client A: insert 'X' at position 1 -> "hXello"
 *   Client B: insert 'Y' at position 3 -> "helYlo"
 *
 *   If we just apply both naively:
 *   - A first: "hXello", then B: "hXeYllo" (Y at pos 3+1=4? or original 3?)
 *
 *   OT figures out that after A's insert at pos 1, B's position 3
 *   should become position 4 (shifted by 1).
 */

import { OTType } from '../core/types';

/** Text snapshot is a string */
export type TextSnapshot = string;

/** Insert operation: insert text at a position */
export interface InsertOp {
  type: 'insert';
  pos: number;
  text: string;
}

/** Delete operation: delete characters starting at a position */
export interface DeleteOp {
  type: 'delete';
  pos: number;
  count: number;
}

/** Text operation: either insert or delete */
export type TextOp = InsertOp | DeleteOp;

/** Type guard for insert operations */
export function isInsertOp(op: TextOp): op is InsertOp {
  return op.type === 'insert';
}

/** Type guard for delete operations */
export function isDeleteOp(op: TextOp): op is DeleteOp {
  return op.type === 'delete';
}

/**
 * Simple Text OT Type implementation
 */
export const textType: OTType<TextSnapshot, TextOp> = {
  name: 'simple-text',
  uri: 'http://sharejs.org/types/simple-text',

  /**
   * Create initial text value.
   *
   * @param data - Initial text (defaults to empty string)
   * @returns Initial text value
   */
  create(data?: unknown): TextSnapshot {
    if (typeof data === 'string') {
      return data;
    }
    return '';
  },

  /**
   * Apply an operation to the text.
   *
   * @param snapshot - Current text
   * @param op - Operation to apply
   * @returns New text
   *
   * Examples:
   *   apply("hello", {type: 'insert', pos: 1, text: 'X'}) => "hXello"
   *   apply("hello", {type: 'delete', pos: 1, count: 2}) => "hlo"
   */
  apply(snapshot: TextSnapshot, op: TextOp): TextSnapshot {
    if (isInsertOp(op)) {
      // Insert text at position
      const before = snapshot.slice(0, op.pos);
      const after = snapshot.slice(op.pos);
      return before + op.text + after;
    } else {
      // Delete characters at position
      const before = snapshot.slice(0, op.pos);
      const after = snapshot.slice(op.pos + op.count);
      return before + after;
    }
  },

  /**
   * Transform op1 against op2.
   *
   * This is where the OT magic happens!
   *
   * The key insight is: if op2 inserted or deleted characters before
   * op1's position, we need to adjust op1's position.
   *
   * @param op1 - Operation to transform
   * @param op2 - Operation that was already applied
   * @param side - 'left' or 'right' for tie-breaking when positions are equal
   * @returns Transformed op1
   *
   * Examples:
   *   Text: "hello"
   *   op1: insert 'X' at pos 3
   *   op2: insert 'Y' at pos 1
   *   transform(op1, op2, 'left') => insert 'X' at pos 4
   *   (because Y was inserted before pos 3, shifting it to 4)
   */
  transform(op1: TextOp, op2: TextOp, side: 'left' | 'right'): TextOp {
    // Clone op1 so we don't mutate the original
    const result: TextOp = { ...op1 };

    if (isInsertOp(op2)) {
      // op2 is an insert
      // If op2 inserts before our position, shift our position right
      // If op2 inserts at the same position, use 'side' to break the tie
      const insertedLength = op2.text.length;

      if (op2.pos < result.pos || (op2.pos === result.pos && side === 'right')) {
        result.pos += insertedLength;
      }
    } else {
      // op2 is a delete
      const deleteStart = op2.pos;
      const deleteEnd = op2.pos + op2.count;

      if (isInsertOp(result)) {
        // Our op is an insert
        // If delete is entirely before our position, shift left
        // If delete overlaps our position, we insert at the delete position
        if (deleteEnd <= result.pos) {
          result.pos -= op2.count;
        } else if (deleteStart < result.pos) {
          result.pos = deleteStart;
        }
      } else {
        // Our op is also a delete
        // This is more complex - we need to handle overlapping deletes

        const ourStart = result.pos;
        const ourEnd = result.pos + result.count;

        if (deleteEnd <= ourStart) {
          // op2's delete is entirely before ours, shift left
          result.pos -= op2.count;
        } else if (deleteStart >= ourEnd) {
          // op2's delete is entirely after ours, no change needed
        } else {
          // Overlapping deletes - reduce our count by the overlap
          // and adjust position if needed

          if (deleteStart <= ourStart) {
            // op2 starts before or at our start
            if (deleteEnd >= ourEnd) {
              // op2 completely covers our delete, our delete becomes no-op
              result.pos = deleteStart;
              result.count = 0;
            } else {
              // op2 overlaps the beginning of our delete
              const overlap = deleteEnd - ourStart;
              result.pos = deleteStart;
              result.count -= overlap;
            }
          } else {
            // op2 starts inside our delete
            if (deleteEnd >= ourEnd) {
              // op2 overlaps the end of our delete
              const overlap = ourEnd - deleteStart;
              result.count -= overlap;
            } else {
              // op2 is entirely inside our delete
              result.count -= op2.count;
            }
          }
        }
      }
    }

    return result;
  },

  /**
   * Invert a text operation (for undo).
   *
   * Note: For delete operations, we would need the original text
   * to create a proper inverse. This simplified version assumes
   * we're using a placeholder.
   */
  invert(op: TextOp): TextOp {
    if (isInsertOp(op)) {
      // Inverse of insert is delete
      return {
        type: 'delete',
        pos: op.pos,
        count: op.text.length,
      };
    } else {
      // Inverse of delete is insert (but we need the deleted text!)
      // In a real implementation, the op would include the deleted text
      // For now, we'll use a placeholder
      return {
        type: 'insert',
        pos: op.pos,
        text: '?'.repeat(op.count), // Placeholder - real impl needs deleted text
      };
    }
  },
};

// Register the text type
import { types } from '../core/types';
types.register(textType);

export default textType;
