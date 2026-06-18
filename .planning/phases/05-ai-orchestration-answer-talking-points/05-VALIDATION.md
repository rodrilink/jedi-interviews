---
phase: 5
slug: ai-orchestration-answer-talking-points
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-18
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 (co-located, per IDEXX standards) |
| **Config file** | electron-vite / vitest config in repo root (existing; STT tests run under it) |
| **Quick run command** | `npx vitest run src/main/ai/<file>.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds (unit suite; no network — gateway is faked) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/main/ai/<touched-file>.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green AND on-machine live AI verify complete
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

> Plan/task IDs are populated by the planner; rows below map each phase requirement and key locked decision to its automated proof. The overlay is `focusable:false` and the live stream is not unit-testable — those rows are intentionally manual-only.

| Requirement | Behavior | Threat Ref | Test Type | Automated Command | File Exists |
|-------------|----------|------------|-----------|-------------------|-------------|
| AI-01 | Answer-mode prompt assembly (correct system prompt + labeled span; infers latest question) | — | unit | `npx vitest run src/main/ai/prompt-assembler.test.ts` | ❌ W0 |
| AI-02 | Talking-points prompt assembly (3–5 bullet instruction shape) | — | unit | `npx vitest run src/main/ai/prompt-assembler.test.ts` | ❌ W0 |
| D-13 | Prompt assembler accepts empty grounding-context slot with no signature change | — | unit | `npx vitest run src/main/ai/prompt-assembler.test.ts` | ❌ W0 |
| D-11 | Empty-span guard skips the API call and emits a panel entry | — | unit | `npx vitest run src/main/ai/ai-orchestrator.test.ts` | ❌ W0 |
| D-06 / D-07 | Single-in-flight: re-press cancels; other mode cancels-then-starts; request-id guard prevents cross-stream event bleed | T-5 (key/stream integrity) | unit (FakeAiGateway) | `npx vitest run src/main/ai/ai-orchestrator.test.ts` | ❌ W0 |
| D-02 | AI history bounded (last-N entries / total-char ceiling) | — | unit | `npx vitest run src/main/ai/ai-history.test.ts` | ❌ W0 |
| AI-04 | Token-by-token delta push (trailing-edge debounce ~30–60ms) | — | unit (FakeAiGateway) | `npx vitest run src/main/ai/ai-orchestrator.test.ts` | ❌ W0 |
| AI-04 / AI-05 | Live streaming render + keyboard scrollback + focus-cycle indicator | — | manual-only | on-machine verify (overlay `focusable:false`; live stream not unit-testable) | n/a |
| AI-05 | `Ctrl+Alt+A`/`T`/`F` + clear-AI chord registration succeeds and conflict-tested vs Teams/Zoom/VS Code | — | manual-only | 02-03 conflict-test protocol on target machine | n/a |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/main/ai/prompt-assembler.test.ts` — stubs for AI-01 / AI-02 / D-13 (pure prompt assembly + empty context slot)
- [ ] `src/main/ai/ai-history.test.ts` — stubs for D-02 bounds (mirror `transcript-buffer` tests)
- [ ] `src/main/ai/ai-orchestrator.test.ts` — stubs for D-06 / D-07 / D-11 / AI-04 with a `FakeAiGateway` (mirror the `FakeV1Socket` stand-in used for Deepgram)
- [ ] No framework install needed — Vitest already configured (used by the Phase 4 STT tests).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live token-by-token streaming render in the AI panel | AI-04 | Overlay is `focusable:false`; live SDK stream + renderer paint not unit-testable | On the target machine, press `Ctrl+Alt+A` mid-conversation; confirm a `thinking…` entry appears, then text streams in token-by-token, debounced. |
| Keyboard scrollback over a long response | AI-05 | Requires real overlay render + focused-panel scroll | Generate a response longer than the visible panel; press `Ctrl+Alt+F` to focus the AI panel, then `Ctrl+Alt+PgUp/PgDn`; confirm full scrollback and the corner active-panel indicator. |
| Re-press cancels in-flight stream | Success Criterion 5 (D-06) | Requires a real in-flight stream | Press `Ctrl+Alt+A`, then re-press `Ctrl+Alt+A` before completion; confirm the entry is marked `(cancelled)` and no further tokens arrive. |
| Cancel-current-start-new across modes | D-07 | Requires real in-flight stream | Press `Ctrl+Alt+A`, then `Ctrl+Alt+T` mid-stream; confirm the answer entry stops and a new talking-points entry begins, with no concurrent API calls. |
| New-chord conflict test | AI-05 / D-05 / D-08 | OS-level chord capture vs meeting apps can't be unit-tested | Run the 02-03 conflict-test protocol for `Ctrl+Alt+A` / `T` / `F` + clear-AI against Teams, Zoom, and VS Code; document fallbacks if any collide. |
| Hotkey→first-token latency feel | Success Criterion 3 | "In the flow of conversation" is a subjective latency judgment | Read the 05-03 latency log lines for both modes; if Opus talking-points first-token feels too slow to be live, re-tier the per-mode constant to Haiku. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies (live-stream rows are explicitly manual-only)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (3 test files above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
