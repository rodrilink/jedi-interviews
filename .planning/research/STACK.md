# Stack Research

**Domain:** Windows 11 Electron desktop "meeting/interview assistant" overlay (transparent always-on-top, keyboard-only, system-audio loopback → streaming STT → Claude)
**Researched:** 2026-06-16
**Confidence:** HIGH on scaffolding/SDKs/overlay; MEDIUM on loopback-audio reliability (version-sensitive, see flags)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Electron** | `35.x` (pin a known-good 35 build) for v1; `36`/`37` only after smoke-testing loopback | App shell, overlay windows, screenshot, native loopback audio | Native `getDisplayMedia({ audio: 'loopback' })` is **Windows-only and officially supported** via `setDisplayMediaRequestHandler`. Electron 35 line is the most-reported-working for Windows loopback. Newer majors (40.x) introduced a desktop-audio regression (silence) — see PITFALLS. Do **not** chase latest (42.x) blindly. |
| **TypeScript** | `5.6+` | Whole codebase | Matches user's TS-first standard; first-class in electron-vite. |
| **electron-vite** | `5.0.0` | Build/dev tooling (main + preload + renderer), HMR, TS bundling | Purpose-built for the three-process Electron model with separate `main`/`preload`/`renderer` configs out of the box. Vite HMR on the renderer makes the overlay UI fast to iterate — the project's stated priority. Mature enough; the historic "packaging pain" reports are mitigated by pairing it with electron-builder for distribution (below). |
| **electron-builder** | `26.15.3` | Packaging / installer (NSIS for Windows) | Decoupled from dev tooling. electron-vite builds the bundles; electron-builder produces the Windows installer. This split avoids electron-forge's still-**experimental** Vite plugin. For a personal single-user tool, even an unsigned NSIS or portable `.exe` is fine. |
| **React** | `18.x` (or `19.x`) | Renderer UI for the overlay + context panel | User is React-fluent (IDEXX frontend standard). Overlay is simple enough that React is optional, but it pays off for the Session Context panel and streaming-text rendering. SolidJS/Svelte are viable but add unfamiliarity. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@deepgram/sdk** | `5.4.0` | Streaming STT over WebSocket | Core transcription. v5 is a **breaking redesign** — use `new DeepgramClient({ apiKey })`, `client.listen.v1.connect({ model: 'nova-3', interim_results: true, encoding: 'linear16', sample_rate: 16000 })`, then `connection.sendMedia(int16Buffer)`. Listen to `'message'` events; `data.is_final` distinguishes final vs interim transcripts. Run this in the **main process** (or a hidden renderer) — keep the API key out of the visible overlay renderer. |
| **@anthropic-ai/sdk** | `0.104.2` | Claude calls (answers, talking points, code-challenge vision) | Use `client.messages.stream({ model, max_tokens, messages })` and consume `content_block_delta` `text_delta` events for streaming to the overlay. For the screenshot mode, send a user message with content blocks `[{ type: 'image', source: { type: 'base64', data, media_type: 'image/png' } }, { type: 'text', text: prompt }]`. Pre-`1.0` but API-stable and the official SDK. Model IDs: `claude-opus-4-8` (hard), `claude-haiku-4-5` (fast) — confirm exact IDs via the `claude-api` skill at build time. |
| **uiohook-napi** | `1.5.5` | App-wide global hotkeys + key handling while another app is focused | **Preferred over Electron `globalShortcut`** for this app. `globalShortcut` *registers* (and thus *steals*) accelerators OS-wide, silently fails on conflicts, and is blocked by some apps/games. `uiohook-napi` is a passive low-level hook: it observes keystrokes without consuming them, so it never fights the meeting app for a chord. Use it to drive opacity-adjust, window-move, and mode hotkeys. Native module → must be rebuilt for the Electron ABI (see Version Compatibility). |
| **electron-store** | `11.0.2` | Local persistence of session context (notes, ticket text, snippets, links) + non-secret prefs | Simple JSON store in `app.getPath('userData')`. v11 is **ESM-only** — fine under electron-vite's ESM main. Use for everything *except* API keys. |
| **safeStorage** (Electron built-in) | n/a (ships with Electron) | Encrypt the Deepgram + Anthropic API keys at rest | OS-backed encryption (DPAPI on Windows). Store the `safeStorage.encryptString(key)` ciphertext via electron-store; decrypt in the main process only. Do **not** put raw keys in electron-store or expose them to the renderer. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **@electron/rebuild** | Rebuild `uiohook-napi` against the Electron ABI | Run after install / Electron upgrades; without it the native hook crashes on load. |
| **oxlint + Prettier** | Lint/format (per IDEXX standards) | 4-space, single quotes, 180 col. |
| **AudioWorklet** (Web Audio, built-in) | Convert loopback `MediaStream` → 16 kHz mono Int16 (linear16) PCM frames for Deepgram | Run a small worklet that down-mixes/resamples Float32 → Int16 and posts buffers to the main thread (or directly streams via IPC). Avoid the deprecated `ScriptProcessorNode`. |

## Installation

