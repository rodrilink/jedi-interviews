# Phase 6: Session Context + Settings Window - Research

**Researched:** 2026-06-19
**Domain:** Electron multi-window/multi-renderer build wiring, safeStorage two-key persistence, live STT re-key, prompt grounding injection
**Confidence:** HIGH (all five focus areas grounded in actual repo code; ULID choice verified against npm registry)

## Summary

Phase 6 is overwhelmingly a **wiring** phase, not a design phase. CONTEXT.md (D-01..D-10) locks every architectural decision; the existing codebase already contains all the seams Phase 6 fills: the `IGroundingContext` schema + `formatContext()` + `assemblePrompt()` are complete and unit-tested; the `AiOrchestrator` already takes constructor-injected closures (`transcriptBuffer`, `pushAi`) the way D-10's `getActiveContext` provider will be added; the `placeholder-secret.service.ts` round-trip is the exact `safeStorage` pattern the real two-key store generalizes; and the `DeepgramSttGateway` is constructed with its key once at `index.ts:165` in a way that makes a tear-down-and-reconnect re-key a clean instance swap.

The single genuine technical risk is **electron-vite multi-renderer + multi-preload build wiring** — the app currently builds exactly one renderer and one preload, and Phase 6 adds a second focusable window with its own renderer entry and its own dedicated preload (D-04). The repo already contains a proven precedent for adding a second build target (the `verify:secret` config adds a second main entry), and electron-vite's `rollupOptions.input` accepts multiple named inputs natively, so this is well-understood — the planner just needs to mirror the existing dev-URL-vs-prod-file branch and point the second window's `webPreferences.preload` at the second `.cjs` output.

**Primary recommendation:** Add a second renderer input (`settings`) and a second preload input (`settings`) to `electron.vite.config.ts`'s existing `rollupOptions.input` maps; create `createSettingsWindow()` mirroring `createOverlayWindow()` with the focus/transparency options inverted, loading the settings HTML via the existing `ELECTRON_RENDERER_URL ? loadURL : loadFile` branch (with the renderer entry name in the path); use the `ulid` npm package (3.0.2, dual ESM/CJS, 9.2M weekly downloads) for IDs; re-key Deepgram by stopping the current gateway and constructing+starting a fresh `DeepgramSttGateway(newKey)` instance; re-key Anthropic by reconstructing the `AnthropicGateway` (or holding it behind a re-keyable reference); and add `getActiveContext` as a 5th constructor parameter to `AiOrchestrator`, swapping `context: undefined` → `context: getActiveContext()` at line 165.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Settings window lifecycle (create/focus/destroy) | Main | — | Main owns all BrowserWindow creation (`overlay-window.manager.ts` precedent); hotkey is a main-side trigger |
| API-key entry form rendering | Settings Renderer | — | Focusable window UI; the deliberate two-way exception (D-04) |
| Key encrypt/decrypt + persistence | Main | — | safeStorage + electron-store are main-only (CLAUDE.md, IN-01); never crosses to renderer plaintext |
| Two-way IPC (getKeys/saveKeys/getContext/saveContext) | Settings Preload → Main `ipcMain.handle` | — | Scoped two-way surface (D-04); main remains the only place touching safeStorage/store |
| Context editor form + dirty indicator | Settings Renderer | — | Standard focusable-window form UX (Claude's discretion) |
| SessionContext store (CRUD, active selection, ULID keys) | Main (repository) | electron-store | By-convention singleton in `index.ts`; data persists under `userData` |
| Active-context → IGroundingContext mapping | Main (repository) | — | `activeAsGrounding()` is pure-mappable, unit-testable |
| Live Deepgram re-key (teardown + reconnect) | Main | DeepgramSttGateway | Reuses the gateway's own connect/reconnect; key stays main-only |
| Live Anthropic re-key (next-call in place) | Main | AnthropicGateway | Re-supply key to a fresh/holder-wrapped gateway; never reads env |
| Context injection into prompt | Main (AiOrchestrator) | prompt-assembler | `getActiveContext()` pulled at each `trigger()`; pure assembler unchanged |

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-10 — do NOT re-litigate)
- **D-01:** Settings window created **lazily on `Ctrl+Alt+S`**; re-press focuses the existing one; close (X/Esc) destroys it. No settings window at launch.
- **D-02:** Hotkey = **`Ctrl+Alt+S`**, `discrete`, added to `HOTKEY_CHORDS`; re-verify against Teams/Zoom/VS Code per the 02-03 protocol with a documented fallback letter.
- **D-03:** **Two tabs (`Keys` / `Context`), `Context` as the default landing tab.**
- **D-04:** Settings window gets its **OWN dedicated preload + scoped two-way IPC** (`getKeys`/`saveKeys`/`getContext`/`saveContext` via `ipcRenderer.invoke` → `ipcMain.handle`). Overlay's one-way preload/contract is NOT modified. `contextIsolation`/`sandbox` stay on.
- **D-05:** Four labeled fields mapping 1:1 to `IGroundingContext`: Notes, Ticket text, Repo snippets, Links (one URL per line → `links[]`). NO new prompt formatting.
- **D-06:** **Explicit Save button** with a dirty indicator; one write per Save (not autosave); save makes that context active immediately (no restart).
- **D-07:** **Keys apply LIVE.** Anthropic: next call uses the new key. Deepgram: live websocket torn down + reconnected with the new key, reusing the existing reconnect path.
- **D-08:** **Key precedence at boot: `safeStorage` wins → `process.env` (loadDotenvFile) fallback → `''`.** Intentionally inverts loadDotenvFile's "real env wins" rule for these two keys only, in the key-resolution layer (loadDotenvFile itself unchanged).
- **D-09:** Store is **ULID-keyed and multi-context-ready**: `{ contexts: ISessionContextDto[]; activeId: string }`; each `ISessionContextDto` has a ULID `id` + the four grounding fields + room for future metadata. v1 UI edits ONE context (no selector, no name field shown).
- **D-10:** Active context reaches the orchestrator via an **injected `getActiveContext()` provider** (pull-on-trigger), mirroring the existing `transcriptBuffer`/`pushAi` constructor injection. At each `trigger()` it reads the latest saved context as `IGroundingContext` and passes it to `assemblePrompt({ mode, span, context })`. Repo exposes `activeAsGrounding()` returning `undefined`/empty when no context exists.

