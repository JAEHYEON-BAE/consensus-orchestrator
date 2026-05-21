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

export interface StateTransitionEvent {
  from: OrchestratorState;
  to: OrchestratorState;
  trigger: TransitionSymbol;
  timestamp: Date;
}

const TRANSITIONS: Record<OrchestratorState, Partial<Record<TransitionSymbol, OrchestratorState>>> = {
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

const TERMINAL_STATES = new Set<OrchestratorState>(["DONE", "ABORTED", "ERROR"]);

export class OrchestratorStateMachine {
  private state: OrchestratorState = "IDLE";
  private readonly listeners: ((event: StateTransitionEvent) => void)[] = [];

  transition(trigger: TransitionSymbol): OrchestratorState {
    const next = TRANSITIONS[this.state][trigger];

    if (next === undefined) {
      throw new Error(
        `Invalid transition: cannot apply "${trigger}" in state "${this.state}".`
      );
    }

    const event: StateTransitionEvent = {
      from: this.state,
      to: next,
      trigger,
      timestamp: new Date(),
    };

    this.state = next;

    for (const listener of this.listeners) {
      listener(event);
    }

    return this.state;
  }

  onTransition(listener: (event: StateTransitionEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) this.listeners.splice(index, 1);
    };
  }

  getState(): OrchestratorState {
    return this.state;
  }

  isTerminal(): boolean {
    return TERMINAL_STATES.has(this.state);
  }
}
