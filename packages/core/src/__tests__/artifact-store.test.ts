import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ArtifactStore } from "../artifacts/store.js";

let tmpDir: string;
let store: ArtifactStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-store-test-"));
  store = new ArtifactStore(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ArtifactStore", () => {
  describe("constructor", () => {
    it("creates the workspace directory if it does not exist", () => {
      const nested = path.join(tmpDir, "new", "nested", "dir");
      new ArtifactStore(nested);
      expect(fs.existsSync(nested)).toBe(true);
    });
  });

  describe("savePlan", () => {
    it("writes plan_v0.md to disk", () => {
      const artifact = store.savePlan(0, "# Plan v0");
      expect(artifact.name).toBe("plan_v0.md");
      expect(artifact.type).toBe("plan");
      expect(artifact.iteration).toBe(0);
      expect(fs.readFileSync(artifact.path, "utf8")).toBe("# Plan v0");
    });

    it("writes subsequent plan versions", () => {
      store.savePlan(0, "initial");
      const artifact = store.savePlan(1, "revised");
      expect(artifact.name).toBe("plan_v1.md");
      expect(fs.readFileSync(artifact.path, "utf8")).toBe("revised");
    });
  });

  describe("saveReview", () => {
    it("writes review_v1.md to disk", () => {
      const artifact = store.saveReview(1, "## Review\n\n[REVISION]");
      expect(artifact.name).toBe("review_v1.md");
      expect(artifact.type).toBe("review");
      expect(artifact.iteration).toBe(1);
      expect(fs.readFileSync(artifact.path, "utf8")).toBe("## Review\n\n[REVISION]");
    });
  });

  describe("load", () => {
    it("returns the content of a saved artifact", () => {
      store.savePlan(0, "# Content");
      expect(store.load("plan_v0.md")).toBe("# Content");
    });

    it("throws when the file does not exist", () => {
      expect(() => store.load("nonexistent.md")).toThrow("Artifact not found: nonexistent.md");
    });
  });

  describe("list", () => {
    it("returns an empty array initially", () => {
      expect(store.list()).toEqual([]);
    });

    it("returns artifacts in insertion order", () => {
      store.savePlan(0, "plan");
      store.saveReview(1, "review");
      store.savePlan(1, "revised plan");

      const names = store.list().map((a) => a.name);
      expect(names).toEqual(["plan_v0.md", "review_v1.md", "plan_v1.md"]);
    });

    it("returns a copy — mutations do not affect internal state", () => {
      store.savePlan(0, "plan");
      const list = store.list();
      list.pop();
      expect(store.list()).toHaveLength(1);
    });
  });

  describe("getRunPath", () => {
    it("returns an absolute path nested under workspace/runs/<runId>", () => {
      expect(path.isAbsolute(store.getRunPath())).toBe(true);
      expect(store.getRunPath()).toContain(path.join("runs", store.runId));
    });
  });

  describe("run isolation", () => {
    it("two stores with different runIds write to separate directories", () => {
      const storeA = new ArtifactStore(tmpDir, "run-a");
      const storeB = new ArtifactStore(tmpDir, "run-b");

      storeA.savePlan(0, "plan from run A");
      storeB.savePlan(0, "plan from run B");

      expect(storeA.load("plan_v0.md")).toBe("plan from run A");
      expect(storeB.load("plan_v0.md")).toBe("plan from run B");
      expect(storeA.getRunPath()).not.toBe(storeB.getRunPath());
    });

    it("accepts an explicit runId for reproducible paths", () => {
      const store = new ArtifactStore(tmpDir, "fixed-id");
      expect(store.runId).toBe("fixed-id");
      expect(store.getRunPath()).toContain("fixed-id");
    });

    it("generates a runId when none is provided", () => {
      const store = new ArtifactStore(tmpDir);
      expect(store.runId).toMatch(/^\d{8}_\d{6}$/);
    });
  });
});
