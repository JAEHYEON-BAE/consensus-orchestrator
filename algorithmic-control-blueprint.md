# Algorithmic Control Blueprint

This document defines how Consensus Orchestrator separates AI judgment from deterministic control logic.

The core principle is:

```text
AI agents may generate, review, explain, and judge.
Classical algorithms own control flow, validation, retries, persistence, and safety boundaries.
```

AI output is always treated as untrusted input. It must be parsed and validated before it can influence the orchestration loop.

## 1. Design Principle

Consensus Orchestrator should be split into three conceptual layers.

```text
AI Agent Layer
  - Creates implementation plans
  - Reviews plans
  - Revises plans
  - Implements approved plans

Classical Algorithm Layer
  - Controls state transitions
  - Counts iterations
  - Parses verdicts and issues
  - Applies retry policies
  - Persists session history
  - Emits diagnostics and warnings

Infrastructure Layer
  - Runs external processes
  - Reads and writes files
  - Emits events
  - Serializes session state
```

The AI Agent Layer can produce candidate meanings. The Classical Algorithm Layer decides how those outputs are allowed to affect the system.

## 2. Non-Negotiable Invariants

- AI agents must never directly mutate session state.
- AI agents must never decide the current iteration count.
- AI agents must never choose state transitions outside the finite-state machine.
- AI agents must never bypass validation by phrasing output persuasively.
- Missing or malformed AI output must be handled conservatively.
- The orchestrator must be able to explain why it moved from one state to another.

## 3. State Management: Finite-State Machine

The orchestration loop should be controlled by a deterministic finite-state machine.

```text
State x Symbol -> Next State
```

Recommended states:

```ts
export type OrchestratorState =
  | "IDLE"
  | "PLANNING"
  | "REVIEWING"
  | "REVISING"
  | "AWAITING_USER"
  | "IMPLEMENTING"
  | "DONE"
  | "ABORTED"
  | "ERROR";
```

Recommended transition symbols:

```ts
export type TransitionSymbol =
  | "START"
  | "PLAN_DONE"
  | "APPROVED"
  | "REVISION"
  | "MAX_REACHED"
  | "USER_CONTINUE"
  | "USER_ACCEPT"
  | "USER_ABORT"
  | "IMPL_DONE"
  | "FAIL";
```

Recommended transition table:

```ts
const TRANSITIONS: Record<
  OrchestratorState,
  Partial<Record<TransitionSymbol, OrchestratorState>>
> = {
  IDLE: {
    START: "PLANNING",
  },
  PLANNING: {
    PLAN_DONE: "REVIEWING",
    FAIL: "ERROR",
  },
  REVIEWING: {
    APPROVED: "IMPLEMENTING",
    REVISION: "REVISING",
    MAX_REACHED: "AWAITING_USER",
    FAIL: "ERROR",
  },
  REVISING: {
    PLAN_DONE: "REVIEWING",
    FAIL: "ERROR",
  },
  AWAITING_USER: {
    USER_CONTINUE: "REVIEWING",
    USER_ACCEPT: "IMPLEMENTING",
    USER_ABORT: "ABORTED",
  },
  IMPLEMENTING: {
    IMPL_DONE: "DONE",
    FAIL: "ERROR",
  },
  DONE: {},
  ABORTED: {},
  ERROR: {},
};
```

The AI can only affect this machine indirectly through validated symbols such as `APPROVED` or `REVISION`.

## 4. Iteration Control

Iteration counting should be isolated from prompt text and AI output.

```ts
export class IterationController {
  private count = 0;
  private limit: number;

  constructor(maxIterations: number) {
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10) {
      throw new RangeError("maxIterations must be an integer between 1 and 10.");
    }

    this.limit = maxIterations;
  }

  canContinue(): boolean {
    return this.count < this.limit;
  }

  consume(): { iteration: number; remaining: number } {
    if (!this.canContinue()) {
      throw new Error("Iteration limit exceeded.");
    }

    this.count += 1;
    return {
      iteration: this.count,
      remaining: this.limit - this.count,
    };
  }

  extend(additionalIterations: number): void {
    if (!Number.isInteger(additionalIterations) || additionalIterations < 1) {
      throw new RangeError("additionalIterations must be a positive integer.");
    }

    this.limit += additionalIterations;
  }

  current(): number {
    return this.count;
  }

  max(): number {
    return this.limit;
  }

  isExhausted(): boolean {
    return this.count >= this.limit;
  }
}
```

