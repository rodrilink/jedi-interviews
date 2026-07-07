# Jedi Interviews

## What This Is

A personal Windows desktop assistant for meetings and interviews. It runs as a transparent,
always-on-top overlay window — controlled entirely by keyboard — that listens to the computer's
system audio, keeps a live rolling transcript on screen, and on demand calls an AI to help the user
participate: answering questions directed at them, suggesting talking points when the team discusses
project work, and solving code challenges captured from a screenshot. The user feeds the session with
project context (notes, ticket text, repo snippets, reference links) so the AI's output is grounded
in the actual work being discussed.

It is built as a personal study, meeting-preparation, and live note-taking aid for the user's own
meetings and mock-interview practice.

## Core Value

When the user presses a hotkey during a meeting, a grounded, relevant AI response appears on the
overlay fast enough to be useful in the flow of conversation — without ever stealing keyboard/mouse
focus from the meeting app.

## Current Milestone: v1.1 Structured Q/A Panel

**Goal:** Turn the flat-text Q/A panel into structured, speaker-attributed cards that clearly distinguish questions from statements at a glance.

**Target features:**
- Enable Deepgram diarization + utterance segmentation so the mixed loopback stream is split into per-speaker utterances (moves CAP-02 into this milestone)
- A session-long speaker map that keeps each voice labeled consistently as Person 1, Person 2, … despite Deepgram index drift
- A fast local heuristic that tags each utterance as Question or Statement (defaulting to Statement when unsure) — no per-segment AI cost
- Card-based Q/A redesign in place: each utterance in its own panel labeled `Q1 - Person 1` / `S3 - Person 2`, questions and statements visually distinct
- A compact people list of identified speakers in the Q/A panel

## Requirements

### Validated

- [x] Overlay is moved and controlled by keyboard only (global hotkeys), never stealing focus from the meeting app — Validated in Phase 2: Global Hotkeys + Window Control (conflict-tested against Teams/Zoom/VS Code, 2026-06-17)
- [x] Transcript is a stream of discrete, speaker-attributed (`Person N`), Question/Statement-classified utterances through the `ISttProvider` seam (no Deepgram coupling downstream) — Validated in Phase 8: Diarized Utterance Pipeline (QA-01/02/03/07; 8/8 automated, 2 live human-UAT items pending, 2026-07-07)

### Active

- [ ] Transparent, always-on-top overlay window with adjustable opacity
- [ ] Capture system (computer) audio — built-in Electron loopback is NO-GO on the target machine (Phase 3 gate, 2026-06-17: DXGI duplicator failure); Phase 4 captures via the `naudiodon` WASAPI sidecar instead. Still required; only the mechanism changed.
- [ ] Live rolling transcript of the captured audio, shown on the overlay
- [ ] Hotkey: answer an interview question from the recent transcript
- [ ] Hotkey: suggest talking points when the team is discussing project tasks
- [ ] Hotkey: take a screenshot and solve a code challenge from it
- [ ] Session Context panel: paste/edit project notes, ticket text, repo snippets, and reference links, stored locally and injected into AI prompts
- [ ] AI responses stream to the overlay and are readable without leaving the meeting

### Out of Scope

- Mic capture of the user's own voice — deferred; system audio only for v1 (can distinguish speakers later)
- Live Jira/Azure/GitHub API integration (OAuth, fetching ticket/repo content) — large per-provider surface; v1 uses pasted context, store designed so a URL-fetcher can be added later
- Auto-detecting questions and answering unprompted — v1 is hotkey-driven for predictability and cost control
- macOS / Linux support — Windows-first; the user is on Windows 11
- Cloud sync / multi-device — personal local-only tool
- Local on-device transcription (Whisper) for v1 — Deepgram cloud streaming chosen for latency/accuracy; STT is behind an interface so Whisper can be swapped in later

## Context

- **Platform:** Windows 11 Home. Single user (the project owner), personal tool, iterated on frequently.
- **User's stack:** TypeScript-first (per IDEXX Payments engineering standards). Electron chosen partly so the
  user is fast iterating in a language they know.
- **Why Electron:** best-in-class support for transparent / click-through / always-on-top overlays, trivial
  screenshot APIs, easy HTTP/websocket calls to AI and STT services.
