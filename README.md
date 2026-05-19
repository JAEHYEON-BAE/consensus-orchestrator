# Consensus Orchestrator

Claude Code and OpenAI Codex를 Author/Critic 역할로 고정해, 개발 요청을 계획, 리뷰, 수정, 승인 흐름으로 통과시키는 합의 기반 개발 자동화 도구입니다.

현재 저장소는 전체 설계의 초기 MVP입니다. 핵심 아이디어인 “Author가 구현 계획을 작성하고, Critic이 결함을 검토하며, 승인될 때까지 계획을 수정한다”는 루프가 mock adapter 기반으로 구현되어 있습니다.

## 목적

일반적인 AI 개발 자동화는 사용자 요청을 곧바로 구현으로 넘기기 쉽습니다. Consensus Orchestrator는 구현 전에 별도의 비판자 모델이 계획을 검토하도록 하여, 설계 결함과 빠진 요구사항을 먼저 드러내는 것을 목표로 합니다.

기본 흐름은 다음과 같습니다.

```text
User task
  -> Claude Code as Author creates an implementation plan
  -> OpenAI Codex as Critic reviews the plan
  -> Author revises the plan when revision is required
  -> Approved plan proceeds to implementation
```

Critic의 리뷰는 항상 다음 verdict token 중 하나로 끝나야 합니다.

```text
[APPROVED]
[REVISION]
```

## 현재 상태

구현되어 있는 항목:

- TypeScript 기반 pnpm workspace
- `packages/core` 공유 코어 패키지
- `packages/cli` CLI 엔트리포인트
- mock Author/Critic adapter
- 기본 orchestration loop
- verdict token parser
- `--max-iterations` 옵션

아직 구현되지 않은 항목:

- 실제 Claude Code / Codex CLI adapter
- prompt template 및 prompt builder
- state machine
- artifact store
- session resume
- max iteration 도달 시 사용자 개입
- dry-run / JSON output
- VS Code extension

전체 설계는 [consensus-orchestrator-blueprint.md](./consensus-orchestrator-blueprint.md)를 참고하세요.

## 프로젝트 구조

```text
.
├── consensus-orchestrator-blueprint.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── packages
    ├── cli
    │   └── src
    │       └── index.ts
    └── core
        └── src
            ├── adapters
            │   ├── base.ts
            │   └── mock.ts
            ├── index.ts
            ├── orchestrator.ts
            └── verdict.ts
```

## 요구사항

- Node.js 20 이상
- pnpm

현재 lockfile은 설치된 의존성 기준으로 관리합니다.

## 설치

```bash
pnpm install
```

## 실행

현재 CLI는 mock adapter를 사용합니다.

```bash
pnpm dev "간단한 계산기 구현"
```

sandbox나 로컬 환경에서 `tsx` IPC 문제가 발생하면 직접 실행할 수 있습니다.

```bash
node_modules/.bin/tsx packages/cli/src/index.ts "간단한 계산기 구현"
```

반복 횟수는 1부터 10까지 지정할 수 있습니다.

```bash
pnpm dev "PostgreSQL 비동기 쿼리 빌더 구현" --max-iterations 5
```

mock 흐름에서는 첫 리뷰가 `[REVISION]`, 두 번째 리뷰가 `[APPROVED]`로 종료됩니다.

## 검증

```bash
pnpm typecheck
pnpm test
```

현재 테스트 파일은 아직 추가되어 있지 않습니다.

## 설계 방향

최종 목표는 CLI와 VS Code Extension이 같은 core package를 공유하는 구조입니다.

```text
Presentation Layer
  CLI / VS Code Extension

Orchestrator Core
  Session manager / State machine / Iteration controller

Agent Adapter Layer
  Claude Code adapter / Codex adapter

Infrastructure Layer
  Artifact store / Prompt builder / Logger / Event bus
```

우선순위는 다음과 같습니다.

1. Core + CLI MVP 완성
2. 실제 Claude Code / Codex adapter 연결
3. 계획서와 리뷰 로그를 artifact로 저장
4. session resume 및 오류 복구
5. VS Code Extension 구현

## 개발 메모

이 저장소는 아직 git repository로 초기화되어 있지 않을 수 있습니다. Git으로 관리할 때는 `node_modules/`, `.pnpm-store/`, 빌드 산출물, coverage, `.agent-workspace/` 같은 세션 산출물을 제외하는 것이 좋습니다.
