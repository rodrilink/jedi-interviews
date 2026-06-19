---
phase: 7
slug: screenshot-vision-packaging-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-19
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 (co-located `*.test.ts`) |
| **Config file** | electron-vite / vite-driven; tests run via `vitest run` |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm test` (→ `vitest run`) |
| **Estimated runtime** | ~10–20 seconds (unit suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <changed test file>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full Vitest suite green + `07-VERIFICATION.md` GO recorded
- **Max feedback latency:** ~20 seconds (unit); manual gate is the packaged-build check

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-xx | 01 | 1 | AI-03 | — | Downscale ≤1568 long edge, only-if-larger, aspect preserved | unit | `npx vitest run src/main/vision/test/downscale.utility.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-xx | 01 | 1 | AI-03 | T-7-IL | base64 has NO `data:` prefix | unit | `npx vitest run src/main/vision/test/downscale.utility.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-xx | 01 | 1 | AI-03 | — | `assemblePrompt` emits block array iff `image` present; string otherwise (text modes byte-identical) | unit | `npx vitest run src/main/ai/test/prompt-assembler.test.ts` | ⚠️ extend | ⬜ pending |
| 07-01-xx | 01 | 1 | AI-03 | — | Active-monitor source-select: match `desktopCapturer` source by `display_id` (pure helper) | unit | `npx vitest run src/main/vision/test/screenshot.service.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-xx | 01 | 1 | AI-03 | — | Orchestrator: code-challenge bypasses empty-span guard; single-in-flight cancel across 3 modes | unit | `npx vitest run src/main/ai/test/ai-orchestrator.test.ts` | ⚠️ extend | ⬜ pending |
| 07-01-xx | 01 | 1 | AI-03 | — | Live capture → stream → vision panel | manual | on-machine (see Manual-Only) | — | ⬜ pending |
| 07-02-xx | 02 | 2 | PKG-01 | T-7-TM | Packaged `.exe`: transparency + never-steal-focus + content-protection + screenshot-solve | manual | run `release/*.exe` on target machine | `07-VERIFICATION.md` | ⬜ pending |
| 07-02-xx | 02 | 2 | PKG-01 | T-7-TM | Native modules load in package (hotkeys + audio alive) | manual | observe in packaged `.exe` | `07-VERIFICATION.md` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/main/vision/test/downscale.utility.test.ts` — AI-03 (downscale math + no-`data:`-prefix assertion)
- [ ] `src/main/vision/test/screenshot.service.test.ts` — AI-03 (pure source-select/match logic; `desktopCapturer` mocked)
- [ ] Extend `src/main/ai/test/prompt-assembler.test.ts` — image branch + text-mode-byte-identical assertions
- [ ] Extend `src/main/ai/test/ai-orchestrator.test.ts` — code-challenge empty-span bypass + 3-mode single-in-flight cancel
- [ ] `07-VERIFICATION.md` — on-machine GO/NO-GO record (mirror Phase 1 `01-04` gate)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live screenshot-solve end-to-end | AI-03 | No headless display + no live Anthropic key in CI; streaming + real capture are integration-level | Park overlay on the challenge screen, press `Ctrl+Alt+C`, confirm a streaming solution appears in the vision panel grounded in session context |
| Overlay excluded from its own screenshot | AI-03 | Content-protection-vs-`desktopCapturer` exclusion is driver/scale dependent (A4 / Pitfall 1) | Capture, inspect the PNG, confirm no overlay rectangle is present |
| Packaged build: transparency / never-steal-focus / content-protection | PKG-01 | Existential behaviors are human-judged (Phase 1 precedent) | Run `release/*.exe` on target Win 11: verify transparent render, focus never leaves the active app, overlay absent from screen-share |
| Native modules alive in package | PKG-01 | Only observable in the packaged `.exe` (dev always works) | In the `.exe`: confirm hotkeys fire (uiohook) and the audio meter/transcript moves (native-recorder) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
