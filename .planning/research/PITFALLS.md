# Pitfalls Research

**Domain:** Windows Electron transparent always-on-top overlay — system-audio loopback capture, streaming STT (Deepgram), Claude LLM + vision, keyboard-only control
**Researched:** 2026-06-16
**Confidence:** MEDIUM-HIGH (focus/click-through, loopback, content-protection, signing verified against Electron GitHub issues and official docs; latency/UX from domain reasoning + community reports)

This domain has an unusual property: the **hardest problems are platform/version-specific Electron behaviors, not application logic**. The overlay's two defining requirements — "never steal focus" and "invisible in screen share" — are precisely the two areas where Electron has active, version-sensitive regressions on Windows 11. Pin your Electron version deliberately and re-verify on every upgrade.

## Critical Pitfalls

### Pitfall 1: Overlay steals keyboard/mouse focus from the meeting app

**What goes wrong:**
The overlay window grabs focus when it appears, is moved, is clicked, or when AI text streams in. The meeting app (Teams/Zoom/Meet) loses focus — push-to-talk stops working, the user's typing goes into the void, the meeting UI dims its "active" state, or screen-share controls behave oddly. This kills the core value proposition ("never stealing focus").

**Why it happens:**
Default `BrowserWindow` is focusable and `show: true` focuses on creation. `win.show()` and `win.focus()` activate the window. Even with `focusable: false`, calling `show()` (vs `showInactive()`) or having any focusable DOM element that receives a programmatic `.focus()` will steal focus. On Windows, `alwaysOnTop` plus a visible window that accepts activation will pull foreground when shown.

**How to avoid:**
- Create the window with `focusable: false`, `skipTaskbar: true`, `show: false`, `frame: false`, `transparent: true`.
- Display it with `win.showInactive()` — **never** `win.show()` or `win.focus()`.
- Set `setAlwaysOnTop(true, 'screen-saver')` (a high level) so it floats over the meeting without needing activation.
- For click-through: `win.setIgnoreMouseEvents(true, { forward: true })`. The `{ forward: true }` (Windows-only) forwards move events so you can still detect hover and toggle interactivity via CSS `pointer-events`, but the window never takes focus.
- Drive ALL interaction through `globalShortcut` — the overlay should have **zero** focusable HTML elements in v1 (no `<input>`, no `<textarea>`, no `tabindex`). The Session Context editor must be a **separate, normal window** the user opens deliberately (it is allowed to take focus), NOT part of the always-on-top overlay.
- Never call `webContents.focus()` or autofocus DOM nodes.

**Warning signs:**
While testing with a real meeting open, watch the meeting window's title-bar "active" highlight. If it dims when the overlay appears/updates, you are stealing focus. Teams push-to-talk silently breaking is the classic tell.

**Phase to address:** Overlay-shell phase (the very first phase). This must be proven before any AI work — it is the project's existential constraint.

---

### Pitfall 2: System-audio loopback captures nothing, or only one window's audio

**What goes wrong:**
`getDisplayMedia({ audio: 'loopback' })` returns a stream with no error, but the audio track is silent (no transcript ever appears), or it captures only the audio of the specific window/tab the user picked in the picker rather than the full system mix — so audio from a different app (the actual meeting) is missed.

**Why it happens:**
- Plain `navigator.mediaDevices.getDisplayMedia({ audio: true })` throws `NotSupportedError` on Windows — desktop audio is NOT available through the standard path. You **must** install a `setDisplayMediaRequestHandler` in the main process that resolves with `{ audio: 'loopback' }` and a video source.
- Electron version matters enormously. Loopback support and a string of regressions live across versions: the community `electron-audio-loopback` shim targets `>=31.0.1` and `<39.0.0` (built into Chromium at 39+). There are documented "captures only silence" regressions in the 40.x line and renderer crash (Error 263) reports on Windows 11 with `chromeMediaSourceId`.
- "Loopback" semantics: if your handler resolves with a specific window/tab source rather than the screen/system source, you get that source's audio only. System-wide loopback requires the screen source.
- A known workaround for "silent stream" bugs: requesting `video: { width: 4, height: 4, frameRate: 1 }` instead of disabling video can restore audio (a GPU-texture interaction). You generally still need a video constraint present even though you discard the video track.

