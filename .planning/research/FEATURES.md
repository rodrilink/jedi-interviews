# Feature Research

**Domain:** Hotkey-driven, always-on-top desktop overlay "interview / meeting copilot" (live system-audio transcription + on-demand grounded LLM assistance), Windows-only, single-user
**Researched:** 2026-06-16
**Confidence:** HIGH (multiple converging products + verified Electron/Windows API behavior)

## Summary for the roadmap author

The v1 scope in PROJECT.md is well-chosen and matches what real products in this category ship. This research **sharpens what each requirement minimally entails** and **surfaces five table-stakes features the PROJECT.md requirements imply but do not name explicitly**:

1. **Content protection (hide overlay from screen-share)** — every product in this category treats this as table stakes; PROJECT.md describes "never stealing focus" but never names capture-exclusion. For an overlay you read during a *shared* meeting, this is arguably the single most load-bearing feature.
2. **Response history / scrollback + keyboard scrolling** — a streamed answer that scrolls off-screen with no way to scroll back is unusable in a keyboard-only overlay.
3. **STT auto-reconnect** — Deepgram websockets drop; without silent reconnect the transcript dies mid-meeting.
4. **"Clear transcript buffer" + bounded rolling window** — both an explicit hotkey and an automatic cap.
5. **First-run / API-key entry flow** — the app is dead without Deepgram + Anthropic keys; this needs a real (keyboard-reachable) entry path, not a hand-edited file.

Everything else in PROJECT.md's Active list maps cleanly onto table stakes. The three AI modes are the differentiator; the *grounding via pasted Session Context* is what makes them more than a generic chatbot.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these makes the tool feel broken in a live meeting.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Transparent, always-on-top, focus-stealing-free overlay | Core premise; if it grabs focus the meeting app loses input | MEDIUM | Electron `BrowserWindow`: `transparent:true`, `alwaysOnTop` (use `'screen-saver'` level), `focusable:false`, `skipTaskbar:true`. `focusable:false` is the key to never stealing focus — but it also means **you cannot rely on in-window keyboard events**, forcing the global-hotkey model (already a requirement). |
| **Content protection — invisible to screen share** *(implied, not named in PROJECT.md)* | In a shared meeting, a visible AI overlay defeats the purpose; this is the category's defining feature | LOW-MEDIUM | Electron `win.setContentProtection(true)` → Windows `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`. Requires **Win10 2004+** (true exclusion); older shows a black rectangle. Known Electron gotchas: protection is **cleared by `win.hide()`** (re-apply on show — electron#45844) and can cause black rectangles in some full-screen-share paths (electron#46507). Verify on the user's exact Win11 build early. |
| Global hotkey to show/hide the overlay | Need to dismiss instantly; keyboard-only | LOW | Electron `globalShortcut`. Toggle visibility; re-assert content protection on show. |
| Keyboard-only move / reposition | "Drag away from shared region" without a mouse | LOW | Hotkeys nudge `setPosition` (e.g. Alt+arrows). Resize is **optional** (see differentiators). Aura-AI uses Alt+arrows to move. |
| Adjustable opacity | Read overlay without fully obscuring meeting content behind it | LOW | `win.setOpacity()` bound to a few discrete levels (Aura-AI: 40/70/100% on Alt+1/2/3) is simpler and better than a continuous slider for keyboard control. |
| Live rolling transcript on the overlay | The whole feed the AI acts on; user must see what was heard | MEDIUM | Deepgram streaming. Must render **interim (partial) results greyed/italic, finalized text solid** — this distinction is universal across products and prevents the "text keeps rewriting itself" confusion. |
| Bounded rolling transcript buffer | Memory + readability; meetings run an hour+ | LOW | Cap by lines or minutes (Aura-AI: 6–20 configurable "exchanges"). Drop oldest. |
| Clear / reset transcript buffer (hotkey) | New topic or new question; stop stale context bleeding into prompts | LOW | Explicit hotkey. Cheap, high value — prevents the previous discussion polluting the next answer. |
| STT auto-reconnect on websocket drop | Cloud STT sockets drop; silent death mid-meeting is unacceptable | MEDIUM | Aura-AI explicitly auto-reconnects. Needs backoff + a visible connection state indicator on the overlay. |
| Streaming AI responses to the overlay | Latency hiding — first tokens must appear fast in conversation flow | MEDIUM | Anthropic streaming API. Append tokens to a scrollable response pane. This is core value per PROJECT.md. |
| **Response scrollback + keyboard scroll** *(implied, not named)* | Streamed answers overflow; keyboard-only means no scrollbar dragging | LOW-MEDIUM | Aura-AI: Alt+↑/↓ to scroll, Home/End to jump. Without this a long answer is unreadable. Keep last N responses navigable. |
| Mode hotkey: **answer the question** from recent transcript | Primary use case | MEDIUM | Take recent finalized transcript span + Session Context → LLM → stream answer. Min viable span = "last N lines / last ~60s." |
| Mode hotkey: **suggest talking points** about project work | Second use case | MEDIUM | Same pipeline, different system prompt (brainstorm/contribute rather than answer-the-asked-question). Leans hardest on Session Context grounding. |
| Mode hotkey: **screenshot → solve code challenge** | Third use case; vision path | MEDIUM-HIGH | Capture screen (Electron `desktopCapturer` or native screenshot) → send image to Claude vision (Opus 4.8) + Session Context → stream solution. Note: screenshot must capture the *meeting/IDE* content, and the overlay itself should be excluded from its own screenshot. |
| Session Context: paste / edit / persist project notes, tickets, snippets, links | Grounding; this is what makes answers relevant, not generic | MEDIUM | Local store (file or SQLite). Inject into every mode's prompt. PROJECT.md store design should anticipate a future URL-fetcher. |
| API-key configuration (Deepgram + Anthropic), persisted locally | App is non-functional without keys | LOW-MEDIUM | Must be reachable via keyboard (overlay is `focusable:false`, so likely a separate normal settings window). Don't ship a hand-edited-JSON-only flow — that's a v1 papercut. Store keys in OS credential vault or at least a local file with clear path. |
| Connection / status indicator on overlay | User must know if it's listening, transcribing, thinking, or dead | LOW | Tiny state badge (listening / reconnecting / generating / error). |

