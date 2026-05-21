import type { AgentAdapter } from "./adapters/base.js";
import { MockClaudeAdapter, MockCodexAdapter } from "./adapters/mock.js";
import { resolveVerdict, type Verdict } from "./verdict.js";
import { OrchestratorStateMachine } from "./state-machine.js";
import { IterationController } from "./iteration-controller.js";
import { ArtifactStore, type Artifact } from "./artifacts/store.js";
import { OrchestratorError } from "./errors.js";

export interface OrchestratorOptions {
  task: string;
  maxIterations: number;
  workspacePath?: string;
  adapters?: {
    author: AgentAdapter;
    critic: AgentAdapter;
  };
  onEvent?: (event: OrchestratorEvent) => void;
}

export interface RunResult {
  converged: boolean;
  verdict: Exclude<Verdict, "MISSING">;
  iterations: number;
  finalPlan: string;
  artifacts: Artifact[];
}

export type OrchestratorEvent =
  | { type: "planning_started" }
  | { type: "review_started"; iteration: number; maxIterations: number }
  | { type: "verdict"; iteration: number; verdict: Exclude<Verdict, "MISSING"> }
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
    const sm = new OrchestratorStateMachine();
    const iterCtrl = new IterationController(this.options.maxIterations);
    const store = new ArtifactStore(this.options.workspacePath ?? ".agent-workspace");

    sm.transition("START");
    this.emit({ type: "planning_started" });

    let plan: string;
    try {
      plan = await this.author.call(`PLAN:\n${this.options.task}`);
    } catch (cause) {
      sm.transition("FAIL");
      throw new OrchestratorError("planning", 0, cause);
    }
    store.savePlan(0, plan);
    sm.transition("PLAN_DONE");

    while (iterCtrl.canContinue()) {
      const { iteration } = iterCtrl.consume();

      this.emit({ type: "review_started", iteration, maxIterations: this.options.maxIterations });

      let rawReview: string;
      try {
        rawReview = await this.critic.call(`REVIEW ITERATION ${iteration}:\n${plan}`);
      } catch (cause) {
        sm.transition("FAIL");
        throw new OrchestratorError("reviewing", iteration, cause);
      }

      let review: string;
      let verdict: Exclude<Verdict, "MISSING">;
      try {
        const resolved = await resolveVerdict(
          rawReview,
          (repairPrompt) => this.critic.call(repairPrompt),
        );
        review = resolved.text;
        verdict = resolved.verdict;
      } catch (cause) {
        sm.transition("FAIL");
        throw new OrchestratorError("reviewing", iteration, cause);
      }
      store.saveReview(iteration, review);

      this.emit({ type: "verdict", iteration, verdict });

      if (verdict === "APPROVED") {
        sm.transition("APPROVED");
        this.emit({ type: "done", converged: true, iterations: iteration });
        return { converged: true, verdict, iterations: iteration, finalPlan: plan, artifacts: store.list() };
      }

      if (iterCtrl.isExhausted()) {
        sm.transition("MAX_REACHED");
        break;
      }

      sm.transition("REVISION");
      this.emit({ type: "revision_started", iteration });

      try {
        plan = await this.author.call(`REVISE:\n${plan}\n\nREVIEW:\n${review}`);
      } catch (cause) {
        sm.transition("FAIL");
        throw new OrchestratorError("revising", iteration, cause);
      }
      store.savePlan(iteration, plan);
      sm.transition("PLAN_DONE");
    }

    this.emit({ type: "done", converged: false, iterations: iterCtrl.current() });
    return {
      converged: false,
      verdict: "REVISION",
      iterations: iterCtrl.current(),
      finalPlan: plan,
      artifacts: store.list(),
    };
  }

  private emit(event: OrchestratorEvent): void {
    this.options.onEvent?.(event);
  }
}