### Claude's Discretion (planner decides)
- Exact electron-store key names / file layout (base64 ciphertext only, never plaintext).
- Settings-window dimensions, styling, tab implementation, dirty indicator, masked/revealable key inputs (a "show/hide key" affordance + "saved ✓" encouraged, not mandated).
- The fallback letter if `Ctrl+Alt+S` collides.
- **ULID generation mechanism** (dependency vs local generator; pure-JS preferred). → *Recommended below: `ulid` npm.*
- Exact `ISessionContextDto` metadata fields beyond `id` + four grounding fields (`name`, `createdAt`, `source`).
- How the Deepgram re-key reconnect is wired (reuse gateway reconnect vs full pipeline rebuild). → *Recommended below: instance swap.*
- Whether the settings window surfaces a "missing key" hint.

### Deferred Ideas (OUT OF SCOPE)
- Multi-context UI (named contexts, create/switch/delete, selector) — schema ships, UI deferred.
- Live Jira/Azure/GitHub URL-fetcher.
- Autosave for the context editor.
- Vision/code-challenge mode + Windows packaging (Phase 7).
- Per-mode / per-context different grounding.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CTX-01 | Context editor (notes/ticket/snippets/links) | Four-field form maps 1:1 to `IGroundingContext` (prompt-assembler.ts:52-61); settings renderer + two-way preload |
| CTX-02 | Local persistence across restarts | electron-store under `userData` (placeholder-secret.service.ts precedent uses `new Store(...)`) |
| CTX-03 | Injected into all modes | Single `getActiveContext()` provider feeds `assemblePrompt` at ai-orchestrator.ts:165 — both modes route through one `trigger()` |
| CTX-04 | Structured ULID-keyed store for future fetcher | `{ contexts: ISessionContextDto[]; activeId }` schema (D-09); `ulid` npm for IDs |
| SET-01 | Separate focusable window | `createSettingsWindow()` mirroring `createOverlayWindow()` inverted; second renderer entry |
| SET-02 | Enter/save both keys, applied live | safeStorage two-key store + D-07 live re-key (Deepgram instance swap, Anthropic reconstruction) |
| SET-04 | Context editor reachable from settings window | `Context` tab is the landing tab in the same window opened by `Ctrl+Alt+S` (D-03) |
| AI-06 | Every AI call grounded in active context + transcript span | `context: getActiveContext()` at ai-orchestrator.ts:165; observable via the grounding-vs-Phase-5 criterion |

## Standard Stack

### Core (existing, unchanged)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| electron | 35.7.5 (pinned) | App shell, BrowserWindow, safeStorage, ipcMain | Already pinned & on-machine verified |
| electron-vite | 5.0.0 | Multi-process build (main/preload/renderer) | Native multi-input `rollupOptions.input` support |
| electron-store | 11.0.2 (ESM-only) | JSON persistence under `userData` | Already a dependency; used by placeholder-secret.service.ts |
| react / react-dom | 19.2.7 | Settings window UI | Renderer already React; reuse for the settings renderer |
| @vitejs/plugin-react | 4.3.4 | React HMR for the settings renderer | Already wired in the renderer config block |

### Supporting (NEW dependency)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ulid` [VERIFIED: npm registry] | 3.0.2 | Pure-JS ULID generation for `ISessionContextDto.id` (CTX-04/D-09) | Use `import { ulid } from 'ulid'` in the context repository (main process) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ulid` npm | `ulidx` (2.4.1) | `ulidx` is a TS-first rewrite (362K weekly dl, since 2021) with the same dual ESM/CJS shape; perfectly viable. `ulid` is the canonical implementation (9.2M weekly dl, since 2016) — pick `ulid` for ubiquity, `ulidx` only if you want its richer typed API. Both `[OK]` on slopcheck. |
| `ulid` npm | ~15-line local monotonic generator | A local generator avoids a dependency but you must correctly implement Crockford base32 + the monotonic-within-millisecond increment to keep IDs lexicographically sortable. For a single-user app where IDs are generated one-at-a-time on Save, monotonicity-within-ms is irrelevant, so a local generator is defensible — but `ulid` is 69KB, zero native build, and removes the correctness burden. **Recommend the library.** |
| New `ipcMain.handle` two-way surface | Reuse overlay's one-way push channels | Overlay contract is locked one-way (IN-01); the settings window NEEDS request/response (getKeys returns a value). `invoke`/`handle` is the correct pattern and is the scoped D-04 exception. |

**Installation:**
```bash
npm install ulid
```

**Version verification (run 2026-06-19):**
- `npm view ulid version` → `3.0.2`; created 2016-08-01; repo `github.com/ulid/javascript`; `type: module`, dual `module`/`main` (CJS) entry points → safe under the ESM main bundle.
- `npm view ulidx version` → `2.4.1`; created 2021-06-05; repo `github.com/perry-mitchell/ulidx`; also dual ESM/CJS.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| ulid | npm | ~10 yrs (2016) | 9.26M/wk | github.com/ulid/javascript | [OK] | **Approved (recommended)** |
| ulidx | npm | ~5 yrs (2021) | 362K/wk | github.com/perry-mitchell/ulidx | [OK] | Approved (alternative) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

