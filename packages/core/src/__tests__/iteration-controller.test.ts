import { describe, it, expect } from "vitest";
import { IterationController } from "../iteration-controller.js";

describe("IterationController", () => {
  describe("constructor", () => {
    it("accepts valid maxIterations", () => {
      expect(() => new IterationController(1)).not.toThrow();
      expect(() => new IterationController(5)).not.toThrow();
      expect(() => new IterationController(10)).not.toThrow();
    });

    it.each([0, 11, -1, 1.5, NaN])(
      "throws RangeError for invalid maxIterations: %s",
      (n) => {
        expect(() => new IterationController(n)).toThrow(RangeError);
      }
    );
  });

  describe("canContinue / consume", () => {
    it("allows consuming up to the limit", () => {
      const ctrl = new IterationController(3);
      expect(ctrl.canContinue()).toBe(true);
      expect(ctrl.consume()).toEqual({ iteration: 1, remaining: 2 });
      expect(ctrl.consume()).toEqual({ iteration: 2, remaining: 1 });
      expect(ctrl.consume()).toEqual({ iteration: 3, remaining: 0 });
      expect(ctrl.canContinue()).toBe(false);
    });

    it("throws when consume is called beyond the limit", () => {
      const ctrl = new IterationController(1);
      ctrl.consume();
      expect(() => ctrl.consume()).toThrow("Iteration limit exceeded.");
    });
  });

  describe("isExhausted", () => {
    it("is false before limit is reached", () => {
      const ctrl = new IterationController(2);
      ctrl.consume();
      expect(ctrl.isExhausted()).toBe(false);
    });

    it("is true after limit is reached", () => {
      const ctrl = new IterationController(2);
      ctrl.consume();
      ctrl.consume();
      expect(ctrl.isExhausted()).toBe(true);
    });
  });

  describe("extend", () => {
    it("allows additional iterations after exhaustion", () => {
      const ctrl = new IterationController(2);
      ctrl.consume();
      ctrl.consume();
      expect(ctrl.canContinue()).toBe(false);
      ctrl.extend(2);
      expect(ctrl.canContinue()).toBe(true);
      expect(ctrl.consume()).toEqual({ iteration: 3, remaining: 1 });
    });

    it.each([0, -1, 1.5, NaN])(
      "throws RangeError for invalid additionalIterations: %s",
      (n) => {
        const ctrl = new IterationController(3);
        expect(() => ctrl.extend(n)).toThrow(RangeError);
      }
    );
  });

  describe("current / max", () => {
    it("tracks current count and max correctly", () => {
      const ctrl = new IterationController(5);
      expect(ctrl.current()).toBe(0);
      expect(ctrl.max()).toBe(5);
      ctrl.consume();
      ctrl.consume();
      expect(ctrl.current()).toBe(2);
      ctrl.extend(3);
      expect(ctrl.max()).toBe(8);
    });
  });
});
