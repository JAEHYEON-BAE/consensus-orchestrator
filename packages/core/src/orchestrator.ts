import type { AgentAdapter } from "./adapters/base.js";
import { MockClaudeAdapter, MockCodexAdapter } from "./adapters/mock.js";
import { parseVerdict, type Verdict } from "./verdict.js";

export interface OrchestratorOptions {
  task: string;
  maxIterations: number;
  adapters?: {
    author: AgentAdapter;
    critic: AgentAdapter;
  };
  onEvent?: (event: OrchestratorEvent) => void;
}

export interface RunResult {
  converged: boolean;
  verdict: Verdict;
  iterations: number;
  finalPlan: string;
}

export type OrchestratorEvent =
  | { type: "planning_started" }
  | { type: "review_started"; iteration: number; maxIterations: number }
  | { type: "verdict"; iteration: number; verdict: Verdict }
  | { type: "revision_started"; iteration: number }
  | { type: "done"; converged: boolean; iterations: number };

export class Orchestrator {
  private readonly author: AgentAdapter;
  private readonly critic: AgentAdapter;

  constructor(private readonly options: OrchestratorOptions) {
    this.author = options.adapters?.author ?? new MockClaudeAdapter();
    this.critic = options.adapters?.critic ?? new MockCodexAdapter();
  }

  async run(): Promise<RunResult> {
    let plan = await this.generatePlan(this.options.task);

    for (let iteration = 1; iteration <= this.options.maxIterations; iteration++) {
      const review = await this.reviewPlan(plan, iteration);
      const verdict = parseVerdict(review);

      this.emit({ type: "verdict", iteration, verdict });

      if (verdict === "APPROVED") {
        this.emit({ type: "done", converged: true, iterations: iteration });
        return {
          converged: true,
          verdict,
          iterations: iteration,
          finalPlan: plan,
        };
      }

      plan = await this.revisePlan(plan, review, iteration);
    }

    this.emit({
      type: "done",
      converged: false,
      iterations: this.options.maxIterations,
    });

    return {
      converged: false,
      verdict: "REVISION",
      iterations: this.options.maxIterations,
      finalPlan: plan,
    };
  }

  private async generatePlan(task: string): Promise<string> {
    this.emit({ type: "planning_started" });
    return this.author.call(`PLAN:\n${task}`);
  }

  private async reviewPlan(plan: string, iteration: number): Promise<string> {
    this.emit({
      type: "review_started",
      iteration,
      maxIterations: this.options.maxIterations,
    });
    return this.critic.call(`REVIEW ITERATION ${iteration}:\n${plan}`);
  }

  private async revisePlan(plan: string, review: string, iteration: number): Promise<string> {
    this.emit({ type: "revision_started", iteration });
    return this.author.call(`REVISE:\n${plan}\n\nREVIEW:\n${review}`);
  }

  private emit(event: OrchestratorEvent): void {
    this.options.onEvent?.(event);
  }
}
