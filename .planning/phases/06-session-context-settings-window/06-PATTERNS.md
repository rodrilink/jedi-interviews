# Phase 6: Session Context + Settings Window - Pattern Map

**Mapped:** 2026-06-19
**Files analyzed:** 13 (8 new, 5 modified)
**Analogs found:** 13 / 13 (every new/modified file has a concrete in-repo analog)

> Phase 6 is a wiring phase. Every hard mechanism (safeStorage round-trip, BrowserWindow creation, contextBridge preload, gateway construction, prompt injection seam, hotkey chord registration, pure-utility + co-located test, electron-vite multi-input build) already exists in this repo. The executor copies an existing shape and inverts/extends it — there is almost no net-new mechanism. **No TSyringe** (main has no DI container; everything is a by-convention singleton instantiated once in `index.ts`). **safeStorage ciphertext-only, main-process only, never logged, never over IPC.** **The overlay's one-way preload/contract is NOT touched** — the settings window's two-way preload is a scoped, separate file.

## File Classification

| New/Modified File | Role / Layer | Data Flow | Closest Analog | Match Quality |
|-------------------|--------------|-----------|----------------|---------------|
| `src/main/settings-window.manager.ts` → `createSettingsWindow()` | main / window-manager | event-driven (lazy create/focus/destroy) | `src/main/overlay-window.manager.ts` `createOverlayWindow()` :297-375 | exact (inverted options) |
| `src/renderer/settings.html` | renderer / HTML entry | request-response (loads settings app) | `src/renderer/index.html` | exact |
| `src/renderer/src/settings.tsx` | renderer / React entry | request-response | `src/renderer/src/main.tsx` | exact |
| `src/preload/settings.ts` | preload / contextBridge | request-response (two-way `invoke`/`handle`) | `src/preload/index.ts` :86-162 (one-way) | role-match (inverted: two-way) |
| `src/main/context/session-context.repository.ts` | main / repository | CRUD over electron-store | `src/main/placeholder-secret.service.ts` (electron-store usage) | role-match |
| `src/main/secrets/api-key-store.service.ts` (two-key safeStorage) | main / service | file-I/O (encrypt→store→decrypt) | `src/main/placeholder-secret.service.ts` :36-52 | exact (generalize 1→2 keys) |
| `src/main/config/resolve-api-key.utility.ts` | main / utility | transform (pure precedence) | `src/main/config/load-dotenv.utility.ts` `parseDotenv` (pure) | role-match |
| `src/main/context/parse-links.utility.ts` | main / utility | transform (pure) | `src/main/audio/rms.utility.ts` `computeRmsInt16` (pure) | role-match |
| `src/main/context/parse-links.utility.test.ts` | test | unit | `src/main/audio/rms.utility.test.ts` (co-located) | exact |
| `src/main/hotkey-registrar.service.ts` (add `Ctrl+Alt+S` chord) | MODIFY / config-array | event-driven | existing chords in same file :53-105 | exact |
| `src/main/ai/ai-orchestrator.ts` (5th ctor param + line 165) | MODIFY / orchestrator | event-driven (pull-on-trigger) | its OWN `pushAi`/`transcriptBuffer` ctor injection :115-122 | exact (self) |
| `src/main/ai/anthropic-ai.gateway.ts` (in-place `rekey()`) | MODIFY / gateway | event-driven | its OWN ctor `new Anthropic({ apiKey })` :35-38 | exact (self) |
| `src/main/index.ts` (wiring sites) | MODIFY / handler | event-driven | existing `wireSttPipeline` :162-217, ctor wiring :241-243, `buildHandlers` :69-124 | exact (self) |
| `electron.vite.config.ts` (2nd renderer + 2nd preload input) | MODIFY / build config | n/a | existing `rollupOptions.input` maps + `electron.vite.verify.config.ts` 2nd-target | exact |

## Pattern Assignments

### `src/main/settings-window.manager.ts` → `createSettingsWindow()` (main, window-manager)

**Analog:** `src/main/overlay-window.manager.ts:297-375` (`createOverlayWindow()`).

