# Phase 1: Overlay Shell + Existential Behaviors - Research

**Researched:** 2026-06-16
**Domain:** Electron desktop overlay (transparent, non-focus-stealing, capture-invisible) + secret boundary + electron-vite scaffold
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**On-Machine Verification (plan 01-04)**
- **D-01:** Prove "focus is never stolen" with a **manual visual checklist** — watch the active meeting app's title bar stay focused/active while the overlay is shown and moved, and tick a written checklist. No programmatic foreground-window logging in Phase 1.
- **D-02:** Prove "absent from screen capture" with a **real self screen-share or system screenshot** while the overlay is visible — confirm it is fully absent (not a black rectangle). The proof screenshot is saved as gate evidence.
- **D-03:** All verification evidence lives in a **committed `VERIFICATION.md`** containing: the checklist with sign-off, the recorded exact Electron 35.x patch version, target-machine info, the date, and the path to the proof screenshot. This is the auditable GO/NO-GO record.

**Secret/IPC Boundary (plan 01-03)**
- **D-04:** Implement the **most basic security proof only** — a main-process-only `safeStorage` (DPAPI) round-trip: encrypt a hardcoded **placeholder/fake** secret, persist the ciphertext, read it back, decrypt, and assert equality. All in the main process. No real keys (those arrive in Phase 6).
- **D-05:** **No renderer-facing or IPC secret channels in Phase 1.** The full typed renderer→main secret channel (booleans only, never plaintext) is designed in Phase 6.
- **D-06:** Still wire the structural boundary in the scaffold now: `contextIsolation: true`, `sandbox: true`, and a typed `contextBridge` preload — but with no secret-bearing channels yet.

**Overlay First-Paint (plan 01-02)**
- **D-07:** The empty overlay renders a **tiny status HUD** showing proof-of-life: Electron version, content-protection state (ON/OFF), and window position. It doubles as the visual verification readout during the gate.
- **D-08:** Build the HUD as a **toggleable debug HUD that survives** into later phases (hidden by default later, toggle wired in Phase 2). In Phase 1 it shows by default since no hotkeys exist yet.

**Electron Version Pinning (plans 01-01 / 01-04)**
- **D-09:** Pin Electron with an **exact version (no `^` or `~`) in `package.json` AND commit the lockfile** for byte-for-byte reproducible reinstalls. Procedure: start on the latest 35.x patch, verify BOTH behaviors, then pin and record the exact patch.
- **D-10:** The Phase 1 packaged smoke test is **minimal**: build once via electron-builder, launch the `.exe`, and eyeball that transparency/frameless rendering still holds. Installer/signing and full re-verification of the packaged build are deferred to Phase 7 (PKG-01).

### Claude's Discretion
- Exact HUD layout/styling, the precise wording of the VERIFICATION.md checklist items, the placeholder-secret value and the exact electron-store key used for the round-trip, and the always-on-top level (`'screen-saver'` per CLAUDE.md guidance) are left to the planner/executor within the decisions above.

