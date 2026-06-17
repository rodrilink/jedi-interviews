# Phase 3: Audio Loopback Spike - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove, in isolation, that Electron **system-audio loopback produces real, non-silent audio** on the target Windows 11 machine at the pinned Electron version — a **GO/NO-GO gate** before any STT code is written. Capture the computer's system (loopback) audio, surface a live RMS level so the signal can be confirmed non-zero by eye, and record the result as a documented decision: **proceed with built-in loopback** or **trigger the WASAPI-sidecar fallback**. Covers requirements AUD-01, AUD-02.

**Locked upstream (do not re-litigate):**
- **Built-in loopback is the chosen path**: capture via `setDisplayMediaRequestHandler` + `getDisplayMedia` with **`video:true` present** (the video track is discarded; `audio:true, video:false` throws on Windows). The **WASAPI sidecar (`naudiodon`) is the documented fallback** if loopback returns silence (ROADMAP §Phase 3; PROJECT.md Key Decisions; CLAUDE.md §"System audio loopback").
- Native loopback is **Windows-only, Electron 31+** — already satisfied (Phase 1 GO at **Electron 35.7.5** on the target machine). Do NOT chase newer Electron majors (40.x loopback-silence regression — CLAUDE.md §"What NOT to Use").
- This is a **small, gate-like phase**. Do NOT start Deepgram/STT integration until this gate passes. The two-plan breakdown (03-01 capture + live RMS meter; 03-02 on-machine verification + recorded go/no-go) is the agreed work breakdown (ROADMAP §Phase 3).
- **Focus/click-through contract is non-negotiable** (OVL-02, Phase 1): no focus-stealing dialog, no on-screen capture picker. The `setDisplayMediaRequestHandler` is exactly the mechanism that grants loopback without a picker.
- **STT lives behind an `ISttProvider` seam** (STATE.md decision, Phase 4) — the audio-capture seam built here is the **source** that feeds STT, kept distinct from the provider seam.

</domain>

<decisions>
## Implementation Decisions