**Copy the BrowserWindow + dev/prod-load skeleton (overlay-window.manager.ts:297-319, :367-372), INVERTING the existential options.** The overlay's `webPreferences` block and the `ELECTRON_RENDERER_URL ? loadURL : loadFile` branch are the load-bearing parts to mirror:

```typescript
// overlay-window.manager.ts:298-319 — MIRROR this shape, invert the marked fields
const window = new BrowserWindow({
    width: 900, height: 700,
    show: false,
    transparent: true,        // → false   (settings is opaque)
    frame: false,             // → true     (normal frame + X)
    focusable: false,         // → true     (it hosts text inputs — the whole point)
    skipTaskbar: true,        // → false (discretion)
    resizable: false,         // → true  (discretion)
    backgroundColor: '#00000000',  // → a normal opaque bg
    webPreferences: {
        preload: join(currentDirectory, '../preload/index.cjs'),  // → '../preload/settings.cjs'
        contextIsolation: true,   // KEEP true
        sandbox: true,            // KEEP true
        backgroundThrottling: false,  // → omit (settings may throttle when hidden)
    },
});
```

**DO NOT copy these overlay-only lines** (overlay-window.manager.ts:325, :330-353): `setIgnoreMouseEvents`, the `blur`→`setContentProtection(true)` re-assert, the `screen.on('display-*')` re-assert listeners, `setAlwaysOnTop('screen-saver')`. The settings window is a normal visible window — applying content protection would hide it from the user's own screenshots (anti-pattern, RESEARCH Pattern 3).

**Dev/prod load branch — mirror :367-372 but TARGET THE SETTINGS ENTRY** (RESEARCH Pattern 2 / Pitfall 1 — the bare `ELECTRON_RENDERER_URL` loads the overlay's `index.html`; you MUST append the filename):

```typescript
if (process.env.ELECTRON_RENDERER_URL) {
    void settingsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/settings.html`);
} else {
    void settingsWindow.loadFile(join(currentDirectory, '../renderer/settings.html'));
}
```

**Reveal:** call normal `show()` + `focus()` (NOT the overlay's `showInactive()`) — this window SHOULD take focus.

**D-01 lazy lifecycle:** hold a module-level `settingsWindow: BrowserWindow | undefined`; the open-settings handler does `if (defined && !destroyed) → show()+focus(); else create+show+focus` and wires `window.on('closed', () => { settingsWindow = undefined; })` (same `closed`-cleanup discipline as overlay-window.manager.ts:361).

---

### `src/renderer/settings.html` + `src/renderer/src/settings.tsx` (renderer entries)

**Analogs:** `src/renderer/index.html` and `src/renderer/src/main.tsx`.

**`settings.html` — copy `index.html` verbatim, change only the title and the script src.** The CSP `<meta>` (index.html:7) MUST be carried over (Security Domain — CSP on settings HTML):

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" />
...
<div id="root"></div>
<script type="module" src="/src/settings.tsx"></script>   <!-- was /src/main.tsx -->
```

Because the renderer block sets `root: 'src/renderer'` (electron.vite.config.ts:34), `settings.html` MUST live at `src/renderer/settings.html` and its script path resolves under that root.