### Differentiators (Competitive Advantage)

Where this tool earns its keep vs. a generic chatbot or off-the-shelf copilot.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Grounding in user's own pasted project context** | Talking points / answers reference the *actual* tickets and repo, not generic advice | MEDIUM | This is the project's real edge over Cluely-style generic copilots. Quality of prompt-injection (how context is templated) matters more than the store. |
| **Tiered model routing (Haiku fast / Opus hard)** | Cheap-fast for talking-points & classification, heavy for code-solving | MEDIUM | PROJECT.md already specifies this. Map mode→model: talking-points/answer → Haiku-first, screenshot-solve → Opus. Aura-AI/Natively both do multi-model routing; here it's intentional cost/quality tiering. |
| **Distinct hotkey per AI mode (no menu)** | Zero-friction, keyboard-only, no focus steal | LOW | Three mode hotkeys + utility hotkeys. This *is* the interaction model; treat as table stakes-adjacent but it's a deliberate design edge. |
| **Transcript-span selection for the action** | Which words the AI acts on — "last question" vs "last 2 min" | MEDIUM | Notably, **none of the surveyed products solve this cleanly** — they just send a rolling window. v1: send "last N finalized lines / last ~60s," default sensible, optionally a hotkey to extend the span. A clean span-picker (e.g. cycle 30s/60s/120s windows) would be a genuine differentiator. |
| Brief vs. detailed answer toggle | In-conversation you want bullets; reviewing you want depth | LOW | Aura-AI toggles bullet hints vs. full answers. One hotkey or a per-mode default. |
| Multiple named Session Contexts | One per meeting/interview/project; switch between them | MEDIUM | v1 can ship a single context; named multi-context is a clean v1.x. Store design should allow it from day one. |
| Click-through ("ghost") mode | Click apps *behind* the overlay without moving it | LOW | `setIgnoreMouseEvents(true)`. Aura-AI Alt+X. Nice with keyboard-only model; low cost. |
| Hotkey customization | Avoid clashes with meeting-app / IDE shortcuts | MEDIUM | Real risk: default hotkeys collide with Teams/Zoom/VS Code. At minimum document defaults; remapping is v1.x. |

