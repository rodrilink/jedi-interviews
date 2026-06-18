# Deferred Items — Phase 05

Out-of-scope discoveries logged during execution (per executor SCOPE BOUNDARY). NOT fixed here.

| Discovered | Item | Why deferred |
|-----------|------|--------------|
| 05-01 Task 3 | `npm run format:check` reports 43 files (incl. untouched `vitest.config.ts`, `tsconfig.json`, `VERIFICATION.md`) as needing Prettier. The diff is **CRLF-only**: `git config core.autocrlf=true` checks files out with CRLF while Prettier's default `endOfLine: lf` expects LF. All files I touched in this plan are Prettier-clean ignoring line endings (verified file-by-file). | Pre-existing, repo-wide line-ending condition unrelated to this plan's changes. Mass-reformatting every file (or changing the Git/Prettier line-ending policy) is out of scope for an AI-orchestration plan and would balloon the diff. Recommend a dedicated `/gsd:quick` to set `endOfLine` policy (e.g. add `endOfLine: 'crlf'` or a `.gitattributes` `* text eol=lf` + renormalize) so `format:check` is green on Windows checkouts. |
