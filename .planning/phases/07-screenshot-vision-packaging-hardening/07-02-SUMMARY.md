---
phase: 07-screenshot-vision-packaging-hardening
plan: 02
subsystem: infra
tags: [electron-builder, packaging, portable, asar, native-modules, uiohook-napi, native-recorder-nodejs, pkg-01]

requires:
  - phase: 07-01
    provides: Ctrl+Alt+C screenshot-solve mode end-to-end (capture -> Opus stream -> vision panel); JEDI_DISABLE_GPU fallback wired top-level
  - phase: 01
    provides: transparent/frameless/always-on-top overlay with setContentProtection(true); the on-machine GO/NO-GO verification pattern; pinned Electron 35.7.5
  - phase: 02
    provides: uiohook-napi global hotkeys (native module #1 to unpack)
  - phase: 04
    provides: native-recorder-nodejs WASAPI capture (native module #2 to unpack); --ignore-scripts install discipline
  - phase: 06
    provides: Settings window + safeStorage key path (the in-package key entry path)
provides:
  - Portable Windows .exe (release/Jedi Interviews-1.0.0-portable.exe, Electron 35.7.5) with both native .node modules asarUnpack'd
  - electron-builder.yml extended for PKG-01 (asarUnpack globs, portable artifactName, npmRebuild:false)
  - 07-VERIFICATION.md — signed on-machine GO record (6/6 manual checks PASS)
affects: [07-03]

tech-stack:
  added: []
  patterns:
    - "asarUnpack the native module trees + their loader helper (node-gyp-build) so require(absolutePath) reads .node from disk, not inside app.asar (Pitfall 4 — the real packaging fix, not the rebuild)"
    - "npmRebuild:false because both modules ship ABI-stable N-API prebuilds and this machine has no MSVC (from-source rebuild is non-blocking — STATE 02-01/04-01)"
    - "On-machine human-judged GO/NO-GO gate for existential behaviors (Phase 1 precedent) recorded in a committed VERIFICATION.md"

key-files:
  created:
    - .planning/phases/07-screenshot-vision-packaging-hardening/07-VERIFICATION.md
  modified:
    - electron-builder.yml
    - package.json

key-decisions:
  - "Added npmRebuild:false to electron-builder.yml — the default native-deps rebuild tried a from-source compile of uiohook-napi and failed (no Visual Studio/MSVC on this machine). The N-API prebuilds are ABI-stable and load as-is under Electron 35.7.5 (STATE 02-01/04-01); asarUnpack is the load-bearing fix (Pitfall 4)."
  - "Packaged .exe does not load .env (dev-mode-only convenience). Keys flow through the in-app Settings/safeStorage path (Phase 6 D-08) — the intended v1 path. Logged as a non-blocking follow-up todo; did not block GO."

patterns-established:
  - "asarUnpack both native module trees + node-gyp-build loader helper; verify the win32-x64 prebuild .node files land in app.asar.unpacked/ on disk"
  - "On-machine GO/NO-GO gate signed into VERIFICATION.md for packaged existential behaviors"

requirements-completed: [PKG-01]

duration: 12min
completed: 2026-06-19
---

# Phase 7 Plan 02: Packaging & On-Machine Verification Summary

**Portable Windows `.exe` (Electron 35.7.5) with both native `.node` modules `asarUnpack`'d, verified GO 6/6 on the target machine — transparency, focus discipline, content protection, native-module liveness, and end-to-end screenshot-solve all hold in the package.**

## Performance

- **Duration:** ~12 min active (plan spanned 57 min wall-clock including the human-gate wait)
- **Started:** 2026-06-19T19:13:46Z
- **Completed:** 2026-06-19T20:11:00Z
- **Tasks:** 3 (2 autonomous + 1 human-verify gate)
- **Files modified:** 3 (electron-builder.yml, package.json, 07-VERIFICATION.md)

## Accomplishments

- Extended the minimal Phase-1 portable `electron-builder.yml` into the full PKG-01 package: `asarUnpack` globs for `**/*.node`, `uiohook-napi`, `native-recorder-nodejs`, and the `node-gyp-build` loader helper (Pitfall 4); `portable.artifactName`; `win.icon` (cosmetic fallback to default).
- Built `release/Jedi Interviews-1.0.0-portable.exe` (signed, single-file portable, Electron 35.7.5) and confirmed both `win32-x64` prebuilds (`uiohook-napi.node`, `NativeAudioSDK.node`) land in `app.asar.unpacked/`.
- Recorded the signed on-machine GO (6/6 checks PASS) in `07-VERIFICATION.md`, mirroring the Phase 1 gate structure.

## Task Commits

1. **Task 1: asarUnpack both native modules + portable artifact name** - `de7d7f5` (chore)
2. **Task 2: build portable .exe + stage on-machine GO/NO-GO record** - `e169b39` (feat)
3. **Task 3: on-machine GO/NO-GO gate** - human-verify checkpoint; results recorded in `07-VERIFICATION.md` (committed with plan metadata)

## Files Created/Modified

- `electron-builder.yml` - Added `asarUnpack` globs, `portable.artifactName`, `win.icon`, and `npmRebuild:false`.
- `package.json` - Extended `rebuild` script to cover both native modules (D-14).
- `.planning/phases/07-screenshot-vision-packaging-hardening/07-VERIFICATION.md` - Signed on-machine GO record (6/6 PASS) + build evidence + documented `.env` note.

## Decisions Made

- **`npmRebuild:false`** — the default electron-builder native-deps step ran `@electron/rebuild` against `uiohook-napi`, which attempted a from-source compile and failed ("Could not find any Visual Studio installation"). Both modules ship ABI-stable N-API prebuilds that load as-is under Electron 35.7.5 (STATE 02-01/04-01); `asarUnpack` is the real packaging requirement (RESEARCH Pitfall 4). Disabling the rebuild is correct and unblocks the build.
- **Packaged `.exe` does not load `.env`** — keys flow through the in-app Settings/`safeStorage` path (Phase 6 D-08, `safeStorage` → `.env` → `''`), which is the intended v1 path. Logged as a non-blocking follow-up todo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Disabled electron-builder's from-source native rebuild (`npmRebuild:false`)**
- **Found during:** Task 2 (build the portable `.exe`)
- **Issue:** `npm run package` failed — electron-builder's default native-deps step invoked `@electron/rebuild` on `uiohook-napi`, which tried `node-gyp` from-source and errored "Could not find any Visual Studio installation to use" (no MSVC on this machine).
- **Fix:** Added `npmRebuild: false` to `electron-builder.yml`. The N-API prebuilds are ABI-stable and load unchanged under Electron 35.7.5 (STATE 02-01/04-01); the from-source rebuild was never load-bearing for these modules. `asarUnpack` (the actual fix, Pitfall 4) handles getting the `.node` files onto disk.
- **Files modified:** `electron-builder.yml`
- **Verification:** Re-ran `npm run package` → succeeded (`skipped dependencies rebuild reason=npmRebuild is set to false`); produced the signed portable `.exe`; both `win32-x64` prebuilds confirmed in `app.asar.unpacked/`.
- **Committed in:** `e169b39` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was necessary to produce the build on this MSVC-less machine and is the correct config for ABI-stable N-API prebuilds. No scope creep — `asarUnpack` remains the load-bearing mechanism and the on-machine gate confirmed both modules load live.

## Issues Encountered

- **Packaged build does not load `.env` (documented note, not a blocker):** on first packaged launch with no Settings key, the audio meter moved (capture alive) but STT showed "disconnected/reconnecting" with an empty transcript. Entering the Deepgram key via Settings (`Ctrl+Alt+S`) → STT connected and the transcript flowed. The Settings/`safeStorage` path is the intended v1 key path and works correctly in the package. Logged as a follow-up todo (whether the packaged build should also load a co-located `.env` is future-plan scope).

## Authentication Gates

The end-to-end screenshot-solve (check 5) and STT (check 4) require live keys. These were supplied on-machine via the in-app Settings/`safeStorage` path during the GO gate — not an execution blocker for the autonomous build tasks.

## Known Stubs

None. No code stubs introduced — this plan is packaging config + a verification record.

## Next Phase Readiness

- **07-03 (hardening):** PKG-01 is GO. The `JEDI_DISABLE_GPU=1` fallback was **not needed** (transparency rendered fine on the GPU path) but 07-03 still wires it as the documented opt-in fallback per the plan. 07-03 also owns latency instrumentation, SmartScreen "Run anyway" documentation, and hotkey-config recovery.
- **Follow-up todo for a future plan (non-blocking):** decide whether the packaged `.exe` should also load a co-located `.env`; current behavior (Settings/`safeStorage` only in the package) is the intended v1 path.

## Self-Check: PASSED

- `07-VERIFICATION.md` exists with `status: passed`, 6/6 PASS, signed GO line, Electron 35.7.5 recorded.
- Task commits `de7d7f5` and `e169b39` present in `git log`.
- `release/Jedi Interviews-1.0.0-portable.exe` exists; both `win32-x64` `.node` prebuilds confirmed in `app.asar.unpacked/`.

---
*Phase: 07-screenshot-vision-packaging-hardening*
*Completed: 2026-06-19*
