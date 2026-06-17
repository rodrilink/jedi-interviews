# Phase 4: STT Pipeline + Live Transcript - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a **live rolling transcript on the overlay**, streamed from captured system audio to Deepgram and back, behind a **swappable `ISttProvider` seam**, that survives dropped connections (auto-reconnect with backoff, connection state visible) and never grows unbounded. Covers requirements TRN-01, TRN-02, TRN-03, TRN-04, TRN-05.

**Locked upstream (do not re-litigate):**
- **Built-in `getDisplayMedia` loopback is NO-GO on the target machine** (Phase 3 gate, 2026-06-17: continuous DXGI desktop-duplicator failure makes every Chromium-based capture path silent). Phase 4 captures system audio via the **`naudiodon` WASAPI path** instead. The system-audio requirement (AUD-01/AUD-02) is unchanged — only the capture **mechanism** changes. See `03-LOOPBACK-GATE.md`.
- **STT is reached only through an `ISttProvider` seam** (STATE.md / PROJECT.md decision): Deepgram now, Whisper a later v2 swap. The seam is defined in THIS phase before anything depends on STT output.
- **Deepgram v5 API** (`DeepgramClient`, `listen.v1.connect`, `sendMedia`, `is_final`) — ignore v3/v4 tutorials. 16 kHz mono Int16 (linear16) PCM is the wire format.
- **The overlay is `focusable:false`; the renderer is a read-only `jedi:status` view** (Phase 1/2 boundary). No focus-stealing, no general renderer→main control surface.
- **Key entry / settings window is Phase 6 (SET-02), not here** — Phase 4 must not pull settings-window scope forward.
- The 4-plan breakdown in ROADMAP (seam+gateway / PCM pipeline / buffer+clear / reconnect+render) is the agreed shape; planner refines.

</domain>

<decisions>
## Implementation Decisions

### WASAPI Capture (the load-bearing pivot)
- **D-01:** Capture runs as an **in-main-process native addon** — `naudiodon`(-loopback) loaded directly in the Electron **main** process (the same way `uiohook-napi` is loaded today), NOT a separate child process. Simpler: no child-process lifecycle/PCM-framing plumbing, PCM stays in-process. Accepted trade-off: a native capture crash takes down the whole app. This still satisfies the "never touches Chromium screen capture" constraint (the DXGI/`getDisplayMedia` path that failed) — an in-main native addon avoids it just as a child process would.
- **D-02:** **Down-mix + resample to 16 kHz mono Int16 PCM happens in main (TypeScript), and the renderer audio path is retired.** `naudiodon` is expected to deliver the device's native format (likely 48 kHz stereo); a main-process **`.utility.ts`** (unit-testable) does the down-mix/resample. The renderer `rms-meter.worklet.ts` + `audio-capture.service.ts` become dead code and are **removed** — there is one audio path, entirely in main, no renderer Web Audio. The existing `rms.utility.ts` math is reusable for a main-computed level meter.
- **D-03:** **Plain `naudiodon` does not expose loopback devices** — the implementation needs the `naudiodon-loopback` fork (Axiver) or an equivalent native helper, and it requires `@electron/rebuild` against the Electron 35.7.5 ABI. This is the same class of native-module risk as `uiohook-napi` (which failed an MSVC from-source rebuild in Phase 2 and only worked via the prebuilt N-API binary) — researcher must confirm a working binary/rebuild path on this machine BEFORE the rest of the pipeline is built on it.

### Transcript IPC + Render
- **D-04:** The transcript renders **inside the existing toggleable `DebugHud`** (extend it), NOT a new dedicated content surface, for Phase 4. Interim text should be visually distinct from finalized text (e.g. dimmed/italic).
- **D-05:** **Transcript visibility is coupled to the HUD toggle** — toggling the HUD off hides the transcript too. Accepted for Phase 4 to keep it tight; Phase 5 (which carries a UI hint and adds streaming AI answers) may split out a dedicated always-on content surface then.

