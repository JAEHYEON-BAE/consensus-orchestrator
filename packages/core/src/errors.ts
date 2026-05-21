export type OrchestratorPhase = "planning" | "reviewing" | "revising";

export class OrchestratorError extends Error {
  readonly phase: OrchestratorPhase;
  readonly iteration: number;
  readonly cause: unknown;

  constructor(phase: OrchestratorPhase, iteration: number, cause: unknown) {
    super(`Agent call failed during ${phase} (iteration ${iteration}): ${String(cause)}`);
    this.name = "OrchestratorError";
    this.phase = phase;
    this.iteration = iteration;
    this.cause = cause;
  }
}