slopcheck 0.6.1 ran via `slopcheck scan` against a temp `package.json` listing both packages — both returned `[OK]`. No `postinstall` scripts of concern (pure-JS, no native build — matches the project's "no native-build appetite").

## Architecture Patterns

### System Architecture Diagram

```
                      Ctrl+Alt+S (uiohook, discrete)
                                 │
                                 ▼
                  ┌──────────────────────────────┐
   MAIN PROCESS   │  open-settings handler        │
                  │  (in buildHandlers, index.ts) │
                  └──────────────┬────────────────┘
                                 │ create-or-focus
                                 ▼
                  ┌──────────────────────────────┐
                  │  createSettingsWindow()       │  ← mirrors createOverlayWindow()
                  │  focusable:true, framed,      │     inverted (focusable/transparent/frame)
                  │  preload: settings.cjs        │
                  └──────────────┬────────────────┘
                                 │ loadURL(dev) / loadFile(prod)
                                 ▼
   SETTINGS       ┌──────────────────────────────┐
   RENDERER       │  Settings React app           │
   (focusable)    │  Tabs: [Context*] [Keys]      │
                  │  window.settingsApi.*         │  ← settings preload contextBridge
                  └──────────────┬────────────────┘
                     invoke      │      ▲ value
                  ┌──────────────▼──────┴─────────┐
   MAIN           │  ipcMain.handle(...)          │
                  │  getKeys/saveKeys/            │
                  │  getContext/saveContext       │
                  └───┬───────────────────┬───────┘
                      │                   │
          ┌───────────▼──────┐   ┌────────▼─────────────┐
          │ KeyStore         │   │ SessionContextRepo   │
          │ safeStorage      │   │ electron-store       │
          │ (2 ciphertexts)  │   │ {contexts[],activeId}│
          └───┬──────────┬───┘   └──────────┬───────────┘
              │ saveKeys │                  │ saveContext (D-06: also sets active)
   re-key live│          │                  │
   ┌──────────▼───┐  ┌───▼──────────┐       │ activeAsGrounding()
   │ Deepgram     │  │ Anthropic    │       │ (pull-on-trigger)
   │ swap gateway │  │ re-key gw    │       ▼
   │ instance +   │  │ (next call)  │   ┌──────────────────────────┐
   │ start()      │  └──────────────┘   │ AiOrchestrator.trigger()  │
   └──────────────┘                     │ getActiveContext() →      │
                                        │ assemblePrompt({mode,span,│
                                        │   context}) [line 165]    │
                                        └───────────────────────────┘
```

Trace the primary flow: user presses `Ctrl+Alt+S` → main creates the focusable settings window → user pastes context on the Context tab and clicks Save → `invoke('saveContext', dto)` → `ipcMain.handle` writes to electron-store and sets it active → next AI hotkey trigger pulls it via `getActiveContext()` → grounded prompt assembled at line 165.

### Pattern 1: electron-vite second renderer + second preload entry
**What:** Add named inputs to the existing `rollupOptions.input` maps; electron-vite builds each into `out/renderer/<name>.html` (renderer) and `out/preload/<name>.cjs` (preload).
**When to use:** Adding the settings window's renderer and dedicated preload (D-04).
**Source:** electron-vite `rollupOptions.input` accepts a `Record<name, path>` (verified — repo already uses `{ index: ... }` in all three blocks; `electron.vite.verify.config.ts` proves a second build target works). [CITED: electron.vite.config.ts; electron.vite.verify.config.ts]

The current config to mirror (`electron.vite.config.ts`):
```typescript
preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
        rollupOptions: {
            input: {
                index: resolve('src/preload/index.ts'),
                settings: resolve('src/preload/settings.ts'),   // NEW — emits out/preload/settings.cjs
            },
            output: { format: 'cjs', entryFileNames: '[name].cjs' },  // already forces .cjs per name
        },
    },
},
renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    build: {
        rollupOptions: {
            input: {
                index: resolve('src/renderer/index.html'),
                settings: resolve('src/renderer/settings.html'),  // NEW — emits out/renderer/settings.html
            },
        },
    },
    plugins: [react()],
},
```

**Critical detail — the `root: 'src/renderer'` + multi-input interaction.** Because the renderer block sets `root: 'src/renderer'`, both HTML inputs must live under `src/renderer/`. The existing `index.html` is at `src/renderer/index.html` with `<script src="/src/main.tsx">`. The settings HTML should be `src/renderer/settings.html` with its own `<script src="/src/settings.tsx">` and its own root div + CSP `<meta>` (mirroring index.html:7). With multiple HTML inputs under one root, Vite produces `out/renderer/index.html` and `out/renderer/settings.html`.

**Critical detail — preload `.cjs` output is already correct for a second entry.** The preload block already sets `output.format: 'cjs'` + `entryFileNames: '[name].cjs'`, so adding a `settings` input automatically emits `out/preload/settings.cjs` with no other change. The overlay loads `../preload/index.cjs` (overlay-window.manager.ts:314); the settings window loads `../preload/settings.cjs`.

### Pattern 2: dev-URL-vs-prod-file load for the second window
**What:** The overlay uses `process.env.ELECTRON_RENDERER_URL` (injected by electron-vite dev) → `loadURL`, else `loadFile('../renderer/index.html')` (overlay-window.manager.ts:367-372). The settings window mirrors this but targets the **settings** entry.
**Source:** [CITED: overlay-window.manager.ts:367-372]

```typescript
// In createSettingsWindow():
if (process.env.ELECTRON_RENDERER_URL) {
    void settingsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/settings.html`);
} else {
    void settingsWindow.loadFile(join(currentDirectory, '../renderer/settings.html'));
}
```

**Verification note (MEDIUM confidence — must be confirmed at build time):** With electron-vite multi-HTML-input renderers, the dev server serves each HTML entry by its filename relative to the renderer `root`. The overlay (the default `index`) loads at the bare `ELECTRON_RENDERER_URL`; the settings entry is served at `ELECTRON_RENDERER_URL/settings.html`. The planner MUST smoke-test the dev path (`npm run dev`, press `Ctrl+Alt+S`, confirm the settings HTML loads with HMR) AND the prod path (`npm run build` then `npm run preview`) — this is the one spot where the multi-renderer URL shape is not 100% verifiable from static config alone. The prod `loadFile` path is unambiguous (`out/renderer/settings.html` exists after build). [ASSUMED: dev-server path shape for secondary HTML entry]

### Pattern 3: `createSettingsWindow()` — overlay inverted
**What:** A new factory in `overlay-window.manager.ts` (or a new `settings-window.manager.ts`) mirroring `createOverlayWindow()` (overlay-window.manager.ts:297) with the existential options inverted.
**Source:** [CITED: overlay-window.manager.ts:297-375]

| Option | Overlay | Settings window |
|--------|---------|-----------------|
| `focusable` | `false` | `true` (it hosts text inputs) |
| `transparent` | `true` | `false` |
| `frame` | `false` | `true` (normal frame, X button) |
| `skipTaskbar` | `true` | `false` (or true — discretion) |
| `resizable` | `false` | `true` (discretion) |
| `setIgnoreMouseEvents` | called (click-through) | NOT called |
| `setContentProtection` | re-applied every show | **do NOT apply** (user needs to see/screenshot it; not an overlay) |
| `setAlwaysOnTop('screen-saver')` | yes | optional/no |
| blur/display re-assert listeners | yes | not needed |
| `webPreferences.preload` | `../preload/index.cjs` | `../preload/settings.cjs` |
| `contextIsolation` / `sandbox` | true / true | **true / true (keep)** |
| `backgroundThrottling` | `false` | default (it can throttle when hidden) |
| reveal | `showInactive()` only | normal `show()` / `focus()` — it SHOULD take focus |

**D-01 lifecycle:** Hold a module-level `settingsWindow: BrowserWindow | undefined`. The `open-settings` handler: if defined and not destroyed → `settingsWindow.show()` + `settingsWindow.focus()`; else create, show, and wire `window.on('closed', () => { settingsWindow = undefined; })` so the next press recreates it.

### Pattern 4: scoped two-way IPC (D-04)
**What:** A settings-only preload exposing a typed `contextBridge` namespace over `ipcRenderer.invoke`; matching `ipcMain.handle` in main.
**Source:** [CITED: preload/index.ts:86-158 — the one-way pattern this extends, plus the `process.contextIsolated` guard at :157-162]

The settings preload (`src/preload/settings.ts`) should reuse the existing preload's `process.contextIsolated` guard (preload/index.ts:157-162 throws if contextIsolation is off). Expose:
```typescript
const settingsApi = {
    getKeys(): Promise<{ deepgram: boolean; anthropic: boolean }> { return ipcRenderer.invoke('settings:get-keys'); },
    saveKeys(keys: { deepgram?: string; anthropic?: string }): Promise<void> { return ipcRenderer.invoke('settings:save-keys', keys); },
    getContext(): Promise<ISessionContextDto> { return ipcRenderer.invoke('settings:get-context'); },
    saveContext(dto: ISessionContextDto): Promise<void> { return ipcRenderer.invoke('settings:save-context', dto); },
};
```
**Security rule (CLAUDE.md / D-04):** `getKeys` returns only **presence booleans**, never the decrypted key — the plaintext key never crosses IPC, never reaches the renderer. `saveKeys` accepts plaintext (the user typed it) flowing renderer→main once, where main encrypts it; that is the only direction a key value travels and it is one-way inbound. Register `ipcMain.handle` once in `index.ts` (by-convention singleton wiring site).

### Pattern 5: live re-key (D-07)
**Deepgram (instance swap — recommended least-invasive path):** `DeepgramSttGateway`'s key is `private readonly apiKey` set only in the constructor (deepgram-stt.gateway.ts:80) and read only inside `connect()` when it constructs `new DeepgramClient({ apiKey })` (line 135). There is **no setter** and the key is captured per-connection. The cleanest re-key is therefore: `await sttGateway.stop()` (clears timers, tears down the socket, sets `disconnected` — deepgram-stt.gateway.ts:98-105) → construct a fresh `new DeepgramSttGateway(newKey)` → re-attach the SAME three event handlers (`transcript`/`connection-state-change`/`error`) that `wireSttPipeline` attaches (index.ts:172-191) → `await newGateway.start()`. **The audio capture seam makes this clean:** `AudioCaptureService`'s callback calls `gateway.sendAudio(pcm)` (index.ts:205) — if the gateway reference is held in a re-pointable variable (not captured by value in the closure), the capture pipeline keeps running and just feeds the new gateway. **Refactor needed:** extract the gateway-wiring (the `gateway.on(...)` block + the `sendAudio` call target) so it can be re-pointed at a new instance. The least-invasive approach: keep the gateway in the module-level `sttGateway` and have the capture callback call `sttGateway?.sendAudio(pcm)` rather than closing over a local `gateway` const. [CITED: deepgram-stt.gateway.ts:80,98-105,135; index.ts:165-216]

**Anthropic (next-call re-key):** `AnthropicGateway` constructs `new Anthropic({ apiKey })` ONCE in its constructor (anthropic-ai.gateway.ts:37) and `this.client` is reused for every `stream()`. There is no per-call key read. Two options: (a) reconstruct `new AnthropicGateway(newKey)` and re-point the orchestrator's gateway reference — but the orchestrator holds the gateway as `private readonly gateway` (ai-orchestrator.ts:116) and wires its event handlers in the constructor (`wireGatewayHandlers`), so swapping the instance means re-wiring; (b) add a re-key method to `AnthropicGateway` that does `this.client = new Anthropic({ apiKey })` (drop `readonly` on `client`) and `this.apiKey = newKey` — keeps the SAME gateway instance and the SAME wired handlers, so the orchestrator is untouched. **Recommend (b)** — it preserves the orchestrator's `readonly gateway` and avoids re-wiring; the next `stream()` call uses the new client. This is "the gateway is re-keyed in place" exactly as D-07 phrases it. [CITED: anthropic-ai.gateway.ts:29,35-38,51]

### Pattern 6: context injection (D-10)
**What:** Add a 5th constructor parameter `getActiveContext: () => IGroundingContext | undefined` to `AiOrchestrator`; at line 165 swap `context: undefined` → `context: this.getActiveContext()`.
**Source:** [CITED: ai-orchestrator.ts:115-122 (constructor), :165 (assemblePrompt call); index.ts:243 (wiring site)]

```typescript
// ai-orchestrator.ts constructor — add the 5th param exactly like pushAi:
public constructor(
    private readonly gateway: IAiGateway,
    private readonly transcriptBuffer: TranscriptBuffer,
    private readonly history: AiHistory,
    private readonly pushAi: (event: IAiPushEvent) => void,
    private readonly getActiveContext: () => IGroundingContext | undefined   // NEW (D-10)
) { ... }