```bash
# Scaffold
npm create @quick-start/electron@latest jedi-interviews -- --template react-ts
# (electron-vite + React + TS + electron-builder wiring)

# Core runtime deps
npm install @deepgram/sdk@^5.4.0 @anthropic-ai/sdk@^0.104.2 electron-store@^11 uiohook-napi@^1.5.5

# Dev / build
npm install -D electron@35 electron-vite@^5 electron-builder@^26 @electron/rebuild typescript@^5.6

# Rebuild native module against Electron ABI
npx @electron/rebuild -f -w uiohook-napi
```

## Overlay window configuration (the load-bearing details)

Create the `BrowserWindow` with:

```ts
new BrowserWindow({
  transparent: true,
  frame: false,
  alwaysOnTop: true,          // then: win.setAlwaysOnTop(true, 'screen-saver')
  focusable: false,           // CRITICAL: prevents the overlay from ever taking keyboard focus
  skipTaskbar: true,          // no taskbar/alt-tab entry
  hasShadow: false,
  resizable: false,
  webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
});
```

Then, post-create:
- `win.setAlwaysOnTop(true, 'screen-saver')` — high z-level so it floats over full-screen-ish meeting windows. `'screen-saver'` sits above normal always-on-top windows.
- `win.setIgnoreMouseEvents(true, { forward: true })` — makes the overlay **click-through** so meeting/mouse clicks pass to the app underneath. Toggle to `false` only when the user needs to interact (but per requirements this app is keyboard-only, so it can stay click-through permanently).
- `win.setVisibleOnAllWorkspaces(true)` — keep visible across virtual desktops.
- `win.setContentProtection(true)` — **optional**; excludes the overlay from screen-share/capture (it won't show up if the user shares their screen in the meeting). Worth enabling for this use case.

**Focus discipline (Windows):** `focusable: false` is the primary guarantee against focus theft. Because the app is keyboard-only and driven by `uiohook-napi` (a passive hook, not a focused input field), the overlay never needs to be the foreground window. Move/opacity changes are done programmatically (`win.setBounds`, `win.setOpacity`) from the main process in response to global hotkeys — never by focusing the window.

**Windows caveats:**
- `transparent: true` + `frame: false` is required for true click-through; on Windows a transparent window can't be resized by the user (fine — resizing is keyboard-driven here).
- Transparent always-on-top windows can occasionally hide behind other apps' top-most toolbars; the `'screen-saver'` level mitigates this.
- Do not set `backgroundThrottling` defaults blindly — disable throttling (`webPreferences.backgroundThrottling: false`) so the audio/transcript pipeline keeps running when the overlay isn't focused (it never is).

## System audio loopback (highest-risk dependency)

**Mechanism (native, no third-party driver):**
```ts
session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
  callback({ video: undefined, audio: 'loopback' }); // 'loopbackWithMute' to also mute local playback
}, { useSystemPicker: false });
// renderer:
const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
// drop the video track, keep audio → AudioWorklet → Int16 PCM → Deepgram
```
- `audio: 'loopback'` / `'loopbackWithMute'` are **officially Windows-only** and supported natively from Electron **31+** (no Chromium patch needed). This matches the project's "Electron built-in loopback" decision exactly.
- Some Electron versions require requesting `video: true` then discarding the video track to reliably get the audio stream.

**Fallback (documented, only if native loopback proves flaky on the user's machine):**
- `electron-audio-loopback@1.0.6` — JS shim for Electron 31–39 where native loopback needed patching. Note: per the maintainer, **Electron 39+ no longer needs it**.
- Native WASAPI sidecar via `naudiodon@2.3.6` (PortAudio bindings) — raw WASAPI loopback capture in a separate process, piped to the app. Heavier (native build, PortAudio) — reserve for true failure of the Chromium path.

## Screenshot capture (code-challenge mode)

Use **Electron `desktopCapturer`** — built-in, no extra dependency, returns the screen as a thumbnail/`NativeImage` you can convert to base64 PNG and hand straight to the Anthropic SDK image block. `screenshot-desktop@1.15.4` (shells out to a bundled native binary) is the fallback only if `desktopCapturer` resolution/quality is insufficient on multi-monitor setups. Prefer `desktopCapturer` to keep the dependency surface and packaging simple.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| electron-vite + electron-builder | electron-forge (with Vite plugin) | If you want one unified CLI for dev + package + publish and can tolerate the **experimental** Forge-Vite plugin. Forge is more mature for distribution pipelines, but the overlap isn't worth it for a personal single-user app. |
| uiohook-napi | Electron `globalShortcut` | Use `globalShortcut` only for a couple of dedicated chords you're happy to *reserve* OS-wide and that won't collide with the meeting app. It's zero-dependency and simpler — acceptable for a v0 spike, but it can steal/conflict and silently fail. |
| Native `getDisplayMedia({ audio: 'loopback' })` | electron-audio-loopback / naudiodon WASAPI | Use the shim/native path only if the Chromium loopback path returns silence or errors on the target Electron version. |
| desktopCapturer | screenshot-desktop | Multi-monitor edge cases or if you need full-resolution captures `desktopCapturer` thumbnails can't provide. |
| Deepgram streaming | local Whisper (whisper.cpp) | Privacy-sensitive sessions or offline use (documented fallback behind the STT-provider interface). Higher latency / setup cost. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Electron `globalShortcut` as the *primary* hotkey system | Registers accelerators OS-wide (steals them from other apps), silently fails on conflicts, blocked by some apps/games — fights the meeting app, the exact thing this project forbids | `uiohook-napi` (passive hook) |
| Latest Electron (40.x–42.x) for v1 without testing | A desktop-audio capture **regression** (loopback returns silence) was reported in the 40.x line; reliability of the very newest majors for Windows loopback is unverified | Pin Electron **35.x** for v1; only upgrade after smoke-testing loopback on the target machine |
| `nodeIntegration: true` / `contextIsolation: false` | Security anti-pattern; exposes Node to renderer-loaded content | `contextIsolation: true`, `sandbox: true`, expose a minimal typed API via `contextBridge` in preload |
| `ScriptProcessorNode` for PCM conversion | Deprecated, runs on main thread, glitchy under load | `AudioWorklet` |
| API keys in `electron-store` (plaintext) or in the renderer | Keys would sit unencrypted in `userData` and be reachable from renderer | Encrypt with `safeStorage` (DPAPI) in the **main** process; keep all Deepgram/Anthropic calls in main |
| electron-forge Vite plugin | Still flagged **experimental** by the Forge maintainers | electron-vite (dev) + electron-builder (package) |
| `electron-audio-loopback` on Electron 39+ | Maintainer states it's unnecessary — native loopback works | Native `getDisplayMedia({ audio: 'loopback' })` |

## Stack Patterns by Variant

**If native loopback returns silence/errors on the chosen Electron build:**
- First try requesting `video: true` and discarding the video track.
- Then try `electron-audio-loopback` (if on Electron ≤ 38).
- Last resort: `naudiodon` WASAPI sidecar process.
- Because the STT pipeline is behind an interface, the audio *source* can be swapped without touching transcript/AI code.

**If the overlay occasionally drops below other top-most windows on Windows:**
- Use `setAlwaysOnTop(true, 'screen-saver')` (not the default level) and re-assert on `blur`/display-change events.

**If you want screen-share invisibility (don't leak the assistant when sharing your screen):**
- Enable `win.setContentProtection(true)`.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| electron@35 | uiohook-napi@1.5.5 | Native module — run `@electron/rebuild` against Electron's ABI after install and after any Electron upgrade. |
| electron-store@11 | electron-vite ESM main | v11 is **ESM-only**; ensure the main process bundle is ESM (electron-vite default). On CommonJS main, pin electron-store@8. |
| @deepgram/sdk@5 | (any) | **v5 is a breaking API change** vs v3/v4 — `listen.v1.connect`/`sendMedia`/`DeepgramClient`. Ignore older v3 tutorials. |
| @anthropic-ai/sdk@0.104 | (any) | Pre-1.0 but API-stable; `messages.stream()` + base64 image blocks are current. |
| Electron native loopback | Electron 31+ on **Windows only** | macOS/Linux loopback is not the supported native path; project is Windows-only so this is fine. |

## Sources

- `/deepgram/deepgram-js-sdk` (Context7) — v5 live WebSocket: `DeepgramClient`, `listen.v1.connect`, `interim_results`, `is_final`, `sendMedia` — HIGH
- `/anthropics/anthropic-sdk-typescript` (Context7) — `messages.stream()`, SSE delta events, base64 image content block shape — HIGH
- https://www.electronjs.org/docs/latest/api/session — `setDisplayMediaRequestHandler`: `'loopback'`/`'loopbackWithMute'` Windows-only, `useSystemPicker` (macOS 15+), `enableLocalEcho` — HIGH
- https://github.com/alectrocute/electron-audio-loopback — requires Electron ≥31; native loopback works on Electron 39+ without the shim; Windows/macOS/Linux — MEDIUM
- https://github.com/electron/electron/issues/49607 — desktop audio regression: working in 35.1.2, silence in 40.1.0 (reported macOS; treat newer majors as needing a Windows smoke test) — MEDIUM
- https://github.com/electron/electron/issues/27240, /issues/8491 — `globalShortcut` is not reliably "global", silently fails on conflicts, steals accelerators — MEDIUM
- https://github.com/hcfyapp/uiohook-shoutcut — uiohook-napi as a `globalShortcut` replacement — MEDIUM
- https://electron-vite.org/ — electron-vite main/preload/renderer model, current major — HIGH
- https://www.electronforge.io/config/plugins/vite — Forge Vite plugin marked experimental — HIGH
- npm registry (`npm view`) — current versions: electron 42.4.1, @deepgram/sdk 5.4.0, @anthropic-ai/sdk 0.104.2, electron-store 11.0.2, electron-vite 5.0.0, uiohook-napi 1.5.5, electron-builder 26.15.3, electron-audio-loopback 1.0.6, naudiodon 2.3.6, screenshot-desktop 1.15.4 — HIGH

---
*Stack research for: Windows Electron meeting/interview assistant overlay*
*Researched: 2026-06-16*
</content>
</invoke>
