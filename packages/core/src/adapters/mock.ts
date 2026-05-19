import type { AgentAdapter } from "./base.js";

export class MockClaudeAdapter implements AgentAdapter {
  readonly name = "Mock Claude";

  async call(prompt: string): Promise<string> {
    if (prompt.startsWith("PLAN:")) {
      const task = prompt.slice("PLAN:".length).trim();
      return `# Implementation Plan\n\nTask: ${task}\n\nInitial mock plan.`;
    }

    if (prompt.startsWith("REVISE:")) {
      return `${prompt}\n\nRevision: added more implementation detail.`;
    }

    return "Mock Claude response.";
  }
}

export class MockCodexAdapter implements AgentAdapter {
  readonly name = "Mock Codex";
  private callCount = 0;

  async call(): Promise<string> {
    this.callCount += 1;

    if (this.callCount < 2) {
      return "## Major Issues\n\nNeeds more detail.\n\n[REVISION]";
    }

    return "## Summary\n\nLooks implementation-ready.\n\n[APPROVED]";
  }
}
