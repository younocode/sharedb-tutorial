/**
 * Counter Type - The simplest possible OT type
 *
 * Reference: test/client/number-type.js in ShareDB
 *
 * This is the perfect type for learning OT because:
 * - Snapshot is just a number
 * - Operation is just a number (the delta)
 * - Addition is commutative, so transform is trivial!
 *
 * Example:
 *   Initial: 0
 *   Client A: +5
 *   Client B: +3
 *
 *   No matter what order they're applied, result is 8.
 *   transform(+5, +3) = +5 (no change needed!)
 *
 * This demonstrates that OT is simplest when operations commute.
 * For text editing, operations don't commute (order matters!),
 * which is why text OT is more complex.
 */

import { OTType } from '../core/types';

/** Counter snapshot is just a number */
export type CounterSnapshot = number;

/** Counter operation is just a number (the delta to add) */
export type CounterOp = number;

/**
 * Counter OT Type implementation
 */
export const counterType: OTType<CounterSnapshot, CounterOp> = {
  name: 'counter',
  uri: 'http://sharejs.org/types/counter',

  /**
   * Create initial counter value.
   *
   * @param data - Initial value (defaults to 0)
   * @returns Initial counter value
   *
   * Examples:
   *   create() => 0
   *   create(10) => 10
   *   create(3.14) => 3 (truncated to integer)
   */
  create(data?: unknown): CounterSnapshot {
    // Use bitwise OR to convert to integer (same as ShareDB's number-type)
    return (data as number) | 0;
  },

  /**
   * Apply a delta to the counter.
   *
   * @param snapshot - Current counter value
   * @param op - Delta to add
   * @returns New counter value
   *
   * Examples:
   *   apply(5, 3) => 8
   *   apply(10, -7) => 3
   */
  apply(snapshot: CounterSnapshot, op: CounterOp): CounterSnapshot {
    return snapshot + op;
  },

  /**
   * Transform a counter operation.
   *
   * Since addition is commutative, transform is trivial:
   * we just return the original operation unchanged!
   *
   * @param op1 - Operation to transform
   * @param _op2 - Operation that was already applied (unused)
   * @param _side - Tie-breaking side (unused)
   * @returns Transformed operation (unchanged)
   *
   * Why this works:
   *   If counter = 0, and we have:
   *   - op1: +5
   *   - op2: +3
   *
   *   Path A: apply(apply(0, +5), +3) = 8
   *   Path B: apply(apply(0, +3), +5) = 8
   *
   *   The result is the same regardless of order!
   *   So transform(+5, +3) = +5 (no change needed)
   */
  transform(op1: CounterOp, _op2: CounterOp, _side: 'left' | 'right'): CounterOp {
    // Addition commutes, so no transformation needed
    return op1;
  },

  /**
   * Compose two counter operations into one.
   *
   * @param op1 - First operation
   * @param op2 - Second operation
   * @returns Combined operation
   *
   * Example:
   *   compose(3, 5) => 8
   *   Because apply(apply(x, 3), 5) === apply(x, 8)
   */
  compose(op1: CounterOp, op2: CounterOp): CounterOp {
    return op1 + op2;
  },

  /**
   * Invert a counter operation (for undo).
   *
   * @param op - Operation to invert
   * @returns Inverse operation
   *
   * Example:
   *   invert(5) => -5
   *   apply(apply(x, 5), -5) === x
   */
  invert(op: CounterOp): CounterOp {
    return -op;
  },
};

// Register the counter type
import { types } from '../core/types';
types.register(counterType);

export default counterType;