- **Audio capture reality:** Chromium cannot natively grab Windows system output. Modern Electron exposes
  system-audio loopback via `setDisplayMediaRequestHandler` / `getDisplayMedia({ audio: 'loopback' })`. Chosen
  over a bundled native WASAPI helper to avoid native-build complexity early; the native helper is the fallback
  if loopback proves flaky.
- **Transcription:** Deepgram real-time streaming STT (cheap, simple websocket, word-level timing). Abstracted
  behind a small STT-provider interface so local Whisper can replace it without rewrites.
- **AI:** Claude (Anthropic API). `claude-opus-4-8` for hard code-challenge solving; `claude-haiku-4-5` for
  fast classification / quick suggestions. The `claude-api` skill will be consulted at implementation time for
  current model IDs, streaming, and screenshot/vision input.
- **Triggers:** hotkey-driven. The app always transcribes into a rolling buffer; the AI is only invoked when
  the user presses a mode-specific hotkey. No constant LLM calls, no unprompted pop-ups.
- **Ethical framing:** built and framed as a personal study / meeting-prep / mock-interview / note-taking aid
  for the user's own sessions. The user controls when and whether it acts.

## Constraints

- **Tech stack:** Electron + TypeScript — matches the user's skills and gives the best overlay/screenshot story.
- **Platform:** Windows 11 only for v1.
- **Focus discipline:** the overlay MUST NOT take keyboard/mouse focus from the active meeting window; all control is via global hotkeys.
- **Audio:** system-audio loopback only (no mic) for v1.
- **Cost:** AI calls are user-triggered only; STT is the only continuous external cost — keep it on a cheap streaming provider.
- **Privacy:** audio leaves the machine to Deepgram and AI calls go to Anthropic — acceptable for v1; local Whisper is the documented privacy fallback.
- **Dependencies:** requires Deepgram and Anthropic API keys (user-supplied, stored locally).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Electron + TypeScript | Best overlay/screenshot support; matches user's TS-first stack | — Pending |
| Electron built-in loopback, system audio only | Pure-JS, no native binary; mic deferred | ✗ NO-GO (2026-06-17) — DXGI desktop-duplicator fails on the target machine (MSI); `getDisplayMedia` loopback is silent even on general media. Built-in screen/window source and the `electron-audio-loopback` shim all failed identically. Phase 4 uses the `naudiodon` WASAPI sidecar. See 03-LOOPBACK-GATE.md. |
| `naudiodon` WASAPI sidecar for system-audio capture | Built-in loopback NO-GO on the target machine (DXGI duplicator failure); WASAPI loopback runs in a separate process and never touches Chromium's screen capturer | ✓ Adopted for Phase 4 (2026-06-17) — system-audio requirement (AUD-01/AUD-02) unchanged; only the capture mechanism changes. The 03-01 audio-capture seam isolates the swap from the STT/transcript code. |
| Deepgram streaming STT behind a provider interface | Cheap, low-latency, swappable for local Whisper later | — Pending |
| Claude (Opus 4.8 hard / Haiku 4.5 fast) | User is in the Anthropic ecosystem; tiered for cost/quality | — Pending |
| Hotkey-driven AI triggers (no auto-detect) | Predictable, cheap, no awkward unprompted pop-ups; fits keyboard-only requirement | — Pending |
| Paste-based local context store (no live API) | 90% of grounding value without per-provider OAuth surface; upgradeable to a URL-fetcher | — Pending |
| Deepgram diarization for speaker ID (v1.1) | Single mixed loopback stream still separates into speakers via `diarize:true`; no mic/second-channel needed; classification kept local/heuristic to honor "AI is user-triggered only" | — Pending (v1.1) |
| Session-long speaker map (stable Person N) | Deepgram raw speaker indices drift on a rolling stream; a session map keeps each voice's label stable for the whole meeting | — Pending (v1.1) |
| Local heuristic Q-vs-statement (default Statement) | Avoids per-segment AI cost/latency; questions are the high-value signal but false-questions are noisy, so borderline defaults to Statement | — Pending (v1.1) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-07 — Phase 8 (Diarized Utterance Pipeline) complete: the STT seam now carries discrete, `Person N`-attributed, Question/Statement-classified utterances and the finalized-transcript feed to the AI orchestrator is restored (CR-01 fix). Next: Phase 9 card-based Q/A panel redesign.*
