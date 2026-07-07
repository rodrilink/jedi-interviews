# Phase 12: Scope Hotkey + Directed-at-Me - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Give the user control over *which* detected questions auto-answer, via a single global hotkey that cycles auto-answer scope through three states — **All questions → Directed-at-me → Off → All** (default **All** at session start) — with the current scope shown as a small text label on the overlay, plus a local, no-AI "directed-at-me" heuristic that (in that scope only) decides whether a detected question is aimed at the user. Requirements: **AA-03, AA-04**.

**In scope:** a new `Ctrl+Alt+D` scope-cycle chord registered through `HotkeyRegistrarService`; a main-owned `autoAnswerScope` flag cycled by that chord; a scope **gate** wrapping the Phase 11 auto-trigger at `index.ts:398` (Off suppresses the enqueue at source; Directed-at-me runs the heuristic; All fires unconditionally); the scope pushed to the overlay over the existing `jedi:status` channel and rendered as a small `Auto: All / Directed / Off` label; a pure `directed-at-me` utility in `src/main/stt/` (mirroring the QA-03 `question-classifier.utility.ts` pattern); and an optional **"Your name"** field added to the Settings window + persisted, feeding the heuristic as a strong 2nd-person cue.

**Out of scope (later/other phases):** any change to question *detection* (it stays the local QA-03 classification — no per-utterance AI call, SC 5); the manual `Ctrl+Alt+A` path (unchanged, still works in every scope, SC 3); auto-firing talking-points/code-challenge (only `answer` auto-fires, from v1.2); user-customizable hotkey remapping (CTL-V2-01); richer per-answer scope controls.

</domain>

<decisions>
## Implementation Decisions

