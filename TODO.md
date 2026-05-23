# TODO — Consensus Orchestrator

두 분석을 종합한 구현 태스크 목록입니다.  
현재 상태: **AI agent 연결 전 준비 약 65%** — core loop·FSM·verdict·artifact 기반은 견고하나, 실제 agent 호출을 감당할 어댑터 계층과 안전장치가 없습니다.

---

## Phase 1 — AI Agent 연결 전 필수 (4개)

실제 agent를 붙이기 전에 아래 4개가 없으면, 실패 조건이 core loop으로 그대로 새어 들어옵니다.

### 1-A. 실제 Agent Adapter 구현

- [ ] `packages/core/src/adapters/claude.ts` 작성
  - `execa`로 `claude --non-interactive` 호출, stdin에 prompt 전달, stdout 반환
  - 비정상 exit code → `OrchestratorError` throw
- [ ] `packages/core/src/adapters/codex.ts` 작성
  - `codex exec --json -` 호출
  - newline-delimited JSON event stream 파싱 → `assistant` 텍스트 블록 추출
  - 파싱 실패 시 raw stdout fallback
- [ ] `AgentAdapter` 인터페이스([adapters/base.ts](packages/core/src/adapters/base.ts))에 `isAvailable(): Promise<boolean>` 추가
- [ ] `execa` 패키지를 `package.json`에 추가 (`pnpm add execa`)

### 1-B. PromptBuilder / 구조화된 프롬프트 템플릿

현재 `orchestrator.ts`가 넘기는 프롬프트(`PLAN:\n...`, `REVISE:\n...`)는 실제 agent에서 구조화된 리뷰를 기대하기에 너무 얇습니다. 청사진 §4 기준.

- [ ] `packages/core/src/prompts/templates.ts` 작성
  - PLAN 프롬프트: SYSTEM(Author 역할 명시) + 7개 섹션 구조 강제
  - REVIEW 프롬프트: SYSTEM(Critic 역할 명시) + CRITICAL/MAJOR/MINOR 구조 + `[APPROVED]`/`[REVISION]` 토큰 강제
  - REVISE 프롬프트: 이전 리뷰 주입 + Revision Notes 형식
  - IMPLEMENT 프롬프트: 승인된 plan 주입
- [ ] `packages/core/src/prompts/builder.ts` 작성
  - 반복 2회차부터 이전 이력(`iterationContext`) 주입
  - `Orchestrator`에서 raw 문자열 대신 builder 사용하도록 교체

### 1-C. Adapter 안정장치 (timeout · retry · 가용성 확인)

- [ ] Preflight check 함수 구현 (`isAvailable()` 활용)
  - session 시작 전 `claude`/`codex` CLI 설치 여부 확인
  - 미설치 시 설치 안내 메시지와 함께 조기 종료
- [ ] `AgentAdapter.call()`에 `timeout` 옵션 추가
  - 기본값 300초, `OrchestratorOptions`에서 설정 가능하게
- [ ] 재시도/백오프 정책 구현 (청사진 §8.2 기준)
  - `AgentTimeoutError`: 최대 2회 재시도, 5s/10s 백오프
  - `AgentOutputError` (빈 출력): 1회 재시도
  - `AgentNotFoundError` / `AuthenticationError`: 즉시 종료
- [ ] stderr 캡처 및 로깅

### 1-D. 최대 반복 도달 시 사용자 개입 흐름

현재 `orchestrator.ts:98`에서 `break` 후 `converged: false`로 종료합니다. FSM에는 `AWAITING_USER`가 있지만 연결되지 않았습니다.

- [ ] `OrchestratorOptions`에 `onUserRequired` 콜백 추가
  ```ts
  onUserRequired?: (ctx: UserInputContext) => Promise<UserDecision>
  ```
- [ ] `UserInputContext` / `UserDecision` 타입 정의
  ```ts
  interface UserInputContext { lastPlan: string; lastReview: string; unresolvedIssues: Issue[] }
  type UserDecision =
    | { action: "continue"; additionalIterations: number }
    | { action: "accept" }
    | { action: "abort" }
  ```
- [ ] `Orchestrator.run()`에서 `MAX_REACHED` 이후 `onUserRequired` 호출 + FSM 전환(`USER_CONTINUE` / `USER_ACCEPT` / `USER_ABORT`) 연결
- [ ] CLI에서 `@inquirer/prompts`를 이용한 선택 UI 구현 (select + number input)

---