### Spike Location & Lifecycle
- **D-01:** The spike is **wired into the real overlay app** (main + renderer), NOT a standalone throwaway verify build. (This diverges from Phase 1's `verify:secret` isolated-build pattern — chosen deliberately so the gate also bootstraps the audio pipeline.)
- **D-02:** Build it as the **foundation for Phase 4** — a clean, minimal **audio-capture seam/module** (the real capture path Phase 4's STT pipeline extends), with the **RMS meter as a removable verification layer on top**. Not spike-quality throwaway code. The capture seam is the audio *source*; it stays distinct from the Phase 4 `ISttProvider` seam.
- **D-03:** Capture **auto-starts with no picker**: `setDisplayMediaRequestHandler` returns the loopback source directly (no on-screen picker, no user gesture, no focus steal — preserves OVL-02), and capture kicks off automatically at app ready. No dedicated start hotkey for v1 of the spike.

### RMS Meter Surfacing
- **D-04:** The live level is surfaced as an **`Audio:` row in the existing DebugHud**, pushed over the read-only `jedi:status` channel — same pattern as the Phase 2 `Hotkeys:` row. Shows a live level (number + a simple block-character bar). No new window; renderer stays a pure view (Phase 1/2 IPC boundary).
- **D-05:** RMS is computed in an **AudioWorklet** that reads Float32 frames off the main thread (NOT `ScriptProcessorNode` — deprecated, glitchy; NOT a verification-only AnalyserNode loop). This is the **same worklet Phase 4 extends** to down-mix/resample to 16 kHz mono Int16 PCM for Deepgram — so it's real foundation, consistent with D-02 and CLAUDE.md §"AudioWorklet".

### Pass Threshold & Decision Record
- **D-06:** **"Non-silent" is human-judged from the HUD, no hard-coded numeric gate.** GO = the meter **visibly and sustainedly moves well above zero while system audio plays** AND **reads ~0 when audio is paused** (the audio-paused-reads-zero check rules out a stuck/fake meter). Appropriate for a one-time on-machine gate rather than an automated test.
- **D-07:** The result is recorded in a **committed `03-LOOPBACK-GATE.md`** in the phase dir capturing: machine, Electron version, audio source(s) used, observed RMS behavior (playing vs paused), and **GO (built-in loopback)** or **NO-GO (trigger WASAPI sidecar fallback)** — plus the decision logged in **STATE.md / PROJECT.md** decisions. Mirrors the Phase 2 conflict-test doc and the Phase 1 GO/NO-GO record.

### Test Audio Source
- **D-08:** Test with **two sources, in order**: (1) **general media** (YouTube/Spotify/system sound) first to prove the capture pipeline works, then (2) **a real Teams or Zoom call** to confirm it captures actual meeting audio — the real use case. The meeting check de-risks the **communication-device routing gotcha** (Teams/Zoom can route call audio through a comms-specific render endpoint that loopback of the default endpoint may miss).
- **D-09:** **Partial-result interpretation is part of the gate:** if general media produces signal but the meeting call does not, that is a **partial NO-GO pointing at comms-device routing** (not loopback-in-general failing) — record it explicitly in `03-LOOPBACK-GATE.md`, because it changes Phase 4's capture approach rather than triggering the full WASAPI sidecar.

### Claude's Discretion
- The exact module/file shape of the audio-capture seam, where it sits in `src/main`/`src/renderer`, and how it composes with `overlay-window.manager.ts` and the `jedi:status` push (researcher/planner decide, honoring D-02/D-04).
- The AudioWorklet's internal RMS math, the meter's update cadence/throttle, and the exact visual form of the `Audio:` HUD row (number, bar width, smoothing).
- Whether capture is torn down on `window-all-closed`/quit and how the MediaStream/AudioContext lifecycle is managed.
- The precise `getDisplayMedia` constraints object (beyond the locked `video:true`-present requirement) and how the discarded video track is stopped.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 3: Audio Loopback Spike" — goal, 3 success criteria, the 2 plans (03-01 capture + live RMS meter; 03-02 on-machine verification + recorded go/no-go), and the **Notes** (GO/NO-GO gate; loopback silence is the biggest technical risk; `getDisplayMedia` needs `video:true` present on Windows; silence → WASAPI-sidecar fallback changes Phase 4; do not start Deepgram until this passes).
- `.planning/REQUIREMENTS.md` §Audio — AUD-01 (capture system/loopback audio), AUD-02 (validate non-silent audio on the target machine before the transcript pipeline is built on it).
- `.planning/PROJECT.md` — Key Decisions (built-in loopback over native WASAPI helper; WASAPI sidecar is the documented fallback) and the focus-discipline / system-audio-only constraints.

### Prior-phase decisions this phase builds on
- `.planning/STATE.md` §Accumulated Context — Phase 1 GO signed at **Electron 35.7.5** on the target Windows 11 machine; the decision that **built-in loopback is chosen over a native WASAPI helper, WASAPI sidecar is the fallback if the loopback spike shows silence**; and that **STT lives behind an `ISttProvider` seam** (Phase 4).
- `.planning/phases/01-overlay-shell-existential-behaviors/01-CONTEXT.md` — Phase 1 decisions: the toggleable DebugHud surviving into later phases, and the single read-only `jedi:status` channel as the IPC surface (the seam the `Audio:` row reuses).
- `.planning/phases/02-global-hotkeys-window-control/02-CONTEXT.md` — the `Hotkeys:` HUD row + read-only `jedi:status` push pattern that the `Audio:` row mirrors (D-04).

### Stack & implementation guidance
- `CLAUDE.md` (project root) §"System audio loopback (highest-risk dependency)" — `audio:'loopback'`/`'loopbackWithMute'` Windows-only, native from Electron 31+; request `video:true` then discard the video track; `electron-audio-loopback` shim only for Electron ≤38 (unnecessary on 35? — note: maintainer says 39+; on 35 native loopback is the documented path here); `naudiodon@2.3.6` WASAPI sidecar as the heavier last-resort fallback.
- `CLAUDE.md` §"AudioWorklet" — convert loopback `MediaStream` → 16 kHz mono Int16 (linear16) PCM via an AudioWorklet (down-mix/resample Float32→Int16); avoid the deprecated `ScriptProcessorNode`. (Phase 3 computes RMS in this worklet; Phase 4 extends it to emit PCM.)
- `CLAUDE.md` §"What NOT to Use" — do NOT chase Electron 40.x–42.x (desktop-audio loopback silence regression); stay on the pinned 35.x.
- `CLAUDE.md` §"Overlay window configuration" — `backgroundThrottling:false` (keep the audio/transcript pipeline running when the overlay isn't focused — it never is).

### Code to extend (see code_context below)
- `src/main/overlay-window.manager.ts` — `IOverlayStatus`, `STATUS_CHANNEL` ('jedi:status'), `pushStatus()`; extend the status payload with the audio level.
- `src/main/index.ts` — app bootstrap (`app.whenReady`) where capture is wired up and `setDisplayMediaRequestHandler` is installed on the session.
- `src/preload/index.ts` — the typed read-only `window.jedi` bridge to mirror the extended `IOverlayStatus`.
- `src/renderer/src/components/debug-hud.tsx` — the HUD to extend with the `Audio:` row (CSS in `src/renderer/src/assets/hud.css`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`IOverlayStatus` + `STATUS_CHANNEL` ('jedi:status') + `pushStatus(window)`** (`src/main/overlay-window.manager.ts`) — the read-only main→renderer status push extended in Phases 1 & 2 (electronVersion/contentProtection/position, then `hotkeys`, `hudVisible`). Phase 3 adds an audio-level field the same way. The interface is declared locally in main, preload, and the HUD (bundled separately) — all three sites must be updated identically (the Phase 2 pattern).
- **`DebugHud`** (`src/renderer/src/components/debug-hud.tsx`) — status-row component already driven by `window.jedi.onStatus` and a `hudVisible` flag; Phase 3 adds an `Audio:` row alongside the existing `Hotkeys:`/Electron/position rows.
- **`showOverlay()` / session setup in `index.ts`** — `app.whenReady` bootstrap is where Phase 2 registered the hotkey service and is where Phase 3 installs `setDisplayMediaRequestHandler` and starts capture.

### Established Patterns
- **Main owns existential/IO behavior; renderer is a pure read-only view** fed by `jedi:status`. Audio capture + RMS run in the renderer's Web Audio context (where `getDisplayMedia`/AudioWorklet live), but the level is pushed through the same one-way status flow the HUD already consumes. (Note for planner: the capture/worklet necessarily runs renderer-side; the meter value still surfaces via the established status pattern — reconcile cleanly rather than adding a renderer→main control channel.)
- **`backgroundThrottling:false`** is already set so the pipeline keeps running while the overlay is unfocused (it always is) — directly relevant to a continuously-running audio capture.
- **Verification-on-the-real-machine discipline** (Phase 1 GO/NO-GO, Phase 2 conflict test) — Phase 3 is the same: a human-judged on-machine gate recorded in a committed doc (D-06/D-07).
- **Strict TS / IDEXX standards** — explicit return types, single quotes, 4-space, TSDoc on exports; `.service.ts`/`.test.ts` co-located Vitest where unit-testable (worklet/RMS math is unit-testable even if the live capture is not).

### Integration Points
- **`session.setDisplayMediaRequestHandler`** (installed in `index.ts` at `app.whenReady`) → returns the loopback source with no picker (D-03).
- **Renderer capture → AudioWorklet (RMS) → level → IPC/status → DebugHud `Audio:` row** — the data path for the meter (D-04/D-05).
- **Capture seam ← (Phase 4) → `ISttProvider`** — the worklet that emits RMS now will emit 16 kHz Int16 PCM for Deepgram later; the capture module is the audio source feeding the STT provider seam.
- **New dependency risk:** none required for built-in loopback (native to Electron). `naudiodon` (WASAPI sidecar) is pulled in ONLY on a NO-GO.

</code_context>

<specifics>
## Specific Ideas

- The DebugHud continues its role as the **on-screen verification surface** — after being the Phase 1 existential readout and the Phase 2 hotkey cheat-sheet, it now also shows the live `Audio:` level for this gate.
- The **two-source test order is deliberate** (D-08): general media proves the pipeline; the real meeting call proves the *product*. The explicit "media works but meeting doesn't = comms-device routing problem" interpretation (D-09) is the specific insight to carry into Phase 4.
- The spike is intentionally built as **real foundation, not throwaway** (D-01/D-02) — the gate doubles as the first increment of the Phase 4 audio pipeline.

</specifics>

<deferred>
## Deferred Ideas

- **16 kHz mono Int16 PCM down-mix/resample for Deepgram** — the AudioWorklet built here computes RMS; extending it to emit STT-ready PCM frames is **Phase 4** (TRN-01). Out of scope for the gate.
- **`naudiodon` WASAPI sidecar implementation** — only built if this gate returns NO-GO (silence). Not built speculatively.
- **Mic capture / speaker diarization** — already out of scope for v1 (system audio only, PROJECT.md); not part of this phase.
- **Start/stop capture hotkey** — auto-start chosen for the spike (D-03); a manual capture toggle, if ever wanted, is a later concern.

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 3-Audio Loopback Spike*
*Context gathered: 2026-06-17*
