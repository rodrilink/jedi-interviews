# Phase 6: Session Context + Settings Window - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a **separate, normal (focusable) settings window** that hosts (a) Deepgram + Anthropic
API-key entry/save encrypted at rest via `safeStorage`, and (b) a persisted **session-context editor**
(notes / ticket text / repo snippets / reference links). The **active session context is injected into
every AI prompt** (all modes), completing AI-06 grounding. Covers **CTX-01** (context editor), **CTX-02**
(local persistence across restarts), **CTX-03** (injected into all modes), **CTX-04** (structured,
ULID-keyed store ready for a future URL-fetcher), **SET-01** (separate focusable window), **SET-02**
(enter/save both keys), **SET-04** (context editor reachable from the settings window by hotkey), and
**AI-06** (every AI call grounded in the active context + transcript span).

**Locked upstream (do NOT re-litigate):**
- **The overlay is `focusable:false` and click-through; it cannot host text inputs.** All key entry and
  context editing MUST live in a SEPARATE focusable `BrowserWindow` (ROADMAP Notes / SET-01). This is the
  whole reason the phase exists — do not try to put inputs on the overlay.
- **Encrypt-at-rest plumbing is proven (SET-03, Phase 1, already `Complete`).** `safeStorage` (DPAPI)
  encrypt → store base64 ciphertext via `electron-store` under `userData` → decrypt in main only, all in
  the main process, never over IPC, never logged, never committed. The pattern lives in
  `src/main/placeholder-secret.service.ts`; `electron-store` is already a dependency. Phase 6 replaces the
  *placeholder* with the two real keys.
- **The `IGroundingContext` schema already exists** in `src/main/ai/prompt-assembler.ts` with exactly the
  four fields: `notes?`, `ticketText?`, `repoSnippets?`, `links?: string[]`. `formatContext()` already
  renders them into `Notes:/Ticket:/Repo snippets:/Links:` prompt blocks. Phase 6 FILLS this — it does not
  redesign it.
- **The injection point is `src/main/ai/ai-orchestrator.ts:165`** — today `assemblePrompt({ mode, span,
  context: undefined })`. Phase 6 (plan 06-04) replaces `undefined` with the active context. No signature
  change anywhere — this is exactly the D-13 "seam built empty in Phase 5, filled in Phase 6" plan.
- **Main owns IO/state; the OVERLAY renderer is a strict one-way view (IN-01).** The settings window is the
  deliberate, scoped EXCEPTION — it needs a two-way control surface (see D-03). The overlay's one-way
  preload/contract is NOT touched.
- **Hotkeys register through `HotkeyRegistrarService` / `HOTKEY_CHORDS`** (`src/main/hotkey-registrar.service.ts`).
  Used Ctrl+Alt letters so far: J, Left/Right/Up/Down, [, ], H, Q, K, PgUp/PgDn, A, T, G, F. The new
  open-settings chord gets the 02-03 Teams/Zoom/VS Code conflict re-check like every other chord.
- The ROADMAP 4-plan shape (06-01 settings window + key entry/save via safeStorage / 06-02
  SessionContextRepository with ULID-keyed `ISessionContextDto` / 06-03 context editor UI / 06-04 inject
  active context into PromptAssembly) is the agreed breakdown; planner refines.

**Mode:** mvp — ship ONE working context and the two-key entry; build the multi-context *schema* now but
keep the multi-context *UI* out (D-13).

</domain>

<decisions>
## Implementation Decisions

### Settings Window — lifecycle, hotkey, layout (SET-01/SET-04)
- **D-01:** **The settings window is created lazily, on demand.** `Ctrl+Alt+S` creates and shows the
  focusable settings window the first time it is pressed; if it is already open, the chord focuses the
  existing one. Closing it (window X / Esc) destroys it. No settings window exists at launch — the booted
  app is just the overlay, as today. Re-pressing recreates it. (Contrast the overlay, which is created at
  launch and toggled — the settings window is heavier and rarely open, so lazy is the right lifecycle.)
- **D-02:** **Hotkey = `Ctrl+Alt+S`.** `S` is outside the locked conflict-tested set; the planner
  re-verifies it against Teams/Zoom/VS Code on the target machine per the 02-03 protocol, with a documented
  fallback letter if it collides. The chord is `discrete`. It adds to `HOTKEY_CHORDS` exactly like every
  other chord (handler wired in `index.ts`, missing-handler surfaces in `register().failed` / CTL-03).