### Reconnect + Bounded Buffer
- **D-06:** The transcript buffer is **bounded by a time window** (keep the last N minutes of finalized transcript, drop older), NOT by word/segment count. Chosen because it aligns with Phase 5's time-based "recent transcript span" selection (~60s window) and with how a user perceives "recent conversation". Planner sets N and ensures a hard memory ceiling.
- **D-07:** The **clear-transcript hotkey is a new Ctrl+Alt chord added through the existing `HotkeyRegistrarService`** — same `register()`-result checking and HUD surfacing as the Phase 2 chords. Planner picks the exact letter (avoiding the finalized J / arrows / `[` `]` / H / Q set) and re-checks it against Teams/Zoom/VS Code. Clearing wipes the main-side `TranscriptBuffer`; the overlay reflects the empty buffer via the push.

### Deepgram Key Sourcing (bridges to Phase 6)
- **D-08:** Phase 4 sources the Deepgram key from an **env var or a local untracked dev config read in main** — never in the renderer, never in logs, never committed (honors SET-03). Phase 6's `safeStorage`-backed key entry **replaces the source later without touching the gateway**. This lets Phase 4 prove a real live transcript (success criterion 1) without dragging the Phase-6 settings UI forward.

### Claude's Discretion
- **Audio level meter fate (D-02 follow-on):** whether to recompute RMS in main from the captured PCM (reusing `rms.utility.ts`) and keep the HUD `Audio:` row as a "capture is alive" signal, or drop the meter entirely now that the transcript itself proves capture works. **Lean:** keep a main-computed meter — audio is the load-bearing risk and the meter distinguishes "audio flowing but silent" from "capture broken" during quiet stretches; but the planner may drop it if it doesn't earn its keep.
- **Transcript IPC topology:** dedicated `jedi:transcript` channel vs reusing `jedi:status`. **Lean:** a dedicated one-way main→renderer transcript channel — transcript traffic is high-frequency (interim results fire many times/sec) and would otherwise bloat/couple the status payload that 3 sites declare identically. Either way, stay within the one-way main→renderer boundary.
- **TranscriptBuffer location:** **Lean strongly to main** — the Deepgram websocket and (per D-01) audio capture both live in main, and Phase 5's AI orchestration (also main-side) must read a transcript span from it. A renderer-side buffer would create two sources of truth and fight the one-way boundary. Main holds the authoritative rolling buffer and pushes the renderable window to the overlay.
- **`ISttProvider` interface style:** **Lean event-emitter** — `start()`/`stop()`/`sendAudio(pcm)` plus typed events (`transcript` interim/final, `connection-state-change`, `error`), matching Deepgram v5's `connection.on('message')` model so a future Whisper provider emits the same events. Researcher confirms the exact v5 live-client event shape and finalizes.
- **Reconnect gap handling:** **Lean to drop PCM during the gap** for v1 (discard incoming PCM while disconnected, resume on reconnect) — simplest, bounded, acceptable for a live-meeting aid where reconnects are brief. Planner may choose a bounded-buffer-and-flush instead if warranted; connection state surfaces on the overlay either way (TRN-03).
- Reconnect **backoff curve** (initial delay, max delay, jitter) and the exact connection-state values surfaced on the overlay.

### Folded Todos
- **260617-code-review-audio-seam-warnings** (from Phase 3 `03-REVIEW.md`, severity: warning) — fold into the capture rework / DebugHud extension as cleanup-during-rework:
  - **WR-01** — the unguarded `sources[0]` empty-source guard in `src/main/index.ts` (moot on the NO-GO machine) becomes an **equivalent empty/unavailable-device guard on the new WASAPI capture init**.
  - **WR-02** — carry the **idempotent-`start()` discipline** (early-return if already capturing) into the new main-side capture so React Strict-Mode / re-entry can't leak a capture handle.
  - **WR-03** — fix the leaked `preload.onStatus` listener: **return a stored unsubscribe fn from `onStatus`** and call it in `DebugHud`'s `useEffect` cleanup (directly relevant since the HUD is being extended).
  - **IN-01** — the orphaned `ipcMain.on('jedi:audio-level')` listener is **removed** as a side effect, since `reportAudioLevel` / the renderer audio path is retired per D-02.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 4: STT Pipeline + Live Transcript" — goal, 5 success criteria, the 4 plans (seam+gateway / PCM pipeline / buffer+clear / reconnect+render), and the **Notes** (define `ISttProvider`+`DeepgramSttGateway` first; Deepgram v5 only; AudioWorklet not ScriptProcessorNode; assert declared sample rate == actual PCM rate).