The controller owns the count. The AI only receives the current iteration as prompt context.

## 5. Verdict Parsing

Verdict parsing must be deterministic and strict.

The primary rule from the main blueprint should remain:

```text
The verdict token must appear alone on the final line.
```

Recommended parser:

```ts
export type Verdict = "APPROVED" | "REVISION" | "MISSING";

export function parseVerdict(text: string): Verdict {
  const lines = text.trimEnd().split("\n");
  const lastLine = lines.at(-1)?.trim();

  if (lastLine === "[APPROVED]") return "APPROVED";
  if (lastLine === "[REVISION]") return "REVISION";

  return "MISSING";
}
```

Do not treat persuasive prose as a verdict. A sentence like “this looks approved” is not a verdict.

### Missing Verdict Policy

When the verdict is missing:

1. Retry the Critic with a formatting repair prompt.
2. Retry at most two times.
3. If the verdict is still missing, treat the review as `REVISION`.
4. Persist the malformed output for auditability.

This keeps malformed AI output from accidentally advancing the workflow.

## 6. Issue Parsing

Critic reviews should be parsed into structured issues when possible.

```ts
export interface ReviewIssue {
  severity: "CRITICAL" | "MAJOR" | "MINOR";
  description: string;
  location: string;
  requiredFix: string;
}
```

The issue parser should be deterministic and best-effort. It should never be the only source of truth for state transitions.

Recommended use cases:

- Display unresolved issues to the user.
- Generate session reports.
- Prioritize revision prompt context.
- Track whether serious issues persist across iterations.

Recommended conservative behavior:

- If parsing fails, keep the raw review.
- If severity is missing or unknown, skip that issue block.
- If no issues are parsed but the verdict is `REVISION`, still continue with revision using the full raw review.

## 7. Revision Priority

When structured issues are available, the orchestrator may sort them before injecting them into the revision prompt.

Recommended order:

```text
CRITICAL -> MAJOR -> MINOR
```

For the current project scale, a simple sort is enough. A heap or priority queue is unnecessary until issue volumes become large.

```ts
const SEVERITY_RANK = {
  CRITICAL: 0,
  MAJOR: 1,
  MINOR: 2,
} as const;

export function sortIssuesBySeverity(issues: ReviewIssue[]): ReviewIssue[] {
  return [...issues].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}
```

This sorting should improve prompt quality, not override the full review.

## 8. Session History

Session history should be append-only and persisted as JSON plus artifact files.

A simple array is preferable to an in-memory linked list because sessions must survive process exits.

```ts
export interface IterationRecord {
  iteration: number;
  planPath: string;
  reviewPath: string;
  verdict: Verdict;
  issues: ReviewIssue[];
  createdAt: string;
}

export interface SessionState {
  sessionId: string;
  task: string;
  state: OrchestratorState;
  maxIterations: number;
  currentIteration: number;
  iterations: IterationRecord[];
  createdAt: string;
  updatedAt: string;
}
```

Recommended artifact layout:

```text
.agent-workspace/
  session.json
  session_report.md
  plan_v0.md
  review_v1.md
  plan_v1.md
  review_v2.md
```

This structure supports resume, audit trails, diagnostics, and future branch handling.

## 9. Diagnostic Heuristics

Diagnostic heuristics can help detect stalled or suspicious sessions. They must not replace the primary verdict path.

Recommended rule:

```text
Verdict token decides the primary path.
Classical algorithms validate, constrain, retry, persist, and warn.
```

### 9.1 Edit Distance

Normalized edit distance between consecutive plans can indicate plan stability.

Use it to warn when:

- The plan barely changes across revisions.
- The Critic keeps returning `REVISION`.
- The session may be stuck in a low-change loop.

Do not use edit distance as proof that the plan is correct.