**How to avoid:**
- **Pin a known-good Electron version and document it.** Test loopback on YOUR Windows 11 build before building anything on top. Do not blindly take the latest Electron.
- Use `app.whenReady()` → `session.defaultSession.setDisplayMediaRequestHandler((request, callback) => callback({ video: primaryScreenSource, audio: 'loopback' }))`. Resolve with a **screen** source for system-wide audio.
- Keep a tiny video constraint (e.g. 4×4) and immediately `track.stop()` the video track after acquiring the stream; consume only the audio track.
- Build a **5-minute spike** that captures loopback, pipes it to a `<audio>` meter or logs RMS levels, and confirms non-silence with a real meeting playing — BEFORE writing Deepgram code.
- Keep the WASAPI native sidecar as a designed-in fallback behind the STT/audio-source interface. The PROJECT already names this; honor it. The trigger to switch is: silence on your target Electron version that no version pin fixes.

**Warning signs:** No transcript ever appears despite "connected" STT. Audio meter flatlines. Works in dev (latest Electron) but breaks after an Electron upgrade. Captures your own test audio but not the meeting app.

**Phase to address:** Audio-capture phase (early, right after overlay shell). Spike loopback in isolation before integrating STT.

---

### Pitfall 3: The overlay is VISIBLE in the user's own screen share (content protection fails or shows a black box)

**What goes wrong:**
The user shares their screen in the meeting and the overlay — with its AI answers — is captured and shown to everyone, OR `setContentProtection(true)` is enabled but the captured frame shows a **solid black rectangle** where the overlay is (still obviously "something is there"), which is arguably worse for a discreet tool.

**Why it happens:**
- `setContentProtection` maps to Windows' `SetWindowDisplayAffinity`. `WDA_EXCLUDEFROMCAPTURE` (Windows 10 2004+) truly excludes the window from capture; the older `WDA_MONITOR` only blacks it out. Behavior depends on the Windows build AND the capture method (DWM/Desktop Duplication vs window-graphics-capture vs legacy GDI).
- Active Electron regressions: **Electron 35.0.1 introduced a regression** (commit 84d2ba2 / `SetAllowScreenshots`) where `setContentProtection(true)` shows the window as a **black rectangle** on Windows 11 instead of being invisible — it worked in 35.0.0. There are multiple related open issues (black rectangle during full-screen share, captured on some Windows builds, breaks after hide/show).
- Toggling visibility: `setContentProtection` can be lost after `hide()`/`show()` cycles — you may need to re-apply it.
- Different meeting apps capture differently. Some use full-monitor duplication (respects exclude-from-capture), some use per-window capture, some browsers use different paths — so "invisible in Zoom" does not guarantee "invisible in Teams/Meet."