- `.planning/REQUIREMENTS.md` §"Audio & Transcript" — TRN-01 (stream to STT, live transcript on overlay), TRN-02 (interim + final), TRN-03 (auto-reconnect), TRN-04 (clear hotkey + bounded buffer), TRN-05 (`ISttProvider` seam).
- `.planning/PROJECT.md` — Key Decisions (WASAPI sidecar adopted for Phase 4 after loopback NO-GO; Deepgram behind a provider interface; hotkey-driven), Context, and the focus-discipline / system-audio-only / cost / privacy constraints.

### The load-bearing prior decision (READ FIRST)
- `.planning/phases/03-audio-loopback-spike/03-LOOPBACK-GATE.md` — the NO-GO record: why `getDisplayMedia`/Chromium loopback is dead on this machine (DXGI duplicator failure), the three approaches that all failed identically, and the explicit Phase 4 implication (WASAPI capture, never touches Chromium screen capture). This is WHY the capture mechanism changed.
- `.planning/phases/03-audio-loopback-spike/03-CONTEXT.md` — the audio-capture seam decisions (D-02: seam is real Phase 4 foundation; D-05: the worklet was meant to be extended to PCM — now superseded by D-02 here, which moves resampling to main and retires the worklet).

### Prior-phase decisions this phase builds on
- `.planning/STATE.md` §Accumulated Context — Phase 1 GO at Electron 35.7.5; `uiohook` prebuilt-binary-vs-from-source rebuild note (the native-module precedent for D-03); STT-behind-`ISttProvider` decision; the 03-01 capture-seam IPC notes.
- `.planning/phases/01-overlay-shell-existential-behaviors/01-CONTEXT.md` — the `contextIsolation`/`sandbox`/typed-preload boundary (D-06), the toggleable `DebugHud` that survives into later phases (D-08), the single read-only `jedi:status` channel.
- `.planning/phases/02-global-hotkeys-window-control/02-CONTEXT.md` + `02-HOTKEY-CONFLICT-TEST.md` — the `HotkeyRegistrarService`, the finalized conflict-tested Ctrl+Alt chord set, and the `register()`-result-checking / HUD-surfacing pattern the clear-transcript chord (D-07) reuses.

### Stack & implementation guidance
- `CLAUDE.md` (project root) §"@deepgram/sdk" / Version Compatibility — Deepgram v5 live WebSocket: `new DeepgramClient({apiKey})`, `client.listen.v1.connect({ model:'nova-3', interim_results:true, encoding:'linear16', sample_rate:16000 })`, `connection.sendMedia(int16Buffer)`, `'message'` events, `data.is_final`. Run in main (key out of the renderer).
- `CLAUDE.md` §"System audio loopback" + §"What NOT to Use" — `naudiodon@2.3.6` WASAPI sidecar as the documented fallback (now adopted); stay on pinned Electron 35.x (40.x has a loopback-silence regression).
- `CLAUDE.md` §"AudioWorklet" — the down-mix/resample Float32→16 kHz mono Int16 logic (now relocated to a main-process utility per D-02 rather than a renderer worklet).
- `CLAUDE.md` §"Version Compatibility" — native modules need `@electron/rebuild` against the Electron ABI (applies to `naudiodon` exactly as it does to `uiohook-napi`).

### Code to rework / extend (see code_context)
- `src/renderer/src/services/audio-capture.service.ts` + `src/renderer/src/audio/rms-meter.worklet.ts` — **retired** per D-02 (renderer audio path removed).
- `src/renderer/src/audio/rms.utility.ts` (+ `.test.ts`) — RMS math **reused** for an optional main-computed level meter.
- `src/main/overlay-window.manager.ts` (`IOverlayStatus`, `STATUS_CHANNEL`, `pushStatus`) + `src/preload/index.ts` + `src/renderer/src/components/debug-hud.tsx` — extended for the transcript render (D-04) and the WR-03 unsubscribe fix; `reportAudioLevel` / `jedi:audio-level` removed (IN-01).
- `src/main/index.ts` — `app.whenReady` bootstrap where the old `setDisplayMediaRequestHandler` lived; rewire for main-side WASAPI capture init (with the WR-01 empty-device guard).
- `src/main/hotkey-registrar.service.ts` — add the clear-transcript chord (D-07).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`HotkeyRegistrarService`** (`src/main/hotkey-registrar.service.ts`) — proven uiohook-napi (+ globalShortcut fallback) registrar with `register()`-result checking and HUD surfacing; the clear-transcript chord (D-07) registers through it exactly like the Phase 2 chords.
- **`rms.utility.ts`** (`src/renderer/src/audio/`, unit-tested) — the RMS math; reusable for a main-computed level meter even though its worklet wrapper is retired.
- **`IOverlayStatus` / `STATUS_CHANNEL` ('jedi:status') / `pushStatus()`** (`src/main/overlay-window.manager.ts`) — the one-way main→renderer push the transcript render builds on (whether via a new channel per the D-04 discretion lean, or by extension).
- **`DebugHud`** (`src/renderer/src/components/debug-hud.tsx`) — the status-row view, extended with the transcript (D-04/D-05).