// ai-orchestrator.ts:165 — the ONLY change to trigger():
const { system, userContent } = assemblePrompt({ mode, span, context: this.getActiveContext() });
```
```typescript
// index.ts:243 — the wiring site, add the provider closure exactly like (event) => pushAi(...):
const contextRepo = new SessionContextRepository();   // by-convention singleton (D-09)
aiOrchestrator = new AiOrchestrator(
    aiGateway, buffer, aiHistory,
    (event) => pushAi(window, event),
    () => contextRepo.activeAsGrounding()              // NEW (D-10) — pull-on-trigger
);
```
`formatContext()` already returns `''` for `undefined`/empty (prompt-assembler.ts:91-115), so a no-context session is byte-for-byte identical to Phase 5 — the seam fails safe. [CITED: prompt-assembler.ts:91-115]

### Anti-Patterns to Avoid
- **Putting inputs on the overlay** — the overlay is `focusable:false` (locked OVL-02); it physically cannot host a text input. This is the whole reason the phase exists.
- **Returning decrypted keys to the renderer** — `getKeys` returns presence booleans only; the plaintext key never crosses IPC outbound.
- **Reading the key from `process.env` inside a gateway** — both gateways take the key by constructor only and never read env (anthropic-ai.gateway.ts, deepgram-stt.gateway.ts comments are explicit). The re-key path re-SUPPLIES the key; it does not make the gateway read env.
- **Applying `setContentProtection(true)` to the settings window** — that is an overlay-only existential behavior; the settings window is a normal visible window.
- **Modifying the overlay's one-way preload/contract** — D-04 scopes the two-way surface to a SEPARATE settings preload; the overlay's IN-01 boundary is untouched.
- **Mutating loadDotenvFile** — D-08's "safeStorage wins over .env for these two keys" lives in the key-resolution layer, NOT in `loadDotenvFile` (which keeps its "real env always wins" rule for everything else).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lexicographically-sortable unique IDs | Custom timestamp+random ID scheme | `ulid` npm | Crockford base32 + monotonic-within-ms is fiddly to get right; 69KB, no native build, 9.2M weekly downloads |
| Key encryption at rest | Custom crypto / storing plaintext | Electron `safeStorage` (DPAPI) | OS-backed, already proven in placeholder-secret.service.ts |
| Request/response IPC | Manual event-pair correlation over `send`/`on` | `ipcRenderer.invoke` / `ipcMain.handle` | Built-in promise-based round-trip; the correct two-way primitive |
| Second window build | Manual HTML copy / hand-rolled bundler step | electron-vite `rollupOptions.input` multi-entry | Native multi-input support; the verify config already proves a 2nd target works |
| SSE/stream parsing for re-keyed Anthropic | Re-implement streaming | Existing `AnthropicGateway.stream()` | Re-key reuses the whole gateway; only the client's apiKey changes |
| Deepgram reconnect on re-key | New reconnect logic | `DeepgramSttGateway.stop()` + fresh instance `.start()` | The gateway already owns connect/reconnect/backoff/keep-alive |

**Key insight:** Phase 6 writes almost no new *mechanism*. Every hard problem (encryption, reconnect, streaming, prompt formatting, injection) already has a working, tested implementation in the repo. The work is wiring a second window's build + IPC and a small persistence repository, then flipping `context: undefined` to a live provider.

## Runtime State Inventory

> Phase 6 is additive (a new window + a new store), not a rename/refactor. This section is included because it introduces NEW persisted state and a NEW key-source precedence — both of which have runtime-state implications worth recording.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | NEW: electron-store gains a `contexts` array + `activeId` (D-09) and TWO key ciphertexts (Deepgram, Anthropic). The existing placeholder `secretCiphertext` key (placeholder-secret.service.ts:16) is from Phase 1's proof and is unrelated — leave it or retire it; it does not collide with the real keys. | Choose distinct store key names (e.g. `deepgramKeyCiphertext`, `anthropicKeyCiphertext`, `sessionContexts`, `activeContextId`); do NOT reuse `secretCiphertext` |
| Live service config | NEW: the running Deepgram websocket holds a key in memory (the constructor arg). A re-key tears it down and reconnects — no external service registration to migrate. | Instance swap on saveKeys (Pattern 5) |
| OS-registered state | The new `Ctrl+Alt+S` chord registers through `HotkeyRegistrarService` like every other chord — no separate OS registration (uiohook is a passive hook). | Add to `HOTKEY_CHORDS` + a handler in `buildHandlers`; re-run the 02-03 conflict test |
| Secrets/env vars | `process.env.DEEPGRAM_API_KEY` / `process.env.ANTHROPIC_API_KEY` (from `.env` via loadDotenvFile) become the FALLBACK behind safeStorage (D-08). The `.env` file is unchanged; its precedence drops to second. No env var is renamed. | Key-resolution layer reads safeStorage first, then `process.env`, then `''` |
| Build artifacts | NEW build outputs: `out/preload/settings.cjs` and `out/renderer/settings.html` after adding the second inputs. The existing `out/renderer/index.html` + `out/preload/index.cjs` are unchanged. | Confirm both appear after `npm run build`; the prod `loadFile` paths depend on them |

## Common Pitfalls

### Pitfall 1: The dev-server URL for the second renderer entry
**What goes wrong:** `loadURL(process.env.ELECTRON_RENDERER_URL)` (bare) loads the DEFAULT `index` entry; the settings window loaded the same way would show the overlay HTML.
**Why it happens:** electron-vite multi-HTML renderers are served by filename under the renderer root; the bare URL resolves to `index.html`.
**How to avoid:** Append the entry filename: `loadURL(\`${ELECTRON_RENDERER_URL}/settings.html\`)`. Smoke-test in `npm run dev` before assuming the path. The prod `loadFile('../renderer/settings.html')` path is unambiguous.
**Warning signs:** Pressing `Ctrl+Alt+S` shows the transparent overlay UI in a framed window, or a blank window.

### Pitfall 2: safeStorage availability timing
**What goes wrong:** `safeStorage.isEncryptionAvailable()` returns `false` if called before `app.whenReady()`.
**Why it happens:** On Windows, DPAPI availability is only true after the `ready` event (documented in placeholder-secret.service.ts:32-34).
**How to avoid:** All key store reads/writes happen inside `ipcMain.handle` (post-ready) or in the boot-time resolution that already runs inside `app.whenReady().then(...)` (index.ts:219). Guard with `isEncryptionAvailable()` and fall back to the env key / `''` if false (mirrors placeholder-secret.service.ts:37-39).
**Warning signs:** Keys silently fail to persist; `decryptString` throws.

### Pitfall 3: re-key reconnect must re-attach event handlers
**What goes wrong:** Swapping in a fresh `DeepgramSttGateway` instance but forgetting to re-attach the `transcript`/`connection-state-change`/`error` listeners → transcripts stop appearing after a key save.
**Why it happens:** Event handlers are bound to the OLD instance in `wireSttPipeline` (index.ts:172-191); a new EventEmitter has no listeners.
**How to avoid:** Extract the handler-attach block into a reusable function called on both boot and re-key, OR re-point a module-level `sttGateway` and have the handlers/capture target it indirectly. Recommend extracting `attachSttGatewayHandlers(gateway, window, buffer, ...)`.
**Warning signs:** Live transcript freezes after saving a Deepgram key; connection state stuck.

### Pitfall 4: dropping `readonly` on AnthropicGateway.client for in-place re-key
**What goes wrong:** `client` is `private readonly` (anthropic-ai.gateway.ts:29); an in-place re-key needs to reassign it.
**Why it happens:** The in-place re-key (Pattern 5b) reassigns `this.client = new Anthropic({ apiKey })`.
**How to avoid:** Drop `readonly` from `client` and add a `rekey(newKey: string): void` method with a TSDoc note that it never logs the key. Alternatively reconstruct the gateway and re-wire the orchestrator (more invasive). Recommend the in-place method.
**Warning signs:** TS2540 "Cannot assign to 'client' because it is a read-only property."

### Pitfall 5: electron-store@11 is ESM-only
**What goes wrong:** A CommonJS import of electron-store fails.
**Why it happens:** electron-store@11 is ESM-only (CLAUDE.md). The main bundle is ESM (electron-vite default), so `import Store from 'electron-store'` works (placeholder-secret.service.ts:2 proves it).
**How to avoid:** Keep the context repository in the ESM main bundle; do not import electron-store from a CJS context. The `externalizeDepsPlugin()` keeps it external and resolves it at runtime.
**Warning signs:** `ERR_REQUIRE_ESM` at runtime.

### Pitfall 6: links-textarea parsing edge cases
**What goes wrong:** Splitting the Links textarea naively produces empty strings (trailing newline) or whitespace-only entries → `formatContext` renders blank link lines.
**Why it happens:** `value.split('\n')` keeps empty lines.
**How to avoid:** A pure parser: `text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)`. Make it a `.utility.ts` so it is unit-tested (Validation Architecture). The reverse (joining `links[]` back into the textarea for editing) is `links.join('\n')`.
**Warning signs:** Empty `Links:` block in the prompt; `links` array with `''` entries.

## Code Examples

### `ISessionContextDto` schema (D-09, CTX-04)
```typescript
// Source: derived from prompt-assembler.ts:52-61 IGroundingContext + D-09
/** A single named session context; multi-context-ready though v1 UI edits one. */
export interface ISessionContextDto {
    /** ULID primary key (CTX-04/D-09). */
    id: string;
    /** Free-form project notes (CTX-01). */
    notes?: string;
    /** Ticket / story text (CTX-02). */
    ticketText?: string;
    /** Repo snippets (CTX-03). */
    repoSnippets?: string;
    /** Reference links, one per line in the UI, parsed to an array. */
    links?: string[];
    /** Future-fetcher metadata (CTX-04 seam; not shown in v1 UI). */
    name?: string;
    source?: 'manual' | 'jira' | 'azure' | 'github';
    createdAt?: string;  // ISO-8601
}

/** The persisted store shape (D-09). */
export interface ISessionContextStore {
    contexts: ISessionContextDto[];
    activeId: string;
}
```

### `activeAsGrounding()` mapping (D-10) — pure, unit-testable
```typescript
// Maps the active ISessionContextDto -> IGroundingContext (the four fields only), or undefined.
public activeAsGrounding(): IGroundingContext | undefined {
    const active = this.contexts.find((c) => c.id === this.activeId);
    if (active === undefined) {
        return undefined;   // -> formatContext returns '' -> identical to Phase 5
    }
    return {
        notes: active.notes,
        ticketText: active.ticketText,
        repoSnippets: active.repoSnippets,
        links: active.links,
    };
}
```

### Boot key resolution (D-08) — pure, unit-testable
```typescript
// Source: D-08 precedence. Pure so it is unit-testable without safeStorage/electron-store.
/** safeStorage key (if present) wins -> else process.env fallback -> else ''. */
export function resolveApiKey(savedDecrypted: string | undefined, envValue: string | undefined): string {
    if (savedDecrypted !== undefined && savedDecrypted.length > 0) {
        return savedDecrypted;
    }
    return envValue ?? '';
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single renderer + single preload | Multi-entry `rollupOptions.input` | n/a (electron-vite supports it natively) | Add named inputs; no plugin change |
| Keys from `process.env` only (Phase 4/5) | safeStorage-first, env fallback (D-08) | This phase | Saved UI key becomes source of truth; `.env` stays a dev fallback |
| `context: undefined` (Phase 5 D-13) | `context: getActiveContext()` (D-10) | This phase | Completes AI-06 grounding; no signature change |

**Deprecated/outdated:** none relevant. The placeholder `secretCiphertext` store key (Phase 1) is superseded by the two real key ciphertexts but does not need active removal.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The electron-vite dev server serves the secondary HTML entry at `${ELECTRON_RENDERER_URL}/settings.html` | Pattern 2 / Pitfall 1 | LOW-MEDIUM — if the path differs, the dev settings window is blank/wrong; fixed by smoke-testing `npm run dev` and adjusting the URL suffix. Prod `loadFile` is unaffected (unambiguous). Planner MUST add a dev+prod smoke step. |

**All other claims are [CITED] against repo files or [VERIFIED] against the npm registry.**

## Open Questions

1. **Exact dev-server URL suffix for the second renderer entry**
   - What we know: prod `loadFile('../renderer/settings.html')` is correct; the overlay's dev pattern is `loadURL(ELECTRON_RENDERER_URL)`.
   - What's unclear: whether the dev suffix is `/settings.html` exactly (vs a base-path quirk under `root: 'src/renderer'`).
   - Recommendation: Planner adds an explicit dev+prod smoke task (open `Ctrl+Alt+S`, confirm settings HTML loads with HMR in dev and from file in prod). This is the only genuine unknown in the phase.

2. **`Ctrl+Alt+S` conflict on the target machine**
   - What we know: `S` is outside the conflict-tested set; D-02 mandates a re-check per the 02-03 protocol with a fallback letter.
   - What's unclear: whether Teams/Zoom/VS Code claim `Ctrl+Alt+S` on this machine.
   - Recommendation: Planner schedules the on-machine re-check (like every prior new chord); document a fallback letter.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Electron safeStorage (DPAPI) | Key encryption | ✓ (proven Phase 1) | electron 35.7.5 | env key / `''` if `isEncryptionAvailable()` false |
| electron-store | Context + ciphertext persistence | ✓ | 11.0.2 | — |
| `ulid` npm | ULID generation | ✗ (not yet installed) | 3.0.2 (to install) | local generator (discouraged) |
| uiohook-napi | `Ctrl+Alt+S` chord | ✓ (proven Phase 2) | 1.5.5 | globalShortcut fallback (already wired) |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** `ulid` (install via `npm install ulid`; local generator is the documented fallback if a dependency is undesirable).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 |
| Config file | `vitest.config.ts` (`environment: 'node'`, `include: ['src/**/*.test.ts']`) |
| Quick run command | `npx vitest run src/main/<file>.test.ts` |
| Full suite command | `npm test` (= `vitest run`) |

Co-located `*.test.ts` next to source (15 existing test files confirm the convention, e.g. `prompt-assembler.test.ts`, `ai-orchestrator.test.ts`, `placeholder-secret.service.test.ts`).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CTX-04 | `activeAsGrounding()` maps active DTO → IGroundingContext (4 fields); returns `undefined` when no active context | unit | `npx vitest run src/main/context/session-context.repository.test.ts` | ❌ Wave 0 |
| CTX-01 | Links textarea parser: split/trim/filter-empty; round-trips with `links.join('\n')` | unit | `npx vitest run src/main/context/parse-links.utility.test.ts` | ❌ Wave 0 |
| SET-02/D-08 | `resolveApiKey(saved, env)` precedence: saved wins → env → `''` | unit | `npx vitest run src/main/config/resolve-api-key.utility.test.ts` | ❌ Wave 0 |
| AI-06/D-10 | Orchestrator passes `getActiveContext()` result into `assemblePrompt`; empty/undefined context yields Phase-5-identical prompt | unit (extend) | `npx vitest run src/main/ai/ai-orchestrator.test.ts` | ✅ (extend) |
| AI-06/D-05 | `formatContext` renders the four blocks when filled | unit (exists) | `npx vitest run src/main/ai/prompt-assembler.test.ts` | ✅ (covered) |
| SET-02/D-07 | safeStorage two-key round-trip (encrypt→store base64→decrypt) | integration | manual `verify:secret`-style script (post-`app.ready`) | ❌ Wave 0 |
| SET-01 | Settings window opens focusable by hotkey; overlay keeps focus discipline | integration (manual) | on-machine: press `Ctrl+Alt+S`, confirm window focusable + overlay unaffected | manual |
| SET-02/D-07 | Live Deepgram reconnect on key save (no restart) | integration (manual) | on-machine: save a new Deepgram key, confirm transcript resumes | manual |
| AI-06 | Grounding observably improves vs Phase 5 | integration (manual) | on-machine: with vs without context, compare answer relevance | manual |

### Sampling Rate
- **Per task commit:** `npx vitest run src/main/<touched-file>.test.ts` (quick, sub-second).
- **Per wave merge:** `npm test` (full suite green).
- **Phase gate:** Full suite green + the manual integration checks (window focus, safeStorage round-trip, live re-key, observable grounding) before `/gsd:verify-work`.

### Pure-unit vs integration split (per CONTEXT focus area 6)
- **Pure-unit (Vitest, co-located, NO Electron):** `activeAsGrounding()` mapping + active-resolution; `resolveApiKey()` precedence; links-textarea parser; orchestrator context-passing (extend the existing fake-gateway test in `ai-orchestrator.test.ts`).
- **Integration-level (require Electron/live resources, validate pragmatically on Windows):** safeStorage round-trip (needs `app.ready` — use a `verify:secret`-style headless script per `electron.vite.verify.config.ts`); live BrowserWindow creation + IPC `invoke`/`handle` (on-machine manual); live Deepgram websocket reconnect on re-key (on-machine manual, observe transcript resumes); observable grounding improvement (on-machine human-judged).

### Wave 0 Gaps
- [ ] `src/main/context/session-context.repository.test.ts` — covers CTX-04 (mapping + active-resolution)
- [ ] `src/main/context/parse-links.utility.test.ts` — covers CTX-01 (links parsing)
- [ ] `src/main/config/resolve-api-key.utility.test.ts` — covers SET-02/D-08 (key precedence)
- [ ] Extend `src/main/ai/ai-orchestrator.test.ts` — assert `getActiveContext()` result reaches `assemblePrompt` (covers AI-06/D-10)
- [ ] Headless safeStorage two-key round-trip script (mirror `scripts/verify-secret.ts` + `electron.vite.verify.config.ts`) — covers SET-02 encrypt/decrypt
- [ ] No new framework install needed (Vitest already present)

## Security Domain

> `security_enforcement` config key not present in this project; the project's own CLAUDE.md mandates secret-boundary discipline, so security is treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth; API keys are credentials to external services, not app logins |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | Single-user local app |
| V5 Input Validation | yes | Links textarea parsed/trimmed; key strings trimmed; DTO shape validated before store write |
| V6 Cryptography | yes | safeStorage (DPAPI) — NEVER hand-roll; ciphertext-only at rest (placeholder-secret.service.ts precedent) |
| V7 (Secret Management / logging) | yes | Keys never logged, never IPC'd in plaintext outbound, never committed (CLAUDE.md, gateway TSDoc) |

### Known Threat Patterns for Electron + safeStorage
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Plaintext key reaching the renderer | Information Disclosure | `getKeys` returns presence booleans only; decrypt happens in main, value never sent to renderer |
| Key in logs / error payloads | Information Disclosure | `sanitizeAiError` already strips SDK error bodies (anthropic-ai.gateway.ts:93-97); never log the key on re-key |
| Plaintext key on disk | Information Disclosure | safeStorage encrypt → store base64 ciphertext only (never the plaintext) |
| Renderer XSS reaching Node | Elevation of Privilege | `contextIsolation:true` + `sandbox:true` on the settings window (kept); preload throws if contextIsolation off |
| Renderer→main arbitrary IPC | Tampering | Only four named `ipcMain.handle` channels; validate the saveContext DTO shape before persisting |
| CSP on settings HTML | Tampering/Injection | Mirror index.html:7 CSP `<meta>` on settings.html (`default-src 'self'; script-src 'self'`) |

## Sources

### Primary (HIGH confidence) — repo code (cited inline)
- `electron.vite.config.ts` — multi-input `rollupOptions.input` (three blocks), preload `.cjs` output forcing, renderer `root`
- `electron.vite.verify.config.ts` — proven second-build-target precedent (separate `outDir` + input)
- `src/main/overlay-window.manager.ts:297-375` — `createOverlayWindow()` template + dev/prod load branch (:367-372)
- `src/main/index.ts` — gateway construction sites (Deepgram :165, Anthropic :241, orchestrator :243), `wireSttPipeline` (:162-217), `loadDotenvFile` (:223), `buildHandlers` (:69-124)
- `src/main/ai/ai-orchestrator.ts:115-122,165` — constructor injection + the `assemblePrompt({context: undefined})` swap point
- `src/main/ai/prompt-assembler.ts:52-61,91-133` — `IGroundingContext`, `formatContext` (empty→`''`), `assemblePrompt`
- `src/main/placeholder-secret.service.ts` — safeStorage encrypt→base64→decrypt round-trip
- `src/main/ai/anthropic-ai.gateway.ts:29,35-38,51` — client constructed once with key; re-key approach
- `src/main/stt/deepgram-stt.gateway.ts:80,98-105,135` — key captured in constructor, read in `connect()`; `stop()` teardown
- `src/main/hotkey-registrar.service.ts:53-105` — `HOTKEY_CHORDS` + the add-a-chord pattern
- `src/preload/index.ts:86-162` — one-way contextBridge + `process.contextIsolated` guard
- `src/renderer/index.html`, `src/renderer/src/main.tsx` — renderer entry shape to mirror for settings
- `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts` — build/typecheck/test wiring

### Secondary (MEDIUM confidence) — npm registry (verified 2026-06-19)
- `npm view ulid` → 3.0.2, created 2016, repo github.com/ulid/javascript, dual ESM/CJS, 9.26M weekly downloads
- `npm view ulidx` → 2.4.1, created 2021, repo github.com/perry-mitchell/ulidx, dual ESM/CJS, 362K weekly downloads
- `slopcheck scan` (0.6.1) → both `[OK]`

### Tertiary (LOW confidence — flagged for validation)
- electron-vite dev-server URL shape for a secondary HTML entry (A1) — must be smoke-tested in `npm run dev`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against the installed package.json and npm registry
- Architecture (window/IPC/re-key/injection): HIGH — every seam cited against actual repo lines; line numbers confirmed (orchestrator :165, constructor :115-122, gateways :165/:241/:243)
- ULID choice: HIGH — registry-verified, slopcheck `[OK]`
- electron-vite second-renderer dev URL: MEDIUM — config shape is certain; the dev-server URL suffix needs a one-time smoke test (A1, Open Question 1)
- Pitfalls/validation: HIGH — derived directly from the cited code

**Research date:** 2026-06-19
**Valid until:** 2026-07-19 (stable stack; electron/electron-vite pinned)
