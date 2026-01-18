/**
 * Tests for counter OT type
 */

import { describe, it, expect } from "vitest";
import { counterType } from "../../src/types/counter";

describe("Counter Type", () => {
  describe("create", () => {
    it("should create counter with default value 0", () => {
      expect(counterType.create()).toBe(0);
    });

    it("should create counter with provided value", () => {
      expect(counterType.create(10)).toBe(10);
    });

    it("should truncate decimal values", () => {
      expect(counterType.create(3.7)).toBe(3);
    });

    it("should handle negative values", () => {
      expect(counterType.create(-5)).toBe(-5);
    });
  });

  describe("apply", () => {
    it("should add positive delta", () => {
      expect(counterType.apply(10, 5)).toBe(15);
    });

    it("should add negative delta", () => {
      expect(counterType.apply(10, -3)).toBe(7);
    });

    it("should handle zero delta", () => {
      expect(counterType.apply(10, 0)).toBe(10);
    });
  });

  describe("transform", () => {
    it("should return op unchanged (addition commutes)", () => {
      expect(counterType.transform(5, 3, "left")).toBe(5);
      expect(counterType.transform(5, 3, "right")).toBe(5);
    });

    it("should work with negative ops", () => {
      expect(counterType.transform(-5, 3, "left")).toBe(-5);
    });
  });

  describe("compose", () => {
    it("should compose two operations", () => {
      expect(counterType.compose!(3, 5)).toBe(8);
    });

    it("should compose negative operations", () => {
      expect(counterType.compose!(3, -5)).toBe(-2);
    });
  });

  describe("invert", () => {
    it("should invert positive operation", () => {
      expect(counterType.invert!(5)).toBe(-5);
    });

    it("should invert negative operation", () => {
      expect(counterType.invert!(-5)).toBe(5);
    });

    it("should satisfy apply(apply(x, op), invert(op)) === x", () => {
      const initial = 10;
      const op = 5;
      const afterApply = counterType.apply(initial, op);
      const afterInvert = counterType.apply(
        afterApply,
        counterType.invert!(op),
      );
      expect(afterInvert).toBe(initial);
    });
  });

  describe("OT Property: Convergence", () => {
    it("should converge when applying concurrent ops in either order", () => {
      const initial = 0;
      const opA = 5; // Client A: +5
      const opB = 3; // Client B: +3

      // Path 1: Apply A, then transform and apply B
      const afterA = counterType.apply(initial, opA);
      const transformedB = counterType.transform(opB, opA, "right");
      const result1 = counterType.apply(afterA, transformedB);

      // Path 2: Apply B, then transform and apply A
      const afterB = counterType.apply(initial, opB);
      const transformedA = counterType.transform(opA, opB, "left");
      const result2 = counterType.apply(afterB, transformedA);

      // Both paths should result in the same final state
      expect(result1).toBe(result2);
      expect(result1).toBe(8); // 0 + 5 + 3 = 8
    });
  });
});
