# Phase 6: Session Context + Settings Window - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 6-Session Context + Settings Window
**Areas discussed:** Window lifecycle & hotkey, Context editor shape, Runtime key application, Active-context & multi-context seam

---

## Window lifecycle & hotkey

### Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| On-demand, created lazily | Hotkey creates the focusable settings window on first press (focuses if open); closing destroys it. App boots overlay-only. | ✓ |
| Created hidden at launch, toggled | Built hidden at boot; hotkey show()/hide()s it like the overlay's J toggle. Faster first open, but a focusable hidden window lives all session. | |

**User's choice:** On-demand, created lazily (D-01)
**Notes:** Boot stays overlay-only; Ctrl+Alt+S creates+shows, close destroys, re-press recreates.

### Hotkey + layout

| Option | Description | Selected |
|--------|-------------|----------|
| Ctrl+Alt+S, single scroll page | One scrollable page: keys on top, context below. | |
| Ctrl+Alt+S, two tabs | Two tabs (Keys / Context), Context default. Cleaner separation. | ✓ |
| Different letter | C / O / comma, user-specified layout. | |

**User's choice:** Ctrl+Alt+S, two tabs (D-02/D-03)
**Notes:** Context is the landing tab (used more than keys). S re-verified against Teams/Zoom/VS Code per 02-03.

### Settings IPC

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated settings preload + invoke/handle | Settings window gets its own typed contextBridge API over invoke→handle; overlay one-way preload untouched. | ✓ |
| Reuse overlay preload, extend it | Add two-way methods to the shared preload both windows load; widens the overlay's one-way surface. | |

**User's choice:** Dedicated settings preload + scoped invoke/handle (D-04)
**Notes:** Preserves the IN-01 one-way boundary for the overlay; main stays the only safeStorage/store touch point.

---

## Context editor shape

### Editor fields

| Option | Description | Selected |
|--------|-------------|----------|
| Four labeled fields matching the schema | Notes / Ticket text / Repo snippets textareas + Links (one URL per line). Maps 1:1 to IGroundingContext and formatContext() blocks. | ✓ |
| One freeform blob | Single textarea → notes; other fields empty. Simplest but loses the labeled structure the prompt already formats. | |

**User's choice:** Four labeled fields (D-05)
**Notes:** No new prompt formatting needed — editor mirrors the existing formatContext() shape.

### Save behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit Save button | Edit → Save persists + makes active; dirty indicator for unsaved edits. Matches Keys-tab save model. | ✓ |
| Autosave on blur/debounce | Edits auto-persist; no button, more writes, less explicit control. | |

**User's choice:** Explicit Save button with dirty indicator (D-06)
**Notes:** One write per save; becomes the active context immediately.

---

## Runtime key application

### Apply timing

| Option | Description | Selected |
|--------|-------------|----------|
| Live apply, no restart | Saving re-keys running gateways; Anthropic next-call, Deepgram websocket teardown+reconnect. | ✓ |
| Live for Anthropic, restart note for Deepgram | Anthropic live; Deepgram saved but applies on next launch with a restart note. | |
| Restart to apply (both) | Both saved+encrypted, read at next boot only. | |

**User's choice:** Live apply, no restart — both keys (D-07)
**Notes:** Deepgram reconnect reuses the existing STT connect/reconnect path; first-run is paste-save-works.

### Key precedence

| Option | Description | Selected |
|--------|-------------|----------|
| safeStorage wins, .env is fallback | Saved key if present, else process.env (.env), else '' → missing-key state. .env dev workflow unchanged. | ✓ |
| .env wins, safeStorage fallback | Shell/.env always overrides; risks stale-.env shadowing the UI-saved key. | |
| safeStorage only, retire .env keys | Settings is the only source; breaks current .env dev launch until keys saved once. | |

**User's choice:** safeStorage wins, .env is fallback (D-08)
**Notes:** Deliberately inverts loadDotenvFile's "real env wins" rule for these two keys only, in the resolution layer (dotenv utility unchanged). Avoids the stale-.env shadowing trap.

---

## Active-context & multi-context seam

### Multi-context UI

| Option | Description | Selected |
|--------|-------------|----------|
| Schema ready, single implicit context in UI | ULID-keyed array + activeId in the store; UI edits exactly one always-active context, no selector/name shown. | ✓ |
| Visible selector + naming now | Full create/switch/delete/name CRUD this phase; exercises the schema in UI but risks scope creep. | |

**User's choice:** Schema ready, single implicit context in UI (D-09)
**Notes:** CTX-04 satisfied structurally; multi-context UI deferred to the future fetcher. Fits mvp "ships one" scope.

### Context delivery

| Option | Description | Selected |
|--------|-------------|----------|
| Inject a context provider into the orchestrator | Orchestrator constructed with getActiveContext(); pulls latest at each trigger. Mirrors transcriptBuffer/pushAi injection. | ✓ |
| Push context into the orchestrator on save | Save calls orchestrator.setContext(); orchestrator holds mutable currentContext. | |

**User's choice:** Inject a context provider (pull-on-trigger) (D-10)
**Notes:** Always-current (mid-session saves picked up next trigger); no mutable state added to the orchestrator. Fills ai-orchestrator.ts:165 context: undefined → active context.

---

## Claude's Discretion

- electron-store key names / file layout for the contexts array + two key ciphertexts (ciphertext only, per placeholder-secret precedent).
- Settings-window dimensions, styling, tab implementation, dirty indicator, masked vs revealable key inputs, "saved ✓" confirmation.
- Fallback letter if Ctrl+Alt+S collides in the conflict re-check.
- ULID generation mechanism (pure-JS preferred — no native build).
- Exact ISessionContextDto metadata beyond id + the four grounding fields (e.g. name, createdAt, source).
- How the Deepgram re-key reconnect is wired (reuse reconnect vs pipeline rebuild — least invasive).
- Whether the settings window surfaces a "missing key" hint mirroring the overlay's inline message.

## Deferred Ideas

- Multi-context UI (named contexts, selector, CRUD) — schema ships now, UI deferred to the future fetcher.
- Live Jira/Azure/GitHub URL-fetcher — out of scope v1; CTX-04 store + source metadata is its seam.
- Autosave for the context editor — rejected for v1 in favor of explicit Save.
- Vision / code-challenge mode + Windows packaging — Phase 7 (AI-03, PKG-01).
- Per-mode / per-context different grounding — not needed; all modes share the active context via getActiveContext().
