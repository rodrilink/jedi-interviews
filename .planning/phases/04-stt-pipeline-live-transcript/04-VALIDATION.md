---
phase: 4
slug: stt-pipeline-live-transcript
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-17
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 (already configured) |
| **Config file** | `vitest.config.ts` (`environment: 'node'`, `include: ['src/**/*.test.ts']`) |
| **Quick run command** | `npx vitest run <touched-file>.test.ts` (single file for the seam touched) |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | ~5 seconds (pure unit suite; no live capture/network in tests) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run` for the specific seam touched (e.g. `pcm-resample.utility.test.ts`).
- **After every plan wave:** Run `npm test` (full Vitest suite).
- **Before `/gsd:verify-work`:** Full suite green PLUS both manual gates recorded (capture go/no-go, live-transcript demo).
- **Max feedback latency:** ~5 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| capture go/no-go | 01 | 0 | TRN-01 (capture) | — | non-silent loopback PCM on this machine before pipeline built on it | manual | human go/no-go capture spike | n/a | ⬜ pending |
| resample downmix | 01 | 1 | TRN-01 | — | 48kHz stereo Buffer → 16kHz mono Int16 correct sample count + values | unit | `npx vitest run src/main/audio/pcm-resample.utility.test.ts` | ❌ W0 | ⬜ pending |
| rate assertion | 01 | 1 | TRN-01 | — | mismatched declared-vs-actual sample rate throws | unit | `npx vitest run src/main/audio/pcm-resample.utility.test.ts` | ❌ W0 | ⬜ pending |
| ISttProvider seam | 01 | 1 | TRN-05 | — | consumers depend only on `ISttProvider`; `DeepgramSttGateway` satisfies it | unit (type + mock) | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ❌ W0 | ⬜ pending |
| interim/final mapping | 01 | 1 | TRN-02 | — | interim (`is_final` falsy) vs final mapping from mock `ListenV1Results` | unit | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ❌ W0 | ⬜ pending |
| reconnect + state events | 01 | 1 | TRN-03 | — | gateway emits `connection-state-change` on open/close/error; backoff schedule | unit | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ❌ W0 | ⬜ pending |
| key sourcing (no leak) | 01 | 1 | TRN-01 | T-4 key handling | Deepgram key read in main only; never in renderer, logs, or commits | unit + source assert | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ❌ W0 | ⬜ pending |
| transcript bounding | 03 | 1 | TRN-04 | — | segments older than N pruned; hard memory ceiling enforced (injected clock) | unit | `npx vitest run src/main/stt/transcript-buffer.test.ts` | ❌ W0 | ⬜ pending |
| clear() empties buffer | 03 | 1 | TRN-04 | — | `clear()` empties buffer; overlay reflects empty buffer | unit | `npx vitest run src/main/stt/transcript-buffer.test.ts` | ❌ W0 | ⬜ pending |
| clear-transcript chord | 03 | 1 | TRN-04 | — | clear chord registers via `HotkeyRegistrarService` and calls `clear()` | unit | `npx vitest run src/main/hotkey-registrar.service.test.ts` | partial | ⬜ pending |
| live transcript on overlay | 04 | 2 | TRN-01, TRN-02 | — | real Deepgram transcript renders in DebugHud, interim distinct from final | manual | human run, real key + audio | n/a | ⬜ pending |
| reconnect visible on overlay | 04 | 2 | TRN-03 | — | drop mid-session → auto-reconnect, connection state visible on overlay | manual | human run, force socket drop | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/main/audio/pcm-resample.utility.test.ts` — stubs for TRN-01 (downmix, resample, rate assertion)
- [ ] `src/main/stt/transcript-buffer.test.ts` — stubs for TRN-04 (time bounding, ceilings, clear)
- [ ] `src/main/stt/deepgram-stt.gateway.test.ts` — stubs for TRN-02/03/05 with a mocked `V1Socket` (mock `@deepgram/sdk` at the module boundary)
- [ ] Extend `src/main/hotkey-registrar.service.test.ts` — clear-transcript chord wiring (D-07)

*No framework install needed (Vitest present). No shared-fixture file needed; mock the Deepgram SDK and the native capture addon at the module boundary.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WASAPI loopback produces non-silent PCM on this machine | TRN-01 (capture) | Native addon load + real device capture cannot be unit-tested; this is the OQ-1 de-risk gate | Run the capture go/no-go spike with the chosen native package under Electron 35.7.5; play system audio; confirm captured PCM is non-silent (level > floor). If it fails, switch to the `audiotee` sidecar fallback before building the pipeline. |
| Real Deepgram transcript appears on overlay | TRN-01, TRN-02 | Live network + real audio + real key; not reproducible in unit suite | Run app with a real Deepgram key (env/dev-config) and live system audio; confirm a rolling transcript updates in the DebugHud, with interim text visually distinct from final. |
| Auto-reconnect with connection state visible | TRN-03 | Requires forcing a real websocket drop mid-session | During a live session, drop network / kill the socket; confirm it reconnects with backoff and the connection state is visible on the overlay throughout. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (manual gates explicitly listed above)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
