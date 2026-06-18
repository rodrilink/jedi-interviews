# Phase 04 — Deferred Items

Out-of-scope discoveries logged during plan execution. NOT fixed in the originating plan
(scope boundary: only auto-fix issues directly caused by the current task's changes).

| Item | Found during | Detail | Suggested owner |
|------|--------------|--------|-----------------|
| Prettier format warnings in pre-existing files | 04-02 (format:check) | `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/services/audio-capture.service.ts` fail `npm run format:check`. None are touched by 04-02. `src/renderer/src/services/audio-capture.service.ts` is also slated for retirement per D-02/IN-01 in a later 04 plan, so formatting it now is wasted effort. | 04-04 (capture rework / renderer audio-path retirement) — run `npm run format` as part of that rework. |
