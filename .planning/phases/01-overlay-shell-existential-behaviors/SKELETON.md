# Walking Skeleton — Jedi Interviews

**Phase:** 1
**Generated:** 2026-06-16

## Capability Proven End-to-End

A launchable Electron overlay window renders a live HUD (Electron version, content-protection state, window position) driven by a real main → preload → renderer data flow, AND a main-process safeStorage (DPAPI) round-trip proves the secret boundary — the thinnest end-to-end thing that actually runs and is verifiable on the target Windows 11 machine.

The full stack is exercised: build tooling (electron-vite three-config) → main process (overlay BrowserWindow + safeStorage) → preload (typed contextBridge boundary) → renderer (React HUD) → packaged .exe (transparency smoke).

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| App shell | Electron, pinned EXACTLY to `35.7.5` (min safe 35.4.0), no `^`/`~`, lockfile committed (D-09) | Native Windows loopback (Phase 3) is supported on 35.x; 35.7.5 is the latest 35.x patch and contains BOTH the content-protection fix (#47034, first in 35.4.0) and the older-Windows fix (#47886). 35.0.x–35.3.0 are KNOWN-BROKEN (black-box during capture) and forbidden. The right patch is the deliverable — version coupling is the real risk. |
| Language | TypeScript (latest 5.9.x line preferred over TS 6.x for scaffold compatibility — A1) | IDEXX TS-first standard; first-class in electron-vite. |
| Build/dev tooling | electron-vite 5.0.0 (main / preload / renderer three-config) | Purpose-built for the three-process model; HMR on the renderer. |
| Packaging | electron-builder 26.15.3, minimal Windows portable target (no signing in Phase 1) | Decoupled from dev tooling; avoids the experimental Forge-Vite plugin. Full PKG-01 (installer/signing) owned by Phase 7. |
| UI | React 19 in the renderer | User is React-fluent; HUD now, streaming panels later. |
| Module system | ESM main (`"type": "module"`) | electron-store@11 is ESM-only (`engines.node >=20`). |
| Persistence | electron-store 11.0.2 (ciphertext + non-secret prefs only) | Atomic writes, schema, userData pathing — never hand-rolled file IO. |
| Secret-at-rest | Electron `safeStorage` (DPAPI), main process only | OS-backed key management; never hand-roll crypto. Phase 1 proves the plumbing with a fake placeholder (D-04); real keys arrive in Phase 6. |
| Security boundary | `contextIsolation: true` + `sandbox: true` + typed `contextBridge` preload, no `nodeIntegration` (D-06) | Renderer cannot reach Node/secrets. The ONLY Phase 1 IPC surface is a read-only, non-secret status channel feeding the HUD (D-05). |
| Overlay behavior | `transparent` + `frame:false` + `focusable:false`; shown ONLY via a `showOverlay()` wrapper that re-applies `setContentProtection(true)` + `setAlwaysOnTop(true,'screen-saver')` + `showInactive()` on EVERY show, re-asserted on blur/display change | The two existential behaviors: never steal focus (OVL-02), absent from screen capture (OVL-04). Content protection MUST be re-applied per show or it drops to a black box. `setVisibleOnAllWorkspaces` is a no-op on Windows — not relied upon. |
| Directory layout | `src/main/` (index.ts, overlay-window.manager.ts, placeholder-secret.service.ts), `src/preload/` (index.ts, index.d.ts), `src/renderer/src/` (React HUD); IDEXX file suffixes (`.service.ts`, `.manager`) | Mirrors the RESEARCH recommended structure; the seams later phases plug into. |

## Stack Touched in Phase 1

- [x] Project scaffold (electron-vite, electron-builder, oxlint + Prettier, TypeScript)
- [x] Real process boundary — main → preload (typed contextBridge) → renderer status channel
- [x] Real persistence read AND write — safeStorage encrypt → electron-store set (ciphertext) → get → decrypt
- [x] Real UI wired to data — React HUD subscribes to `window.jedi.onStatus` and renders live version/CP-state/position
- [x] Packaged full-stack run — `npm run dev` (full run) + minimal `npm run package` .exe transparency smoke

## Out of Scope (Deferred to Later Slices)

- Global hotkeys / keyboard control of the overlay (Phase 2 — uiohook-napi)
- The HUD toggle binding (the HUD is built toggleable now but shows by default; Phase 2 wires the toggle hotkey)
- Audio loopback capture (Phase 3)
- STT / live transcript (Phase 4)
- AI orchestration / streaming answers (Phase 5)
- The focusable settings window, REAL API keys, and the renderer→main secret channel returning booleans only (Phase 6)
- Screenshot vision + full hardened/signed packaging re-verification (Phase 7 / PKG-01)
- Programmatic foreground-window logging and in-app desktopCapturer self-test (intentionally rejected for this gate — manual verification only)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions (the Electron pin, the security boundary, the showOverlay wrapper, the directory layout):

- Phase 2: Keyboard-only show/hide, move, and opacity control (uiohook-napi) acting on the WindowManager; wire the HUD toggle.
- Phase 3: System-audio loopback go/no-go spike with a live RMS meter on the same overlay.
- Phase 4: Live rolling transcript via an ISttProvider seam (Deepgram v5) rendered on the overlay.
- Phase 5: Streaming AI answers + talking points from the recent transcript, keyboard-scrollable.
- Phase 6: Focusable settings window + REAL API keys (extends the safeStorage boundary with a booleans-only IPC channel) + persisted session context grounding every prompt.
- Phase 7: Screenshot vision mode + hardened, runnable Windows .exe with transparency/focus/content-protection intact.
