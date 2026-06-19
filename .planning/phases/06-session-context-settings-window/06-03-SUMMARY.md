---
phase: 06-session-context-settings-window
plan: 03
subsystem: settings-ui
tags: [react, electron, settings, contextBridge, ipc, grounding, renderer]

# Dependency graph
requires:
  - plan: 06-01
    provides: focusable Ctrl+Alt+S settings window, scoped two-way settingsApi contextBridge, /settings.html dev URL, placeholder settings.tsx
  - plan: 06-02
    provides: ISessionContextDto schema, parseLinks utility, SessionContextRepository (getActive/saveActive)
provides:
  - Two-tab SettingsApp shell (Context default landing + Keys) — D-03
  - ContextTab four-field grounding editor + derived dirty indicator + explicit single Save (D-05/D-06)
  - KeysTab two-key entry/save form with presence-only display (SET-02, T-06-10)
  - Renderer-local settingsApi typing (ISettingsApi/ISaveContextInput) with links-as-raw-string save contract
affects:
  - "06-04 (wires settings:get-context / settings:save-context handler bodies — MUST parse links via parseLinks in main)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Settings renderer = two-tab SettingsApp consuming window.settingsApi; Context is the default tab (D-03)"
    - "Derived dirty state (live form vs loaded baseline) drives the unsaved indicator; Save is explicit-only (D-06), never in onChange"
    - "Link parsing authoritative in MAIN: renderer sends links as raw newline-joined string; main re-parses via parseLinks (06-02)"
    - "Presence-only Keys UI: inputs are write-only (cleared after save), display driven solely by getKeys booleans (T-06-10)"

key-files:
  created:
    - src/renderer/src/SettingsApp.tsx
    - src/renderer/src/components/ContextTab.tsx
    - src/renderer/src/components/KeysTab.tsx
    - src/renderer/src/settings.css
    - src/renderer/src/settings-api.d.ts
  modified:
    - src/renderer/src/settings.tsx

key-decisions:
  - "LINK PARSING AUTHORITY = MAIN. ContextTab sends links as a RAW newline-joined string in saveContext({ links: string }); main parses to string[] via parseLinks (06-02) inside the settings:save-context handler wired in 06-04. The renderer only ever JOINS links[] with '\\n' for editing on pre-fill — it never splits/parses. 06-04 MUST match this (parse on save, join on read)."
  - "Renderer-local settingsApi typing in src/renderer/src/settings-api.d.ts (declare global Window.settingsApi). Declared locally rather than imported from src/preload/settings.ts because tsconfig.web includes only src/renderer/src/** + the overlay src/preload/index.d.ts — the settings preload bundle is outside the renderer typecheck graph."
  - "saveContext input type loosened to { notes?; ticketText?; repoSnippets?; links?: string } (links is the raw textarea string, not string[]) to make main the single parse authority. getContext return type keeps links: string[] (the persisted shape) for the join-on-prefill round-trip."
  - "Keys inputs are write-only: empty fields are omitted from saveKeys so an existing key is left unchanged; inputs clear after a successful save so a key value never lingers in the field (T-06-10)."

requirements-completed: [CTX-01, SET-04, "SET-02 (UI half)"]

# Metrics
duration: ~70min
completed: 2026-06-19
---

# Phase 6 Plan 03: Settings Editor UI (Context + Keys tabs) Summary

**The real two-tab settings editor replacing the 06-01 placeholder: a Context landing tab (D-03) with the four `IGroundingContext` fields, a derived unsaved-changes indicator, and an explicit single Save (D-05/D-06), plus a Keys tab for entering/saving both API keys with a presence-only display (SET-02, T-06-10) — all wired to the scoped `window.settingsApi` bridge, renderer-only.**

## Performance

- **Duration:** ~70 min (wall clock across worktree session)
- **Tasks:** 2 of 2 auto tasks complete; Task 3 is a blocking human-verify checkpoint (AWAITING on-machine verification)
- **Files:** 6 (5 created, 1 modified)

## Accomplishments

- **`SettingsApp.tsx`** — two-tab shell (`tab-context` / `tab-keys`) with `Context` as the DEFAULT/landing tab (`useState<SettingsTab>('context')`, D-03); reachable directly from the Ctrl+Alt+S window (SET-04).
- **`ContextTab.tsx`** (CTX-01, D-05/D-06) — four labeled fields mapping 1:1 to `IGroundingContext`: Notes (`input-notes`), Ticket text (`input-ticket-text`), Repo snippets (`input-repo-snippets`), Links (`input-links`, a textarea, one URL per line). Pre-fills from `getContext()` on mount (maps `links[]` → newline-joined text). A derived `dirty` flag (live form vs loaded baseline) drives the `text-dirty-indicator`; `btn-save-context` calls `saveContext` exactly ONCE per click (disabled when not dirty / saving), then clears dirty and shows `saved ✓`. No save call lives in any `onChange` (D-06 — verified by grep gate).
- **`KeysTab.tsx`** (SET-02, T-06-10) — two masked inputs (`input-deepgram-key` / `input-anthropic-key`) with a Show/Hide affordance, `btn-save-keys` sending only the filled fields to `saveKeys` (empty fields omitted → existing key untouched), and a presence display (`text-key-presence`) driven SOLELY by `getKeys()` booleans. Inputs are write-only — cleared after save; a key string is never rendered.
- **`settings.css`** — all styling for the settings surface (the inverted opaque/focusable window, 06-01); zero inline `style=` props anywhere in the new components (code-standards, verified by grep).
- **`settings-api.d.ts`** — renderer-local `declare global Window.settingsApi` typing (`ISettingsApi`, `ISaveContextInput`, `IApiKeyPresence`, `ISettingsSessionContextDto`).
- **`settings.tsx`** — now renders `<SettingsApp />`, replacing the 06-01 placeholder.

