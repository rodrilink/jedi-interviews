---
phase: 01-overlay-shell-existential-behaviors
plan: 01
subsystem: infra
tags: [electron, electron-vite, typescript, react, contextBridge, sandbox, esm]

# Dependency graph
requires: []
provides:
  - Launchable electron-vite React+TS scaffold (main/preload/renderer three-config build)
  - Exact-pinned electron@35.7.5 with committed lockfile (D-09, reproducible builds)
  - ESM main process (type:module) ready for electron-store@11 (ESM-only)
  - contextIsolation+sandbox+typed contextBridge security boundary, no secret channels (D-06/D-05)
  - IDEXX lint/format toolchain (oxlint + Prettier, 4-space/single-quote/180)
affects:
  - 01-02 (WindowManager + debug HUD extends window.jedi with a read-only status channel)
  - 01-03 (safeStorage secret round-trip builds on the ESM main + electron-store)
  - 01-04 (on-machine GO/NO-GO verification of the pinned build)
  - Phase 6 (real secret channels extend the structural boundary established here)

# Tech tracking
tech-stack:
  added:
    - electron@35.7.5
    - electron-vite@5.0.0
    - electron-builder@26.15.3
    - electron-store@11.0.2
    - react@19.2.7 / react-dom@19.2.7
    - typescript@5.9.3
    - oxlint@1.70.0
    - prettier@3.4.2
  patterns:
    - electron-vite main/preload/renderer three-config split
    - contextIsolation:true + sandbox:true + typed contextBridge preload (no secret channels)
    - Sandboxed preload emitted as CommonJS (.cjs) under an ESM (type:module) project
    - Exact dependency pinning + committed lockfile for reproducible builds (D-09)

key-files:
  created:
    - package.json
    - package-lock.json
    - electron.vite.config.ts
    - electron-builder.yml
    - tsconfig.json
    - tsconfig.node.json
    - tsconfig.web.json
    - .gitignore
    - .prettierrc
    - .prettierignore
    - .oxlintrc.json
    - src/main/index.ts
    - src/preload/index.ts
    - src/preload/index.d.ts
    - src/renderer/index.html
    - src/renderer/src/main.tsx
    - src/renderer/src/App.tsx
  modified: []

key-decisions:
  - "Pinned TypeScript 5.9.3 (latest 5.x) instead of TS 6.x to de-risk the scaffold (assumption A1)"
  - "Sandboxed preload built as CommonJS .cjs because Electron does not support ESM preloads under sandbox:true"
  - "Added tsconfig.web.json alongside tsconfig.node.json so the renderer gets DOM libs + JSX typing"

patterns-established:
  - "Three-config electron-vite build (main ESM, preload CJS, renderer React)"
  - "Structural-only contextBridge boundary: typed window.jedi namespace with no secret-bearing channels (D-05/D-06)"
  - "Preload fails loudly if contextIsolation is ever disabled"

requirements-completed: []

# Metrics
duration: 7min
completed: 2026-06-17
---

# Phase 1 Plan 01: Electron Scaffold + Security Boundary Summary

**Launchable electron-vite React+TS Walking Skeleton with exact-pinned electron@35.7.5, committed lockfile, ESM main, and a contextIsolation+sandbox+typed-contextBridge boundary carrying no secret channels.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-17T03:15:32Z
- **Completed:** 2026-06-17T03:23:00Z
- **Tasks:** 2
- **Files modified:** 17 created

## Accomplishments
- Scaffolded the electron-vite three-process project (main / preload / renderer) with React 19 + TypeScript, building cleanly via `electron-vite build`.
- Pinned Electron to exact `35.7.5` (no `^`/`~`) and committed `package-lock.json` — the lockfile pins electron 35.7.5 transitively (D-09).
- Set `type: module` (ESM main) so the ESM-only `electron-store@11` works without a downgrade (Pitfall 5).
- Wired the structural security boundary (D-06): `contextIsolation: true`, `sandbox: true`, `backgroundThrottling: false`, no `nodeIntegration`; window created after `app.whenReady`.
- Exposed a single typed, read-only, non-secret `window.jedi` namespace via `contextBridge.exposeInMainWorld` — no secret channels in Phase 1 (D-05).
- Installed `electron-builder@26.15.3` and added a minimal `electron-builder.yml` (portable Win target) so the 01-04 packaged smoke test (D-10) has it ready.
- IDEXX lint/format toolchain passes: `npm run typecheck`, `npm run lint`, `npm run format:check` all exit 0.

## Task Commits

1. **Task 1: Scaffold electron-vite React+TS and pin Electron exactly** - `f86cfe7` (chore)
2. **Task 2: Wire contextIsolation+sandbox+typed contextBridge boundary** - `0f38301` (feat)

_Note: scaffold + dependency pinning committed as Task 1 (chore); source boundary + preload-format fix committed as Task 2 (feat)._