- **D-03:** **Two tabs inside one window: `Keys` and `Context`, with `Context` as the default/landing tab**
  (it's used more often than keys, which are typically set once). SET-04 is satisfied because the context
  editor is reachable from the same settings window opened by the hotkey.
- **D-04:** **The settings window gets its OWN dedicated preload + a scoped two-way IPC surface.** A
  settings-specific preload exposes a typed `contextBridge` API (e.g. `getKeys`/`saveKeys`/`getContext`/
  `saveContext`) over `ipcRenderer.invoke` → `ipcMain.handle`. Main remains the only place that touches
  `safeStorage` / `electron-store`. **The overlay's existing one-way preload and contract are NOT modified**
  — the two-way surface is scoped to the settings window only, preserving the IN-01 boundary for the overlay.
  `contextIsolation`/`sandbox` stay on for the settings window like the overlay.

### Context Editor — fields and save (CTX-01/CTX-02)
- **D-05:** **Four labeled fields mapping 1:1 to `IGroundingContext`:** a textarea each for **Notes**,
  **Ticket text**, **Repo snippets**, and a **Links** textarea (one URL per line, parsed into `links[]`).
  This maps directly to the existing `formatContext()` blocks — NO new prompt formatting is needed. The
  store schema stays four-field regardless.
- **D-06:** **Explicit Save button for the context editor**, with a dirty/"unsaved changes" indicator.
  Saving writes once to `electron-store` (under `userData`, CTX-02 persistence) AND makes that context the
  active one immediately (no restart, no second action). One write per Save — not autosave — for
  predictable behavior and consistency with the Keys tab, which is always an explicit save.

### Runtime Key Application (SET-02)
- **D-07:** **Keys apply LIVE — no restart.** Saving a key in settings re-keys the running gateways:
  - **Anthropic:** the next AI call uses the new key (the gateway reads the current key holder per call /
    is re-keyed in place).
  - **Deepgram:** the live STT websocket is **torn down and reconnected with the new key**. The 03-01
    audio-capture seam + the gateway's own connect/reconnect path isolate this swap. The planner wires a
    "re-key the STT pipeline" path that reuses the existing reconnect logic.
- **D-08:** **Key precedence at boot: `safeStorage` wins, `.env` is the fallback.** Resolution order:
  saved `safeStorage` key if present → else `process.env` key (from `loadDotenvFile`, the Phase 4/5 D-08
  dev source) → else `''` (which surfaces the existing inline "missing API key" state). This keeps the
  current `.env` dev workflow working with **zero changes** while making the settings window the canonical
  user path and the source of truth when a key has been saved. (Note: this intentionally INVERTS the
  `loadDotenvFile` "real env always wins" rule **for these two API keys specifically** — the saved UI key
  must override a stale `.env`. The dotenv utility itself is unchanged; the override happens in the
  key-resolution layer, not in `loadDotenvFile`.)

### Session Context Store — structure and active selection (CTX-03/CTX-04)
- **D-09:** **The store is ULID-keyed and multi-context-ready from day one, but the v1 UI is
  single-context.** Shape: `{ contexts: ISessionContextDto[]; activeId: string }` where each
  `ISessionContextDto` has a ULID `id`, the four `IGroundingContext` fields, and room for future metadata
  (e.g. a name, a source/provenance for a future URL-fetcher). The v1 editor edits exactly ONE context
  (created on first save, always `active`) — **no selector, no name field shown in the UI.** The seam exists
  in the *data*; the multi-context UI is deferred. This satisfies CTX-04 structurally (a future Jira/Azure/
  GitHub fetcher pushes more `ISessionContextDto`s and the UI gains a selector later — no schema redesign).
- **D-10:** **The active context reaches the orchestrator via an injected provider (pull-on-trigger).** The
  `AiOrchestrator` is constructed with a `getActiveContext()` provider (a closure over the context repo,
  e.g. `() => contextRepo.activeAsGrounding()`), mirroring how it already takes `transcriptBuffer` and the
  `pushAi` closure via its constructor (`index.ts:243`). At each `trigger()` it calls the provider to read
  the LATEST saved context as `IGroundingContext` and passes it into `assemblePrompt({ mode, span, context })`
  at line 165. This is always-current (a mid-session Save is picked up on the next trigger) and adds no
  mutable state to the orchestrator. The repo exposes an `activeAsGrounding()` that maps the active
  `ISessionContextDto` → `IGroundingContext` (the four fields), returning `undefined`/empty when there is no
  saved context (so `formatContext` yields no block — identical to Phase 5 behavior).

### Claude's Discretion
- **Exact electron-store key names / file layout** for the contexts array and the two key ciphertexts —
  planner picks, following the `placeholder-secret.service.ts` precedent (store base64 ciphertext only,
  never plaintext).
- **Settings-window dimensions, styling, and tab implementation** (React component structure, the dirty
  indicator UI, masked vs revealable key inputs) — planner/UI decides; it is a normal focusable window so
  standard form UX applies. A "show/hide key" affordance and a "saved ✓" confirmation are encouraged but
  not mandated.
- **The fallback letter** for the open-settings chord if `Ctrl+Alt+S` collides in the conflict re-check (D-02).
- **ULID generation mechanism** (a small dependency vs a tiny local generator) — planner picks; the
  project has no native-build appetite, so a pure-JS ULID is preferred.
- **The exact `ISessionContextDto` metadata fields** beyond `id` + the four grounding fields (e.g. a
  `name`, `createdAt`, `source`) — planner adds whatever a future fetcher plausibly needs without building
  UI for it now (CTX-04 is about the schema, not the UI).
- **How the Deepgram re-key reconnect is wired** (reuse the gateway's reconnect vs a full pipeline rebuild)
  — planner picks the least-invasive path through the existing STT wiring (D-07).
- **Whether the settings window also surfaces a "missing key" hint** mirroring the overlay's inline
  `AI error: missing API key` — nice-to-have, planner's call.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 6: Session Context + Settings Window" — goal, the 5 success criteria
  (separate focusable window + key entry encrypted via safeStorage; context editor; local persistence;
  every AI call grounded in active context + transcript span with observable improvement vs Phase 5;
  structured ULID-keyed `ISessionContextDto`), the 4 plans (06-01 window+keys / 06-02 repo+schema /
  06-03 editor UI / 06-04 inject into PromptAssembly), and the **Notes** (overlay is `focusable:false` so
  inputs MUST be in a separate window; design `ISessionContextDto` for multiple named contexts from day
  one even though v1 ships one; electron-store + contextBridge IPC are mature standard patterns).
- `.planning/REQUIREMENTS.md` §"Session Context" (CTX-01..04), §"Settings & Secrets" (SET-01, SET-02,
  SET-04; **SET-03 is already Complete** from Phase 1), and §"AI Assistance" AI-06 (grounding). **Note:**
  AI-03 (vision) and PKG-01 (packaging) are Phase 7 — out of scope here.
- `.planning/PROJECT.md` — Key Decisions (paste-based local context store, no live API, upgradeable to a
  URL-fetcher — CTX-04 is exactly this seam) and the focus-discipline / privacy / cost constraints; the
  `safeStorage`-at-rest decision for keys.

### Stack & implementation guidance
- `CLAUDE.md` (project root) §"electron-store" (`electron-store@11`, ESM-only, JSON store under
  `app.getPath('userData')` — use for everything EXCEPT raw keys) and §"safeStorage" (encrypt the two API
  keys at rest via DPAPI in MAIN only; store the ciphertext via electron-store; decrypt in main only; never
  put raw keys in electron-store or expose them to the renderer). §"What NOT to Use" — keys never in the
  renderer/plaintext; `contextIsolation:true` + `sandbox:true` + minimal typed `contextBridge` preload.

### Prior-phase decisions this phase builds on
- `.planning/phases/05-ai-orchestration-answer-talking-points/05-CONTEXT.md` — **D-13 (the prompt-assembler
  context seam built empty in Phase 5, filled here)**; the `IGroundingContext` schema; the by-convention
  main-side singleton + constructor-injection pattern (the orchestrator already takes a `transcriptBuffer`
  + `pushAi` closure — D-10 adds a `getActiveContext` provider the same way); the
  thin-gateway/never-log-the-key discipline that the live-rekey path (D-07) must preserve; the env/dev-config
  key source (D-08-equivalent) that becomes the FALLBACK behind safeStorage here (D-08).
- `.planning/phases/04-stt-pipeline-live-transcript/04-CONTEXT.md` — the main-owns-IO/state +
  renderer-is-a-one-way-view (IN-01) boundary the overlay keeps and the settings window scopes an exception
  to (D-04); the Deepgram gateway connect/reconnect path the live-rekey (D-07) reuses; the 03-01
  audio-capture seam that isolates the STT key swap.
- `.planning/phases/02-global-hotkeys-window-control/02-CONTEXT.md` + `02-HOTKEY-CONFLICT-TEST.md` — the
  `HotkeyRegistrarService` / `HOTKEY_CHORDS` registration + `register()`-result-checking pattern and the
  conflict-tested chord set the new `Ctrl+Alt+S` open-settings chord adds to and must be re-tested against
  (D-02).
- `.planning/phases/01-overlay-shell-existential-behaviors/01-CONTEXT.md` — the
  `contextIsolation`/`sandbox`/typed-preload boundary the settings window's dedicated preload (D-04)
  reuses; the proven `safeStorage`+electron-store round-trip (`placeholder-secret.service.ts`) the real
  key store (D-07/D-08) extends.

### Code to extend / build on (see code_context)
- `src/main/ai/prompt-assembler.ts` — `IGroundingContext` (the four fields), `formatContext()`, and
  `assemblePrompt()` already exist; Phase 6 only FILLS the `context` arg (D-05/D-10), no signature change.
- `src/main/ai/ai-orchestrator.ts:165` — the `context: undefined` → active-context swap; the constructor
  is where the `getActiveContext` provider is injected (D-10).
- `src/main/placeholder-secret.service.ts` — the safeStorage encrypt → store base64 ciphertext → decrypt
  round-trip the real two-key store replaces/generalizes (D-07/D-08).
- `src/main/config/load-dotenv.utility.ts` + `src/main/index.ts:223,241,165` — the current
  `loadDotenvFile` + `process.env.*_API_KEY ?? ''` key sourcing that becomes the FALLBACK behind a
  safeStorage-first resolution layer (D-08); the gateway construction sites the live-rekey (D-07) reaches.
- `src/main/overlay-window.manager.ts` — `createOverlayWindow()` is the BrowserWindow-creation template
  for `createSettingsWindow()` (D-01), inverted: `focusable:true`, not transparent/click-through, normal
  frame.
- `src/main/hotkey-registrar.service.ts` — `HOTKEY_CHORDS` is where `Ctrl+Alt+S` is added (D-02);
  `HOTKEY_ACTION_LABELS` / `register().failed` surfacing is reused.
- `src/preload/index.ts` (+ `index.d.ts`) — the existing one-way overlay preload; the settings window gets
  a SEPARATE preload alongside it (D-04), NOT an extension of this one.

No external ADRs/specs beyond the `.planning/` docs and `CLAUDE.md` above — requirements are fully captured
in the decisions and the ROADMAP/REQUIREMENTS refs.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`IGroundingContext` + `formatContext()` + `assemblePrompt()`** (`src/main/ai/prompt-assembler.ts`) —
  the entire grounding-injection mechanism already exists and is unit-tested; Phase 6 only supplies the
  data. `formatContext` already returns `''` for an empty/absent context, so a no-context session behaves
  exactly as Phase 5.
- **`AiOrchestrator` constructor-injection** (`src/main/ai/ai-orchestrator.ts:115-122`, wired at
  `index.ts:243`) — already takes a gateway, the transcript buffer, the history, and a `pushAi` closure;
  the `getActiveContext` provider (D-10) is added the same way. `trigger()` is the single place that calls
  `assemblePrompt` (line 165).
- **`proveSecretBoundary` / `placeholder-secret.service.ts`** — proven `safeStorage`(DPAPI) encrypt →
  electron-store base64 ciphertext → decrypt round-trip, main-process only, never logged. The real
  two-key store is this pattern, generalized to two keys + a non-placeholder value (D-07/D-08).
- **`createOverlayWindow()`** (`src/main/overlay-window.manager.ts:297`) — the BrowserWindow creation +
  preload-wiring + dev `loadURL` / prod `loadFile` template for the new `createSettingsWindow()` (D-01),
  with the focus/transparency options inverted.
- **`HotkeyRegistrarService` / `HOTKEY_CHORDS`** — proven passive uiohook(+globalShortcut fallback)
  registrar; the `Ctrl+Alt+S` chord registers exactly like the Phase 2/4/5 chords with
  `register().failed` surfacing (D-02).
- **`loadDotenvFile`** (`src/main/config/load-dotenv.utility.ts`) — the existing `.env` loader that
  becomes the key FALLBACK source behind safeStorage (D-08); unchanged.

### Established Patterns
- **Main owns IO/state; the overlay renderer is a pure one-way view (IN-01).** The settings window is the
  scoped, deliberate exception with its own two-way preload (D-04); the overlay contract is untouched.
- **Seam-first, fill-later** — applied a THIRD time here: the Phase-5 empty prompt-context slot (D-13) is
  filled now (D-05/D-10), exactly as `ISttProvider` was defined before Deepgram.
- **By-convention singletons in main (no TSyringe)** — the new context repo + settings-window manager are
  instantiated once in `index.ts`, like every other main service.
- **Thin gateway over a vendor SDK; the key is constructor-injected, never read from `process.env` inside
  the gateway, never logged/IPC'd.** The live-rekey (D-07) must preserve this — it re-supplies the key to
  the gateway, it does not make the gateway read env or expose the key.
- **safeStorage ciphertext only, never plaintext, never committed** (`placeholder-secret.service.ts`
  precedent) — the two real keys follow this exactly (D-07/D-08).
- **`contextIsolation:true` + `sandbox:true` + minimal typed `contextBridge` preload** — the settings
  window keeps these; its preload is minimal and typed (D-04).
- **Strict TS / IDEXX standards** — explicit return types, single quotes, 4-space, TSDoc on exports;
  co-located Vitest for the unit-testable pieces (the context repo's mapping/active-resolution, the
  key-resolution precedence logic, the links-parsing). Live window/IPC and the safeStorage round-trip are
  integration-level, not pure-unit.

### Integration Points
- **Open-settings hotkey (main) → `createSettingsWindow()` (main, focusable) → settings renderer (two-way
  preload) → `ipcMain.handle` (main) → safeStorage key store + context repo (main).** All persistence and
  encryption stay in main.
- **Save key (settings) → main re-keys the running gateways live (D-07):** Anthropic next-call; Deepgram
  websocket teardown + reconnect via the existing STT reconnect path.
- **Save context (settings) → context repo writes electron-store (D-06) → next `trigger()` pulls it via
  `getActiveContext()` (D-10) → `assemblePrompt({...context})` (`ai-orchestrator.ts:165`) → grounded AI
  call (AI-06).**
- **Boot key resolution (D-08):** safeStorage key → else `process.env` (`loadDotenvFile`) → else `''`;
  the resolved key is what the gateways are constructed with at `index.ts:165,241`.
- **CTX-04 forward seam:** a future Jira/Azure/GitHub URL-fetcher pushes additional `ISessionContextDto`s
  into the same store and the UI gains a selector — no schema redesign (D-09).
- **New dependency (likely):** a pure-JS ULID generator (no native build) for `ISessionContextDto.id`.

</code_context>

<specifics>
## Specific Ideas

- **The settings window is a NORMAL window, the deliberate opposite of the overlay:** focusable, not
  transparent, not click-through, with a real frame — because the user types into it. This is the only
  place in the app the user interacts with a focusable window; everything else is keyboard-driven over the
  click-through overlay.
- **`Ctrl+Alt+S`, two tabs (`Keys` / `Context`), Context as the landing tab** — the user opens this mostly
  to edit context mid-prep, not to re-enter keys (keys are set once).
- **The context editor mirrors the prompt's own structure:** four labeled fields (Notes / Ticket text /
  Repo snippets / Links one-per-line) that map 1:1 to `IGroundingContext` and the existing
  `formatContext()` blocks — the editor IS the prompt's shape, made editable.
- **Live key application with no restart is an explicit UX goal** — first-run is "open settings, paste both
  keys, save, and it just works" without relaunching, including the live Deepgram websocket reconnect.
- **safeStorage overrides `.env` for the two keys** — the saved UI key is the source of truth once set;
  `.env` stays a zero-friction dev fallback. This deliberately avoids the stale-`.env`-shadowing trap
  (a key saved in the UI must not be silently overridden by an old `.env`/shell var).
- **Multi-context is real in the data, invisible in the UI for v1** — the store is ULID-keyed and holds an
  array + `activeId` from day one (CTX-04), but the user only ever sees/edits one context; the selector
  arrives with the future fetcher.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-context UI (named contexts, create/switch/delete, an active-context selector)** — the *schema*
  ships now (D-09) but the *UI* is deferred. Arrives naturally when the future URL-fetcher populates
  multiple contexts. Keeps this phase at its mvp "ships one context" scope.
- **Live Jira / Azure / GitHub URL-fetcher that auto-populates context** — explicitly out of scope for v1
  (PROJECT.md / REQUIREMENTS Out of Scope). CTX-04's ULID-keyed store + `ISessionContextDto.source`
  metadata is the seam it plugs into later; no fetcher code is written now.
- **Autosave for the context editor** — considered, rejected for v1 in favor of an explicit Save (D-06).
  Easy to add later if the explicit-save model feels heavy.
- **Vision / code-challenge mode + Windows packaging** — Phase 7 (AI-03, PKG-01). Vision reuses the entire
  AI path (including the grounding context filled here), adding only an image source + Opus switch.
- **Per-mode or per-context different grounding (e.g. answer vs talking-points reading different context
  fields)** — not needed; all modes ground on the same active context via the single
  `getActiveContext()` provider (D-10). Easy to split later since context is a per-call argument.

None — discussion stayed within phase scope; no pending todos matched this phase.

</deferred>

---

*Phase: 6-Session Context + Settings Window*
*Context gathered: 2026-06-19*
