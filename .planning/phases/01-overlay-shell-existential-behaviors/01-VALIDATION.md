---
phase: 1
slug: overlay-shell-existential-behaviors
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-16
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> This phase is an empirical GO/NO-GO gate — most acceptance is **manual on-machine** evidence (D-01/D-02/D-03), with one automatable assertion (the safeStorage round-trip, SET-03).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None yet (greenfield). The safeStorage round-trip is implemented as a main-process script `npm run verify:secret` (prints PASS/FAIL). A Vitest unit test is an acceptable alternative if preferred. |
| **Config file** | none — Wave 0 installs / scaffolds |
| **Quick run command** | `npm run verify:secret` (main-process placeholder round-trip prints PASS/FAIL) |
| **Full suite command** | Manual on-machine checklist (`VERIFICATION.md`) + `npm run verify:secret` + packaged-smoke eyeball |
| **Estimated runtime** | ~5 seconds (verify:secret); manual checklist ~10 min |

---

## Sampling Rate

- **After every task commit:** Run `npm run verify:secret` (once it exists) plus typecheck/lint.
- **After every plan wave:** Dev launch (`electron-vite dev`); eyeball the status HUD shows Electron version + content-protection=ON + window position.
- **Before phase gate:** Full manual `VERIFICATION.md` checklist signed (D-01/D-02/D-03), safeStorage PASS, packaged `.exe` transparency eyeballed (D-10), exact Electron 35.x patch recorded.
- **Max feedback latency:** ~5 seconds for the automated assertion.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-xx | 01 | 1 | (scaffold) | — | N/A | build | `electron-vite build` | ❌ W0 | ⬜ pending |
| 1-02-xx | 02 | — | OVL-01 | — | Transparent/frameless/always-on-top renders over all windows | manual-visual | — (eyeball; HUD on top) | ❌ W0 (VERIFICATION.md) | ⬜ pending |
| 1-02-xx | 02 | — | OVL-02 | — | Meeting app title bar stays focused while overlay shown/moved | manual-visual (D-01) | — (checklist) | ❌ W0 | ⬜ pending |
| 1-02-xx | 02 | — | OVL-04 | — | Overlay absent (not black) in real screen share; CP re-applied each show | manual-visual (D-02) | — (saved proof screenshot) | ❌ W0 | ⬜ pending |
| 1-03-xx | 03 | — | SET-03 | T-1 InfoDisclosure / EoP | safeStorage placeholder round-trip equals original; only ciphertext persisted; renderer cannot reach secret | unit/integration | `npm run verify:secret` | ❌ W0 | ⬜ pending |
| 1-04-xx | 04 | — | OVL-06 | — | Behaviors verified on target machine + pinned version recorded | manual (D-03) | — (committed VERIFICATION.md) | ❌ W0 | ⬜ pending |
| 1-04-xx | 04 | — | (D-10) | — | Packaged `.exe` still renders transparent/frameless | manual-visual | `npm run build` then launch `.exe` + eyeball | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `VERIFICATION.md` — the GO/NO-GO evidence doc (manual checklist, exact Electron patch version, machine info, date, proof-screenshot path) — D-03 / OVL-06
- [ ] `verify:secret` script (or Vitest test) — automatable safeStorage placeholder round-trip assertion — SET-03
- [ ] (Optional) Vitest install if the safeStorage assertion is written as a test rather than a script
- [ ] Lint/format config per IDEXX standards (oxlint + Prettier; 4-space, single quotes, 180 col)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Overlay renders transparent/frameless/always-on-top over all windows | OVL-01 | Visual rendering correctness can't be asserted programmatically | Launch app; confirm HUD floats over a maximized window with no opaque background / frame |
| Meeting app title bar never loses focus while overlay shown & moved | OVL-02 | OS focus state is observed visually; no in-app hook in Phase 1 (D-01) | Focus a meeting app (Teams/Zoom); show & move overlay; confirm the app's title bar stays active (not greyed) |
| Overlay absent (not a black rectangle) in real screen share; CP re-applied after each show | OVL-04 | Requires a real external capture path (D-02) | Start a real screen share or system screenshot while overlay visible; confirm overlay fully absent; save proof screenshot |
| All behaviors verified on the target Windows 11 machine against the pinned 35.x patch; version recorded | OVL-06 | "Verified on this machine" is the acceptance criterion (D-03) | Complete the checklist in VERIFICATION.md; record exact Electron patch, machine, date |
| Packaged `.exe` still renders transparent/frameless | D-10 | Packaged-build rendering can differ from dev; eyeball only | `npm run build`, launch the produced `.exe`, eyeball transparency (no white flash / opaque bg) |

---

## Validation Sign-Off

- [ ] All tasks have an `<automated>` verify or a Wave 0 dependency (manual behaviors are explicitly enumerated above)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (note: this phase is manual-heavy by nature — the gate is on-machine evidence)
- [ ] Wave 0 covers all MISSING references (VERIFICATION.md, verify:secret)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s for the automated assertion
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