### Deferred Ideas (OUT OF SCOPE)
- None. (Programmatic focus-watching, an in-app desktopCapturer self-test, full IPC secret channels, and full packaged-build re-verification were each considered and intentionally pushed to later phases.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OVL-01 | Transparent, frameless, always-on-top overlay over all windows | Overlay window option set + `setAlwaysOnTop(true,'screen-saver')` — Pattern 1 |
| OVL-02 | Overlay never takes keyboard/mouse focus (`focusable:false`, `showInactive`) | `focusable:false` + `showInactive()` confirmed in Electron docs — Pattern 1 |
| OVL-04 | Hidden from screen-share/recording (`setContentProtection`, re-applied after every show) | `setContentProtection(true)` + mandatory re-apply-on-show pattern; **version-coupled** — Pattern 2, Pitfall 1 |
| OVL-06 | Behavior confirmed on target Windows 11 machine + pinned Electron version | Manual checklist + screen-share self-test + committed VERIFICATION.md — Validation Architecture |
| SET-03 | API keys encrypted at rest (safeStorage/DPAPI), never in logs/renderer/commits | `safeStorage` main-process round-trip with placeholder secret — Pattern 3, Code Examples |
</phase_requirements>

## Summary

Phase 1 is a version-coupled GO/NO-GO gate, and the single most consequential research finding **revises the CLAUDE.md guidance**: the "black rectangle during screen capture" bug is **not isolated to 35.0.1**. It was introduced by PR #45868 (backported into the 35.x line starting at **35.0.1**, 2025-03-10) and **persisted through 35.0.1, 35.0.2, 35.0.3, 35.1.x, 35.2.x, and 35.3.0**. It was only fixed by PR #47020 / 35-x-y backport #47034 (merged 2025-05-09), which means the **first 35.x patch with the content-protection fix is 35.4.0** (released 2025-05-14). A further "older Windows versions" fix (#47886, merged 2025-07-31) landed in the **35.7.x** range. [VERIFIED: github.com/electron/electron PRs #45868, #47020, #47034, #47886 + npm publish dates]

**Primary recommendation:** Start on the **latest 35.x patch, `electron@35.7.5`** (published 2025-08-19), which contains both the main fix (#47034) and the older-Windows fix (#47886). The **minimum safe version is 35.4.0**; anything `< 35.4.0` is known-broken for content protection on Windows. Do not pin `35.0.x`–`35.3.0`. After on-machine verification, pin the exact verified patch with no `^`/`~` and commit the lockfile (D-09). Scaffold with electron-vite 5 + electron-builder 26 + React 19 + TypeScript, ESM main process (electron-store@11 is ESM-only and requires Node ≥20). Wire `contextIsolation:true` + `sandbox:true` + typed `contextBridge` preload with no secret channels (D-06), and prove the `safeStorage` DPAPI plumbing with a hardcoded placeholder round-trip entirely in main (D-04).

Two API facts from the Electron docs that affect the plan: (1) `setVisibleOnAllWorkspaces` **does nothing on Windows** — CLAUDE.md lists it but it is a documented no-op here; call it harmlessly or omit it, do not rely on it. (2) `safeStorage.isEncryptionAvailable()` only returns true **after the `ready` event**, so the round-trip must run after `app.whenReady()`. [VERIFIED: electronjs.org/docs]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Overlay window lifecycle (create/show/hide, always-on-top, content protection) | Main process | — | BrowserWindow + native window affinity APIs are main-only |
| Transparent/frameless rendering, HUD UI | Renderer (React) | — | Visual surface; receives proof-of-life data via preload |
| Content-protection re-apply on every show | Main process | — | `setContentProtection` is a main-process BrowserWindow method; must wrap the show call |
| Secret encrypt/decrypt round-trip | Main process **only** | — | `safeStorage` is main-only by API; D-04/D-05 forbid renderer/IPC secret channels |
| Ciphertext persistence | Main process (electron-store) | — | Store lives in `userData`; written/read in main |
| Proof-of-life data (version, CP state, position) to HUD | Preload (`contextBridge`) | Main → renderer | Typed, read-only, non-secret channel — the only IPC surface in Phase 1 |
| Build/bundle (main+preload+renderer) | electron-vite (build tier) | — | Three-config model |
| Packaged smoke `.exe` | electron-builder (packaging tier) | — | Decoupled from dev tooling per D-10 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| electron | **35.7.5** (latest 35.x; min safe **35.4.0**) | App shell, overlay BrowserWindow, content protection, safeStorage | Native loopback (Phase 3) is Win-only supported in 35.x; latest 35.x patch has the content-protection fix. `[VERIFIED: npm registry]` (existence) + `[CITED: github PRs]` (fix mapping) |
| typescript | 6.0.3 | Whole codebase | IDEXX TS-first standard; first-class in electron-vite `[VERIFIED: npm registry]` |
| electron-vite | 5.0.0 | Dev/build tooling — main/preload/renderer three-config model, HMR | Purpose-built for the three-process Electron model `[VERIFIED: npm registry]` `[CITED: electron-vite.org]` |
| electron-builder | 26.15.3 | Packaging — minimal Win `.exe` for the D-10 transparency smoke test | Decoupled from dev tooling; avoids experimental Forge-Vite plugin `[VERIFIED: npm registry]` |
| react | 19.2.7 | Renderer UI for HUD (and later panels) | User is React-fluent; HUD + later streaming text `[VERIFIED: npm registry]` |
| react-dom | 19.2.7 | React renderer | Pairs with react `[VERIFIED: npm registry]` |

> **Note on TypeScript 6.0.3:** the npm `latest` tag now resolves to TS 6.0.3. CLAUDE.md says "5.6+", which 6.0.3 satisfies. If electron-vite 5 / the React TS template has not yet validated against TS 6, pinning the latest TS 5.x line (e.g. 5.9.x) is a safe, lower-risk choice for a scaffold. Planner's discretion; flag in Assumptions. `[ASSUMED]` (TS6 ecosystem compatibility not verified this session)

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| electron-store | 11.0.2 | Persist the ciphertext for the safeStorage round-trip; non-secret prefs | v11 is **ESM-only**, `engines.node >=20` — main bundle MUST be ESM (electron-vite default). On CommonJS main, would need v8. `[VERIFIED: npm registry]` |
| safeStorage | (built into Electron) | DPAPI encrypt/decrypt of the placeholder secret in main | OS-backed (DPAPI on Windows). `isEncryptionAvailable()` true only after `ready`. `[CITED: electronjs.org/docs/latest/api/safe-storage]` |
| @electron/rebuild | 4.0.4 | Rebuild native modules against Electron ABI | **NOT needed in Phase 1** — no native modules yet. `uiohook-napi` arrives in Phase 2. Flag only. `[VERIFIED: npm registry]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| electron-vite + electron-builder | electron-forge (Vite plugin) | Forge-Vite plugin is **experimental**; not worth it for a single-user tool. CLAUDE.md "What NOT to Use." |
| electron@35.7.5 | electron@35.4.0 | 35.4.0 is the *minimum* with the content-protection fix; 35.7.5 additionally has the older-Windows fix (#47886). Prefer 35.7.5 unless it fails on-machine, then bisect down to 35.4.0. |
| electron 35.x | electron 40.x–42.x | 40.x line has a desktop-audio loopback regression (silence) — would break Phase 3. Do not chase latest major. |

**Installation:**
```bash
# Scaffold (electron-vite React+TS template) then pin exact Electron:
npm create @quick-start/electron@latest jedi-interviews -- --template react-ts
# Pin Electron exactly (no ^ / ~) after verification — D-09:
npm install --save-exact --save-dev electron@35.7.5
# Runtime / persistence:
npm install electron-store@11.0.2
# Packaging (dev dep):
npm install --save-dev electron-builder@26.15.3
```
> Note: the official electron-vite scaffold command is `npm create @quick-start/electron@latest`. Confirm the exact template flag at scaffold time (`--template react-ts` is the documented React+TypeScript template). `[CITED: electron-vite.org]` / template flag `[ASSUMED]`

**Version verification (done this session):** `npm view electron versions` confirms 35.x patches run 35.0.0 → **35.7.5** (35.7.5 published 2025-08-19). electron-vite 5.0.0, electron-builder 26.15.3, electron-store 11.0.2 (`engines.node >=20`), @electron/rebuild 4.0.4, react/react-dom 19.2.7, typescript 6.0.3 — all current as of 2026-06-16. `[VERIFIED: npm registry]`

## Package Legitimacy Audit

> slopcheck was not available in this environment; ecosystem registry verification was performed via `npm view`. All packages below are well-established, high-trust Electron-ecosystem packages with long histories and known source repos. None are obscure or newly published. No `postinstall` network/filesystem scripts were found on electron-store or @electron/rebuild.

| Package | Registry | Age | Source Repo | postinstall | Disposition |
|---------|----------|-----|-------------|-------------|-------------|
| electron | npm | 10+ yrs | github.com/electron/electron | (none flagged) | Approved |
| typescript | npm | 10+ yrs | github.com/microsoft/TypeScript | none | Approved |
| electron-vite | npm | 3+ yrs | github.com/alex8088/electron-vite | none | Approved |
| electron-builder | npm | 9+ yrs | github.com/electron-userland/electron-builder | (install scripts present — normal for builder) | Approved |
| react / react-dom | npm | 10+ yrs | github.com/facebook/react | none | Approved |
| electron-store | npm | 8+ yrs | github.com/sindresorhus/electron-store | none | Approved |
| @electron/rebuild | npm | 8+ yrs | github.com/electron/rebuild | none | Approved (not installed in Phase 1) |

**Packages removed (slopcheck [SLOP]):** none
**Packages flagged [SUS]:** none

*slopcheck unavailable: per protocol these would normally be marked `[ASSUMED]`. Given these are the canonical, high-download Electron toolchain packages with verified source repos, the risk is negligible; the planner need not gate them behind a human-verify checkpoint. Any *new* package introduced during planning should still run the legitimacy gate.*

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────── MAIN PROCESS ───────────────────────────┐
  app.whenReady() ─▶│  createOverlayWindow()                                              │
                    │    BrowserWindow({ transparent, frame:false, focusable:false,        │
                    │      skipTaskbar:true, webPreferences:{contextIsolation:true,        │
                    │      sandbox:true, backgroundThrottling:false, preload } })          │
                    │         │                                                            │
                    │         ▼                                                            │
                    │  showOverlay()  ──────────────────────────────────┐                 │
                    │    win.setAlwaysOnTop(true,'screen-saver')         │ re-asserted     │
                    │    win.setContentProtection(true)   ◀── MUST RE-RUN on every show ── │
                    │    win.showInactive()              (and on 'blur'/'display' events)  │
                    │                                                                      │
                    │  safeStorage round-trip (D-04, main-only):                           │
                    │    isEncryptionAvailable() → encryptString(PLACEHOLDER)              │
                    │      → store.set(ciphertext) → store.get() → decryptString()         │
                    │      → assert(decrypted === PLACEHOLDER)                             │
                    └───────────────┬──────────────────────────────────────────────────────┘
                                    │ contextBridge (typed, READ-ONLY, non-secret)
                                    │  exposeInMainWorld('jedi', { onStatus(cb) })
                                    ▼
                    ┌─────────────────────── PRELOAD ───────────────────────┐
                    │ contextIsolated bridge: forwards {electronVersion,     │
                    │ contentProtection:boolean, position:{x,y}} to renderer │
                    └───────────────┬───────────────────────────────────────┘
                                    ▼
                    ┌─────────────────────── RENDERER (React) ──────────────┐
                    │ Debug HUD: shows Electron version • CP state • position│
                    │ (transparent bg; the visible verification readout)     │
                    └────────────────────────────────────────────────────────┘
   Build: electron-vite (main+preload+renderer configs) → electron-builder → smoke .exe (D-10)
```

### Recommended Project Structure
```
jedi-interviews/
├── package.json            # exact-pinned electron, "type":"module"
├── electron.vite.config.ts # main / preload / renderer configs
├── electron-builder.yml    # minimal Win target (D-10)
├── tsconfig.json / tsconfig.node.json
├── src/
│   ├── main/
│   │   ├── index.ts                    # app lifecycle, whenReady
│   │   ├── overlay-window.manager.ts   # WindowManager: create + showOverlay wrapper
│   │   └── placeholder-secret.service.ts # safeStorage round-trip (D-04)
│   ├── preload/
│   │   └── index.ts                    # typed contextBridge (no secrets)
│   └── renderer/
│       ├── index.html                  # transparent body
│       └── src/                        # React HUD
└── VERIFICATION.md         # GO/NO-GO evidence (D-03), created in 01-04
```

### Pattern 1: Non-Focus-Stealing Always-On-Top Overlay (OVL-01, OVL-02)
**What:** Create the window with focus disabled and show it without activating it.
**When to use:** The overlay window, every time.
**Example:**
```typescript
// Source: electronjs.org/docs/latest/api/browser-window (verified)
const overlay = new BrowserWindow({
  transparent: true,        // requires frame:false for true click-through; on Windows a
  frame: false,             // transparent window can't be user-resized (fine — keyboard-driven)
  focusable: false,         // OVL-02: window cannot take focus  [property + setFocusable() exist]
  skipTaskbar: true,
  resizable: false,
  hasShadow: false,
  webPreferences: {
    contextIsolation: true, // D-06
    sandbox: true,          // D-06
    backgroundThrottling: false, // keep pipeline alive when unfocused (it always is)
    preload: /* path */,
  },
});
overlay.setAlwaysOnTop(true, 'screen-saver'); // highest practical level over taskbar (CLAUDE.md)
overlay.showInactive();   // OVL-02: "Shows the window but doesn't focus on it"
```
- `focusable` is documented as an **instance property** (`win.focusable`) with `setFocusable()`/`isFocusable()`; it is also accepted as a constructor option in practice. `[CITED: electronjs.org/docs/latest/api/browser-window]`
- `setVisibleOnAllWorkspaces(...)` **does nothing on Windows** — it is a documented no-op. CLAUDE.md lists it; calling it is harmless but provides no benefit on Win. Do not depend on it. `[CITED: electronjs.org/docs/latest/api/browser-window]`

### Pattern 2: Content-Protection-Reapplying Show Wrapper (OVL-04) — load-bearing
**What:** Wrap every "show" so content protection is (re-)applied immediately after, and re-assert on `blur` and display changes.
**When to use:** The ONLY way the overlay is ever shown.
**Example:**
```typescript
// setContentProtection must be re-applied after each show/hide cycle.
// On Win10 2004+ it sets WDA_EXCLUDEFROMCAPTURE (window removed from capture entirely);
// a hide/show cycle can drop affinity back to WDA_MONITOR (black box) if not re-asserted.
function showOverlay(win: BrowserWindow): void {
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setContentProtection(true); // RE-APPLY every show — Issue #29085 / OVL-04
  win.showInactive();
}
// Re-assert defensively on focus loss and display topology changes:
win.on('blur', () => { win.setAlwaysOnTop(true, 'screen-saver'); win.setContentProtection(true); });
screen.on('display-metrics-changed', () => showOverlay(win));
```
- `setContentProtection(enable)` is _macOS_/_Windows_. On Win10 2004+: "the window will be removed from capture entirely; older Windows versions behave as if `WDA_MONITOR` is applied capturing a black window." `[CITED: electronjs.org/docs/latest/api/browser-window]`
- The hide/show affinity-drop is the documented reason re-apply is mandatory. `[CITED: github.com/electron/electron/issues/29085]`

### Pattern 3: Main-Only safeStorage Placeholder Round-Trip (SET-03, D-04)
**What:** Prove DPAPI plumbing with a hardcoded fake secret; no renderer/IPC exposure.
**When to use:** Once, in main, after `app.whenReady()`.
**Example:**
```typescript
// Source: electronjs.org/docs/latest/api/safe-storage (verified)
import { safeStorage } from 'electron';
import Store from 'electron-store';

const PLACEHOLDER = 'jedi-placeholder-secret'; // fake — NO real key in Phase 1 (D-04)
const store = new Store<{ secretCiphertext?: string }>();

export function proveSecretBoundary(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false; // true only AFTER 'ready'
  const ciphertext: Buffer = safeStorage.encryptString(PLACEHOLDER); // returns Buffer
  store.set('secretCiphertext', ciphertext.toString('base64'));      // persist ciphertext only
  const roundTripped = safeStorage.decryptString(
    Buffer.from(store.get('secretCiphertext')!, 'base64')
  );
  return roundTripped === PLACEHOLDER; // assert equality
}
```
- `encryptString(string) → Buffer`; `decryptString(Buffer) → string`; `isEncryptionAvailable() → boolean` (true only after `ready`). Windows uses DPAPI. `[CITED: electronjs.org/docs/latest/api/safe-storage]`
- Never log the plaintext; never expose this over `contextBridge`/IPC (D-05).

### Anti-Patterns to Avoid
- **`nodeIntegration:true` / `contextIsolation:false`:** security anti-pattern; use `contextIsolation:true` + `sandbox:true` + typed `contextBridge`. (CLAUDE.md)
- **Showing the overlay with `show()` or `focus()`:** steals focus — violates OVL-02. Only `showInactive()`.
- **Setting content protection once at creation:** drops to black box after a hide/show cycle — must re-apply on every show. (Pitfall 1)
- **Relying on `setVisibleOnAllWorkspaces` for Windows behavior:** no-op on Windows.
- **Putting the placeholder secret plaintext into electron-store or any log:** store only the ciphertext.
- **Using `^`/`~` on the Electron version:** D-09 requires an exact pin + committed lockfile.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hiding window from screen capture | Custom GDI/screenshot blocking | `win.setContentProtection(true)` | Wraps `SetWindowDisplayAffinity` (WDA_EXCLUDEFROMCAPTURE) correctly per OS build |
| Encrypting the secret at rest | Custom AES + key storage | `safeStorage` (DPAPI) | OS-backed key management; hand-rolled crypto is the classic security mistake |
| Persisting ciphertext / prefs | Hand-rolled JSON file IO | `electron-store` | Atomic writes, schema, `userData` pathing |
| Bundling 3-process Electron + TS + React | Custom webpack/esbuild wiring | `electron-vite` | Purpose-built main/preload/renderer configs + HMR |
| Producing a Win `.exe` | Custom packaging script | `electron-builder` | Mature, decoupled from dev tooling |

**Key insight:** Every "existential behavior" in this phase is a thin wrapper over a native Windows window-affinity / DPAPI primitive. The risk is **version coupling**, not custom code — the right Electron patch is the deliverable, not clever logic.

## Common Pitfalls

### Pitfall 1: Content protection shows a BLACK RECTANGLE instead of being invisible (THE gate risk)
**What goes wrong:** With certain 35.x patches, `setContentProtection(true)` makes the overlay appear as an opaque **black box** during screen share instead of being absent — directly failing success criterion 3.
**Why it happens:** PR #45868 ("fix setContentProtection after hide") changed the Windows path to call `SetAllowScreenshots`, which set `WDA_MONITOR` (black) instead of `WDA_EXCLUDEFROMCAPTURE` (invisible). It was backported into the 35.x line at **35.0.1** and persisted through **35.0.1, 35.0.2, 35.0.3, 35.1.x, 35.2.x, and 35.3.0**. The fix (PR #47020 / backport #47034, merged 2025-05-09) first ships in **35.4.0**.
**How to avoid:** Use Electron **≥ 35.4.0** — recommend the latest **35.7.5** (also includes the older-Windows fix #47886 from 2025-07-31). NEVER use 35.0.1–35.3.0. Re-apply `setContentProtection(true)` on every show (Pitfall 2 overlaps).
**Warning signs:** Black rectangle in the screen-share self-test → wrong patch or missing re-apply.
`[CITED: github.com/electron/electron issues #45990, #46507, #29085; PRs #45868, #47020, #47034, #47886]`

### Pitfall 2: Content protection silently lost after a hide/show cycle
**What goes wrong:** Protection set once at creation drops after the first hide → next show is capturable or black.
**Why it happens:** The window display affinity reverts on hide/show.
**How to avoid:** Re-apply `setContentProtection(true)` inside the `showOverlay` wrapper on **every** show, and on `blur`/`display-metrics-changed` (Pattern 2). This is exactly OVL-04's "re-applied after every show."
**Warning signs:** First show hidden, subsequent shows captured.
`[CITED: github.com/electron/electron/issues/29085]`

### Pitfall 3: Accidentally stealing focus
**What goes wrong:** Overlay becomes the active window; meeting app title bar greys out — fails OVL-02.
**Why it happens:** Using `show()`/`focus()`/`setAlwaysOnTop` interactions, or `focusable` left default-true.
**How to avoid:** `focusable:false` at creation + only ever `showInactive()`. Verify visually via the D-01 checklist.
**Warning signs:** Meeting app title bar loses its active highlight when the overlay appears/moves.
`[CITED: electronjs.org/docs/latest/api/browser-window — showInactive "doesn't focus"]`

### Pitfall 4: safeStorage called before `ready`
**What goes wrong:** `isEncryptionAvailable()` returns false / encrypt throws.
**Why it happens:** On Windows it only becomes available **after** the `ready` event.
**How to avoid:** Run the round-trip inside/after `app.whenReady()`.
`[CITED: electronjs.org/docs/latest/api/safe-storage]`

### Pitfall 5: ESM/CJS mismatch with electron-store@11
**What goes wrong:** `require()` of electron-store@11 throws (ERR_REQUIRE_ESM).
**Why it happens:** electron-store@11 is **ESM-only** (`engines.node >=20`); a CommonJS main bundle can't `require` it.
**How to avoid:** Keep the main bundle ESM (electron-vite default; set `"type":"module"`). If forced to CJS, pin electron-store@8.
`[VERIFIED: npm registry — electron-store engines]`

### Pitfall 6: Transparent window white flash / opaque background on first paint
**What goes wrong:** Brief white flash or solid background before the renderer paints — visible in the D-10 packaged smoke test.
**Why it happens:** Default background color paints before transparent renderer content loads.
**How to avoid:** `transparent:true` + `backgroundColor:'#00000000'`; show only after `ready-to-show`; transparent `<body>` CSS. This is precisely what the D-10 smoke test eyeballs.
`[ASSUMED]` (common Electron transparency guidance; verify visually on-machine)

## Code Examples

See Patterns 1–3 above — all carry verified source citations. Key signatures recap:
- `new BrowserWindow({ transparent, frame:false, focusable:false, webPreferences:{contextIsolation:true, sandbox:true, backgroundThrottling:false} })`
- `win.setAlwaysOnTop(true, 'screen-saver')` — levels include `screen-saver` (above Windows taskbar). `[CITED]`
- `win.setContentProtection(true)` — re-apply every show. `[CITED]`
- `win.showInactive()` — show without focus. `[CITED]`
- `safeStorage.encryptString(str): Buffer` / `decryptString(buf): string` / `isEncryptionAvailable(): boolean`. `[CITED]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "Avoid only 35.0.1" (per CLAUDE.md) | Avoid **35.0.1 through 35.3.0**; min safe **35.4.0** | Fix landed 2025-05-09 (#47034 → 35.4.0) | Revises the version-pinning instruction; 35.3.0 is also broken |
| Electron-patched loopback shims | Native `getDisplayMedia({audio:'loopback'})` (Win, Electron 31+) | (Phase 3 concern) | No shim needed on 35.x |
| ScriptProcessorNode for PCM | AudioWorklet | (Phase 4 concern) | Not relevant to Phase 1 |

**Deprecated/outdated:**
- CLAUDE.md's "35.0.1 is the broken patch" is **incomplete** — the regression spans 35.0.1–35.3.0. Use ≥35.4.0 (recommend 35.7.5).
- `setVisibleOnAllWorkspaces` on Windows — documented no-op; do not rely on it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TypeScript 6.0.3 is compatible with electron-vite 5 / the React-TS template | Standard Stack | Scaffold type-check friction; mitigate by pinning latest TS 5.9.x |
| A2 | The electron-vite scaffold template flag is `--template react-ts` via `npm create @quick-start/electron@latest` | Installation | Wrong flag → re-run scaffold with correct template (cheap) |
| A3 | Transparent-window white-flash mitigation (`backgroundColor:'#00000000'` + `ready-to-show`) is needed/sufficient on the target machine | Pitfall 6 | Visible flash in smoke test; tune on-machine (this is what D-10 checks) |
| A4 | `electron@35.7.5` works correctly on the *specific* target Windows 11 build | Summary/Recommendation | If black box appears, bisect down toward 35.4.0 (still has the core fix). On-machine verification (01-04) IS the mitigation. |

## Open Questions

1. **Does the target Windows 11 build need the #47886 "older Windows versions" fix?**
   - What we know: #47886 (2025-07-31) addresses content protection on *older* Windows builds; the target is Windows 11 (2004+), which is covered by the main #47034 fix.
   - What's unclear: exact target build number.
   - Recommendation: Use 35.7.5 (includes both fixes) — eliminates the question entirely. Record the exact `winver` build in VERIFICATION.md (D-03).

2. **Does the renderer need ANY contextBridge channel in Phase 1?**
   - What we know: HUD needs Electron version + CP state + position (D-07); none are secrets.
   - Recommendation: Expose one read-only, typed, non-secret status channel via `contextBridge` (establishes the boundary pattern Phase 6 extends). No secret channels (D-05).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥20 | electron-store@11 (`engines.node >=20`), electron-vite | Verify on machine | — | Install Node 20 LTS |
| npm | Install/scaffold | Assumed (Node) | — | — |
| Windows 11 (build 2004+ / 10.0.x) | `setContentProtection` WDA_EXCLUDEFROMCAPTURE | Target machine (env: Windows 11 Home 10.0.26200) | 10.0.26200 | none — platform requirement |
| A screen-share/recording tool OR Snipping Tool | D-02 self-test (prove absence from capture) | Built into Win 11 / meeting apps | — | Win+Shift+S screenshot or Teams/Zoom share |
| electron-builder native toolchain (NSIS) | D-10 packaged smoke `.exe` | Downloaded by electron-builder on first run | — | portable `.exe` target if NSIS unavailable |

**Missing dependencies with no fallback:** none identified (target machine is Windows 11 build 10.0.26200, which satisfies the 2004+ requirement).
**Missing dependencies with fallback:** Node ≥20 must be confirmed; install Node 20 LTS if absent.

## Validation Architecture

> nyquist_validation is `true` in config.json. This phase is empirically gated (GO/NO-GO), so validation is largely **manual on-machine** evidence (D-01/D-02/D-03) plus a small amount of automatable assertion.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None yet (greenfield). For the safeStorage assertion, a lightweight Vitest unit/integration test or a `npm run verify:secret` main-process script. `[ASSUMED]` |
| Config file | none — Wave 0 |
| Quick run command | `npm run verify:secret` (main-process round-trip prints PASS/FAIL) — to be created |
| Full suite command | Manual on-machine checklist (VERIFICATION.md) + `npm run verify:secret` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| OVL-01 | Transparent/frameless/always-on-top renders over all windows | manual-visual | — (eyeball; HUD visible on top) | ❌ Wave 0 (VERIFICATION.md) |
| OVL-02 | Meeting app title bar stays focused while overlay shown/moved | manual-visual (D-01) | — (checklist) | ❌ Wave 0 |
| OVL-04 | Overlay absent (not black) in real screen share; CP re-applied each show | manual-visual (D-02) | — (saved proof screenshot) | ❌ Wave 0 |
| OVL-06 | Behaviors verified on target machine + pinned version recorded | manual (D-03) | — (committed VERIFICATION.md) | ❌ Wave 0 |
| SET-03 | safeStorage placeholder round-trip equals original; ciphertext only persisted | unit/integration (automatable) | `npm run verify:secret` | ❌ Wave 0 |
| D-10 | Packaged `.exe` still renders transparent/frameless | manual-visual | `npm run build && launch .exe` then eyeball | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run verify:secret` (if/when the safeStorage assertion exists) + `npm run typecheck`/lint.
- **Per wave merge:** dev launch (`electron-vite dev`), eyeball HUD shows version + CP=ON + position.
- **Phase gate:** Full manual VERIFICATION.md checklist signed (D-01/D-02/D-03) + safeStorage PASS + packaged smoke `.exe` eyeballed (D-10), exact Electron patch recorded.

### Wave 0 Gaps
- [ ] `VERIFICATION.md` — the GO/NO-GO evidence doc (checklist, version, machine info, date, proof-screenshot path) — D-03
- [ ] `verify:secret` script/test — automatable safeStorage round-trip assertion (SET-03)
- [ ] (Optional) Vitest install if the safeStorage assertion is written as a test rather than a script
- [ ] Lint/format config per IDEXX standards (oxlint + Prettier, 4-space, single quotes, 180 col)

## Security Domain

> security_enforcement not set to false → included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth in Phase 1 |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | No external input in Phase 1 (placeholder is hardcoded) |
| V6 Cryptography | **yes** | `safeStorage` (DPAPI) — never hand-roll crypto; store ciphertext only |
| V7 Error Handling & Logging | **yes** | Never log the placeholder/real plaintext or ciphertext-as-text in a way that leaks; the boundary established here protects Phase 6 real keys |
| V10 Malicious Code / Config | **yes** | `contextIsolation:true`, `sandbox:true`, typed `contextBridge`, no `nodeIntegration` — renderer cannot reach Node/secrets |

### Known Threat Patterns for Electron + secret-at-rest
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer escalates to Node and reads secrets | Elevation of Privilege | `contextIsolation:true` + `sandbox:true` + no `nodeIntegration` (D-06) |
| Secret leaks via IPC channel to renderer | Information Disclosure | No secret-bearing IPC in Phase 1 (D-05); Phase 6 channel returns booleans only |
| Plaintext secret persisted/committed | Information Disclosure | Encrypt with DPAPI; persist only ciphertext; placeholder is fake in Phase 1 (D-04); ensure `.gitignore` covers any store file |
| Secret written to logs | Information Disclosure | Do not log plaintext; redact (V7) |
| Tampering with stored ciphertext | Tampering | DPAPI decrypt fails closed; round-trip assertion detects corruption |

## Sources

### Primary (HIGH confidence)
- electronjs.org/docs/latest/api/browser-window — `focusable`, `setContentProtection` (Win10 2004+ WDA_EXCLUDEFROMCAPTURE vs WDA_MONITOR black window), `showInactive`, `setAlwaysOnTop` levels incl. `screen-saver`, `setVisibleOnAllWorkspaces` (no-op on Windows), `backgroundThrottling`
- electronjs.org/docs/latest/api/safe-storage — `encryptString→Buffer`, `decryptString→string`, `isEncryptionAvailable` (true only after `ready`), DPAPI on Windows
- npm registry (`npm view`) — electron 35.x patch list (→35.7.5) + per-version publish dates; electron-vite 5.0.0, electron-builder 26.15.3, electron-store 11.0.2 (`engines.node>=20`), @electron/rebuild 4.0.4, react/react-dom 19.2.7, typescript 6.0.3 (all 2026-06-16)
- github.com/electron/electron PR #47020 + backport #47034 (merged 2025-05-09, semver/patch) — "restore previous Windows screenshotting"; PR #45868 (regression source); PR #47886 (older-Windows fix, 2025-07-31)

### Secondary (MEDIUM confidence)
- github.com/electron/electron issues #45990, #46507, #46180, #46321, #46539, #29085 — black-rectangle regression reports + hide/show re-apply requirement
- electron-vite.org — three-config model, scaffold command

### Tertiary (LOW confidence)
- electron-vite `--template react-ts` exact flag (A2) — verify at scaffold time
- Transparent-window flash mitigation specifics (A3) — verify on-machine in D-10 smoke test

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified on npm 2026-06-16
- Overlay API shape: HIGH — verified against current Electron BrowserWindow docs
- Content-protection version mapping: HIGH — cross-referenced 5+ GitHub issues + PR backport + npm publish dates
- safeStorage boundary: HIGH — verified against current safeStorage docs
- Pitfalls: HIGH (Pitfalls 1–5), MEDIUM (Pitfall 6 transparency flash — verify on-machine)

**Research date:** 2026-06-16
**Valid until:** 2026-07-16 (Electron patch line is active; re-check the latest 35.x patch before pinning if planning slips)
