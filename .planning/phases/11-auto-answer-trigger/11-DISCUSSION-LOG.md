# Phase 11: Auto-Answer Trigger - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 11-auto-answer-trigger
**Areas discussed:** De-dup for distinct questions, Which utterances fire, Trigger wiring seam, Auto-answer visibility

---

## De-dup for distinct questions

| Option | Description | Selected |
|--------|-------------|----------|
| Each distinct question answers | Debounce collapses only SAME/near-identical question text, not any two 'answer'-mode requests; two different questions each answer, subject to single-in-flight queue + bounded cap | ✓ |
| Mode-keyed collapse (accept loss) | Keep Phase 10's rule; any two 'answer' requests in the window collapse to one — a fast follow-up is silently dropped | |
| Short per-question debounce only | No content matching; short debounce to coalesce split-turn fragments, then let each fire — risks answering a split turn twice | |

**User's choice:** Each distinct question answers
**Notes:** The behavioral crux of the phase. Requires reconciling with Phase 10's mode-keyed D-06 debounce — planner likely carries question text/content key on the auto enqueue so dedup compares content, not just mode. Cost bounded by the queue's single-in-flight gate + bounded cap + the future Off mode, not by collapsing distinct questions.

---

## Which utterances fire

| Option | Description | Selected |
|--------|-------------|----------|
| Any question, both speaker kinds | Fire on every classification:'question', diarized (Person N) or neutral 'Speaker' bucket — maximizes recall | ✓ |
| Diarized questions only | Only fire for numbered Person N; ignore the neutral bucket — fewer spurious triggers but drops real questions during non-diarized spans | |

**User's choice:** Any question, both speaker kinds
**Notes:** Utterances are already committed/final at the emit point, so no extra final-only guard needed. Self-authored questions are moot (loopback only, no mic). `statement` never fires (SC 4).

---

## Trigger wiring seam

| Option | Description | Selected |
|--------|-------------|----------|
| Inject a trigger callback | Thread a callback/bound trigger into attachSttGatewayHandlers; late-bound so construction order + re-key both work | |
| Reorder construction | Move orchestrator construction before wireSttPipeline so the binding closes over it directly | ✓ |
| Let planner decide | Both viable; leave the mechanism to the planner provided it survives re-key and adds no renderer→main channel | |

**User's choice:** Reorder construction
**Notes:** Planner MUST verify (a) the boot sequence invariants still hold (dotenv → keystore → orchestrator deps constructible before STT wiring) and (b) the live re-key re-attach path still auto-triggers (Pitfall 3). No new renderer→main channel.

---

## Auto-answer visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Identical, no marker | Auto and manual answers indistinguishable — honors SC 3 literally, zero renderer change | |
| Subtle auto marker | A small visual hint so the user can tell an unprompted answer from a requested one — reuses jedi:ai, needs a payload flag + renderer tweak | ✓ |

**User's choice:** Subtle auto marker → refined to "Tiny label/badge, same panel"

### Marker scope (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Tiny label/badge, same panel | Small text tag/dot on the answer in the SAME panel + SAME streaming render; only a `source` flag on the jedi:ai payload + minimal renderer read | ✓ |
| Marker only at start, then plain | Show the hint only on the header/first line; even lighter on the renderer | |
| Reconsider — no marker | Drop the marker to keep Phase 11 pure main-side wiring; note as deferred UI idea | |

**User's choice:** Tiny label/badge, same panel
**Notes:** Add `source: RequestSource` to the `IAiPushEvent` payload (rides alongside `mode` on the `thinking` variant) + a minimal renderer read that renders a small `auto` tag. Same panel, same streaming render, no layout/behavior change — SC 3's "same rendering" preserved. This is the ONLY renderer-touching change in the phase.

---

## Claude's Discretion

- Exact content-dedup mechanism for D-01 (normalized-text equality vs. short hash vs. trimmed prefix key) and how it threads onto the enqueue path.
- Precise boot-reorder shape for D-03 (move whole AI-stack block up vs. construct orchestrator early and thread it in), provided both invariants hold.
- Renderer badge styling for D-04 (text tag vs. dot vs. icon), within "tiny, same panel, no layout change."
- Whether the auto enqueue extends the `trigger` signature or uses a sibling method, provided manual `trigger(mode)` call sites stay behavior-identical (Phase 10 D-10).

## Deferred Ideas

- 3-state scope hotkey (All → Directed-at-me → Off) + local directed-at-me heuristic — Phase 12.
- Auto-answering talking-points / code-challenge modes — only `answer` auto-fires in v1.2.
- Richer auto-vs-manual distinction (grouping/filtering/dismissing auto answers) — future UI pass.
- Explicit cancel key (carried from Phase 10) — reuses dormant abort machinery; not in v1.2.