### User name for the directed-at-me cue (D-01)
- **D-01:** **Add an optional "Your name" field to the existing Settings window, persisted via the electron-store pattern** (mirroring `SessionContextRepository`'s store-under-`userData` approach, NOT `safeStorage` — the name is not a secret but must not be logged, see threat model). The directed-at-me heuristic uses the configured name as a **strong 2nd-person cue** when set (a question addressing the user by name counts as directed-at-me), and **falls back gracefully to `you`/`your` + addressee-absence logic when the field is blank**. There was NO user-name setting in the app before this phase — Settings previously persisted only API keys (`ApiKeyStoreService`) and session context. The name must never leak into logs alongside transcript text (threat model: "User name as PII in logs").

### Directed-at-me heuristic decision rules (D-02)
- **D-02:** **Lean recall — answer unless the question is clearly aimed at someone else.** In Directed-at-me scope a detected question auto-answers when it has a positive 2nd-person cue (`you`/`your`/the configured name) **OR is ambiguous** (open-to-the-room, no addressee cue at all — e.g. "What's the timeline?"). It is **skipped only** when it is clearly directed at **another named person**. This mode narrows the firehose by filtering OUT other-directed questions, not by requiring a positive cue. **All** mode answers every classified question regardless of the heuristic; **Off** answers none.

### How "aimed at someone else" is detected (D-03)
- **D-03:** **Named-other vocative cue, excluding the configured name.** Because the app diarizes speakers only as `Person 1/2/…` (no real names) and only the user's own name is configured, "aimed at someone else" is detected by a **direct-address (vocative) to a name that is NOT the user's** — e.g. "Sarah, what do you think?", "over to you, Mike", "can Mike take this one?". Detected via capitalized-name-in-address-position patterns (leading `Name,` / trailing `…, Name?` / "to/over to <Name>") minus the configured user name. Conservative about skipping: if no clear other-name vocative is present, the question is NOT skipped (consistent with D-02's lean-recall bias). Pure + unit-testable over representative utterances (SC 4).

### Scope-cycle hotkey (D-04)
- **D-04:** **`Ctrl+Alt+D`** (mnemonic: "directed"/scope) for the 3-state cycle, registered through `HotkeyRegistrarService` as a new `discrete` chord (one entry in `HOTKEY_CHORDS` + a handler in `index.ts`; a missing handler surfaces in `register().failed` via CTL-03 like every other chord). `D` is OUTSIDE the locked, conflict-tested set {J, arrows, [, ], H, Q, K, PgUp, PgDn, A, T, G, F, S, C, Y, M}. **MANDATORY human-verify GO/NO-GO:** run the standard on-machine Teams/Zoom/VS Code conflict re-test (02-03 protocol) before finalizing; fall back to a reserved letter (e.g. `U`) if a collision surfaces and update the chord's TSDoc.

### Overlay scope indicator (D-05)
- **D-05:** **Small read-only text label** rendering the current scope as words — `Auto: All` / `Auto: Directed` / `Auto: Off` — pushed over the existing `jedi:status` channel using the same main-owned-flag pattern as `activePanel` / `hudVisible` (add an `autoAnswerScope` field to `IOverlayStatus`, declared identically in main + preload + renderer). No new control channel, no new focusable element — it is a status view like the existing HUD rows (threat model: "Mode indicator focus discipline"). No color coding for v1.2 (text is self-explanatory; color is a later polish if wanted).

### Claude's Discretion
- The exact scope state machine shape (an enum + a cycle function vs. an index into a 3-tuple) and where the `autoAnswerScope` flag lives (a small main-side holder threaded like `activePanel`, vs. on the orchestrator) — planner's call, provided Off suppresses at the enqueue source and the cycle order is All→Directed→Off→All.
- The precise regex/token rules inside the directed-at-me utility (opener sets, vocative patterns, name matching case/whitespace normalization) — as long as D-02/D-03's behavior holds and it stays a pure no-AI function with representative unit cases.
- The exact Settings field placement/label and the config key name for the persisted user name, and whether the heuristic reads the name pull-on-run vs. cached — planner's call, provided the name is never logged.
- Whether the scope gate lives inline at `index.ts:398` or is extracted into a small helper the utterance handler calls — as long as the manual `Ctrl+Alt+A` path stays byte-for-byte unchanged.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — **AA-03** (3-state scope hotkey All/Directed-at-me/Off, default All, Off disables for the session, scope visible on overlay) and **AA-04** (local no-AI directed-at-me heuristic; no per-utterance AI call, consistent with QA-03). Milestone v1.2 section.
- `.planning/ROADMAP.md` §"Phase 12: Scope Hotkey + Directed-at-Me" — goal, the 5 success criteria, and the threat model (new-chord conflict, Off-not-truly-off, heuristic false pos/neg, user-name-as-PII-in-logs, indicator focus discipline). This CONTEXT resolves the HOW-gray-areas the ROADMAP left open.

### The gate point + prior-phase seams (READ before planning)
- `.planning/phases/11-auto-answer-trigger/11-CONTEXT.md` — the auto-trigger this phase GATES. Phase 11 hard-coded scope = All; Phase 12 owns the gate. Note D-02 (both speaker kinds fire) and the `trigger('answer', 'auto', text)` entry.
- `src/main/index.ts` ~line 388-401 — the `gateway.on('utterance')` handler. The `if (utterance.classification === 'question') aiOrchestrator.trigger('answer', 'auto', utterance.text)` block at ~398 is EXACTLY where the scope gate wraps (Off → no enqueue; Directed-at-me → heuristic gates; All → fire). The manual `Ctrl+Alt+A` path is separate and stays unchanged.
- `src/main/hotkey-registrar.service.ts` — `HOTKEY_CHORDS` (add the `Ctrl+Alt+D` `scope-cycle` entry here; note the on-machine conflict-test TSDoc convention every chord follows), `HotkeyHandlerMap`, `HOTKEY_ACTION_LABELS`, `IHotkeyRegistrationResult.failed` (CTL-03 surfacing).
- `src/main/stt/question-classifier.utility.ts` — the PURE no-AI utility pattern the directed-at-me heuristic mirrors (pure/idempotent, no classes/state, local regex, conservative default, `QUESTION_OPENERS` set style). New utility goes alongside it in `src/main/stt/`.
- `src/main/stt/stt-provider.interface.ts` — `IUtteranceEvent` (`text`, `speaker`, `isDiarized`, `classification`); the heuristic reads `text` (and may use `speaker`/`isDiarized` for context).

### Status push + settings + persistence patterns
- `src/preload/index.ts` — `IOverlayStatus` (~line 10; add `autoAnswerScope` field, declared identically in main/preload/renderer), `STATUS_CHANNEL = 'jedi:status'` (~line 70), `onStatus` (~line 136).
- `src/main/index.ts` `pushStatus(window)` call sites (~lines 148, 206, 619) + the `activePanel` focus-cycle handler (~line 137) — the exact main-owned-flag + re-push pattern the scope flag follows.
- `src/renderer/src/SettingsApp.tsx` + `src/renderer/src/settings.css` + `src/renderer/src/settings-api.d.ts` — the Settings window to add the optional "Your name" field to.
- `src/main/context/session-context.repository.ts` — the electron-store-under-`userData` persistence pattern to mirror for the user-name config (NOT `safeStorage`; the name is not a secret but is never logged).
- `src/main/secrets/api-key-store.service.ts` — reference only (how a persisted value is saved/retrieved; the name is NOT stored here — it is not a secret).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `HotkeyRegistrarService` + `HOTKEY_CHORDS` — adding a chord is one declarative entry + one handler in `index.ts`; the passive-uiohook + globalShortcut-fallback + CTL-03 `failed` surfacing all come for free.
- `question-classifier.utility.ts` — the exact pure-utility template (opener `Set`, local sentence-split regex, conservative default) for the directed-at-me heuristic; both live in `src/main/stt/` and are unit-tested the same way.
- `IOverlayStatus` + `pushStatus(window)` + `onStatus` — the one-way status-flag channel; `autoAnswerScope` rides it exactly like `activePanel`/`hudVisible` (main-owned, re-pushed on change, rendered read-only).
- `SessionContextRepository` electron-store pattern — the persistence shape to mirror for the user-name config (store-under-`userData`, testable via an injected store handle).
- The Phase 11 auto-trigger at `index.ts:398` — the single gate point; wrapping it with the scope check is the whole cost-control mechanism this phase adds.

### Established Patterns
- **New chord = declarative entry + handler + on-machine conflict re-test** (Phases 2/5/6/7). The `Ctrl+Alt+D` chord follows this: TSDoc noting it's outside the locked set + a pending human-verify conflict re-check.
- **Main-owned flag, re-pushed over `jedi:status`, rendered read-only** (`activePanel`, `hudVisible`, `overlayInteractive`). The scope flag is another instance — no new channel, no focusable element (threat model: indicator focus discipline).
- **Pure, no-AI, unit-tested STT utilities** (`question-classifier.utility.ts`, `speaker-map`). The directed-at-me heuristic MUST be pure (SC 4/5): no AI call, representative-case unit test.
- **Suppress-at-source for Off** — the scope gate lives at the enqueue point (`index.ts:398`), so Off produces zero `stream()` calls from the auto path (threat model: "Off is not truly off"); a test asserts this.

### Integration Points
- `index.ts` `gateway.on('utterance')` handler — the scope gate wraps the Phase 11 auto-trigger here.
- `index.ts` hotkey handler map — the new `scope-cycle` handler cycles the flag + calls `pushStatus`.
- `IOverlayStatus` (main/preload/renderer mirrors) + the overlay HUD/panel that renders status — the `autoAnswerScope` label.
- Settings window (`SettingsApp.tsx`) + a new user-name config store — the "Your name" field and its persistence.

</code_context>

<specifics>
## Specific Ideas

- **Cycle order + default:** All → Directed-at-me → Off → All, default **All** at every session start (not persisted across sessions unless the planner finds it trivial — ROADMAP says "defaulting to All at session start").
- **Indicator copy:** `Auto: All` / `Auto: Directed` / `Auto: Off` (exact wording is discretion, but keep it to the compact `Auto: <state>` shape).
- **Directed-at-me acceptance test (SC 4):** a pure unit test over representative utterances — "What do you think?" (2nd-person → answer), "Sarah, your thoughts?" (other-name vocative → skip), "What's the timeline?" (ambiguous → answer, lean-recall), "Rodrigo, can you cover this?" (configured name → answer). And an Off test asserting zero `stream()` calls from the auto path (SC 3).
- **Name field is optional** — a blank name must not break the heuristic; it degrades to `you`/`your` + other-name-vocative logic.

</specifics>

<deferred>
## Deferred Ideas

- **Color-coded scope indicator** — text-only for v1.2; a color accent per state is a later polish if the label proves insufficient.
- **Persisting the last-used scope across sessions** — v1.2 defaults to All every session start (ROADMAP). Remembering the last scope is a possible later enhancement.
- **User-customizable hotkey remapping (CTL-V2-01)** — the scope chord is a fixed default like every other; remapping UI is v2.
- **Auto-firing talking-points / code-challenge under scope** — only `answer` auto-fires in v1.2.
- **Reviewed todos (not folded):** the three todo.match-phase hits (audio-seam warnings, HUD session timer, scrollbar history) were keyword-only matches unrelated to scope/directed-at-me — reviewed and NOT folded; they belong to their own follow-ups.

</deferred>

---

*Phase: 12-scope-hotkey-directed-at-me*
*Context gathered: 2026-07-07*
