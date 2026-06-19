---
phase: 6
slug: session-context-settings-window
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-19
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 |
| **Config file** | `vitest.config.ts` (`environment: 'node'`, `include: ['src/**/*.test.ts']`) |
| **Quick run command** | `npx vitest run src/main/<touched-file>.test.ts` |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Estimated runtime** | ~3 seconds (node env, no Electron) |

Co-located `*.test.ts` next to source (existing convention: `prompt-assembler.test.ts`, `ai-orchestrator.test.ts`, `placeholder-secret.service.test.ts`).

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/main/<touched-file>.test.ts` (sub-second)
- **After every plan wave:** Run `npm test` (full suite must be green)
- **Before `/gsd:verify-work`:** Full suite green + manual integration checks (window focus, safeStorage round-trip, live re-key, observable grounding)
- **Max feedback latency:** ~3 seconds (unit); manual checks are phase-gate only

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 6-02-* | 02 | 1 | CTX-04 | — | DTO→IGroundingContext map; `undefined` when no active context | unit | `npx vitest run src/main/context/session-context.repository.test.ts` | ❌ W0 | ⬜ pending |
| 6-02-* | 02 | 1 | CTX-01 | V5 | Links parser split/trim/filter-empty; round-trips `links.join('\n')` | unit | `npx vitest run src/main/context/parse-links.utility.test.ts` | ❌ W0 | ⬜ pending |
| 6-01-* | 01 | 1 | SET-02 / D-08 | V7 | `resolveApiKey(saved, env)` precedence: saved → env → `''` | unit | `npx vitest run src/main/config/resolve-api-key.utility.test.ts` | ❌ W0 | ⬜ pending |
| 6-01-* | 01 | 1 | SET-02 | V6/V7 | safeStorage two-key round-trip (encrypt→store base64→decrypt), main-only | integration | headless `verify:secret`-style script (post `app.ready`) | ❌ W0 | ⬜ pending |
| 6-04-* | 04 | 2 | AI-06 / D-10 | — | `getActiveContext()` result reaches `assemblePrompt`; empty context = Phase-5-identical prompt | unit (extend) | `npx vitest run src/main/ai/ai-orchestrator.test.ts` | ✅ extend | ⬜ pending |
| 6-04-* | 04 | 2 | AI-06 / D-05 | — | `formatContext` renders the four blocks when filled | unit (exists) | `npx vitest run src/main/ai/prompt-assembler.test.ts` | ✅ covered | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/main/context/session-context.repository.test.ts` — stubs for CTX-04 (mapping + active-resolution)
- [ ] `src/main/context/parse-links.utility.test.ts` — stubs for CTX-01 (links parsing)
- [ ] `src/main/config/resolve-api-key.utility.test.ts` — stubs for SET-02/D-08 (key precedence)
- [ ] Extend `src/main/ai/ai-orchestrator.test.ts` — assert `getActiveContext()` reaches `assemblePrompt` (AI-06/D-10)
- [ ] Headless safeStorage two-key round-trip script (mirror `scripts/verify-secret.ts` + `electron.vite.verify.config.ts`) — SET-02 encrypt/decrypt
- [ ] No framework install needed (Vitest already present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Settings window opens focusable by hotkey; overlay keeps focus discipline | SET-01 | Live BrowserWindow creation + window focus state is not unit-observable | On-machine: press `Ctrl+Alt+S`, confirm a normal focusable window appears and the overlay remains click-through/unaffected |
| Live Deepgram reconnect on key save (no restart) | SET-02 / D-07 | Requires a live websocket + audio capture running | On-machine: with STT running, save a new Deepgram key, confirm the transcript resumes without app restart |
| safeStorage two-key round-trip end-to-end | SET-02 | Requires `app.ready` / DPAPI; not pure-unit | Run the headless `verify:secret`-style script post-`app.ready`; confirm encrypt→decrypt returns the original key |
| Grounding observably improves vs Phase 5 | AI-06 | Human-judged answer relevance | On-machine: trigger a mode with vs without saved context, compare answer relevance/specificity |
| `Ctrl+Alt+S` conflict re-check (Teams/Zoom/VS Code) | SET-01 / D-02 | OS/app-level chord interception, target-machine specific | On-machine: confirm `Ctrl+Alt+S` is not consumed by Teams/Zoom/VS Code; record a fallback letter if it collides (02-03 protocol) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
