import { describe, it, expect, vi } from "vitest";
import { OrchestratorStateMachine } from "../state-machine.js";

describe("OrchestratorStateMachine", () => {
  describe("initial state", () => {
    it("starts in IDLE", () => {
      const sm = new OrchestratorStateMachine();
      expect(sm.getState()).toBe("IDLE");
    });

    it("is not terminal at start", () => {
      const sm = new OrchestratorStateMachine();
      expect(sm.isTerminal()).toBe(false);
    });
  });

  describe("valid transitions", () => {
    it("follows the happy path: IDLE → PLANNING → REVIEWING → IMPLEMENTING → DONE", () => {
      const sm = new OrchestratorStateMachine();
      expect(sm.transition("START")).toBe("PLANNING");
      expect(sm.transition("PLAN_DONE")).toBe("REVIEWING");
      expect(sm.transition("APPROVED")).toBe("IMPLEMENTING");
      expect(sm.transition("IMPL_DONE")).toBe("DONE");
      expect(sm.isTerminal()).toBe(true);
    });

    it("follows the revision path: REVIEWING → REVISING → REVIEWING", () => {
      const sm = new OrchestratorStateMachine();
      sm.transition("START");
      sm.transition("PLAN_DONE");
      expect(sm.transition("REVISION")).toBe("REVISING");
      expect(sm.transition("PLAN_DONE")).toBe("REVIEWING");
    });

    it("follows the max-reached path: REVIEWING → AWAITING_USER", () => {
      const sm = new OrchestratorStateMachine();
      sm.transition("START");
      sm.transition("PLAN_DONE");
      expect(sm.transition("MAX_REACHED")).toBe("AWAITING_USER");
    });

    it("resolves AWAITING_USER with USER_CONTINUE back to REVIEWING", () => {
      const sm = new OrchestratorStateMachine();
      sm.transition("START");
      sm.transition("PLAN_DONE");
      sm.transition("MAX_REACHED");
      expect(sm.transition("USER_CONTINUE")).toBe("REVIEWING");
    });

    it("resolves AWAITING_USER with USER_ACCEPT to IMPLEMENTING", () => {
      const sm = new OrchestratorStateMachine();
      sm.transition("START");
      sm.transition("PLAN_DONE");
      sm.transition("MAX_REACHED");
      expect(sm.transition("USER_ACCEPT")).toBe("IMPLEMENTING");
    });

    it("resolves AWAITING_USER with USER_ABORT to ABORTED", () => {
      const sm = new OrchestratorStateMachine();
      sm.transition("START");
      sm.transition("PLAN_DONE");
      sm.transition("MAX_REACHED");
      expect(sm.transition("USER_ABORT")).toBe("ABORTED");
      expect(sm.isTerminal()).toBe(true);
    });

    it("transitions to ERROR on FAIL from PLANNING", () => {
      const sm = new OrchestratorStateMachine();
      sm.transition("START");
      expect(sm.transition("FAIL")).toBe("ERROR");
      expect(sm.isTerminal()).toBe(true);
    });

    it("transitions to ERROR on FAIL from REVIEWING", () => {
      const sm = new OrchestratorStateMachine();
      sm.transition("START");
      sm.transition("PLAN_DONE");
      expect(sm.transition("FAIL")).toBe("ERROR");
      expect(sm.isTerminal()).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it("throws on invalid trigger in current state", () => {
      const sm = new OrchestratorStateMachine();
      expect(() => sm.transition("APPROVED")).toThrow(
        'Invalid transition: cannot apply "APPROVED" in state "IDLE".'
      );
    });

    it("throws when attempting transition from a terminal state", () => {
      const sm = new OrchestratorStateMachine();
      sm.transition("START");
      sm.transition("PLAN_DONE");
      sm.transition("APPROVED");
      sm.transition("IMPL_DONE"); // DONE
      expect(() => sm.transition("START")).toThrow();
    });
  });

  describe("onTransition listener", () => {
    it("fires with correct event data on each transition", () => {
      const sm = new OrchestratorStateMachine();
      const listener = vi.fn();
      sm.onTransition(listener);

      sm.transition("START");

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ from: "IDLE", to: "PLANNING", trigger: "START" })
      );
    });

    it("unsubscribes when the returned function is called", () => {
      const sm = new OrchestratorStateMachine();
      const listener = vi.fn();
      const unsubscribe = sm.onTransition(listener);

      sm.transition("START");
      unsubscribe();
      sm.transition("PLAN_DONE");

      expect(listener).toHaveBeenCalledOnce();
    });

    it("supports multiple listeners", () => {
      const sm = new OrchestratorStateMachine();
      const a = vi.fn();
      const b = vi.fn();
      sm.onTransition(a);
      sm.onTransition(b);
      sm.transition("START");
      expect(a).toHaveBeenCalledOnce();
      expect(b).toHaveBeenCalledOnce();
    });
  });

  describe("isTerminal", () => {
    it.each(["DONE", "ABORTED", "ERROR"] as const)(
      "%s is terminal",
      (terminalState) => {
        const sm = new OrchestratorStateMachine();
        sm.transition("START");
        sm.transition("FAIL"); // → ERROR, or override below

        // Reach each terminal state independently
        const fresh = new OrchestratorStateMachine();
        if (terminalState === "DONE") {
          fresh.transition("START");
          fresh.transition("PLAN_DONE");
          fresh.transition("APPROVED");
          fresh.transition("IMPL_DONE");
        } else if (terminalState === "ABORTED") {
          fresh.transition("START");
          fresh.transition("PLAN_DONE");
          fresh.transition("MAX_REACHED");
          fresh.transition("USER_ABORT");
        } else {
          fresh.transition("START");
          fresh.transition("FAIL");
        }
        expect(fresh.isTerminal()).toBe(true);
      }
    );
  });
});