### Established Patterns
- **Main owns IO/state; renderer is a pure one-way `jedi:status` view.** The Phase 4 pivot makes this even cleaner: audio capture, resampling, the Deepgram socket, and the `TranscriptBuffer` all live in main; the renderer just renders pushed transcript + connection state. The single write-only `jedi:audio-level` exception is removed (IN-01).
- **Native-module discipline** — `uiohook-napi` established that from-source rebuilds can fail on this machine (no MSVC) but prebuilt N-API binaries load under Electron 35.7.5; `naudiodon` must clear the same `@electron/rebuild`/prebuilt-binary bar (D-03) before the pipeline is built on it.
- **`backgroundThrottling:false`** already set — the continuously-running capture + STT pipeline keeps running while the overlay is unfocused (it always is).
- **Strict TS / IDEXX standards** — explicit return types, single quotes, 4-space, TSDoc on exports; co-located Vitest for unit-testable pieces (the resample/down-mix utility and the `TranscriptBuffer` bounding are unit-testable even though live capture is not).

### Integration Points
- **`naudiodon` (main) → resample utility (main) → `ISttProvider`/`DeepgramSttGateway` (main, websocket) → `TranscriptBuffer` (main) → overlay render** — the Phase 4 data path; all of it main-side except the final push to the renderer.
- **`ISttProvider` ← (Phase 5) → AIOrchestrator** — Phase 5's main-side AI reads a recent time-based span (D-06) from the main `TranscriptBuffer`; the seam's transcript output is what AI consumes.
- **New dependency:** `naudiodon`(-loopback) — native, needs `@electron/rebuild`; `@deepgram/sdk@5` — pure JS. Both run in main.

</code_context>

<specifics>
## Specific Ideas

- The DebugHud continues its evolving role: Phase 1 existential readout → Phase 2 hotkey cheat-sheet → Phase 3 `Audio:` meter → **Phase 4 live transcript**. The user deliberately kept the transcript inside it for this phase (D-04/D-05) rather than opening a new content surface, deferring that to Phase 5.
- The whole Phase 4 architecture is a deliberate consequence of one fact: **the renderer can't be in the audio path on this machine** (DXGI failure). Moving capture, resampling, the socket, and the buffer all into main is not just convenient — it's forced, and it happens to align perfectly with the existing main-owns-state / renderer-is-a-view boundary.
- Native-module risk (D-03) is the single biggest thing to de-risk first — same lesson as `uiohook` in Phase 2.

</specifics>

<deferred>
## Deferred Ideas

- **Dedicated always-on transcript content surface** (decoupled from the DebugHud toggle) — deferred to Phase 5, which carries a UI hint and adds streaming AI answers that also need a readable surface (D-05).
- **`safeStorage`-backed Deepgram/Anthropic key entry + settings window** — Phase 6 (SET-01/SET-02); Phase 4 uses an env/dev-config key source (D-08).
- **Local Whisper `ISttProvider` implementation** — v2 (STT-V2-01); the seam (TRN-05) is built here so it's a drop-in swap, but no Whisper code is written now. (A Whisper stub gateway behind `ISttProvider` is noted for Phase 7's hardening plan.)
- **Bounded-buffer-and-flush of PCM across reconnect gaps** — only if the v1 drop-during-gap lean (Claude's Discretion) proves inadequate in use; not built speculatively.

### Reviewed Todos (not folded)
None — the one matching todo (260617-code-review-audio-seam-warnings) was folded into scope (see Folded Todos above).

</deferred>

---

*Phase: 4-STT Pipeline + Live Transcript*
*Context gathered: 2026-06-17*
