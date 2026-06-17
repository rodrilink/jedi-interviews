# Phase 1: Overlay Shell + Existential Behaviors - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

A transparent, frameless, always-on-top overlay window that (1) never steals keyboard/mouse focus from the active meeting app and (2) is absent from screen-share/recording capture, running on a pinned and on-machine-verified Electron 35.x build, with the API-key security boundary (contextIsolation, sandbox, typed preload, safeStorage) established in the scaffold before any feature code.

This is a **GO/NO-GO gate** — "verified on the target Windows 11 machine" is an acceptance criterion, not an optional check. Covers requirements OVL-01, OVL-02, OVL-04, OVL-06, SET-03.

**Locked upstream (do not re-litigate):** Electron 35.x + TypeScript + electron-vite + React with main/preload/renderer split; `focusable:false` + `showInactive`; `setContentProtection` re-applied after every show; secret/IPC boundary wired in the scaffold; Electron pinned to a known-good 35.x patch (NOT 35.0.1, avoid the 40.x line). The four roadmap plans (01-01 scaffold, 01-02 WindowManager, 01-03 secret boundary, 01-04 on-machine verification) are the agreed work breakdown.

</domain>

<decisions>
## Implementation Decisions

### On-Machine Verification (plan 01-04)
- **D-01:** Prove "focus is never stolen" with a **manual visual checklist** — watch the active meeting app's title bar stay focused/active while the overlay is shown and moved, and tick a written checklist. No programmatic foreground-window logging in Phase 1.
- **D-02:** Prove "absent from screen capture" with a **real self screen-share or system screenshot** while the overlay is visible — confirm it is fully absent (not a black rectangle). The proof screenshot is saved as gate evidence.
- **D-03:** All verification evidence lives in a **committed `VERIFICATION.md`** containing: the checklist with sign-off, the recorded exact Electron 35.x patch version, target-machine info, the date, and the path to the proof screenshot. This is the auditable GO/NO-GO record.

### Secret/IPC Boundary (plan 01-03)
- **D-04:** Implement the **most basic security proof only** — a main-process-only `safeStorage` (DPAPI) round-trip: encrypt a hardcoded **placeholder/fake** secret, persist the ciphertext, read it back, decrypt, and assert equality. All in the main process. No real keys (those arrive in Phase 6).
- **D-05:** **No renderer-facing or IPC secret channels in Phase 1.** The full typed renderer→main secret channel (returning booleans only, never plaintext) is designed in Phase 6 when the settings window and real keys exist.
- **D-06:** Still wire the structural boundary in the scaffold now: `contextIsolation: true`, `sandbox: true`, and a typed `contextBridge` preload — but with no secret-bearing channels yet. This establishes the architecture that Phases 2–6 build on top of.

### Overlay First-Paint (plan 01-02)
- **D-07:** The empty overlay renders a **tiny status HUD** showing proof-of-life: Electron version, content-protection state (ON/OFF), and window position. It doubles as the visual verification readout during the gate (you can see the pinned version and CP state on screen while screen-sharing to confirm the whole thing is hidden).
- **D-08:** Build the HUD as a **toggleable debug HUD that survives** into later phases (hidden by default later, toggle wired in Phase 2 once hotkeys exist). In Phase 1 it simply shows by default since no hotkeys exist yet.

### Electron Version Pinning (plans 01-01 / 01-04)
- **D-09:** Pin Electron with an **exact version (no `^` or `~`) in `package.json` AND commit the lockfile** for byte-for-byte reproducible reinstalls — the verified build must equal the shipped build. Procedure: start on the latest 35.x patch, verify BOTH behaviors, then pin and record the exact patch.
- **D-10:** The Phase 1 packaged smoke test is **minimal**: build once via electron-builder, launch the `.exe`, and eyeball that transparency/frameless rendering still holds (no opaque background, no white flash). Installer/signing and full focus+content-protection re-verification of the packaged build are deferred to Phase 7 (PKG-01).

### Claude's Discretion
- Exact HUD layout/styling, the precise wording of the VERIFICATION.md checklist items, the placeholder-secret value and the exact electron-store key used for the round-trip, and the always-on-top level (`'screen-saver'` per CLAUDE.md guidance) are left to the planner/executor within the decisions above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project decisions & scope
- `.planning/PROJECT.md` — what the app is, the locked stack, the Key Decisions table, and the focus/privacy/cost constraints.
- `.planning/REQUIREMENTS.md` §Overlay, §Settings & Secrets — OVL-01/02/04/06 and SET-03 acceptance language; v1/v2 boundary.
- `.planning/ROADMAP.md` §"Phase 1: Overlay Shell + Existential Behaviors" — goal, 5 success criteria, the 4 plans, and the **Notes** (GO/NO-GO gate; 35.0.1 broken for content protection; 40.x broken for loopback; the early packaged smoke test is transparency-only).
- `.planning/STATE.md` §Accumulated Context — Phase 1 decisions (pinned 35.x, secret boundary in scaffold) and the Phase 1 GO/NO-GO blocker note.

### Stack & implementation guidance
- `CLAUDE.md` (project root) §"Overlay window configuration (the load-bearing details)" — `setAlwaysOnTop(true, 'screen-saver')`, `setContentProtection(true)`, `setVisibleOnAllWorkspaces`, `transparent`+`frame:false`, `backgroundThrottling:false`, re-assert on blur/display-change.
- `CLAUDE.md` §"What NOT to Use" — avoid `nodeIntegration:true`/`contextIsolation:false`; keep keys out of the renderer and out of plaintext electron-store; encrypt with `safeStorage`/DPAPI in main; avoid latest Electron (40.x–42.x) for v1; use electron-vite + electron-builder (not the experimental Forge Vite plugin).
- `CLAUDE.md` §"Recommended Stack" / "Version Compatibility" — electron@35 + electron-vite 5 + electron-builder 26 + electron-store 11 (ESM-only), safeStorage (built-in).

No external ADRs/specs beyond the `.planning/` docs and the project `CLAUDE.md`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Greenfield repo** — no `package.json`, no `src/`, no codebase maps exist yet. Plan 01-01 creates the scaffold; there is nothing to reuse.

### Established Patterns
- None in-repo yet. The patterns this phase must *establish* (and that all later phases inherit): the electron-vite main/preload/renderer split, the `contextIsolation`+`sandbox`+typed-`contextBridge` IPC boundary, and a content-protection-reapplying "show" wrapper for the overlay window.

### Integration Points
- This phase defines the seams later phases plug into: the overlay `WindowManager` (Phase 2 hotkeys/control act on it), the typed preload/IPC boundary (Phase 6 secret channels extend it), and the toggleable debug HUD (Phase 2 wires its toggle).

</code_context>

<specifics>
## Specific Ideas

- The status HUD is explicitly intended to *be* the verification readout — surfacing Electron version and content-protection state on the overlay itself so the screen-share self-test is self-evidencing.
- "Most basic security" was an explicit user steer for the Phase 1 secret proof: prove the DPAPI plumbing with a fake value, don't build the real secrets UX early.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Programmatic focus-watching, an in-app desktopCapturer self-test, full IPC secret channels, and full packaged-build re-verification were each considered and intentionally pushed to later phases or rejected as over-investment for this gate.)

</deferred>

---

*Phase: 1-Overlay Shell + Existential Behaviors*
*Context gathered: 2026-06-16*