### Anti-Features (Commonly Requested, Often Problematic)

Things adjacent products do that this v1 should deliberately NOT build (most already correctly excluded in PROJECT.md — captured here so they don't creep back in).

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-detect questions and answer unprompted | "Magic" hands-free help | Cost explosion (constant LLM calls), awkward mistimed pop-ups, breaks the predictable keyboard-only model; needs a reliable question-classifier you don't have | Hotkey-triggered only (already in PROJECT.md). |
| Mic capture of the user's own voice / speaker diarization | "Capture the whole conversation" | Doubles audio plumbing, adds diarization complexity, and the user's own words rarely need transcribing to *help the user* | System audio only for v1 (already deferred). Diarization is v2. |
| Live Jira/Azure/GitHub OAuth fetching | Auto-pull ticket/repo context | Per-provider OAuth surface is huge; 90% of grounding value comes from pasted text | Paste-based context; store designed for a future URL-fetcher (already in PROJECT.md). |
| Local on-device Whisper for v1 | Privacy | Slower/heavier to get right than cloud; distracts from validating the core loop | Deepgram now behind an STT interface; Whisper is the documented swap-in (already in PROJECT.md). |
| Local RAG / vector memory across past meetings | "Second brain" recall | Big build (embeddings, vector store, retrieval tuning) for unproven value in a v1 personal tool; Natively ships it but it's a mature product | Single in-session context window + pasted notes. Revisit only if recall demand is real. |
| Meeting recording, post-call summaries, follow-up emails | Standard "AI notetaker" features | Different product (async notetaker) than this live-copilot; large surface, not the core value | Out of scope; the live transcript + on-demand answers are the product. |
| "Process disguise" / masquerade as Terminal, anti-proctoring stealth | Defeat interview proctoring | Ethically off-mission (PROJECT.md frames this as a personal study/prep aid, not cheating), and a maintenance arms race | Content protection for screen-share comfort is sufficient and on-mission. |
| Continuous-opacity slider / freeform mouse drag-resize | "Polish" | Fights the keyboard-only constraint; mouse interaction risks focus steal | Discrete opacity levels + arrow-key nudge (keyboard-only). |
| Multi-LLM-provider BYOK abstraction | Flexibility | Premature generality; PROJECT.md commits to Claude | Anthropic only; STT already abstracted, which is the one that matters for the documented Whisper swap. |

---

## Feature Dependencies

```
Transparent always-on-top overlay window
    ├──requires──> focusable:false  ──forces──> Global hotkey control (no in-window key events)
    ├──enables───> Content protection (setContentProtection on the window)
    │                   └──gotcha──> cleared by win.hide(): must re-apply on show/toggle
    ├──hosts────> Live transcript pane ──> Response pane ──> Status indicator
    └──needs────> Keyboard scroll + opacity + move hotkeys (to be usable at all)

System audio loopback capture
    └──requires──> Live transcript (Deepgram stream)
                       ├──requires──> Auto-reconnect (sockets drop)
                       ├──requires──> Interim/final rendering
                       └──requires──> Bounded buffer + Clear hotkey

Three AI modes (answer / talking-points / solve-screenshot)
    ├──answer & talking-points──require──> Transcript span selection (which text to send)
    ├──all three──require──> Session Context (grounding) + API keys configured
    ├──all three──require──> Streaming response pane + scrollback
    ├──tiered──> Model routing (Haiku fast / Opus for screenshot-solve)
    └──solve-screenshot──requires──> Screenshot capture + Claude vision input
                                          └──must──> exclude overlay from its own screenshot

Session Context (paste/edit/persist)
    └──enhances──> all three AI modes (the differentiator)
    └──future──> Multiple named contexts ──> URL-fetcher

API-key config window
    └──requires──> a separate focusable window (overlay is focusable:false)
```

### Dependency Notes

- **`focusable:false` forces the global-hotkey model.** A non-focusable always-on-top window cannot receive normal key events, so *all* control must be `globalShortcut`-based. This is consistent with the keyboard-only requirement — but it also means the **settings/API-key UI must be a separate, focusable window**, not part of the overlay.
- **Content protection must be re-applied after every show.** `win.hide()` clears it (electron#45844). Bundle "show overlay" and "set content protection" into one operation or answers will leak into a screen-share after a hide/show cycle.
- **AI modes depend on transcript-span selection**, which is the under-solved part of the domain. Ship a sane default (last ~60s / last N finalized lines) before investing in a span-picker.
- **Screenshot-solve must exclude the overlay from its own capture**, or the screenshot will contain the AI overlay (and prior answers), confusing the model and leaking context.
- **API keys gate everything** — sequence the first-run key entry early so the rest is testable.

---

## MVP Definition

### Launch With (v1) — matches PROJECT.md Active list, plus the implied table stakes

- [ ] Transparent always-on-top overlay, `focusable:false`, `skipTaskbar:true` — core premise
- [ ] **Content protection (WDA_EXCLUDEFROMCAPTURE)** — *add explicitly; the category's defining feature, only implied in PROJECT.md*
- [ ] Show/hide + move + opacity hotkeys — basic keyboard usability
- [ ] **Keyboard scroll of the response pane** — *add explicitly; long answers are unreadable without it*
- [ ] System-audio loopback capture → Deepgram live transcript with interim/final rendering
- [ ] **Transcript auto-reconnect + bounded buffer + clear-buffer hotkey** — *make these explicit*
- [ ] Three AI mode hotkeys (answer / talking-points / solve-screenshot), streaming output
- [ ] Default transcript-span selection (last ~60s / last N finalized lines)
- [ ] Tiered model routing (Haiku fast / Opus for screenshot-solve)
- [ ] Session Context: paste/edit/persist a single context, injected into all prompts
- [ ] **API-key entry window (keyboard-reachable) + status indicator** — *make explicit*

### Add After Validation (v1.x)

- [ ] Multiple named Session Contexts — trigger: using it across more than one meeting/project
- [ ] Hotkey customization / remapping — trigger: a default collides with Teams/Zoom/VS Code in real use
- [ ] Transcript-span picker (cycle 30/60/120s windows or "last question") — trigger: default span misses too often
- [ ] Brief vs. detailed answer toggle — trigger: answers consistently too long/short for live use
- [ ] Click-through ghost mode — trigger: overlay placement blocks needed clicks
- [ ] Resize hotkeys — trigger: fixed size proves too small/large

### Future Consideration (v2+)

- [ ] Local Whisper STT (privacy) — defer: cloud validates the loop first; interface already in place
- [ ] Speaker diarization / mic capture — defer: large audio rework, low marginal value for self-help
- [ ] URL-fetcher for context (then OAuth Jira/GitHub) — defer: per-provider surface; paste covers 90%
- [ ] Local RAG memory across meetings — defer: heavy build, unproven for a personal v1
- [ ] Post-meeting summaries / notetaker features — defer: a different product

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Transparent always-on-top, no focus steal | HIGH | MEDIUM | P1 |
| Content protection (screen-share invisibility) | HIGH | LOW-MEDIUM | P1 |
| Live transcript (interim/final) + auto-reconnect | HIGH | MEDIUM | P1 |
| Bounded buffer + clear hotkey | MEDIUM | LOW | P1 |
| Streaming response + keyboard scrollback | HIGH | LOW-MEDIUM | P1 |
| Three AI mode hotkeys | HIGH | MEDIUM | P1 |
| Session Context (single, pasted, grounding) | HIGH | MEDIUM | P1 |
| Screenshot → vision solve | HIGH | MEDIUM-HIGH | P1 |
| API-key entry window + status indicator | HIGH | LOW-MEDIUM | P1 |
| Tiered model routing (Haiku/Opus) | MEDIUM | MEDIUM | P1 |
| Default transcript-span selection | HIGH | MEDIUM | P1 |
| Move / opacity hotkeys | MEDIUM | LOW | P1 |
| Multiple named contexts | MEDIUM | MEDIUM | P2 |
| Hotkey customization | MEDIUM | MEDIUM | P2 |
| Transcript-span picker | MEDIUM | MEDIUM | P2 |
| Brief/detailed toggle | LOW-MEDIUM | LOW | P2 |
| Click-through ghost mode | LOW-MEDIUM | LOW | P2 |
| Local Whisper / diarization / RAG / notetaker | LOW (v1) | HIGH | P3 |

## Competitor Feature Analysis

| Feature | Cluely (commercial) | Aura-AI / Natively (open-source) | Our Approach |
|---------|---------------------|----------------------------------|--------------|
| Overlay + screen-share invisibility | Yes, core selling point | Yes, `WDA_EXCLUDEFROMCAPTURE` (Aura) | Yes — `setContentProtection`, re-applied on show |
| Keyboard-only control | Partial (`Cmd/Ctrl+K`) | Full global-hotkey scheme (Aura: Alt+combos) | Full — `focusable:false`, all control via global hotkeys |
| Opacity / move | Limited | Discrete opacity + arrow-move (Aura) | Discrete opacity levels + arrow nudge |
| Transcript interim/final | Yes | Yes; configurable 6–20 exchange window | Yes; bounded buffer + clear hotkey |
| Auto-detect & answer | Yes (auto-suggests) | Some | **No** — hotkey-only by design (cost/predictability) |
| Screenshot code-solve | Yes (screen scan) | Yes, batch screenshots + vision models (Aura) | Single screenshot → Claude Opus vision |
| Context feeding | Playbooks / doc upload | Pasted notes (≤8k chars), files, resume/JD | Pasted notes/tickets/snippets/links, local, prompt-injected |
| Model strategy | Hosted | Multi-provider BYOK + speed routing | Claude only, tiered Haiku/Opus |
| Transcript-span selection | Rolling window (opaque) | Rolling window (opaque) | Default last ~60s; explicit picker is our v1.x edge |
| Ethical framing | Aggressive "undetectable cheating" | Mixed | Personal study/prep/notetaking; no anti-proctoring masquerade |

## Sources

- Cluely overview & feature set — https://tooldirectory.ai/tools/cluely , https://navtools.ai/tool/cluely (MEDIUM — vendor/directory descriptions)
- Aura-AI open-source feature & hotkey list — https://github.com/Rkcr7/Aura-AI (HIGH — concrete repo docs; best source for keyboard scheme)
- Natively open-source copilot feature list — https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant (HIGH — repo docs)
- Open-Cluely (live transcription + screen capture + answers) — https://github.com/shubhamshnd/Open-Cluely (MEDIUM)
- Electron `setContentProtection` → `WDA_EXCLUDEFROMCAPTURE` behavior, Win10 2004+ requirement, `win.hide()` clearing it — https://github.com/electron/electron/issues/45844 , https://github.com/electron/electron/issues/46507 , https://levelup.gitconnected.com/how-i-made-a-desktop-app-invisible-to-screen-sharing-electron-os-level-tricks-5734513c1e67 (HIGH — official Electron issue tracker + technical writeup)
- Interview Coder screenshot-solve workflow & global hotkeys — https://www.interviewcoder.co/still_working , https://www.automateed.com/interview-coder-review (MEDIUM — vendor + review)
- Category comparisons (table-stakes consensus) — https://ophyai.com/best-ai-interview-copilot , https://www.shadecoder.com/blogs/top-10-cluely-alternatives-in-2025-best-invisible-ai-assistants-for-meetings-and-interviews (MEDIUM)

---
*Feature research for: real-time AI interview/meeting copilot overlay (Electron, Windows)*
*Researched: 2026-06-16*