### 9.2 Issue Count Trend

Tracking CRITICAL and MAJOR counts across reviews can reveal whether the session is improving.

Useful warning signals:

- CRITICAL issue count is unchanged across multiple iterations.
- CRITICAL + MAJOR count keeps increasing.
- The same location appears repeatedly in serious issues.

Do not require issue counts to decrease monotonically. A stronger later review may legitimately discover new issues.

### 9.3 Section-Level Change Tracking

Section checksums can identify repeated churn in the same part of the plan.

Useful warning signals:

- The same section changes in every iteration.
- A section changes repeatedly while the same issue remains unresolved.

This should be implemented after artifact storage and plan history exist.

## 10. Retry and Circuit Breaking

Agent calls should be wrapped with deterministic retry logic.

Recommended retry policy:

```text
Agent timeout: retry 2 times with backoff.
Missing verdict: retry 2 times with a formatting repair prompt.
Empty output: retry 1 time.
CLI not found: fail immediately.
Authentication error: fail immediately.
```

Recommended backoff:

```ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries: number; baseDelayMs: number },
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === options.maxRetries) {
        break;
      }

      const delayMs =
        options.baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 250);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
```

A circuit breaker can be added later if repeated external process failures become common. It is not required for the first CLI MVP.

## 11. Main Loop Shape

The high-level orchestration loop should look like this:

```ts
async function runConsensusSession(config: OrchestratorConfig): Promise<SessionSummary> {
  const stateMachine = new OrchestratorStateMachine();
  const iterations = new IterationController(config.maxIterations);
  const artifacts = new ArtifactStore(config.workspacePath);

  stateMachine.transition("START");

  let plan = await author.call(buildInitialPlanPrompt(config.task));
  artifacts.savePlan(0, plan);

  stateMachine.transition("PLAN_DONE");

  while (iterations.canContinue()) {
    const { iteration } = iterations.consume();

    const review = await critic.call(buildReviewPrompt({ plan, iteration }));
    const verdict = parseVerdict(review);
    const issues = parseIssues(review);

    artifacts.saveReview(iteration, review);
    artifacts.saveSessionState({ iteration, verdict, issues });

    if (verdict === "APPROVED") {
      stateMachine.transition("APPROVED");
      break;
    }

    if (iterations.isExhausted()) {
      stateMachine.transition("MAX_REACHED");
      break;
    }

    stateMachine.transition("REVISION");
    plan = await author.call(buildRevisionPrompt({ plan, review, issues }));
    artifacts.savePlan(iteration, plan);
    stateMachine.transition("PLAN_DONE");
  }

  if (stateMachine.getState() === "IMPLEMENTING") {
    await author.call(buildImplementationPrompt(plan));
    stateMachine.transition("IMPL_DONE");
  }

  return buildSessionSummary();
}
```

The exact implementation may differ, but these boundaries should remain stable.

## 12. Implementation Priority

Recommended adoption order for this repository:

1. Add `state-machine.ts`.
2. Add `iteration-controller.ts`.
3. Strengthen `verdict.ts` and add missing verdict retry policy.
4. Add `review-parser.ts`.
5. Add `artifacts/store.ts`.
6. Persist `session.json`.
7. Add user intervention when the iteration limit is reached.
8. Add diagnostics for edit distance, issue trend, and section churn.
9. Add retry wrappers around real agent adapters.
10. Consider circuit breaking only after real adapter behavior is observed.

## 13. What Not To Do

- Do not let the AI choose the next state directly.
- Do not accept non-token prose as approval.
- Do not use edit distance as a substitute for review approval.
- Do not overfit the issue parser to one fragile output shape.
- Do not introduce an in-memory linked list for session history before persistence exists.
- Do not add a circuit breaker before basic retry and error classification are implemented.

## 14. Summary

The safest architecture is not “AI decides and code executes.” It is:

```text
AI proposes meaning.
Algorithms constrain movement.
Artifacts preserve evidence.
Users intervene only when convergence fails.
```

This gives Consensus Orchestrator a predictable skeleton while still allowing AI agents to perform the judgment-heavy work they are good at.
