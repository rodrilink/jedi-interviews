# Requirements: Jedi Interviews

**Defined:** 2026-06-16
**Core Value:** When the user presses a hotkey during a meeting, a grounded, relevant AI response appears on the overlay fast enough to be useful — without ever stealing keyboard/mouse focus from the meeting app.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Overlay

- [x] **OVL-01**: A transparent, frameless, always-on-top overlay window displays on top of all other windows
- [x] **OVL-02**: The overlay never takes keyboard or mouse focus from the active meeting window (`focusable:false`, shown with `showInactive`)
- [x] **OVL-03**: The user can adjust the overlay's opacity by keyboard
- [x] **OVL-04**: The overlay is hidden from screen-share/recording capture (`setContentProtection`, re-applied after every show)
- [x] **OVL-05**: The user can show/hide the overlay by global hotkey
- [x] **OVL-06**: The overlay confirms its non-focus-stealing and screen-share-invisible behavior on the target Windows 11 machine and pinned Electron version

### Control

- [x] **CTL-01**: The user can move the overlay around the screen using the keyboard only
- [x] **CTL-02**: Global hotkeys function while another application (the meeting app) holds focus
- [x] **CTL-03**: Hotkey registration failures and conflicts are detected and surfaced (not silently dropped)

### Audio & Transcript

- [ ] **AUD-01**: The app captures the computer's system (loopback) audio
- [ ] **AUD-02**: Loopback capture is validated to produce real (non-silent) audio on the target machine before the transcript pipeline is built on it
- [ ] **TRN-01**: Captured audio is streamed to a speech-to-text provider and a live transcript updates on the overlay
- [ ] **TRN-02**: The transcript shows interim (partial) and final results as they arrive
- [ ] **TRN-03**: The STT connection automatically reconnects if it drops mid-session
- [ ] **TRN-04**: The user can clear the transcript by hotkey, and the buffer is automatically capped to a bounded size
- [ ] **TRN-05**: Speech-to-text is accessed through a provider interface so the backend (Deepgram) can be swapped (e.g. for local Whisper) without rewriting consumers

### AI Assistance

- [ ] **AI-01**: By hotkey, the user gets an AI answer to an interview question drawn from the recent transcript
- [ ] **AI-02**: By hotkey, the user gets AI-suggested talking points when the team is discussing project work, drawn from the recent transcript
- [ ] **AI-03**: By hotkey, the user takes a screenshot and gets an AI solution to a code challenge shown in it
- [ ] **AI-04**: AI responses stream token-by-token to the overlay and are readable in the flow of conversation
- [ ] **AI-05**: AI output is keyboard-scrollable so responses longer than the overlay are fully readable
- [ ] **AI-06**: Every AI call is grounded in the active Session Context (pasted project notes, ticket text, repo snippets, links) plus the relevant transcript span

### Session Context

- [ ] **CTX-01**: The user can paste and edit project context — notes, ticket text, repo snippets, and reference links — in a dedicated editor
- [ ] **CTX-02**: Session Context persists locally across app restarts
- [ ] **CTX-03**: The active Session Context is injected into AI prompts for all three modes
- [ ] **CTX-04**: The context store is structured so a future URL-fetcher (Jira/Azure/GitHub) can populate it without redesign

### Settings & Secrets

- [ ] **SET-01**: A separate, normal (focusable) window hosts settings — required because the overlay is `focusable:false` and cannot host text inputs
- [ ] **SET-02**: The user can enter and save Deepgram and Anthropic API keys via the settings window
- [x] **SET-03**: API keys are stored encrypted at rest (Electron `safeStorage`/DPAPI) and never written to logs, the renderer, or committed files
- [ ] **SET-04**: The Session Context editor (CTX-01) is reachable from this settings window, opened by hotkey

### Packaging

- [ ] **PKG-01**: The app builds to a runnable Windows executable on which transparency, focus discipline, and content protection still hold

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Capture & Transcription

- **CAP-01**: Capture the user's own microphone in addition to system audio
- **CAP-02**: Speaker diarization (distinguish who is speaking)
- **STT-V2-01**: Local on-device transcription (Whisper) as a privacy-preserving STT provider

### Context Integration

- **INT-01**: Live fetching of Jira ticket content via API
- **INT-02**: Live fetching of GitHub repository content via API
- **INT-03**: Live fetching of Azure DevOps work items via API
- **CTX-V2-01**: Multiple named, switchable Session Contexts/sessions

### Interaction

- **AI-V2-01**: Auto-detection of questions directed at the user (suggest, never answer unprompted)
- **TRN-V2-01**: Transcript-span picker (choose exactly which words the AI acts on, beyond the default recent window)
- **CTL-V2-01**: User-customizable hotkey remapping UI

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Microphone capture / diarization (v1) | System audio only for v1; deferred to v2 to keep capture pipeline simple |
| Live Jira/Azure/GitHub API integration (v1) | Large per-provider OAuth/parsing surface; v1 uses pasted context with an upgrade seam (CTX-04) |
| Auto-detect-and-answer unprompted | Predictability, cost control, and avoiding awkward pop-ups; v1 is hotkey-driven |
| macOS / Linux support | Windows-first; user is on Windows 11; loopback + content-protection paths are Windows-specific |
| Cloud sync / multi-device | Personal local-only tool |
| Local Whisper transcription (v1) | Deepgram chosen for latency/accuracy; STT-provider seam (TRN-05) keeps Whisper a v2 swap, not a rewrite |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| OVL-01 | Phase 1 | Complete |
| OVL-02 | Phase 1 | Complete |
| OVL-04 | Phase 1 | Complete |
| OVL-06 | Phase 1 | Complete |
| SET-03 | Phase 1 | Complete |
| OVL-03 | Phase 2 | Complete |
| OVL-05 | Phase 2 | Complete |
| CTL-01 | Phase 2 | Complete |
| CTL-02 | Phase 2 | Complete |
| CTL-03 | Phase 2 | Complete |
| AUD-01 | Phase 3 | Pending |
| AUD-02 | Phase 3 | Pending |
| TRN-01 | Phase 4 | Pending |
| TRN-02 | Phase 4 | Pending |
| TRN-03 | Phase 4 | Pending |
| TRN-04 | Phase 4 | Pending |
| TRN-05 | Phase 4 | Pending |
| AI-01 | Phase 5 | Pending |
| AI-02 | Phase 5 | Pending |
| AI-04 | Phase 5 | Pending |
| AI-05 | Phase 5 | Pending |
| CTX-01 | Phase 6 | Pending |
| CTX-02 | Phase 6 | Pending |
| CTX-03 | Phase 6 | Pending |
| CTX-04 | Phase 6 | Pending |
| SET-01 | Phase 6 | Pending |
| SET-02 | Phase 6 | Pending |
| SET-04 | Phase 6 | Pending |
| AI-06 | Phase 6 | Pending |
| AI-03 | Phase 7 | Pending |
| PKG-01 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 30 ✓
- Unmapped: 0

---
*Requirements defined: 2026-06-16*
*Last updated: 2026-06-16 after roadmap creation (traceability populated)*