## Task Commits

1. **Task 1: Two-tab SettingsApp shell (Context default) + KeysTab** — `153e620` (feat)
2. **Task 2: ContextTab four-field editor + dirty indicator + explicit Save** — `6ca7440` (feat)

**Task 3: On-machine settings editor UI + dirty/save UX verification** — `checkpoint:human-verify` (gate=blocking). NOT auto-approvable (auto_advance is false). AWAITING human verification on the target Windows machine (see Checkpoint below).

## Link Parsing Authority (for 06-04)

**Authoritative location: MAIN.** The Context tab sends `links` as a RAW newline-joined string via `saveContext({ ..., links: form.links })`. The renderer NEVER splits/parses links — it only `(dto.links ?? []).join('\n')` for editing on pre-fill. 06-04's `settings:save-context` handler MUST call `parseLinks` (06-02) on the incoming `links` string to produce the persisted `string[]`, and `getContext` returns the persisted `links: string[]` for the join-on-prefill round-trip. This keeps the CRLF-safe parse in exactly one place.

## Deviations from Plan

None functionally. Two within-latitude choices the plan explicitly delegated:
- **Single-authority links decision (plan asked to "pick ONE and document it"):** chose MAIN as the parse authority; `saveContext` carries the raw newline string (documented above + in `settings-api.d.ts`).
- **Renderer-local `settingsApi` typing:** the plan offered "import the SettingsApi type OR a local declaration mirroring it" — chose the local declaration because the settings preload bundle is outside the renderer typecheck graph.

## Known Stubs

- `window.settingsApi.getContext()` / `saveContext()` are backed by 06-01 main-side **no-op stubs** (return undefined / no persistence) until 06-04 wires the handler bodies to `SessionContextRepository`. This is INTENTIONAL and per-plan: 06-03 is the renderer-only slice; the live save→grounding path is 06-04. The UI handles the undefined return gracefully (form starts empty; Save resolves without error). NOT a blocking stub for this plan's goal (CTX-01/SET-04/SET-02-UI are renderer-reachability + entry, all met).

## Threat Flags

None — no new security surface beyond the plan's threat model. T-06-10 (key value disclosure) is mitigated: KeysTab renders presence booleans only, inputs are write-only and cleared after save, getKeys is typed to return booleans (the component is structurally unable to receive a key string). T-06-11 (injection): React escapes all text; no `dangerouslySetInnerHTML`. No package installs (T-06-SC).

## Verification

- `npm run typecheck:web` — pass (both task commits).
- `npm run lint` (oxlint) — pass.
- `npm run build` — pass; `out/renderer/settings.html` + `out/renderer/assets/settings-*.css` emit.
- Grep gates: KeysTab `getKeys` count 4 (≥1) and never assigns a key string; ContextTab has all four field testids with Links as a textarea; zero `saveContext` calls inside any `onChange`; `text-dirty-indicator` present and dirty-gated; `links[].join('\n')` pre-fill present; zero inline `style=` in any new component; default tab === `'context'`.

## Checkpoint (Task 3 — AWAITING human verification)

Blocking `checkpoint:human-verify`. The full two-tab editor is built and wired to the settingsApi bridge. On the target Windows machine:
1. `npm run dev`, press `Ctrl+Alt+S` — confirm the window lands on the Context tab and shows the four labeled fields + Links textarea.
2. Type into a field — confirm the unsaved-changes indicator appears; click Save — confirm it clears and `saved ✓` shows. Reopen (close + Ctrl+Alt+S) — confirm pre-fill (fully meaningful once 06-04 lands; until then confirm no error and Save resolves).
3. Keys tab — enter a Deepgram + Anthropic key, Save; confirm presence updates to "set". Confirm NO key value is ever echoed back into the input after reopening.
4. Confirm the overlay stays click-through/unaffected throughout (focus discipline intact).

Resume signal: "approved", or describe the UI/UX issues.

## Self-Check: PASSED

All 6 source files + the SUMMARY verified present on disk; both task commits (`153e620`, `6ca7440`) verified in git log.

---
*Phase: 06-session-context-settings-window*
*Completed (auto tasks): 2026-06-19*
