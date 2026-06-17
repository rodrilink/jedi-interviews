# Phase 1 — GO/NO-GO Verification Record

> **Status: GO — verified on-machine 2026-06-17 by Rodrigo Gomez (Electron 35.7.5, no bisect required).**
> One bug was found and fixed during the gate: the overlay was not click-through and blocked
> mouse clicks to windows beneath it (OVL-02). Fixed in quick task 260616-w65 (commit `4115f62`,
> `setIgnoreMouseEvents(true, { forward: true })`); re-verified GO on the same machine.
> This is the auditable GO/NO-GO gate record for Phase 1 (OVL-01 / OVL-02 / OVL-04 / OVL-06, D-10).
> The two existential, version-coupled overlay behaviors — (1) focus is **never** stolen from the
> active meeting app, and (2) the overlay is **absent** (not a black rectangle) from screen capture —
> MUST be proven empirically on the target Windows 11 machine against the pinned Electron build before
> any Phase 2+ feature work. Tick each box only after observing the behavior in person; do not
> fabricate results.
>
> **How to run the gate:** `npm run dev` on the target Windows 11 machine, then perform the
> Focus, Transparency, and Content-Protection checks below. For the packaged smoke, launch the
> portable `.exe` produced by `npm run package` (see Packaged Smoke section).

---

## Recorded Environment (D-03 / D-09 / OVL-06)

| Field                                | Value                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Electron version (pinned, exact)** | `35.7.5` (from `package.json` devDependencies — exact pin, no `^`/`~`; lockfile committed per D-09) |
| **Minimum safe Electron patch**      | `35.4.0` (content-protection fix #47034; bisect DOWN toward this only if a black box appears)       |
| **Windows build** (`winver` / `ver`) | `10.0.26200.8655`                                                                                   |
| **Machine**                          | `MSI` (personal Windows 11 Home machine)                                                            |
| **Verified by**                      | Rodrigo Gomez                                                                                       |
| **Date**                             | `2026-06-17`                                                                                        |

> Procedure (D-09): the verified build MUST equal the shipped build. Electron is pinned to an exact
> version in `package.json` and the lockfile is committed. If a content-protection black box appears
> at gate time, bisect the Electron patch DOWN toward `35.4.0` (still contains the core fix #47034),
> re-pin exactly, commit the lockfile, re-run this gate, and record the working patch above.

---

## 1. Focus Discipline Checklist (D-01 / OVL-02)

> Watch the active meeting app's **title bar** stay focused/active — do NOT rely on programmatic
> foreground-window logging (D-01). The overlay must NEVER become the active window.

- [x] Opened a real meeting app and clicked into it so its title bar is active/focused.
- [x] With the overlay shown, the meeting app's title bar **stays active** (not greyed out).
- [x] While the overlay is **moved** on screen, the meeting app's title bar **remains active**.
- [x] The overlay never appears in the taskbar and never becomes the foreground/active window.
- [x] No keyboard/mouse focus is ever taken from the meeting app by the overlay.
- [x] **Mouse clicks pass THROUGH the overlay to the window beneath** (click-through; OVL-02). _Initially FAILED — the overlay swallowed clicks; fixed in quick task 260616-w65 (`setIgnoreMouseEvents`) and re-verified PASS._

**Result:** ✅ PASS / ⬜ FAIL
**If FAIL (focus stolen — meeting title bar greys out):** a `show()`/`focus()` slipped in or
`focusable` is not `false`. Return to plan 01-02 to fix, then re-run this gate.

---

## 2. Transparency / Always-On-Top Checklist (OVL-01)

> The HUD is the visible verification readout (D-07): it shows the pinned Electron version,
> content-protection state, and window position.

- [x] The HUD floats over a **maximized** window (always-on-top, `'screen-saver'` level).
- [x] The overlay has **NO opaque/solid background** and **NO frame** (true transparency).
- [x] The HUD reads the pinned Electron version (`35.7.5`), `CP = ON`, and a window position.

**Result:** ✅ PASS / ⬜ FAIL

---

## 3. Content Protection / Screen-Share Checklist (D-02 / OVL-04)

> Prove **absence from capture** with a REAL self screen-share or system screenshot while the
> overlay is visible. Confirm the overlay is **fully absent — NOT a black rectangle**.

- [x] Took a system screenshot (`Win+Shift+S`) while the overlay was visible.
- [x] In the captured image, the overlay is **fully absent** — **NOT** a black rectangle.
- [x] Saved the capture as the proof screenshot into the repo (see path below).

**Proof screenshot path:** `.planning/phases/01-overlay-shell-existential-behaviors/proof-screenshot.png`

**Result:** ✅ PASS / ⬜ FAIL
**If FAIL (overlay appears as a BLACK BOX in the capture):** the Electron patch is wrong or content
protection was not re-applied on show. Bisect the Electron version DOWN toward `35.4.0`, re-pin
exactly, commit the lockfile, and re-run this gate. Record the working patch in the environment block.

---

## 4. Packaged `.exe` Transparency Smoke (D-10)

> Minimal smoke ONLY — eyeball that transparency/frameless rendering survives packaging.
> Full focus + content-protection re-verification of the packaged build is intentionally deferred
> to Phase 7 / PKG-01.

| Field                 | Value                                                                   |
| --------------------- | ----------------------------------------------------------------------- |
| **Build command**     | `npm run package` (`electron-vite build` then `electron-builder --win`) |
| **Target**            | `portable` (Windows, unsigned — installer/signing deferred to Phase 7)  |
| **Produced artifact** | `release/Jedi Interviews 1.0.0.exe` _(gitignored; not committed)_       |

- [x] Launched a packaged `.exe` produced by `npm run package` (original build, pre-click-through-fix).
- [x] The HUD renders **transparent/frameless** — **no opaque/solid background**.
- [x] **No persistent white flash** on first paint (transient first-paint flash is acceptable).
- [x] The HUD is visible over the desktop.

**Result:** ✅ PASS / ⬜ FAIL
**Note:** transparency/frameless rendering was eyeballed on the packaged build and confirmed live in
`npm run dev`. The `.exe` was rebuilt (`npm run package`) after the click-through fix (260616-w65); the
click-through fix is main-process window behavior and does not affect packaged transparency rendering.
**If FAIL (opaque bg / persistent white flash):** apply the transparency fix
(`backgroundColor:'#00000000'` + show only after `ready-to-show`), rebuild, and re-run this smoke.

---

## Sign-Off (GO / NO-GO)

The phase gate is **GO** only when sections 1–4 all read PASS, the proof screenshot is saved and its
path recorded, and the environment block is fully filled in.

- [x] **GO** — All four checks PASS; focus never stolen; overlay absent (not black) in real capture;
      packaged `.exe` renders transparent; environment recorded.
- [ ] **NO-GO** — A check failed (describe below); do not proceed to Phase 2 until resolved.

**Notes / failure description:**

First gate run (2026-06-17) was a **NO-GO**: focus discipline, transparency, and content protection all
passed, but the overlay was **not click-through** — its transparent surface swallowed mouse clicks, so
windows beneath it could not be clicked (OVL-02 violation; missing `setIgnoreMouseEvents`). Corrective
action: quick task **260616-w65** added `setIgnoreMouseEvents(true, { forward: true })` at window
creation and re-asserted it in `showOverlay()` (commit `4115f62`). No Electron bisect was required —
the working patch remains the pinned `35.7.5`. Re-verified on the same machine: all checks PASS → **GO**.

**Signed:** Rodrigo Gomez **Date:** 2026-06-17