**How to avoid:**
- Call `win.setContentProtection(true)` and **re-apply it after every `show`/`showInactive`** and after recreating the window.
- **Pin and verify the Electron version against this exact regression.** Avoid the affected 35.0.x range unless verified fixed; test your chosen version by actually screen-sharing your own screen (record a test meeting, share to yourself in a second account or use the meeting app's self-preview) and confirm the overlay is absent — not blacked out.
- Test against **every meeting app the user actually uses** (Teams, Zoom, Meet-in-browser). Treat each as a separate verification.
- Have a safety hotkey to instantly hide the overlay (`showInactive`/`hide` toggle) as a manual fallback if content protection can't be trusted on a given app/build.
- Document clearly: content protection is best-effort and OS/version-dependent; the manual hide hotkey is the guarantee.

**Warning signs:** During a self-test screen share, the overlay appears or shows as a black box in the shared view. It worked, then broke after an Electron bump.

**Phase to address:** Overlay-shell phase (alongside Pitfall 1) — both are "does the window behave correctly on Windows" concerns and must be proven before AI work. Re-verify in a hardening/packaging phase.

---

### Pitfall 4: Global hotkeys fail to register, conflict, or don't fire when the meeting app is focused

**What goes wrong:**
`globalShortcut.register()` returns `false` and the hotkey silently does nothing; or it works in dev but conflicts with a shortcut the meeting app / OS / another tool already owns; or the user expects it to fire while the meeting is focused and it doesn't.

**Why it happens:**
- `globalShortcut.register()` returns `false` (no throw) when the accelerator is already claimed by another app or the OS. The OS deliberately prevents apps from fighting over global shortcuts — first-registrant wins, and you may not be first.
- Common conflicts: `Ctrl+Shift+...` combos used by Teams/Zoom (mute, camera), `PrintScreen` grabbed by Snipping Tool / OneDrive, media keys, Windows-key combos reserved by the OS.
- AltGr on Windows is mis-mapped: Electron reports AltGr as `ControlLeft` (issue #13895), so accelerators using right-Alt / AltGr layouts behave unexpectedly on non-US keyboards.
- Reliability complaints exist that global shortcuts are not perfectly "global" in all focus states.

**How to avoid:**
- **Always check the boolean return of `register()`** and surface a visible (non-focus-stealing) status to the user when registration fails — never assume success.
- Make hotkeys **user-configurable** with sane defaults, so a conflict is recoverable without a code change. Re-register and re-check on change.
- Choose defaults that avoid common meeting-app and OS reservations. Prefer combos with `Ctrl+Alt` or `Ctrl+Shift+Alt` plus an uncommon key; avoid bare function keys, `PrintScreen`, and Windows-key combos.
- Avoid AltGr / right-Alt in default accelerators given the Windows mis-mapping.
- Test every default hotkey with Teams AND Zoom open and focused (their global mute hotkeys are a frequent collision).
- Unregister all on quit (`globalShortcut.unregisterAll()` in `will-quit`).

**Warning signs:** A hotkey does nothing and there's no error in logs (because `register` returned `false` and you didn't check). Hotkey works with overlay focused but not with meeting focused (means you accidentally wired a local `before-input-event` instead of a true `globalShortcut`).

**Phase to address:** Hotkey/control phase — but the `register()`-returns-false check is a foundational habit from the first hotkey written.

---

### Pitfall 5: Dirty/wrong-rate PCM to Deepgram — silence, garbage transcript, or dropped audio under load

**What goes wrong:**
Transcript is empty, garbled, or sounds "chipmunk/slow" (pitch wrong), or transcription lags further and further behind real time and never catches up.

**Why it happens:**
- **Sample-rate mismatch:** the WebAudio graph runs at the hardware `AudioContext.sampleRate` (commonly 48000 Hz on Windows), but you tell Deepgram `sample_rate=16000` (or vice versa). Deepgram trusts the declared rate — a mismatch yields pitch-shifted, unrecognizable audio. With `linear16` you must send raw 16-bit PCM at exactly the declared rate.
- **Float → int16 conversion errors:** WebAudio gives `Float32` samples in [-1, 1]. Deepgram `linear16` needs little-endian signed `Int16`. Wrong scaling/clamping/endianness = noise or silence.
- **ScriptProcessorNode** is deprecated, runs on the main thread, and drops audio frames under UI/render load (exactly when AI text is streaming and rendering) → gaps in transcript.
- **WebSocket backpressure:** if you push PCM faster than the socket drains (or during reconnects), buffering grows unbounded → growing latency, or you drop chunks → missing words. Auth header omission is the #1 reason the Deepgram socket fails to open at all.

**How to avoid:**
- Use an **`AudioWorkletNode`**, not `ScriptProcessorNode`. The worklet runs on the audio render thread and is resilient to main-thread jank from streaming AI text.
- **Resample deliberately and declare honestly.** Either (a) create the `AudioContext` with `{ sampleRate: 16000 }` and downsample in the worklet, or (b) keep 48000 and set Deepgram `sample_rate=48000`. Make the declared rate and the actual PCM rate identical — assert this in code.
- Convert Float32→Int16 explicitly: clamp to [-1,1], multiply by 32767, write little-endian. Unit-test this conversion.
- Batch to Deepgram-recommended 20–100 ms chunks (e.g. ~100 ms = 3200 bytes int16 mono @16 kHz) — not per-128-sample worklet quantum.
- Pass the Deepgram API key via the `Authorization` header on socket open (in the **main process**, see Pitfall 8). Implement reconnect-with-backoff and a bounded send buffer that **drops oldest** on overflow rather than growing without limit (favor live transcript freshness over completeness).
- Put STT behind the provider interface the PROJECT already specifies so Whisper can swap in.

**Warning signs:** Empty transcript with a "connected" socket. Pitch-shifted playback when you tee the stream to an `<audio>` element. Transcript latency that grows monotonically. Words dropping specifically while AI responses render.

**Phase to address:** STT-streaming phase. Build the audio→PCM→Deepgram pipe as an isolated, testable unit with a known-good audio fixture.

---

### Pitfall 6: End-to-end latency makes the AI answer arrive too late to be useful in conversation

**What goes wrong:**
By the time a grounded answer renders, the conversation has moved on. The tool feels like a transcript-with-delay rather than a live assistant. Core value ("fast enough to be useful in the flow") is lost.

**Why it happens:**
- Waiting for Deepgram **final** transcripts (vs **interim/partial**) before building the prompt adds seconds.
- Sending the entire rolling transcript as context bloats input tokens → slower time-to-first-token and higher cost.
- Using a heavy model (Opus 4.8) for tasks that a fast model (Haiku 4.5) handles — e.g. "suggest a talking point" or classifying the question — pays a latency tax for no quality gain.
- Not streaming the LLM response (waiting for the full completion before showing anything).
- Vision: oversized screenshots inflate time-to-first-token (see Pitfall 7).

**How to avoid:**
- Trigger prompt-building off the **most recent finalized window** of transcript (e.g. last N seconds) the instant the hotkey fires — don't wait for a "final" event mid-utterance.
- **Tier deliberately** (the PROJECT already decides this): Haiku 4.5 for classification / talking-point suggestions; Opus 4.8 only for the code-challenge mode. Wire each hotkey to its intended tier.
- Cap transcript context: send a bounded recent window (e.g. last 60–120 s or last N words) plus the curated Session Context, not the whole buffer.
- **Stream the LLM response** to the overlay and render tokens as they arrive — perceived latency is dominated by time-to-first-token.
- Measure: log timestamps for hotkey-press → prompt-sent → first-token → done. Set a budget (e.g. first useful token < 2 s for Haiku paths) and watch it.

**Warning signs:** Users stop pressing the hotkey because "it's too slow." First-token latency in logs creeping past a couple seconds for quick-suggestion paths. Prompt input-token counts in the thousands for a simple question.

**Phase to address:** AI-integration phase; revisit in a latency-tuning pass after first end-to-end demo.

---

### Pitfall 7: Vision/LLM pitfalls — oversized screenshots, transcript context bloat, streaming render jank

**What goes wrong:**
Screenshot upload is slow or rejected; code-challenge solving is slow to start; prompts balloon with stale transcript; the overlay stutters or layout-thrashes as tokens stream.

**Why it happens:**
- **Image too large:** Claude rejects images over 8000×8000 px (and 2000×2000 if >20 images). More importantly, anything over ~1.15 MP / 1568 px long edge is auto-downscaled server-side, **adding latency with no quality benefit**. A raw 4K screenshot is wasteful. Request body has a 32 MB cap.
- **Wrong encoding:** sending a data-URL prefix, wrong media-type, or non-base64 payload to the vision block → API error. Screenshots should be PNG (lossless, good for code/text) base64-encoded with the correct `media_type`.
- **Context bloat:** dumping the entire rolling transcript every call → token cost + latency + the model losing the actual question in noise.
- **Render jank:** re-rendering the whole markdown/transcript on every streamed token causes layout thrash and dropped frames — which (per Pitfall 5) can also starve a main-thread audio path.

**How to avoid:**
- Before sending, **downscale screenshots to ≤1568 px on the long edge** (≤~1.15 MP) client-side; keep PNG for crisp code text. This is the single biggest vision-latency lever.
- Encode exactly as Claude expects: base64 string + correct `media_type` (`image/png`), no data-URL prefix in the base64 field. (Consult the `claude-api` skill at implementation time for the current request shape — model IDs and vision schema evolve.)
- Bound transcript context (see Pitfall 6) and prepend the curated Session Context so grounding comes from the user's notes, not raw chatter.
- Render streamed tokens by **appending** to a text buffer and throttling markdown re-parse (e.g. rAF or ~50–100 ms debounce), not re-rendering the full document per token. Use the AudioWorklet (Pitfall 5) so audio is immune to this regardless.

**Warning signs:** Vision calls noticeably slower than text calls. API errors mentioning image dimensions or encoding. Overlay stutters while answers stream. Input token counts dominated by transcript rather than the question + context.

**Phase to address:** AI-integration phase (vision sub-phase for the code-challenge mode).

---

### Pitfall 8: API keys leak into the renderer, logs, or committed files

**What goes wrong:**
Deepgram/Anthropic keys end up bundled in renderer JS, printed in logs, or committed to git. For a personal tool this still means a key that can rack up real cost if the repo is ever pushed or the packaged app is shared.

**Why it happens:**
- Putting keys in renderer code or env vars exposed to the renderer (Electron renderers are web pages — anything there is inspectable). Opening a Deepgram websocket directly from the renderer with the key in the URL/header exposes it.
- `console.log`-ing request objects or the websocket URL (which may carry the key).
- Hardcoding keys for "quick testing" and committing; or committing a `.env`.

**How to avoid:**
- Keep ALL secret use in the **main process**. The renderer never sees the raw key. Open the Deepgram socket and call Anthropic from main (or a utility module that only runs in main); stream results to the renderer over IPC.
- Store keys with Electron's `safeStorage` (OS-backed encryption) or at minimum a gitignored user-data config file — never in the repo.
- `.gitignore` the config/`.env` from the first commit; add a secret-scanning pre-commit check.
- Strip secrets from logs: never log full request URLs/headers; redact. Be careful that crash dumps / Datadog-style telemetry (if added) don't capture keys.
- Enable `contextIsolation: true`, `nodeIntegration: false`, and a minimal `preload` exposing only specific IPC channels — so a compromised renderer can't read main-process secrets.

**Warning signs:** Key visible in DevTools sources or network tab. Key string appears in a log file. `git log -p` shows a key. Renderer can `require` node modules.

**Phase to address:** Foundational — set up secret handling and IPC boundary in the project-scaffold phase, before any API call is written.

---

### Pitfall 9: Packaging a transparent Electron app on Windows — black box instead of transparent, plus SmartScreen/AV friction

**What goes wrong:**
The app is transparent in `electron .` dev but renders a **black/opaque box** when packaged or on the user's machine; OR the packaged installer triggers "Windows protected your PC" SmartScreen and "Unknown publisher," and antivirus quarantines it.

**Why it happens:**
- **Transparency + GPU:** transparent windows are flaky with hardware acceleration on a subset of Windows machines (~5% report failures); the window renders black. DWM must be enabled. `app.disableHardwareAcceleration()` is the common fix but costs GPU rendering. `backgroundColor` not set to fully transparent (`'#00000000'`) or `transparent: false` slipping into a packaged config also produces black.
- **Resizing/transparency** combos and `setContentProtection` interactions can also produce black frames (overlaps Pitfall 3).
- **SmartScreen:** since June 2023, Microsoft effectively requires an **EV (or Azure Trusted/Artifact Signing)** certificate; OV certs are now treated like unsigned. Unsigned apps show "unrecognized app" warnings, and reputation must be built over weeks/many installs.
- Unsigned overlay apps that capture audio and exclude themselves from screen capture look exactly like spyware to heuristic AV → false positives.

**How to avoid:**
- Set `transparent: true`, `backgroundColor: '#00000000'`, `frame: false` explicitly and verify in a **packaged build on the target Windows 11 machine** early — not just in dev.
- If transparency renders black on the target machine, try `app.disableHardwareAcceleration()` (acceptable for a lightweight overlay) and re-test; document the tradeoff.
- For a **personal single-user tool**, accept SmartScreen friction (click "More info → Run anyway") and skip the expensive EV cert in v1 — but DOCUMENT this so it's a conscious decision, and plan to add Azure Trusted Signing if it's ever distributed. Don't burn budget on an EV cert for a tool only the author runs.
- Build a tiny packaged smoke-test (electron-builder or similar) in an early phase so packaging surprises surface before feature work piles up. Pin the same Electron version verified for loopback (Pitfall 2) and content protection (Pitfall 3).

**Warning signs:** Black rectangle where the overlay should be transparent, only in packaged/other-machine builds. SmartScreen blue dialog on install. AV quarantine.

**Phase to address:** A dedicated packaging/hardening phase near the end; but do ONE early packaged smoke-test in the scaffold phase to de-risk transparency rendering.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `ScriptProcessorNode` instead of `AudioWorklet` | Less setup, fewer files | Drops audio frames under render load; deprecated; transcript gaps exactly when AI streams | Never for this app (streaming + render jank coincide) |
| Calling Deepgram/Anthropic directly from renderer | Simpler, no IPC plumbing | Key exposure; can't reuse if UI changes | Never (security) |
| Hardcoded hotkeys (not configurable) | Ship faster | Unrecoverable conflicts with meeting app force code changes | MVP only, if `register()` failures are surfaced |
| Latest Electron, no pin | Newest features | Loopback/content-protection regressions silently break core features on upgrade | Never — pin and document the verified version |
| Sending full transcript every LLM call | No windowing logic | Token cost + latency + diluted prompt | Tiny prototypes only |
| Skip EV code-signing cert | No cost/setup | SmartScreen friction | Acceptable for personal single-user v1 (documented) |
| `app.disableHardwareAcceleration()` to fix transparency | Reliable transparent render | Slightly higher CPU for rendering | Acceptable — overlay is lightweight |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Electron loopback audio | Using `getDisplayMedia({audio:true})` directly (throws on Windows) | `setDisplayMediaRequestHandler` resolving `{video: screenSource, audio:'loopback'}`; keep a 4×4 video constraint, stop the video track |
| Deepgram websocket | Omitting `Authorization` header → socket never opens; declaring wrong `sample_rate` | Auth header on open (from main process); declared rate == actual PCM rate; `linear16` = LE int16 |
| Anthropic vision | Sending raw 4K screenshot / data-URL prefix in base64 field | Downscale to ≤1568px long edge, PNG, base64 (no prefix), correct `media_type`; consult `claude-api` skill for current schema |
| Anthropic streaming | Waiting for full completion before rendering | Stream tokens; render append-only with throttled markdown parse |
| globalShortcut | Ignoring the `false` return value | Check return, surface failures, make hotkeys configurable, avoid AltGr/right-Alt and meeting-app combos |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded STT send buffer | Transcript latency grows and never recovers | Bounded buffer, drop-oldest on overflow; reconnect with backoff | Under network hiccups / long sessions |
| Full-document markdown re-render per token | Overlay stutters while answer streams | Append + rAF/debounced re-parse | Long answers (code challenge) |
| Whole-transcript prompts | Rising token cost + slow first-token | Window to recent N seconds + curated context | As a meeting runs long (transcript grows) |
| Oversized vision images | Vision calls slower than text | Client-side downscale to ~1.15 MP | Every code-challenge call until fixed |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| API keys in renderer / socket URL | Key exfiltration via DevTools; cost abuse | Keys live in main process only; IPC for results; `contextIsolation`, `nodeIntegration:false` |
| Keys committed to git / `.env` tracked | Permanent leak in history | `.gitignore` from first commit; `safeStorage`; secret pre-commit scan |
| Logging request URLs/headers | Key in log files / telemetry | Redact secrets from all logs and crash dumps |
| Trusting content protection blindly | Overlay (with answers) shown to the meeting | Verify per Windows build + per meeting app; manual hide-hotkey as guarantee |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Any focusable element on the overlay | Steals focus from meeting (kills core value) | Zero focusable DOM on overlay; context editor is a separate normal window |
| AI answer arrives after conversation moved on | Tool feels useless | Trigger on recent transcript window; Haiku for fast paths; stream tokens |
| Hotkey silently does nothing | User thinks app is broken | Surface `register()` failures non-intrusively; configurable hotkeys |
| No instant hide | Panic when sharing screen | Dedicated hide/show toggle hotkey, always available |
| Overlay too opaque/bright over meeting | Distracting, or visually obvious on camera | Adjustable opacity (already a requirement); subtle styling |

## "Looks Done But Isn't" Checklist

- [ ] **Click-through overlay:** Often "works" but still steals focus — verify with a REAL meeting open that the meeting's active state never dims and push-to-talk keeps working.
- [ ] **Loopback capture:** Often returns a stream but it's silent — verify non-zero audio RMS with the actual meeting app playing, on the pinned Electron version.
- [ ] **Content protection:** Often "enabled" but shows a black box (or works on Zoom, not Teams) — verify the overlay is fully ABSENT in a real self-test screen share, per meeting app.
- [ ] **Global hotkeys:** Often fire in dev but not when the meeting is focused — verify with the meeting window focused, and check `register()` returned true.
- [ ] **PCM pipeline:** Often "transcribes" in dev but with wrong pitch — verify by teeing the PCM to an `<audio>` element and confirming natural speed/pitch.
- [ ] **Transparency:** Often transparent in `electron .` but black when packaged — verify a packaged build on the target machine.
- [ ] **Secrets:** Often "in env vars" but visible in renderer — verify the renderer cannot read the key (check DevTools + network).
- [ ] **Latency:** Often "responds" but too slowly — verify logged hotkey→first-token under budget for fast paths.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Loopback silent on chosen Electron version | MEDIUM | Try video-constraint workaround / different pinned version; if persistent, switch to designed-in WASAPI sidecar behind the audio interface |
| Content protection broken on a Windows/Electron combo | LOW-MEDIUM | Pin to a known-good Electron version; rely on manual hide-hotkey until verified |
| Focus stealing discovered late | MEDIUM | Audit: `showInactive` not `show`, `focusable:false`, no focusable DOM, no `webContents.focus()`; move context editor to its own window |
| Hotkey conflict in the field | LOW | Configurable hotkeys + surfaced failures make this a settings change, not a rebuild |
| Key leaked to git | HIGH | Rotate the key immediately at Deepgram/Anthropic; rewrite history / treat repo as compromised |
| Transparency renders black when packaged | LOW | `disableHardwareAcceleration()`, verify `backgroundColor:'#00000000'`, re-test packaged |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Focus stealing (1) | Overlay-shell (Phase 1) | Real meeting stays active when overlay shows/updates |
| Loopback silence/wrong source (2) | Audio-capture (early) | Non-zero RMS from real meeting audio on pinned Electron |
| Visible in screen share (3) | Overlay-shell (Phase 1) + hardening | Overlay absent in self-test share, per meeting app |
| Hotkey failure/conflict (4) | Hotkey/control | `register()` returns true; fires with meeting focused; configurable |
| Dirty/wrong PCM (5) | STT-streaming | Correct pitch on tee'd audio; stable transcript latency |
| Latency too high (6) | AI-integration + tuning pass | Logged first-token under budget; tiered models wired |
| Vision/context/render (7) | AI-integration (vision sub-phase) | Downscaled images; bounded context; smooth streaming render |
| Secret leakage (8) | Project scaffold (foundational) | Renderer cannot read key; nothing secret in git/logs |
| Packaging/transparency/signing (9) | Scaffold smoke-test + packaging/hardening | Packaged build transparent on target machine; documented signing decision |

## Sources

- Electron `getDisplayMedia`/`setDisplayMediaRequestHandler` & loopback: https://github.com/electron/electron/issues/49607 (silent capture regression, 4×4 video workaround), https://github.com/electron/electron/issues/46369 (Error 263 renderer crash on Windows 11), https://www.electronjs.org/docs/latest/api/desktop-capturer
- `electron-audio-loopback` (version range >=31.0.1, <39.0.0; built-in at 39+): https://github.com/alectrocute/electron-audio-loopback , https://www.npmjs.com/package/electron-audio-loopback
- `setContentProtection` Windows regression (35.0.1, black rectangle, commit 84d2ba2): https://github.com/electron/electron/issues/45990 , https://github.com/electron/electron/issues/46507 , https://github.com/electron/electron/issues/32961 , https://github.com/electron/electron/issues/47834
- Click-through / focus / `setIgnoreMouseEvents({forward:true})`: https://github.com/electron/electron/issues/1335 , https://github.com/electron/electron/issues/23042 , https://www.npmjs.com/package/electron-transparency-mouse-fix
- `globalShortcut` (returns false on conflict, OS arbitration) & AltGr mis-mapping: https://www.electronjs.org/docs/latest/api/global-shortcut , https://github.com/electron/electron/issues/27240 , https://github.com/electron/electron/issues/13895
- Deepgram streaming (linear16, sample-rate matching, 20–100 ms buffering, auth header): https://developers.deepgram.com/docs/determining-your-audio-format-for-live-streaming-audio , https://github.com/orgs/deepgram/discussions/740
- Claude vision limits (8000px reject, ~1.15 MP / 1568px recommendation, 32 MB request): https://docs.claude.com/en/docs/build-with-claude/vision , https://github.com/anthropics/claude-code/issues/12351
- Windows code signing / SmartScreen (EV requirement since June 2023, Azure Trusted Signing): https://www.electronjs.org/docs/latest/tutorial/code-signing , https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- Transparent window black background / hardware acceleration: https://github.com/electron/electron/issues/27253 , https://github.com/electron/electron/issues/33113

---
*Pitfalls research for: Windows Electron transparent overlay meeting/interview assistant*
*Researched: 2026-06-16*