## Files Created/Modified
- `package.json` - Exact electron pin (35.7.5), type:module, dev/build/lint/format/typecheck scripts
- `package-lock.json` - Reproducible lockfile pinning electron 35.7.5 transitively (D-09)
- `electron.vite.config.ts` - main/preload/renderer three-config; preload forced to CommonJS .cjs output
- `electron-builder.yml` - Minimal portable Windows target for the D-10 smoke test
- `tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json` - Project-references TS config (node = main+preload, web = renderer)
- `.gitignore` / `.prettierrc` / `.prettierignore` / `.oxlintrc.json` - Build-output ignore + IDEXX style config
- `src/main/index.ts` - App lifecycle; createWindow after whenReady with the secured webPreferences
- `src/preload/index.ts` - Typed contextBridge `window.jedi` (no secret channels); throws if contextIsolation disabled
- `src/preload/index.d.ts` - Ambient `Window.jedi` type for the renderer
- `src/renderer/index.html` - Transparent-ready entry with a restrictive CSP
- `src/renderer/src/main.tsx` / `App.tsx` - Minimal React renderer proving the preload bridge is connected

## Decisions Made
- **TypeScript 5.9.3 over 6.x** — lower-risk against the electron-vite 5 / React-TS template (research assumption A1); documented as a deliberate pin.
- **Sandboxed preload built as CommonJS (.cjs)** — Electron does not support ES-module preloads when `sandbox: true`; configured the preload build to emit `index.cjs` and pointed main at it.
- **Added `tsconfig.web.json`** beyond the plan's listed `tsconfig.node.json` — the renderer needs separate DOM libs + `react-jsx` typing; node config covers main+preload only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Sandboxed preload emitted ESM (.mjs) but main referenced .js — runtime preload would fail to load**
- **Found during:** Task 2 (boundary wiring + first `electron-vite build`)
- **Issue:** Under `type: module`, electron-vite emitted the preload as `index.mjs`; the main process referenced `../preload/index.js` (nonexistent). Worse, a sandboxed preload (`sandbox: true`, D-06) cannot be an ES module — Electron requires CommonJS preloads under the sandbox, so the `.mjs` output would fail to load at runtime.
- **Fix:** Configured the preload build in `electron.vite.config.ts` to output CommonJS with `entryFileNames: '[name].cjs'`, and updated `src/main/index.ts` to load `../preload/index.cjs`.
- **Files modified:** electron.vite.config.ts, src/main/index.ts
- **Verification:** Rebuilt — preload now emits `out/preload/index.cjs` (valid CommonJS calling `contextBridge.exposeInMainWorld`); built app launched via `npx electron ./out/main/index.js` for 25s with no preload/load errors before timeout.
- **Committed in:** 0f38301 (Task 2 commit)

**2. [Rule 3 - Blocking] Type/tooling package versions in the planned install did not exist on npm**
- **Found during:** Task 1 (initial `npm install`)
- **Issue:** `@types/react-dom@19.2.7` (and same-version `@types/react`) do not exist — `@types/*` packages version independently of the runtime packages. Install failed with ETARGET.
- **Fix:** Pinned to the actual published versions: `@types/react@19.2.17`, `@types/react-dom@19.2.3`, and `oxlint@1.70.0` (latest, since the planner-era 0.15.6 was a placeholder). No package substitution — same packages, correct existing versions.
- **Files modified:** package.json, package-lock.json
- **Verification:** `npm install` succeeded (404 packages); `npm run typecheck` exits 0 with the React 19 types.
- **Committed in:** f86cfe7 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). Plus 1 documented scope addition (`tsconfig.web.json`) under Rule 2 (correctness — renderer typing).
**Impact on plan:** Both auto-fixes were required for the scaffold to install and the app to launch. No scope creep beyond the renderer tsconfig, which is structurally required by the three-config build.

## Issues Encountered
- `npm run dev` could not be visually eyeballed in this non-interactive execution environment. Mitigation: ran `electron-vite build` (all three bundles built cleanly) and launched the built main process with `npx electron`, which ran without error until timeout — a strong launchability signal. The authoritative on-machine visual launch (window paints, transparency) is the explicit responsibility of the Phase 1 GO/NO-GO gate in plan 01-04 (D-01/D-10), not this scaffold plan.
- An npm `min-release-age` user config warning appears on every npm command; harmless (a local registry-age policy), does not affect installs.

## Known Stubs
- `window.jedi` exposes only `{ isReady: true }` — intentional. Phase 1 establishes the structural boundary only (D-06); the read-only status channel is added in 01-02 and secret-bearing channels are deferred to Phase 6 (D-05). Documented, not a blocking stub.

## User Setup Required
None - no external service configuration required in this plan.

## Next Phase Readiness
- Scaffold launches and builds; the security boundary is wired and provably CommonJS-correct under sandbox.
- Ready for 01-02 (overlay WindowManager + debug HUD) to replace the scaffold window and extend `window.jedi` with a read-only status channel.
- Open item carried to 01-04: confirm `electron@35.7.5` content-protection + non-focus-stealing behaviors on the target Windows 11 machine (10.0.26200) and record the exact build in VERIFICATION.md.

## Self-Check: PASSED

All 17 created files exist on disk and all three commits (`f86cfe7`, `0f38301`, `fc5a0b2`) are present in git history.

---
*Phase: 01-overlay-shell-existential-behaviors*
*Completed: 2026-06-17*
