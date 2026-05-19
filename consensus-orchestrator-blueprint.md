# Consensus Orchestrator — 설계 청사진
**Claude Code (Author) × OpenAI Codex (Critic) 합의 기반 개발 자동화**

---

## 목차

1. [개요 및 설계 철학](#1-개요-및-설계-철학)
2. [시스템 아키텍처](#2-시스템-아키텍처)
3. [상태 기계 설계](#3-상태-기계-설계)
4. [프롬프트 엔지니어링 명세](#4-프롬프트-엔지니어링-명세)
5. [CLI 프로그램 구현 명세](#5-cli-프로그램-구현-명세)
6. [VS Code Extension 구현 명세](#6-vs-code-extension-구현-명세)
7. [공유 코어 모듈 설계](#7-공유-코어-모듈-설계)
8. [오류 처리 및 복구 전략](#8-오류-처리-및-복구-전략)
9. [테스트 전략](#9-테스트-전략)
10. [구현 로드맵](#10-구현-로드맵)

---

## 1. 개요 및 설계 철학

### 1.1 시스템 목적

사용자가 작업을 요청하면, 두 AI 에이전트가 **자율적으로 대화하며 합의에 도달**하고 구현까지 수행하는 파이프라인이다. 사용자는 최초 요청 이후 합의가 도달할 때까지 개입하지 않아도 되며, 합의 실패 시에만 개입 요청을 받는다.

```
사용자 → [요청] → 오케스트레이터 → [자율 합의] → [구현]
                                          ↑
                              실패 시에만 사용자에게 질문
```

### 1.2 역할 고정 원칙

| 에이전트 | 역할 | 이유 |
|---|---|---|
| **Claude Code** | Author (저자) | 계획 수립, 수정, 최종 구현 담당 |
| **OpenAI Codex** | Critic (비판자) | 계획 검토, 결함 발견, 승인/반려 판정 |

역할은 세션 전체에서 **절대 교체되지 않는다**. 이는 대화 수렴 속도와 역할 명확성을 위한 설계 결정이다.

### 1.3 Verdict 토큰 규약

Codex의 모든 리뷰 출력은 반드시 아래 두 토큰 중 하나로 종결되어야 한다.

```
[APPROVED]   — 계획서가 구현 가능한 수준에 도달함
[REVISION]   — MAJOR 이상의 이슈가 존재하여 수정이 필요함
```

토큰이 누락된 경우, 오케스트레이터는 이를 `[REVISION]`으로 간주하고 재시도 요청을 보낸다 (최대 2회 재시도 후 오류 처리).

### 1.4 반복 횟수 정책

- **기본값**: 3회
- **사용자 지정 범위**: 1 ~ 10회
- **최대 반복 도달 시**: 루프를 종료하고 사용자에게 현재 상태와 선택지를 제시

---

## 2. 시스템 아키텍처

### 2.1 전체 레이어 구조

```
┌────────────────────────────────────────────────────────┐
│                   Presentation Layer                    │
│         CLI (Node.js)    │    VS Code Extension         │
└────────────────────────────────────────────────────────┘
                           │
┌────────────────────────────────────────────────────────┐
│                   Orchestrator Core                     │
│  SessionManager │ StateMachine │ IterationController    │
└────────────────────────────────────────────────────────┘
                           │
┌────────────────────────────────────────────────────────┐
│                   Agent Adapter Layer                   │
│      ClaudeCodeAdapter    │    CodexAdapter             │
└────────────────────────────────────────────────────────┘
                           │
┌────────────────────────────────────────────────────────┐
│                   Infrastructure Layer                  │
│   ArtifactStore │ PromptBuilder │ Logger │ EventBus     │
└────────────────────────────────────────────────────────┘
```

### 2.2 디렉토리 구조

```
consensus-orchestrator/
├── packages/
│   ├── core/                        # 공유 코어 (CLI + Extension 공용)
│   │   ├── src/
│   │   │   ├── orchestrator.ts      # 메인 오케스트레이터
│   │   │   ├── state-machine.ts     # 상태 기계
│   │   │   ├── session.ts           # 세션 모델
│   │   │   ├── adapters/
│   │   │   │   ├── claude.ts        # Claude Code 어댑터
│   │   │   │   └── codex.ts         # Codex 어댑터
│   │   │   ├── prompts/
│   │   │   │   ├── templates.ts     # 프롬프트 템플릿
│   │   │   │   └── builder.ts       # 프롬프트 빌더
│   │   │   ├── artifacts/
│   │   │   │   └── store.ts         # 아티팩트 저장소
│   │   │   └── events/
│   │   │       └── bus.ts           # 이벤트 버스
│   │   └── package.json
│   │
│   ├── cli/                         # CLI 패키지
│   │   ├── src/
│   │   │   ├── index.ts             # 엔트리포인트
│   │   │   ├── commands/
│   │   │   │   ├── run.ts           # 메인 실행 커맨드
│   │   │   │   └── resume.ts        # 세션 재개 커맨드
│   │   │   └── ui/
│   │   │       ├── renderer.ts      # 터미널 UI 렌더러
│   │   │       └── prompts.ts       # 사용자 입력 처리
│   │   └── package.json
│   │
│   └── vscode-extension/            # VS Code Extension 패키지
│       ├── src/
│       │   ├── extension.ts         # Extension 엔트리포인트
│       │   ├── commands/
│       │   │   └── runOrchestrator.ts
│       │   ├── panels/
│       │   │   ├── OrchestratorPanel.ts   # WebviewPanel
│       │   │   └── webview/
│       │   │       ├── index.html
│       │   │       ├── main.ts
│       │   │       └── components/
│       │   └── providers/
│       │       └── SessionTreeProvider.ts # 세션 목록 사이드바
│       ├── package.json             # Extension manifest
│       └── tsconfig.json
│
├── .workspace/                      # 세션 아티팩트 저장 (gitignore)
├── pnpm-workspace.yaml
└── package.json
```

### 2.3 데이터 흐름

```
[사용자 입력]
      │
      ▼
 SessionManager.create(task, maxIter)
      │
      ▼
 StateMachine: IDLE → PLANNING
      │
      ▼
 ClaudeCodeAdapter.generatePlan(task)
      │  returns: PlanDocument
      ▼
 ArtifactStore.save("plan_v0.md", plan)
      │
      ▼
 StateMachine: PLANNING → REVIEWING
      │
      ├─ [loop: i = 1..maxIterations]
      │        │
      │        ▼
      │   CodexAdapter.review(plan)
      │        │  returns: ReviewDocument { text, verdict }
      │        ▼
      │   ArtifactStore.save(`review_v${i}.md`, review)
      │        │
      │        ├─ verdict == APPROVED → StateMachine: REVIEWING → IMPLEMENTING
      │        │
      │        └─ verdict == REVISION
      │                 │
      │                 ▼
      │           ClaudeCodeAdapter.revise(plan, review)
      │                 │  returns: PlanDocument
      │                 ▼
      │           ArtifactStore.save(`plan_v${i}.md`, revisedPlan)
      │                 │
      │                 └─ [next iteration]
      │
      ├─ [maxIterations 도달, APPROVED 없음]
      │        │
      │        ▼
      │   StateMachine: REVIEWING → AWAITING_USER
      │        │
      │        ▼
      │   EventBus.emit("user:input_required", { reason, lastPlan, lastReview })
      │        │
      │        ▼
      │   [사용자 선택]
      │        ├─ "continue" → maxIterations 추가 후 루프 재개
      │        ├─ "accept"   → 현재 plan으로 구현 진행
      │        └─ "abort"    → 세션 종료
      │
      ▼
 StateMachine: IMPLEMENTING
      │
      ▼
 ClaudeCodeAdapter.implement(finalPlan)
      │
      ▼
 StateMachine: DONE
```

---

## 3. 상태 기계 설계

### 3.1 상태 정의

```typescript
enum OrchestratorState {
  IDLE             = "IDLE",           // 초기 상태
  PLANNING         = "PLANNING",       // Claude가 계획서 작성 중
  REVIEWING        = "REVIEWING",      // Codex가 리뷰 중
  REVISING         = "REVISING",       // Claude가 수정 중
  AWAITING_USER    = "AWAITING_USER",  // 사용자 입력 대기
  IMPLEMENTING     = "IMPLEMENTING",   // Claude가 구현 중
  DONE             = "DONE",           // 완료
  ERROR            = "ERROR",          // 복구 불가 오류
  ABORTED          = "ABORTED",        // 사용자 중단
}
```

### 3.2 전환 규칙

```
IDLE           → PLANNING        (trigger: session.start())
PLANNING       → REVIEWING       (trigger: plan generated)
REVIEWING      → REVISING        (trigger: verdict == REVISION && iter < maxIter)
REVIEWING      → IMPLEMENTING    (trigger: verdict == APPROVED)
REVIEWING      → AWAITING_USER   (trigger: verdict == REVISION && iter == maxIter)
REVISING       → REVIEWING       (trigger: revision generated)
AWAITING_USER  → REVIEWING       (trigger: user chose "continue")
AWAITING_USER  → IMPLEMENTING    (trigger: user chose "accept")
AWAITING_USER  → ABORTED         (trigger: user chose "abort")
IMPLEMENTING   → DONE            (trigger: implementation complete)
ANY            → ERROR           (trigger: unrecoverable exception)
ANY            → ABORTED         (trigger: user Ctrl+C / cancel command)
```

### 3.3 상태 기계 인터페이스

```typescript
// packages/core/src/state-machine.ts

interface Transition {
  from:    OrchestratorState;
  to:      OrchestratorState;
  trigger: string;
}

interface StateMachineEvent {
  previousState: OrchestratorState;
  currentState:  OrchestratorState;
  trigger:       string;
  timestamp:     Date;
}

class OrchestratorStateMachine {
  private state: OrchestratorState = OrchestratorState.IDLE;
  private readonly transitions: Transition[];
  private readonly listeners: ((e: StateMachineEvent) => void)[];

  transition(trigger: string): OrchestratorState;
  onTransition(listener: (e: StateMachineEvent) => void): void;
  getState(): OrchestratorState;
  isTerminal(): boolean;    // DONE | ABORTED | ERROR
}
```

---

## 4. 프롬프트 엔지니어링 명세

### 4.1 설계 원칙

모든 프롬프트는 다음 원칙을 준수한다.

1. **역할 명확화**: 시스템 프롬프트에서 에이전트의 역할을 명시적으로 고정한다.
2. **출력 형식 강제**: 판정 토큰(`[APPROVED]` / `[REVISION]`)은 응답의 마지막 줄에 단독으로 위치해야 한다.
3. **컨텍스트 누적**: 반복이 진행될수록 이전 리뷰와 수정 이력을 포함시켜 대화의 연속성을 유지한다.
4. **도메인 일반화**: 특정 언어나 프레임워크를 가정하지 않는다.

### 4.2 Claude Code 프롬프트 — 초기 계획서

```
SYSTEM:
You are a senior software architect acting as the Author in a structured 
planning process. Your plan will be reviewed critically by a separate agent 
(Critic). Write plans that are detailed, unambiguous, and implementation-ready.

USER:
The following task has been requested:

<task>
{task}
</task>

Write a comprehensive implementation plan in Markdown using this exact structure:

# Implementation Plan

## 1. Objective
One precise sentence describing what will be built.

## 2. Scope
### In Scope
- (bullet list)
### Out of Scope
- (bullet list)

## 3. Architecture
Describe key components, their responsibilities, and how they interact.
Include a simple ASCII diagram if the structure is non-trivial.

## 4. Implementation Steps
Numbered list. Each step must be:
- Concrete and actionable (not "handle errors" but "wrap X in try-catch, 
  throw CustomError on failure")
- Ordered by dependency (no step should depend on a later step)
- Scoped to a single concern

## 5. Data Models
Define all significant data structures, types, or schemas.

## 6. Edge Cases & Risk Mitigation
For each identified risk, provide a specific mitigation strategy.

## 7. Testing Strategy
Describe unit, integration, and edge-case tests with specific scenarios.

## 8. Open Questions
List any assumptions or decisions that need clarification.
```

### 4.3 Codex 프롬프트 — 리뷰

```
SYSTEM:
You are a senior engineer acting as the Critic in a structured planning 
process. Your role is to find flaws, gaps, and risks in implementation plans 
written by an Author (a separate agent). Be adversarial but constructive. 
You must end every review with exactly one verdict token.

USER:
Review the following implementation plan. This is iteration {iteration} of 
a maximum of {maxIterations}.

<plan>
{currentPlan}
</plan>

{iterationContext}

Structure your review as follows:

## Critical Issues
Issues that MUST be resolved before implementation (architectural flaws, 
security vulnerabilities, logical errors, impossible steps).

For each issue:
**Issue**: [description]
**Severity**: CRITICAL
**Location**: [section/step number in the plan]
**Required Fix**: [specific, actionable correction]

## Major Issues
Issues that significantly impact correctness or maintainability.
(same sub-structure as above, Severity: MAJOR)

## Minor Issues
Style, clarity, or completeness suggestions.
(same sub-structure as above, Severity: MINOR)

## Positive Observations
What the plan does well (required — acknowledge strengths).

## Summary
One paragraph overall assessment.

---
[APPROVED]
```
*(Verdict must be on its own line as the very last line. Use [APPROVED] only 
if there are zero CRITICAL and zero MAJOR issues. Use [REVISION] otherwise.)*

---
[REVISION]
```

**`{iterationContext}` 변수 내용 (반복 2회차부터 주입):**

```
Previous iterations context:
{for each past iteration:}
--- Iteration {n} ---
Review summary: {brief summary of issues raised}
Author's response: {brief summary of changes made}
Unresolved issues from iteration {n}: {list or "none"}
{end for}

Focus especially on whether previously raised issues have been adequately 
addressed. Do not re-raise issues that have been resolved.
```

### 4.4 Claude Code 프롬프트 — 수정

```
SYSTEM:
You are a senior software architect (Author). A Critic has reviewed your 
implementation plan and found issues. Revise the plan systematically.

USER:
Your current plan:
<plan>
{currentPlan}
</plan>

The Critic's review (Iteration {iteration}):
<review>
{currentReview}
</review>

Revise the plan by following these rules:
1. Every CRITICAL issue MUST be addressed. No exceptions.
2. Every MAJOR issue MUST be addressed or explicitly argued against with 
   technical justification.
3. MINOR issues should be addressed if they improve clarity; you may decline 
   with a brief note.
4. Do not remove sections from the plan structure.
5. Do not introduce new features or scope not implied by the original task.

Output the complete revised plan (all sections, not just changed parts).

After the plan, include:

## Revision Notes (Iteration {iteration})
For each issue raised:
- **[CRITICAL/MAJOR/MINOR] Issue**: [Critic's issue description]
  **Action**: [Addressed / Declined]
  **Rationale**: [What you changed, or why you declined]
```

### 4.5 Claude Code 프롬프트 — 구현

```
SYSTEM:
You are a senior software engineer. Implement the approved plan exactly as 
specified. Do not deviate from the plan's architecture or scope.

USER:
The following implementation plan has been approved after {totalIterations} 
review iterations:

<plan>
{finalPlan}
</plan>

Implementation requirements:
- Follow the architecture described in Section 3 exactly
- Implement each step in the order specified in Section 4
- Handle all edge cases listed in Section 6
- Write tests as specified in Section 7
- Add inline comments for non-obvious logic
- Create all necessary files; do not leave TODOs for later

Begin implementation.
```

### 4.6 사용자 개입 메시지 — 최대 반복 도달

사용자에게 제시하는 메시지 (CLI/Extension 공통 내용):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠  합의 미달: 최대 반복 횟수({maxIterations}회)에 도달했습니다.

마지막 리뷰에서 미해결된 주요 이슈:
{unresolvedIssues}  ← Codex 마지막 리뷰에서 CRITICAL/MAJOR 항목 추출

현재 계획서: .agent-workspace/plan_v{n}.md
전체 리뷰 로그: .agent-workspace/session_report.md

선택하십시오:
  [1] 추가 반복 허용 (몇 회 더?)
  [2] 현재 계획서로 구현 진행 (미해결 이슈 감수)
  [3] 세션 중단
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 5. CLI 프로그램 구현 명세

### 5.1 기술 스택

| 항목 | 선택 | 이유 |
|---|---|---|
| 런타임 | Node.js 20+ | Claude Code와 동일 생태계 |
| 언어 | TypeScript | 타입 안전성, 코어 공유 |
| CLI 프레임워크 | `commander` | 표준적이고 충분 |
| 터미널 UI | `ink` (React for CLI) | 진행 상황 실시간 렌더링 |
| 사용자 입력 | `@inquirer/prompts` | select/input/confirm |
| 로깅 | `pino` | 구조화 로깅, JSON 출력 |
| 직렬화 | `zod` | 런타임 타입 검증 |

### 5.2 CLI 명령 설계

```bash
# 기본 실행
co-run "작업 요청 내용"

# 반복 횟수 명시
co-run "작업 요청" --max-iterations 5

# 이전 세션 재개
co-run --resume <session-id>

# 드라이런 (에이전트 호출 없이 프롬프트만 출력)
co-run "작업 요청" --dry-run

# 아티팩트 저장 경로 지정
co-run "작업 요청" --workspace ./my-project/.co-workspace

# 세션 목록 조회
co-sessions list

# 세션 상세 조회
co-sessions show <session-id>
```

**`co-run` 옵션 전체 목록:**

```
Options:
  -m, --max-iterations <n>   최대 반복 횟수 (기본: 3, 범위: 1-10)
  -r, --resume <session-id>  이전 세션 재개
  -w, --workspace <path>     아티팩트 저장 경로
  --dry-run                  에이전트 미호출, 프롬프트만 출력
  --no-color                 색상 출력 비활성화
  --json                     머신 리더블 JSON 출력 (CI 사용)
  --timeout <seconds>        단일 에이전트 호출 타임아웃 (기본: 300)
  -v, --verbose              상세 로그 출력
  -h, --help                 도움말
```

### 5.3 터미널 UI 설계 (ink 컴포넌트)

```
┌─────────────────────────────────────────────────────┐
│  Consensus Orchestrator                             │
│  Task: PostgreSQL 비동기 쿼리 빌더 구현               │
├─────────────────────────────────────────────────────┤
│  Phase: REVIEWING        Iteration: 2 / 3           │
│                                                     │
│  ● PLANNING     ✓ 완료 (12.3s)                      │
│  ● REVIEWING    ⟳ 진행 중... (Codex 응답 대기)       │
│    └─ Iteration 1: [REVISION] — 3 CRITICAL, 2 MAJOR │
│    └─ Iteration 2: ⟳ 대기 중                        │
│  ○ IMPLEMENTING  대기                               │
├─────────────────────────────────────────────────────┤
│  Artifacts: .agent-workspace/                       │
│  Session ID: sess_20260515_143022                   │
└─────────────────────────────────────────────────────┘
```

진행 표시:
- `✓` 완료 (녹색)
- `⟳` 진행 중 (노란색, 스피너)
- `○` 대기 (회색)
- `✗` 실패 (빨간색)

### 5.4 CLI 엔트리포인트 구조

```typescript
// packages/cli/src/commands/run.ts

import { Command } from "commander";
import { Orchestrator } from "@consensus/core";
import { TerminalRenderer } from "../ui/renderer";
import { UserInputHandler } from "../ui/prompts";

export const runCommand = new Command("run")
  .argument("<task>", "수행할 작업 요청")
  .option("-m, --max-iterations <n>", "최대 반복 횟수", parseMaxIter, 3)
  .option("-w, --workspace <path>", "아티팩트 저장 경로", ".agent-workspace")
  .option("--dry-run", "프롬프트만 출력, 에이전트 미호출")
  .option("--json", "JSON 출력 모드 (CI용)")
  .action(async (task: string, opts: RunOptions) => {
    const renderer = opts.json
      ? new JsonRenderer()
      : new TerminalRenderer();
    
    const orchestrator = new Orchestrator({
      task,
      maxIterations: opts.maxIterations,
      workspacePath:  opts.workspace,
      dryRun:         opts.dryRun,
      onStateChange:  (e) => renderer.onStateChange(e),
      onUserRequired: (ctx) => UserInputHandler.handle(ctx),
    });

    try {
      const session = await orchestrator.run();
      renderer.renderSummary(session);
      process.exit(session.succeeded ? 0 : 1);
    } catch (err) {
      renderer.renderError(err);
      process.exit(2);
    }
  });

function parseMaxIter(val: string): number {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1 || n > 10) {
    throw new Error("--max-iterations는 1 이상 10 이하의 정수여야 합니다.");
  }
  return n;
}
```

### 5.5 사용자 입력 처리 (최대 반복 도달)

```typescript
// packages/cli/src/ui/prompts.ts

import { select, number, confirm } from "@inquirer/prompts";
import type { UserInputContext } from "@consensus/core";

export class UserInputHandler {
  static async handle(ctx: UserInputContext): Promise<UserDecision> {
    console.log("\n" + "━".repeat(56));
    console.log("⚠  합의 미달: 최대 반복 횟수에 도달했습니다.");
    console.log("\n미해결 이슈:");
    ctx.unresolvedIssues.forEach(issue => {
      console.log(`  [${issue.severity}] ${issue.description}`);
    });
    console.log("━".repeat(56) + "\n");

    const choice = await select({
      message: "어떻게 진행하시겠습니까?",
      choices: [
        { name: "추가 반복 허용",           value: "continue" },
        { name: "현재 계획서로 구현 진행",  value: "accept"   },
        { name: "세션 중단",                value: "abort"    },
      ],
    });

    if (choice === "continue") {
      const additional = await number({
        message: "몇 회 더 반복하시겠습니까? (1-5)",
        min: 1,
        max: 5,
        default: 2,
      });
      return { action: "continue", additionalIterations: additional ?? 2 };
    }

    if (choice === "accept") {
      const confirmed = await confirm({
        message: `미해결 이슈가 ${ctx.unresolvedIssues.length}건 있습니다. 그래도 진행하시겠습니까?`,
        default: false,
      });
      return confirmed
        ? { action: "accept" }
        : UserInputHandler.handle(ctx); // 재귀로 선택 재시작
    }

    return { action: "abort" };
  }
}
```

---

## 6. VS Code Extension 구현 명세

### 6.1 Extension 등록 항목 (package.json)

```json
{
  "name": "consensus-orchestrator",
  "displayName": "Consensus Orchestrator",
  "description": "Claude Code와 OpenAI Codex의 합의 기반 개발 자동화",
  "version": "0.1.0",
  "engines": { "vscode": "^1.88.0" },
  "categories": ["AI", "Programming Languages"],
  "activationEvents": ["onCommand:consensus.run"],
  "contributes": {
    "commands": [
      {
        "command": "consensus.run",
        "title": "Consensus: Run Orchestrator",
        "icon": "$(run)"
      },
      {
        "command": "consensus.resume",
        "title": "Consensus: Resume Session"
      },
      {
        "command": "consensus.showPanel",
        "title": "Consensus: Show Panel"
      }
    ],
    "menus": {
      "editor/context": [
        {
          "command": "consensus.run",
          "group": "consensus"
        }
      ]
    },
    "viewsContainers": {
      "activitybar": [
        {
          "id": "consensus-sidebar",
          "title": "Consensus",
          "icon": "$(circuit-board)"
        }
      ]
    },
    "views": {
      "consensus-sidebar": [
        {
          "id": "consensus.sessions",
          "name": "Sessions"
        }
      ]
    },
    "configuration": {
      "title": "Consensus Orchestrator",
      "properties": {
        "consensus.maxIterations": {
          "type": "number",
          "default": 3,
          "minimum": 1,
          "maximum": 10,
          "description": "기본 최대 반복 횟수"
        },
        "consensus.workspacePath": {
          "type": "string",
          "default": ".agent-workspace",
          "description": "아티팩트 저장 경로 (프로젝트 루트 기준 상대경로)"
        },
        "consensus.claudeCodePath": {
          "type": "string",
          "default": "claude",
          "description": "Claude Code 실행 파일 경로"
        },
        "consensus.codexPath": {
          "type": "string",
          "default": "codex",
          "description": "Codex CLI 실행 파일 경로"
        }
      }
    }
  }
}
```

### 6.2 Webview Panel 설계

Extension은 VS Code Webview API를 사용하여 전용 패널을 렌더링한다.

```
┌─────────────────────────────────────────────────────────────────┐
│  Consensus Orchestrator                               ⚙  ✕     │
├─────────────────────────────────────────────────────────────────┤
│  Task                                                           │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ PostgreSQL 비동기 쿼리 빌더 구현                      │        │
│  └─────────────────────────────────────────────────────┘        │
│  Max Iterations: [3 ▾]            [▶ Run]  [⟳ Resume]          │
├─────────────────────────────────────────────────────────────────┤
│  Progress                                                       │
│  ──────────────────────────────────────────────────────         │
│  ✓ Planning          Claude Code — 계획서 작성 완료             │
│  ↓                                                              │
│  ⟳ Reviewing [2/3]  Codex — 리뷰 진행 중...                    │
│    ├─ Iter 1: [REVISION]  3 CRITICAL · 2 MAJOR · 1 MINOR       │
│    └─ Iter 2: ⟳ 대기 중                                        │
│  ○ Implementing      대기                                       │
├─────────────────────────────────────────────────────────────────┤
│  Artifacts                           [Open Folder]              │
│  ├─ plan_v0.md          [View]                                  │
│  ├─ review_v1.md        [View]                                  │
│  ├─ plan_v1.md          [View]                                  │
│  └─ review_v2.md        [View] ← (진행 중)                      │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Extension ↔ Webview 메시지 프로토콜

Extension과 Webview는 `postMessage` API로 통신한다. 모든 메시지는 아래 타입을 따른다.

```typescript
// Extension → Webview (상태 업데이트)
type ExtensionMessage =
  | { type: "state_update";   payload: SessionState         }
  | { type: "artifact_added"; payload: { name: string; path: string } }
  | { type: "user_required";  payload: UserInputContext     }
  | { type: "error";          payload: { message: string; detail?: string } }
  | { type: "done";           payload: SessionSummary       };

// Webview → Extension (사용자 액션)
type WebviewMessage =
  | { type: "run";    payload: { task: string; maxIterations: number } }
  | { type: "resume"; payload: { sessionId: string }                  }
  | { type: "abort"                                                   }
  | { type: "open_artifact"; payload: { path: string }               }
  | { type: "user_decision"; payload: UserDecision                   };
```

### 6.4 Extension 엔트리포인트

```typescript
// packages/vscode-extension/src/extension.ts

import * as vscode from "vscode";
import { OrchestratorPanel } from "./panels/OrchestratorPanel";
import { SessionTreeProvider } from "./providers/SessionTreeProvider";

export function activate(context: vscode.ExtensionContext) {
  // 1. 사이드바 트리 뷰
  const treeProvider = new SessionTreeProvider(context);
  vscode.window.registerTreeDataProvider("consensus.sessions", treeProvider);

  // 2. 메인 커맨드
  context.subscriptions.push(
    vscode.commands.registerCommand("consensus.run", () => {
      OrchestratorPanel.createOrShow(context);
    }),
    vscode.commands.registerCommand("consensus.resume", (sessionId: string) => {
      OrchestratorPanel.createOrShow(context, sessionId);
    }),
    vscode.commands.registerCommand("consensus.showPanel", () => {
      OrchestratorPanel.createOrShow(context);
    }),
  );
}

export function deactivate() {}
```

### 6.5 OrchestratorPanel 구현 구조

```typescript
// packages/vscode-extension/src/panels/OrchestratorPanel.ts

export class OrchestratorPanel {
  private static instance: OrchestratorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private orchestrator?: Orchestrator;

  static createOrShow(ctx: vscode.ExtensionContext, sessionId?: string) {
    if (OrchestratorPanel.instance) {
      OrchestratorPanel.instance.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "consensusOrchestrator",
      "Consensus Orchestrator",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    OrchestratorPanel.instance = new OrchestratorPanel(panel, ctx, sessionId);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    ctx: vscode.ExtensionContext,
    sessionId?: string
  ) {
    this.panel = panel;
    this.panel.webview.html = this.buildWebviewHtml();
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleWebviewMessage(msg),
      undefined,
      ctx.subscriptions
    );
    this.panel.onDidDispose(() => {
      this.orchestrator?.abort();
      OrchestratorPanel.instance = undefined;
    });
    if (sessionId) this.resumeSession(sessionId);
  }

  private async handleWebviewMessage(msg: WebviewMessage) {
    switch (msg.type) {
      case "run":
        await this.startRun(msg.payload);
        break;
      case "abort":
        this.orchestrator?.abort();
        break;
      case "user_decision":
        this.orchestrator?.resolveUserInput(msg.payload);
        break;
      case "open_artifact":
        vscode.workspace.openTextDocument(msg.payload.path)
          .then(doc => vscode.window.showTextDocument(doc));
        break;
    }
  }

  private async startRun(opts: { task: string; maxIterations: number }) {
    const config = vscode.workspace.getConfiguration("consensus");
    this.orchestrator = new Orchestrator({
      ...opts,
      workspacePath:  config.get("workspacePath", ".agent-workspace"),
      claudeCodePath: config.get("claudeCodePath", "claude"),
      codexPath:      config.get("codexPath", "codex"),
      onStateChange:  (e) => this.postToWebview({ type: "state_update", payload: e }),
      onArtifact:     (a) => this.postToWebview({ type: "artifact_added", payload: a }),
      onUserRequired: (ctx) => new Promise(resolve => {
        this.postToWebview({ type: "user_required", payload: ctx });
        // resolve는 user_decision 메시지 수신 시 호출됨
        this.pendingUserResolve = resolve;
      }),
    });

    try {
      const summary = await this.orchestrator.run();
      this.postToWebview({ type: "done", payload: summary });
    } catch (err) {
      this.postToWebview({ type: "error", payload: { message: String(err) } });
    }
  }

  private postToWebview(msg: ExtensionMessage) {
    this.panel.webview.postMessage(msg);
  }
}
```

### 6.6 사용자 개입 UI (Webview 내)

최대 반복 도달 시 Webview에 아래 컴포넌트가 렌더링된다.

```
┌─────────────────────────────────────────────────────────┐
│  ⚠ 합의 미달 — 최대 3회 반복 완료                        │
├─────────────────────────────────────────────────────────┤
│  미해결 이슈                                             │
│  [CRITICAL] 트랜잭션 롤백 전략이 명시되지 않음            │
│  [MAJOR]    연결 풀 소진 시 동작 미정의                   │
├─────────────────────────────────────────────────────────┤
│  ○ 추가 반복 허용     추가 횟수: [2 ▾]                   │
│  ○ 현재 계획서로 구현 진행                               │
│  ○ 세션 중단                                            │
│                                          [확인]          │
└─────────────────────────────────────────────────────────┘
```

---

## 7. 공유 코어 모듈 설계

### 7.1 Orchestrator 클래스

```typescript
// packages/core/src/orchestrator.ts

export interface OrchestratorConfig {
  task:           string;
  maxIterations:  number;           // 1 ~ 10
  workspacePath:  string;
  dryRun?:        boolean;
  claudeCodePath?: string;          // 기본: "claude"
  codexPath?:      string;          // 기본: "codex"
  timeout?:        number;          // 초, 기본: 300
  onStateChange?:  (e: StateChangeEvent) => void;
  onArtifact?:     (a: ArtifactEvent) => void;
  onUserRequired?: (ctx: UserInputContext) => Promise<UserDecision>;
}

export interface SessionSummary {
  sessionId:     string;
  task:          string;
  succeeded:     boolean;           // APPROVED 수령 여부
  converged:     boolean;
  totalIter:     number;
  finalPlanPath: string;
  artifacts:     string[];
  duration:      number;            // ms
}

export class Orchestrator {
  constructor(private config: OrchestratorConfig) {}

  async run(): Promise<SessionSummary>;
  abort(): void;
  resolveUserInput(decision: UserDecision): void;
}
```

### 7.2 에이전트 어댑터 인터페이스

```typescript
// packages/core/src/adapters/base.ts

export interface AgentAdapter {
  readonly name: string;
  call(prompt: string, options?: CallOptions): Promise<string>;
  isAvailable(): Promise<boolean>;
}

export interface CallOptions {
  timeout?: number;
  label?:   string;    // 로깅용
}
```

**Claude Code 어댑터:**

```typescript
// packages/core/src/adapters/claude.ts

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "Claude Code";

  constructor(
    private readonly execPath: string = "claude",
    private readonly timeout:  number = 300_000,
  ) {}

  async call(prompt: string, opts?: CallOptions): Promise<string> {
    const result = await execa(this.execPath, ["--non-interactive"], {
      input:         prompt,
      timeout:       opts?.timeout ?? this.timeout,
      stripFinalNewline: true,
    });

    if (result.exitCode !== 0) {
      throw new AgentError("claude", result.stderr);
    }
    return result.stdout;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa(this.execPath, ["--version"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
```

**Codex 어댑터:**

```typescript
// packages/core/src/adapters/codex.ts

export class CodexAdapter implements AgentAdapter {
  readonly name = "OpenAI Codex";

  async call(prompt: string, opts?: CallOptions): Promise<string> {
    const result = await execa("codex", ["exec", "--json", "-"], {
      input:   prompt,
      timeout: opts?.timeout ?? 300_000,
    });

    return this.parseOutput(result.stdout);
  }

  private parseOutput(raw: string): string {
    // Codex는 newline-delimited JSON event stream을 반환
    // assistant의 text content block만 추출
    const lines  = raw.split("\n").filter(Boolean);
    const texts: string[] = [];

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "message" && event.role === "assistant") {
          for (const block of event.content ?? []) {
            if (block.type === "text") texts.push(block.text);
          }
        }
      } catch {
        // 파싱 실패 라인 무시
      }
    }

    if (texts.length === 0) {
      // fallback: 전체 stdout을 plain text로 처리
      return raw.trim();
    }
    return texts.join("\n").trim();
  }
}
```

### 7.3 Verdict 파서

```typescript
// packages/core/src/verdict.ts

export type Verdict = "APPROVED" | "REVISION" | "MISSING";

const APPROVED_PATTERN = /^\[APPROVED\]\s*$/m;
const REVISION_PATTERN = /^\[REVISION\]\s*$/m;

export function parseVerdict(reviewText: string): Verdict {
  // 마지막 줄 기준으로 판정 (중간에 언급된 토큰은 무시)
  const lines = reviewText.trimEnd().split("\n");
  const lastLine = lines[lines.length - 1].trim();
  
  if (lastLine === "[APPROVED]") return "APPROVED";
  if (lastLine === "[REVISION]") return "REVISION";
  
  // 마지막 줄이 아닌 곳에 토큰이 있는 경우도 허용 (fallback)
  if (APPROVED_PATTERN.test(reviewText)) return "APPROVED";
  if (REVISION_PATTERN.test(reviewText)) return "REVISION";
  
  return "MISSING";
}

export function handleMissingVerdict(
  reviewText: string,
  retryFn: () => Promise<string>,
  maxRetries: number = 2,
): Promise<{ text: string; verdict: Verdict }> {
  // verdict 토큰 누락 시 Codex에 재요청
  // ...
}
```

### 7.4 아티팩트 저장소

```typescript
// packages/core/src/artifacts/store.ts

export interface Artifact {
  name:      string;     // "plan_v0.md", "review_v1.md", ...
  path:      string;     // 절대경로
  type:      "plan" | "review" | "implementation" | "report";
  iteration: number;
  createdAt: Date;
}

export class ArtifactStore {
  constructor(private readonly workspacePath: string) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  save(name: string, content: string): Artifact;
  load(name: string): string;
  list(): Artifact[];
  sessionReport(session: SessionState): string;  // Markdown 리포트 생성
}
```

### 7.5 이벤트 버스

오케스트레이터의 내부 상태를 UI 레이어에 전달하는 단방향 이벤트 버스.

```typescript
// packages/core/src/events/bus.ts

export type OrchestratorEvent =
  | { type: "state_change";   payload: StateChangeEvent  }
  | { type: "agent_start";    payload: AgentStartEvent   }
  | { type: "agent_done";     payload: AgentDoneEvent    }
  | { type: "artifact";       payload: Artifact          }
  | { type: "verdict";        payload: VerdictEvent      }
  | { type: "user_required";  payload: UserInputContext  }
  | { type: "error";          payload: ErrorEvent        };

export class EventBus {
  emit(event: OrchestratorEvent): void;
  on(type: string, handler: (e: OrchestratorEvent) => void): () => void;
  once(type: string, handler: (e: OrchestratorEvent) => void): void;
}
```

---

## 8. 오류 처리 및 복구 전략

### 8.1 오류 분류 체계

```typescript
// packages/core/src/errors.ts

// 복구 가능 오류 — 재시도 대상
export class AgentTimeoutError extends Error {}    // 에이전트 응답 타임아웃
export class VerdictMissingError extends Error {}  // verdict 토큰 누락
export class AgentOutputError extends Error {}     // 빈 출력 또는 파싱 실패

// 복구 불가 오류 — ERROR 상태 전환
export class AgentNotFoundError extends Error {}   // CLI 미설치
export class AuthenticationError extends Error {}  // 인증 실패
export class WorkspaceError extends Error {}       // 파일시스템 오류
```

### 8.2 재시도 정책

| 오류 종류 | 재시도 횟수 | 백오프 | 재시도 후 실패 시 |
|---|---|---|---|
| `AgentTimeoutError` | 2 | 5s, 10s | ERROR 상태 |
| `VerdictMissingError` | 2 | 즉시 | REVISION으로 간주 |
| `AgentOutputError` | 1 | 즉시 | ERROR 상태 |
| `AgentNotFoundError` | 0 | — | 즉시 종료, 설치 안내 |

### 8.3 사전 요구사항 검증

세션 시작 전 `preflight check` 수행:

```typescript
async function preflightCheck(config: OrchestratorConfig): Promise<void> {
  const claude = new ClaudeCodeAdapter(config.claudeCodePath);
  const codex  = new CodexAdapter(config.codexPath);

  const [claudeOk, codexOk] = await Promise.all([
    claude.isAvailable(),
    codex.isAvailable(),
  ]);

  const errors: string[] = [];
  if (!claudeOk) errors.push(`Claude Code를 찾을 수 없음: '${config.claudeCodePath}'`);
  if (!codexOk)  errors.push(`Codex를 찾을 수 없음: '${config.codexPath}'`);

  if (errors.length > 0) {
    throw new AgentNotFoundError(errors.join("\n"));
  }
}
```

### 8.4 세션 영속성 (재개 지원)

각 반복 완료 후 세션 상태를 JSON으로 저장하여, 중단 시 재개가 가능하다.

```typescript
// .agent-workspace/session.json 스키마
{
  "sessionId":    "sess_20260515_143022",
  "task":         "...",
  "maxIterations": 3,
  "state":        "REVIEWING",
  "currentIter":  2,
  "iterations": [
    {
      "number":    1,
      "planPath":  "plan_v0.md",
      "reviewPath": "review_v1.md",
      "verdict":   "REVISION",
      "timestamp": "2026-05-15T14:30:22Z"
    }
  ],
  "createdAt":    "2026-05-15T14:30:00Z",
  "updatedAt":    "2026-05-15T14:35:10Z"
}
```

재개 시 오케스트레이터는 `session.json`을 로드하고 마지막 완료 상태부터 재개한다.

---

## 9. 테스트 전략

### 9.1 단위 테스트

```
packages/core/src/__tests__/
├── verdict.test.ts          # parseVerdict — 토큰 위치 변형, 누락, 양쪽 모두 존재
├── state-machine.test.ts    # 모든 전환 경로, 잘못된 전환 거부
├── prompt-builder.test.ts   # 컨텍스트 주입, 이전 이력 포함 여부
└── artifact-store.test.ts   # 저장/로드/목록 조회
```

**verdict 파서 테스트 케이스:**

```typescript
describe("parseVerdict", () => {
  it("마지막 줄이 [APPROVED]이면 APPROVED 반환");
  it("마지막 줄이 [REVISION]이면 REVISION 반환");
  it("토큰이 중간에만 있으면 fallback으로 감지");
  it("토큰이 없으면 MISSING 반환");
  it("대소문자 혼용 토큰은 MISSING으로 처리 (엄격 파싱)");
  it("[APPROVED]와 [REVISION]이 모두 있으면 마지막 줄 우선");
});
```

### 9.2 통합 테스트 (Mock 에이전트)

실제 에이전트 호출 없이 파이프라인 전체를 테스트하기 위한 Mock 어댑터:

```typescript
class MockClaudeAdapter implements AgentAdapter {
  private responses: string[];
  private callCount = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async call(): Promise<string> {
    return this.responses[this.callCount++] ?? "fallback plan";
  }
}

class MockCodexAdapter implements AgentAdapter {
  constructor(private verdicts: Verdict[]) {}

  async call(_: string): Promise<string> {
    const v = this.verdicts.shift() ?? "REVISION";
    return `## Review\n\nSome feedback.\n\n[${v}]`;
  }
}

// 테스트 시나리오
it("2회차에 APPROVED 수령 시 정상 종료", async () => {
  const orchestrator = new Orchestrator({
    task: "test",
    maxIterations: 3,
    adapters: {
      claude: new MockClaudeAdapter(["plan_v0", "plan_v1"]),
      codex:  new MockCodexAdapter(["REVISION", "APPROVED"]),
    },
  });
  const result = await orchestrator.run();
  expect(result.converged).toBe(true);
  expect(result.totalIter).toBe(2);
});

it("maxIterations 도달 시 onUserRequired 호출", async () => {
  const mockUserInput = jest.fn().mockResolvedValue({ action: "abort" });
  const orchestrator = new Orchestrator({
    maxIterations:  2,
    onUserRequired: mockUserInput,
    adapters: {
      codex: new MockCodexAdapter(["REVISION", "REVISION"]),
    },
  });
  await orchestrator.run();
  expect(mockUserInput).toHaveBeenCalledTimes(1);
});
```

### 9.3 E2E 테스트

실제 CLI 환경에서 `--dry-run` 플래그를 이용하여 프롬프트 생성 검증:

```bash
# 프롬프트 출력만 확인 (에이전트 미호출)
co-run "간단한 계산기 구현" --dry-run --json | jq '.prompts'
```

### 9.4 Extension 테스트

- `@vscode/test-electron`을 사용한 Extension Host 통합 테스트
- Webview 메시지 프로토콜 직렬화/역직렬화 단위 테스트
- Mock Orchestrator를 사용한 UI 상태 전환 테스트

---

## 10. 구현 로드맵

### Phase 1 — 코어 + CLI MVP (2주 목표)

| 작업 | 우선순위 | 예상 소요 |
|---|---|---|
| 프로젝트 초기화 (monorepo, TypeScript) | P0 | 0.5일 |
| `StateMachine` 구현 + 단위 테스트 | P0 | 0.5일 |
| `ClaudeCodeAdapter` 구현 | P0 | 1일 |
| `CodexAdapter` 구현 + 출력 파서 | P0 | 1일 |
| `PromptBuilder` (4개 템플릿) | P0 | 1일 |
| `Orchestrator` 메인 루프 | P0 | 1.5일 |
| `ArtifactStore` | P1 | 0.5일 |
| CLI 기본 커맨드 (`co-run`) | P0 | 1일 |
| 터미널 UI (ink 컴포넌트) | P1 | 1일 |
| 사용자 개입 흐름 (inquirer) | P0 | 0.5일 |
| 통합 테스트 (Mock 어댑터) | P0 | 1일 |
| `--dry-run`, `--json` 옵션 | P1 | 0.5일 |
| Preflight check | P1 | 0.5일 |

### Phase 2 — 세션 관리 + 안정화 (1주 목표)

| 작업 | 우선순위 |
|---|---|
| 세션 영속성 (`session.json`) | P0 |
| `co-run --resume` 구현 | P0 |
| `co-sessions` 커맨드 | P1 |
| 재시도 정책 구현 | P0 |
| `VerdictMissingError` 처리 + Codex 재요청 | P0 |
| 세션 리포트 생성 (`session_report.md`) | P1 |

### Phase 3 — VS Code Extension (2주 목표)

| 작업 | 우선순위 |
|---|---|
| Extension 프로젝트 설정 + manifest | P0 |
| Webview HTML/CSS/JS | P0 |
| Extension ↔ Webview 메시지 프로토콜 | P0 |
| `OrchestratorPanel` 구현 | P0 |
| 사이드바 `SessionTreeProvider` | P1 |
| 설정 페이지 연동 | P1 |
| 사용자 개입 Webview 컴포넌트 | P0 |
| 아티팩트 파일 직접 열기 (`vscode.workspace.openTextDocument`) | P1 |
| Extension 테스트 | P1 |

### Phase 4 — 고도화 (선택적)

| 작업 | 설명 |
|---|---|
| 역할 교환 모드 | Claude가 Critic, Codex가 Author로 전환하는 실험적 모드 |
| 도메인별 체크리스트 | 보안, 성능, 접근성 등 도메인별 리뷰 기준 주입 |
| 멀티 에이전트 풀 | Critic을 복수의 에이전트로 구성 (다수결 verdict) |
| GitHub Integration | 합의된 계획서를 PR description으로 자동 등록 |
| 비용 추적 | 세션당 API 호출 횟수 및 추정 비용 출력 |

---

## 부록 A — 핵심 의존성 목록

```json
// packages/core/package.json
{
  "dependencies": {
    "execa":    "^8.0.0",   // 자식 프로세스 실행
    "zod":      "^3.22.0",  // 런타임 타입 검증
    "pino":     "^8.21.0",  // 구조화 로깅
    "nanoid":   "^5.0.0"    // 세션 ID 생성
  }
}

// packages/cli/package.json
{
  "dependencies": {
    "commander":          "^12.0.0",
    "ink":                "^5.0.0",
    "@inquirer/prompts":  "^5.0.0"
  }
}

// packages/vscode-extension/package.json
{
  "devDependencies": {
    "@vscode/test-electron": "^2.3.0",
    "@types/vscode":         "^1.88.0"
  }
}
```

## 부록 B — 최소 요구사항

| 항목 | 요구사항 |
|---|---|
| Node.js | 20.0.0 이상 |
| Claude Code CLI | 최신 버전 (`npm install -g @anthropic-ai/claude-code`) |
| OpenAI Codex CLI | 최신 버전 (`npm install -g @openai/codex`) |
| VS Code | 1.88.0 이상 (Extension 사용 시) |
| OS | macOS 12+, Linux (Ubuntu 22.04+), Windows 11 (WSL2) |

---

*이 청사진은 2026년 5월 기준 Claude Code 및 OpenAI Codex CLI의 공개 명세를 기반으로 작성되었다. 두 CLI의 출력 형식 변경 시 어댑터 레이어(`ClaudeCodeAdapter`, `CodexAdapter`)만 수정하면 나머지 코어 로직은 영향을 받지 않도록 설계되었다.*