**`settings.tsx` — copy `main.tsx` (createRoot + StrictMode) verbatim,** swapping `<App />` for the new `<SettingsApp />` root component (the two-tab `Context`/`Keys` shell, Context as landing — D-03; component structure is Claude's discretion).

---

### `src/preload/settings.ts` (preload, two-way contextBridge)

**Analog:** `src/preload/index.ts:86-162` (the one-way overlay preload — REUSE its structure, INVERT the direction to two-way).

**Copy the `process.contextIsolated` guard verbatim (preload/index.ts:157-162)** — it is the security contract:

```typescript
if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('settingsApi', settingsApi);
} else {
    throw new Error('contextIsolation must be enabled — refusing to expose the settingsApi bridge without it.');
}
```

**The API namespace uses `ipcRenderer.invoke` (two-way) instead of the overlay's `ipcRenderer.on` (one-way subscription).** This is the deliberate, scoped D-04 exception:

```typescript
const settingsApi = {
    getKeys(): Promise<{ deepgram: boolean; anthropic: boolean }> { return ipcRenderer.invoke('settings:get-keys'); },
    saveKeys(keys: { deepgram?: string; anthropic?: string }): Promise<void> { return ipcRenderer.invoke('settings:save-keys', keys); },
    getContext(): Promise<ISessionContextDto> { return ipcRenderer.invoke('settings:get-context'); },
    saveContext(dto: ISessionContextDto): Promise<void> { return ipcRenderer.invoke('settings:save-context', dto); },
};
export type SettingsApi = typeof settingsApi;
```

**Security rule (CLAUDE.md / D-04 / RESEARCH Pattern 4):** `getKeys` returns **presence booleans only** — the decrypted key NEVER crosses IPC outbound. `saveKeys` carries plaintext renderer→main ONCE (inbound), where main encrypts it. Mirror the overlay preload's "declared here, not imported from main" discipline (preload/index.ts:9) — declare payload types locally since the sandboxed preload is bundled separately.

---

### `src/main/secrets/api-key-store.service.ts` (two-key safeStorage store)

**Analog:** `src/main/placeholder-secret.service.ts:36-52` (`proveSecretBoundary`) — the proven encrypt→store-base64→decrypt round-trip, generalized from one placeholder to two real keys.

**Copy the exact round-trip shape (placeholder-secret.service.ts:41-49), with the `isEncryptionAvailable()` guard (:37-39):**

```typescript
// Save (per key): encrypt → store ONLY the base64 ciphertext (never plaintext — T-01-03-I2)
if (!safeStorage.isEncryptionAvailable()) { return; }            // Pitfall 2: only true post-app.ready
const ciphertext: Buffer = safeStorage.encryptString(plaintextKey);
store.set(DEEPGRAM_KEY_CIPHERTEXT, ciphertext.toString('base64'));

// Read (per key): decrypt the persisted base64, in MAIN ONLY
const persisted = store.get(DEEPGRAM_KEY_CIPHERTEXT);
const decrypted = persisted === undefined ? undefined : safeStorage.decryptString(Buffer.from(persisted, 'base64'));
```

**Use DISTINCT store keys** (Runtime State Inventory) — e.g. `deepgramKeyCiphertext`, `anthropicKeyCiphertext`. Do NOT reuse the Phase 1 `secretCiphertext` key (placeholder-secret.service.ts:16); it is unrelated and may be left in place. The `new Store<{...}>()` typing pattern is placeholder-secret.service.ts:19. Decrypt happens in main only; the plaintext never returns over IPC (only `{ deepgram: boolean; anthropic: boolean }` presence does).

---

### `src/main/context/session-context.repository.ts` (main, repository over electron-store)

**Analog:** `src/main/placeholder-secret.service.ts` for the `import Store from 'electron-store'` + `new Store<Shape>()` pattern; by-convention singleton (instantiated once in `index.ts`, no TSyringe — see hotkey-registrar.service.ts:118-120 remark and anthropic-ai.gateway.ts:24-26 remark for the canonical TSDoc).

**Store shape (D-09, RESEARCH Code Examples):** `{ contexts: ISessionContextDto[]; activeId: string }`. `ISessionContextDto` = ULID `id` + the four `IGroundingContext` fields (from prompt-assembler.ts:52-61) + optional future-fetcher metadata (`name?`, `source?`, `createdAt?`).

**`activeAsGrounding()` — pure-mappable, unit-tested (D-10):** maps the active DTO → `IGroundingContext` (four fields only), returns `undefined` when no active context exists, so `formatContext` yields `''` and behavior is byte-identical to Phase 5 (prompt-assembler.ts:91-94):

```typescript
public activeAsGrounding(): IGroundingContext | undefined {
    const active = this.contexts.find((c) => c.id === this.activeId);
    if (active === undefined) { return undefined; }
    return { notes: active.notes, ticketText: active.ticketText, repoSnippets: active.repoSnippets, links: active.links };
}
```

**ULID:** `import { ulid } from 'ulid'` (new dep, RESEARCH-approved 3.0.2). electron-store@11 is ESM-only — keep this in the ESM main bundle (Pitfall 5; placeholder-secret.service.ts:2 proves the import works).

---

### `src/main/config/resolve-api-key.utility.ts` (main, pure utility)

**Analog:** `src/main/config/load-dotenv.utility.ts` `parseDotenv` (pure, side-effect-free, unit-testable, TSDoc-on-export). **Do NOT mutate `loadDotenvFile`** — its "real env always wins" rule (load-dotenv.utility.ts:60) stays; the inversion for these two keys lives HERE in the resolution layer (D-08 anti-pattern note):

```typescript
/** safeStorage key (if present) wins → else process.env fallback → else ''. */
export function resolveApiKey(savedDecrypted: string | undefined, envValue: string | undefined): string {
    if (savedDecrypted !== undefined && savedDecrypted.length > 0) { return savedDecrypted; }
    return envValue ?? '';
}
```

---

### `src/main/context/parse-links.utility.ts` + co-located `.test.ts` (pure utility + test)

**Analog:** `src/main/audio/rms.utility.ts` (`computeRmsInt16`) and its co-located `src/main/audio/rms.utility.test.ts`. Pure, TSDoc-on-export, empty-input guard (rms.utility.ts:14-16 returns 0 for empty — mirror with an empty-array return). Parser (Pitfall 6):

```typescript
export function parseLinks(text: string): string[] {
    return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}
```

**Test:** co-locate next to the source (Vitest, `environment: 'node'`); mirror `rms.utility.test.ts`'s describe/it + AAA structure. Cover: split/trim/filter-empty, trailing newline, whitespace-only lines, round-trip with `links.join('\n')`.

---

### `src/main/hotkey-registrar.service.ts` — add `Ctrl+Alt+S` (MODIFY, config-array)

**Analog:** the existing chord entries in the SAME file (`HOTKEY_CHORDS` :53-105). Add ONE entry mirroring the Phase-5 `discrete` chords (:82, :89, :96), with the same conflict-recheck TSDoc preamble pattern:

```typescript
{ label: 'open-settings', keycode: UiohookKey.S, accelerator: 'Ctrl+Alt+S', kind: 'discrete' },
```

`HOTKEY_ACTION_LABELS` (:108) auto-derives. The handler is wired in `index.ts` `buildHandlers`; a missing handler surfaces in `register().failed` (CTL-03) — NO registrar logic change (identical to every prior chord). `S` is OUTSIDE the conflict-tested set — D-02 mandates the on-machine Teams/Zoom/VS Code re-check per the 02-03 protocol, with a documented fallback letter.

---

### `src/main/ai/ai-orchestrator.ts` — 5th ctor param + line 165 (MODIFY, self-analog)

**Analog:** its OWN existing constructor injection (ai-orchestrator.ts:115-122) — add `getActiveContext` exactly like `pushAi` is added today (D-10, RESEARCH Pattern 6):

```typescript
public constructor(
    private readonly gateway: IAiGateway,
    private readonly transcriptBuffer: TranscriptBuffer,
    private readonly history: AiHistory,
    private readonly pushAi: (event: IAiPushEvent) => void,
    private readonly getActiveContext: () => IGroundingContext | undefined   // NEW (D-10)
) { this.wireGatewayHandlers(); }
```

**Line 165 — the ONLY change to `trigger()`** (swap `undefined` for the pulled-on-trigger context):

```typescript
const { system, userContent } = assemblePrompt({ mode, span, context: this.getActiveContext() });
```

No `assemblePrompt` signature change — the `context?` slot already exists (prompt-assembler.ts:69-70). Pull-on-trigger means a mid-session Save is picked up on the next press with zero mutable orchestrator state.

---

### `src/main/ai/anthropic-ai.gateway.ts` — in-place `rekey()` (MODIFY, self-analog)

**Analog:** its OWN constructor `new Anthropic({ apiKey })` (anthropic-ai.gateway.ts:35-38). D-07 live re-key, RESEARCH Pattern 5b (recommended — preserves the orchestrator's `readonly gateway` and its wired handlers, no re-wiring):

```typescript
private client: Anthropic;   // drop `readonly` (Pitfall 4 — TS2540 otherwise)
// ...
/** Re-keys the client in place for the next stream() call (D-07). Never logs the key. */
public rekey(newKey: string): void {
    this.apiKey = newKey;            // drop readonly on apiKey too
    this.client = new Anthropic({ apiKey: newKey });
}
```

Preserve the never-log-the-key discipline (anthropic-ai.gateway.ts:20-21, :88-89). The gateway still never reads `process.env`; the re-key re-SUPPLIES the key.

**Deepgram re-key (NOT a self-method — instance swap, RESEARCH Pattern 5a):** `DeepgramSttGateway`'s key is `private readonly` captured in `connect()` (deepgram-stt.gateway.ts:80, :135) with no setter. Re-key = `await sttGateway.stop()` (:98-105) → `new DeepgramSttGateway(newKey)` → re-attach the three handlers → `await newGateway.start()`. See the `index.ts` refactor below.

---

### `src/main/index.ts` — wiring sites (MODIFY, self-analog)

**Analogs:** existing `wireSttPipeline` :162-217, the ctor wiring block :241-243, and `buildHandlers` :69-124 — all in the SAME file.

**(1) Boot key resolution (D-08)** — replace the bare `process.env.* ?? ''` at :165 and :241 with `resolveApiKey(apiKeyStore.getDeepgram(), process.env.DEEPGRAM_API_KEY)` (and the Anthropic equivalent), inside the existing `app.whenReady().then(...)` block (:219) so safeStorage is post-ready (Pitfall 2). `loadDotenvFile` at :223 is unchanged.

**(2) Deepgram re-key handler-reattach (Pitfall 3)** — extract the three `gateway.on('transcript'|'connection-state-change'|'error', ...)` bindings (:172-191) into a reusable `attachSttGatewayHandlers(gateway, window, buffer, ...)` called on both boot AND re-key. Keep the gateway in the module-level `sttGateway` and have the capture callback call `sttGateway?.sendAudio(pcm)` (re-pointable) rather than closing over the local `gateway` const (currently :205). The capture pipeline (`AudioCaptureService`) keeps running and feeds the new gateway instance.

**(3) Orchestrator wiring (D-10)** — at :243, add the provider closure exactly like the existing `(event) => pushAi(window, event)`:

```typescript
const contextRepo = new SessionContextRepository();        // by-convention singleton (D-09)
aiOrchestrator = new AiOrchestrator(aiGateway, buffer, aiHistory,
    (event) => pushAi(window, event),
    () => contextRepo.activeAsGrounding());                // NEW (D-10) — pull-on-trigger
```

**(4) `open-settings` handler in `buildHandlers`** (:77-123) — add a one-liner mirroring the existing chord handlers (e.g. `'open-settings': (): void => openOrFocusSettingsWindow()`), and thread the new dep into `buildHandlers`' signature like `aiOrchestrator`/`aiHistory` were threaded (:69-76).

**(5) `ipcMain.handle` registration (D-04)** — register the four `settings:*` channels once at this entry point (the by-convention singleton wiring site), routing `saveKeys`→`apiKeyStore` (+ live re-key), `getContext`/`saveContext`→`contextRepo`. Validate the `saveContext` DTO shape before persisting (Security Domain — Tampering).

---

### `electron.vite.config.ts` — second renderer + second preload input (MODIFY, build config)

**Analogs:** the existing `rollupOptions.input` maps (electron.vite.config.ts:20-21 preload, :42-43 renderer) + the proven second-build-target precedent in `electron.vite.verify.config.ts`. Add a `settings` named input to BOTH the preload and renderer blocks:

```typescript
// preload block — emits out/preload/settings.cjs (the existing output.format:'cjs' + entryFileNames:'[name].cjs' at :27-28 already forces this)
input: { index: resolve('src/preload/index.ts'), settings: resolve('src/preload/settings.ts') },

// renderer block — emits out/renderer/settings.html (both HTML inputs live under root:'src/renderer')
input: { index: resolve('src/renderer/index.html'), settings: resolve('src/renderer/settings.html') },
```

No plugin change. The `main` block is untouched.

## Shared Patterns

### safeStorage ciphertext-only round-trip
**Source:** `src/main/placeholder-secret.service.ts:37-49`
**Apply to:** `api-key-store.service.ts` (both keys), every `settings:save-keys`/`get-keys` handler.
- `isEncryptionAvailable()` guard (post-`app.ready` only — Pitfall 2); `encryptString` → store `.toString('base64')`; `decryptString(Buffer.from(persisted, 'base64'))` in MAIN ONLY. Plaintext never persisted, never logged, never returned over IPC (only presence booleans).

### By-convention singleton (NO TSyringe)
**Source:** TSDoc remark in `src/main/hotkey-registrar.service.ts:118-120` and `src/main/ai/anthropic-ai.gateway.ts:24-26`
**Apply to:** `SessionContextRepository`, `api-key-store.service.ts`, the settings-window manager.
- Instantiated exactly once in `index.ts`; resolve at the entry point only, never service-locate mid-method. Carry the standard "@singleton() is NOT applicable — main has no TSyringe container" TSDoc note.

### Never-log / never-IPC the key
**Source:** `src/main/ai/anthropic-ai.gateway.ts:20-21,88-89`, `src/main/stt/deepgram-stt.gateway.ts:77-78`, `index.ts:190` (swallowed error, no payload)
**Apply to:** the `rekey()` method, both gateways, every IPC handler, the error path.
- Gateways take the key by constructor only, never read `process.env`. Re-key re-SUPPLIES the key. `sanitizeAiError` (anthropic-ai.gateway.ts:88-97) already strips SDK error bodies — keep using it; never add a log line that includes the key.

### contextIsolation + sandbox + typed contextBridge guard
**Source:** `src/preload/index.ts:157-162`
**Apply to:** `src/preload/settings.ts`.
- `if (process.contextIsolated) { exposeInMainWorld(...) } else { throw }`. `contextIsolation:true` + `sandbox:true` kept on the settings window's `webPreferences`. Preload is sandboxed → CommonJS `.cjs` output (already forced by config :27-28).

### Pure utility + co-located Vitest test, TSDoc on export
**Source:** `src/main/audio/rms.utility.ts` + `src/main/audio/rms.utility.test.ts`; `src/main/config/load-dotenv.utility.ts` `parseDotenv`
**Apply to:** `parse-links.utility.ts`, `resolve-api-key.utility.ts`, `activeAsGrounding()` mapping, and the extended `ai-orchestrator.test.ts`.
- Pure, side-effect-free, empty-input guard, explicit return type, 4-space/single-quote/180-col, AAA-with-bare-comments tests, `npx vitest run src/main/<file>.test.ts`.

### Add-a-chord (no registrar change)
**Source:** `src/main/hotkey-registrar.service.ts:53-105` (the Phase 4/5 chords)
**Apply to:** the `open-settings` chord + its `buildHandlers` entry.
- One `HOTKEY_CHORDS` entry (`discrete`), one `buildHandlers` one-liner, on-machine conflict re-check per 02-03, fallback letter documented. Missing handler → `register().failed` (CTL-03), never a registrar code change.

## No Analog Found

None. Every new and modified file has a concrete in-repo analog (the multi-renderer build wiring is the only MEDIUM-confidence item, and even it has the `verify.config.ts` second-target precedent — the residual risk is the dev-server URL suffix, flagged below).

## Metadata

**Analog search scope:** `src/main/` (window manager, secret service, gateways, orchestrator, hotkey registrar, config/audio utilities, index wiring), `src/preload/`, `src/renderer/`, `electron.vite*.config.ts`.
**Files scanned:** 14 source/config files + glob/test discovery.
**Known caveat carried from RESEARCH (A1 / Pitfall 1 / Open Question 1):** the dev-server URL suffix for the second renderer entry (`${ELECTRON_RENDERER_URL}/settings.html`) is MEDIUM confidence — the planner MUST add a dev+prod smoke task (press `Ctrl+Alt+S` under `npm run dev` and after `npm run build`/preview). The prod `loadFile('../renderer/settings.html')` path is unambiguous.
**Pattern extraction date:** 2026-06-19
