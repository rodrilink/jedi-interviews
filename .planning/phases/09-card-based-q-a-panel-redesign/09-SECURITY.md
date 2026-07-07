---
phase: 09
slug: card-based-q-a-panel-redesign
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-07
---

# Phase 09 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| main → renderer (`jedi:transcript` / `onTranscript` push) | Transcript, speaker labels, and interim text originating from captured audio via Deepgram cross into the renderer DOM (cards, people chips, ghost card). Untrusted content. | `IOverlayTranscript` — text/state only (`finalText`, `interimText`, `connectionState`, `audioLevel`, `utterances`); no secret/key |

This phase adds NO new trust boundary. The Q/A panel is a pure one-way read-only view over the pre-existing `onTranscript` / `onStatus` / `onScrollTranscript` subscriptions (IN-01, roadmap SC 5). No renderer→main control surface was introduced.

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-09-01 | Tampering / XSS | transcript-panel.tsx card body + header rendering utterance/speaker text | mitigate | Utterance text (`{row.text}`, transcript-panel.tsx:176) and header label (`{row.label}`, :173) render as React children (auto-escaped). No `dangerouslySetInnerHTML` (0 matches in file). | closed |
| T-09-02 | Elevation of Privilege | renderer→main surface | mitigate | No new IPC/control channel. Only the 3 existing read-only subscriptions used (`onTranscript` :66, `onStatus` :88, `onScrollTranscript` :96). No `window.jedi.*` control call, no `ipcRenderer`/`.send`/`.invoke`, no `src/main` import (0 matches each). | closed |
| T-09-03 | Information Disclosure | pushed payload | accept | `IOverlayTranscript` (preload/index.ts:52-67) carries text/state only — `finalText`, `interimText`, `connectionState`, `audioLevel`, `utterances`; documented "never the Deepgram key or any secret (D-08)" (:51,:65). Phase 09 did not change what is pushed. See Accepted Risks Log R-09-01. | closed |
| T-09-04 | Tampering / XSS | people chip text + ghost card body rendering untrusted speaker/interim text | mitigate | Chip label (`` {`${person.speaker} (${person.count})`} `` , transcript-panel.tsx:154) and ghost body (`{interimText}`, :185) render as React children (auto-escaped). No `dangerouslySetInnerHTML` (0 matches in file). | closed |
| T-09-05 | Elevation of Privilege | renderer→main surface | mitigate | People row / ghost / placeholder derive purely from already-subscribed state via `derivePeople(utterances)` (:129) and `deriveCardRows(utterances)` (:128). No new channel, no `window.jedi.*` control call, no `src/main` import (0 matches each). | closed |
| T-09-06 | Denial of Service | unbounded people row / card growth | accept | People row bounded by distinct diarized `Person N` (`derivePeople`, utterance-view.utility.ts:133-149). Both derivations are O(n) `map`/loop over the pushed array; `utterances` is main-bounded upstream (`MAX_SEGMENTS = 400`). Acceptable for a single-user glanceable overlay. See Accepted Risks Log R-09-02. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-09-01 | T-09-03 | The pushed `IOverlayTranscript` carries only transcript text and coarse connection/level state; it never carries the Deepgram or Anthropic key or any secret (D-08 contract, preload/index.ts:51,65). Phase 09 renders additional views of the SAME payload — it does not change what main pushes. Low risk for a single-user local overlay. | Plan-time threat model (register_authored_at_plan_time) | 2026-07-07 |
| R-09-02 | T-09-06 | The people row is bounded by the count of distinct diarized `Person N`; the `utterances` array is main-bounded upstream (`MAX_SEGMENTS = 400`). `deriveCardRows` / `derivePeople` are O(n) per push. Rendering the pushed list is acceptable for a single-user, glanceable overlay; no cap by design (D-03 accepts minor over-split risk). | Plan-time threat model (register_authored_at_plan_time) | 2026-07-07 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-07 | 6 | 6 | 0 | gsd-security-auditor |

Notes:
- SUMMARY.md (09-01, 09-02) contain no `## Threat Flags` section — no new attack surface was flagged during implementation. No unregistered flags.
- The 09-01 deviation (extending the preload `IOverlayTranscript` TYPE mirror with `utterances`) is a type-only mirror sync; it added no IPC channel and does not change the pushed payload — T-09-02/T-09-05 disposition preserved. Verified against preload/index.ts (still only `STATUS`, `TRANSCRIPT`, `SCROLL_TRANSCRIPT`, `AI`, and the pre-existing `COPY_SELECTION` channels; none added this phase).
- 09-REVIEW.md CR-01 (empty-push reset keyed off rolling `finalText`) was resolved in commit `a60da38`; the reset now gates on `next.utterances.length === 0` (transcript-panel.tsx:76). This is a correctness fix, not a security threat, and does not affect any T-09-* disposition.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-07
