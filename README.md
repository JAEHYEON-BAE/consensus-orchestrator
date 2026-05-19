# Consensus Orchestrator

Consensus Orchestrator is a development automation tool that keeps Claude Code and OpenAI Codex in fixed Author/Critic roles. A user request moves through planning, review, revision, and approval before implementation.

This repository is an early MVP of the full blueprint. The core loop is already present with mock adapters: the Author writes an implementation plan, the Critic reviews it, and the Author revises the plan until it is approved or the iteration limit is reached.

## Purpose

AI coding tools often move directly from a user request to implementation. Consensus Orchestrator adds a review gate before implementation so design flaws, missing requirements, and risky assumptions can be caught while the work is still a plan.

The intended flow is:

```text
User task
  -> Claude Code as Author creates an implementation plan
  -> OpenAI Codex as Critic reviews the plan
  -> Author revises the plan when revision is required
  -> Approved plan proceeds to implementation
```

Every Critic review must end with exactly one of these verdict tokens:

```text
[APPROVED]
[REVISION]
```