## Phase 2 — AI Agent 연결 후 안정화

agent가 붙은 뒤 실제 품질을 올리고 루프를 완성하는 작업입니다.

### 2-A. IMPLEMENTING 단계 연결

현재 `APPROVED` 수령 시 FSM은 `IMPLEMENTING`으로 전환하지만 `orchestrator.ts:92`에서 바로 `return`합니다.

- [ ] `author.call(implementPrompt)` 호출 추가 (IMPLEMENT 템플릿 사용)
- [ ] FSM `IMPL_DONE` 전환 연결
- [ ] 구현 결과를 artifact로 저장 (`implementation_final.md`)

### 2-B. 세션 영속성 (Session Persistence)

- [ ] `session.json` 스키마 정의 및 저장 로직 구현
  - 각 반복 완료 후 상태 기록 (sessionId, state, currentIter, planPath, reviewPath, verdict, timestamps)
- [ ] `session_report.md` 생성 (세션 종료 시 전체 이력 Markdown 리포트)
- [ ] `--resume <session-id>` CLI 옵션 구현

### 2-C. Review Issue Parser

- [ ] Critic 응답에서 CRITICAL / MAJOR / MINOR 이슈를 구조화된 객체로 파싱
  ```ts
  interface Issue { severity: "CRITICAL" | "MAJOR" | "MINOR"; description: string; location?: string }
  ```
- [ ] `UserInputContext.unresolvedIssues` 에 파싱 결과 주입
- [ ] stuck loop 탐지: 동일 이슈가 N회 연속 제기되면 경고 이벤트 emit

---

## Phase 3 — CLI UX 개선

### 3-A. 추가 CLI 옵션

- [ ] `--dry-run`: 에이전트 미호출, 생성될 프롬프트만 출력
- [ ] `--json`: 머신 리더블 JSON 출력 (CI 사용)
- [ ] `--timeout <seconds>`: 단일 에이전트 호출 타임아웃
- [ ] `--no-color`: 색상 출력 비활성화

### 3-B. 터미널 UI

- [ ] `ink` 기반 실시간 진행 상황 렌더러 구현
  - 단계별 상태 표시 (✓ 완료 / ⟳ 진행 중 / ○ 대기 / ✗ 실패)
  - 각 반복의 verdict 및 이슈 수 표시

### 3-C. Session 관리 명령

- [ ] `co-sessions list`: 저장된 세션 목록 출력
- [ ] `co-sessions show <session-id>`: 세션 상세 조회

---

## Phase 4 — 구조 / 인프라

### 4-A. Monorepo 패키지 분리

현재 루트 단일 TypeScript 프로젝트로 동작하지만 청사진의 pnpm workspace 구조에서 벗어나 있습니다.

- [ ] `packages/core/package.json` 작성 (독립 패키지, `execa`·`zod`·`pino` 의존성)
- [ ] `packages/cli/package.json` 작성 (`commander`·`ink`·`@inquirer/prompts` 의존성)
- [ ] `pnpm-workspace.yaml` 작성 및 루트 `package.json` 정리
- [ ] 각 패키지별 `tsconfig.json` 분리

### 4-B. VS Code Extension (Phase 3 in blueprint)

- [ ] `packages/vscode-extension` 패키지 초기화
- [ ] Extension manifest (`package.json`) 작성
- [ ] `OrchestratorPanel` (Webview) 구현
- [ ] Extension ↔ Webview 메시지 프로토콜 구현
- [ ] `SessionTreeProvider` 사이드바 구현

---

## 현재 완료된 항목 (참고)

- [x] `AgentAdapter` 인터페이스 설계
- [x] `OrchestratorStateMachine` (모든 전환 경로 구현 및 테스트)
- [x] `IterationController` (범위 검증, extend 지원)
- [x] `ArtifactStore` (run ID 기반 디렉토리, plan/review 저장)
- [x] `resolveVerdict` (verdict 파싱 + 최대 2회 자동 재시도)
- [x] `OrchestratorError` (phase / iteration 컨텍스트 포함)
- [x] `MockClaudeAdapter` / `MockCodexAdapter`
- [x] `Orchestrator` 메인 루프 (plan → review → revise 사이클)
- [x] `onEvent` 콜백 기반 이벤트 시스템
- [x] CLI 기본 명령 (`co-run`, `--max-iterations`, `--workspace`, `--verbose`)
- [x] 단위 테스트 74개 전체 통과
- [x] TypeScript strict 모드 오류 없음
