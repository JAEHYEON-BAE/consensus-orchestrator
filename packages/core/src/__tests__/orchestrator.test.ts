import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Orchestrator } from "../orchestrator.js";
import { OrchestratorError } from "../errors.js";
import type { AgentAdapter } from "../adapters/base.js";

function makeMockAuthor(responses: string[]): AgentAdapter {
  let i = 0;
  return {
    name: "MockAuthor",
    call: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? "fallback plan")),
  };
}

function makeMockCritic(verdicts: ("APPROVED" | "REVISION")[]): AgentAdapter {
  let i = 0;
  return {
    name: "MockCritic",
    call: vi.fn().mockImplementation(() => {
      const v = verdicts[i++] ?? "REVISION";
      return Promise.resolve(`## Review\n\nSome feedback.\n\n[${v}]`);
    }),
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Orchestrator", () => {
  describe("happy path — approved on first review", () => {
    it("returns converged: true with correct iteration count", async () => {
      const author = makeMockAuthor(["plan v0"]);
      const critic = makeMockCritic(["APPROVED"]);

      const result = await new Orchestrator({
        task: "build a thing",
        maxIterations: 3,
        workspacePath: tmpDir,
        adapters: { author, critic },
      }).run();

      expect(result.converged).toBe(true);
      expect(result.verdict).toBe("APPROVED");
      expect(result.iterations).toBe(1);
      expect(result.finalPlan).toBe("plan v0");
    });

    it("saves plan_v0.md and review_v1.md as artifacts", async () => {
      const result = await new Orchestrator({
        task: "build a thing",
        maxIterations: 3,
        workspacePath: tmpDir,
        adapters: { author: makeMockAuthor(["plan v0"]), critic: makeMockCritic(["APPROVED"]) },
      }).run();

      const names = result.artifacts.map((a) => a.name);
      expect(names).toContain("plan_v0.md");
      expect(names).toContain("review_v1.md");

      for (const artifact of result.artifacts) {
        expect(fs.existsSync(artifact.path)).toBe(true);
      }
    });
  });

  describe("revision path — approved after revisions", () => {
    it("converges after two iterations", async () => {
      const author = makeMockAuthor(["plan v0", "plan v1"]);
      const critic = makeMockCritic(["REVISION", "APPROVED"]);

      const result = await new Orchestrator({
        task: "build a thing",
        maxIterations: 3,
        workspacePath: tmpDir,
        adapters: { author, critic },
      }).run();

      expect(result.converged).toBe(true);
      expect(result.iterations).toBe(2);
    });

    it("saves all intermediate artifacts in order", async () => {
      const author = makeMockAuthor(["plan v0", "plan v1"]);
      const critic = makeMockCritic(["REVISION", "APPROVED"]);

      const result = await new Orchestrator({
        task: "build a thing",
        maxIterations: 3,
        workspacePath: tmpDir,
        adapters: { author, critic },
      }).run();

      const names = result.artifacts.map((a) => a.name);
      expect(names).toEqual(["plan_v0.md", "review_v1.md", "plan_v1.md", "review_v2.md"]);
    });
  });

  describe("max iterations reached without approval", () => {
    it("returns converged: false after exhausting all iterations", async () => {
      const author = makeMockAuthor(["plan v0", "plan v1", "plan v2"]);
      const critic = makeMockCritic(["REVISION", "REVISION", "REVISION"]);

      const result = await new Orchestrator({
        task: "build a thing",
        maxIterations: 3,
        workspacePath: tmpDir,
        adapters: { author, critic },
      }).run();

      expect(result.converged).toBe(false);
      expect(result.verdict).toBe("REVISION");
      expect(result.iterations).toBe(3);
    });

    it("does not call author.call more times than maxIterations allows", async () => {
      const author = makeMockAuthor(["p0", "p1", "p2"]);
      const critic = makeMockCritic(["REVISION", "REVISION", "REVISION"]);

      await new Orchestrator({
        task: "build a thing",
        maxIterations: 2,
        workspacePath: tmpDir,
        adapters: { author, critic },
      }).run();

      // initial plan + 1 revision (maxIterations=2: review1→REVISION, review2→REVISION+exhausted)
      expect(author.call).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("throws OrchestratorError with phase=planning when author fails during planning", async () => {
      const author: AgentAdapter = {
        name: "FailingAuthor",
        call: vi.fn().mockRejectedValue(new Error("CLI not found")),
      };
      const critic = makeMockCritic(["APPROVED"]);

      await expect(
        new Orchestrator({
          task: "build a thing",
          maxIterations: 3,
          workspacePath: tmpDir,
          adapters: { author, critic },
        }).run(),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof OrchestratorError &&
          err.phase === "planning" &&
          err.iteration === 0,
      );
    });

    it("throws OrchestratorError with phase=reviewing when critic fails", async () => {
      const author = makeMockAuthor(["plan v0"]);
      const critic: AgentAdapter = {
        name: "FailingCritic",
        call: vi.fn().mockRejectedValue(new Error("timeout")),
      };

      await expect(
        new Orchestrator({
          task: "build a thing",
          maxIterations: 3,
          workspacePath: tmpDir,
          adapters: { author, critic },
        }).run(),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof OrchestratorError &&
          err.phase === "reviewing" &&
          err.iteration === 1,
      );
    });

    it("throws OrchestratorError with phase=revising when author fails during revision", async () => {
      const author: AgentAdapter = {
        name: "AuthorFailsOnRevise",
        call: vi
          .fn()
          .mockResolvedValueOnce("plan v0")
          .mockRejectedValue(new Error("auth error")),
      };
      const critic = makeMockCritic(["REVISION"]);

      await expect(
        new Orchestrator({
          task: "build a thing",
          maxIterations: 3,
          workspacePath: tmpDir,
          adapters: { author, critic },
        }).run(),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof OrchestratorError &&
          err.phase === "revising" &&
          err.iteration === 1,
      );
    });

    it("throws OrchestratorError with phase=reviewing when repair retry throws", async () => {
      const author = makeMockAuthor(["plan v0"]);
      const timeoutError = new Error("timeout during repair");
      const critic: AgentAdapter = {
        name: "CriticMissingThenTimeout",
        call: vi
          .fn()
          .mockResolvedValueOnce("No verdict token here.")  // triggers repair retry
          .mockRejectedValue(timeoutError),                 // repair retry fails
      };

      await expect(
        new Orchestrator({
          task: "build a thing",
          maxIterations: 3,
          workspacePath: tmpDir,
          adapters: { author, critic },
        }).run(),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof OrchestratorError &&
          err.phase === "reviewing" &&
          err.iteration === 1,
      );
    });

    it("preserves the original cause inside OrchestratorError", async () => {
      const originalError = new Error("original cause");
      const author: AgentAdapter = {
        name: "FailingAuthor",
        call: vi.fn().mockRejectedValue(originalError),
      };

      await expect(
        new Orchestrator({
          task: "build a thing",
          maxIterations: 3,
          workspacePath: tmpDir,
          adapters: { author, critic: makeMockCritic([]) },
        }).run(),
      ).rejects.toSatisfy(
        (err: unknown) => err instanceof OrchestratorError && err.cause === originalError,
      );
    });
  });

  describe("events", () => {
    it("emits events in correct order for the happy path", async () => {
      const events: string[] = [];

      await new Orchestrator({
        task: "build a thing",
        maxIterations: 3,
        workspacePath: tmpDir,
        adapters: { author: makeMockAuthor(["p0"]), critic: makeMockCritic(["APPROVED"]) },
        onEvent: (e) => events.push(e.type),
      }).run();

      expect(events).toEqual([
        "planning_started",
        "review_started",
        "verdict",
        "done",
      ]);
    });

    it("emits revision_started on each revision", async () => {
      const events: string[] = [];

      await new Orchestrator({
        task: "build a thing",
        maxIterations: 3,
        workspacePath: tmpDir,
        adapters: {
          author: makeMockAuthor(["p0", "p1"]),
          critic: makeMockCritic(["REVISION", "APPROVED"]),
        },
        onEvent: (e) => events.push(e.type),
      }).run();

      expect(events).toEqual([
        "planning_started",
        "review_started",
        "verdict",
        "revision_started",
        "review_started",
        "verdict",
        "done",
      ]);
    });
  });
});
