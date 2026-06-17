# Phase 1 — GO/NO-GO Verification Record

> **Status: PENDING — awaiting on-machine sign-off.**
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
| **Windows build** (`winver` / `ver`) | `10.0.26200.8655` _(target machine; re-confirm with `winver` at gate time)_                         |
| **Machine**                          | _(record hostname / model — e.g. "personal Win 11 Home laptop")_                                    |
| **Verified by**                      | _(name)_                                                                                            |
| **Date**                             | `2026-06-17` _(set to the actual gate-run date)_                                                    |

> Procedure (D-09): the verified build MUST equal the shipped build. Electron is pinned to an exact
> version in `package.json` and the lockfile is committed. If a content-protection black box appears
> at gate time, bisect the Electron patch DOWN toward `35.4.0` (still contains the core fix #47034),
> re-pin exactly, commit the lockfile, re-run this gate, and record the working patch above.

---

## 1. Focus Discipline Checklist (D-01 / OVL-02)

> Watch the active meeting app's **title bar** stay focused/active — do NOT rely on programmatic
> foreground-window logging (D-01). The overlay must NEVER become the active window.

- [ ] Opened a real meeting app (Teams or Zoom) and clicked into it so its title bar is active/focused.
- [ ] With the overlay shown, the meeting app's title bar **stays active** (not greyed out).
- [ ] While the overlay is **moved** on screen, the meeting app's title bar **remains active**.
- [ ] The overlay never appears in the taskbar and never becomes the foreground/active window.
- [ ] No keyboard/mouse focus is ever taken from the meeting app by the overlay.

**Result:** ⬜ PASS / ⬜ FAIL
**If FAIL (focus stolen — meeting title bar greys out):** a `show()`/`focus()` slipped in or
`focusable` is not `false`. Return to plan 01-02 to fix, then re-run this gate.

---

## 2. Transparency / Always-On-Top Checklist (OVL-01)

> The HUD is the visible verification readout (D-07): it shows the pinned Electron version,
> content-protection state, and window position.

- [ ] The HUD floats over a **maximized** window (always-on-top, `'screen-saver'` level).
- [ ] The overlay has **NO opaque/solid background** and **NO frame** (true transparency).
- [ ] The HUD reads the pinned Electron version (`35.7.5`), `CP = ON`, and a window position.

**Result:** ⬜ PASS / ⬜ FAIL

---

## 3. Content Protection / Screen-Share Checklist (D-02 / OVL-04)

> Prove **absence from capture** with a REAL self screen-share or system screenshot while the
> overlay is visible. Confirm the overlay is **fully absent — NOT a black rectangle**.

- [ ] Started a REAL screen share (Teams/Zoom "share screen") **OR** took a system screenshot
      (`Win+Shift+S`) while the overlay was visible.
- [ ] In the captured image, the overlay is **fully absent** — **NOT** a black rectangle.
- [ ] Saved the capture as the proof screenshot into the repo (see path below).

**Proof screenshot path:** `_(record the committed relative path, e.g. .planning/phases/01-overlay-shell-existential-behaviors/proof-screenshot.png)_`

**Result:** ⬜ PASS / ⬜ FAIL
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

- [ ] Launched the packaged `.exe` produced by `npm run package`.
- [ ] The HUD renders **transparent/frameless** — **no opaque/solid background**.
- [ ] **No persistent white flash** on first paint (transient first-paint flash is acceptable).
- [ ] The HUD is visible over the desktop.

**Result:** ⬜ PASS / ⬜ FAIL
**If FAIL (opaque bg / persistent white flash):** apply the transparency fix
(`backgroundColor:'#00000000'` + show only after `ready-to-show`), rebuild, and re-run this smoke.

---

## Sign-Off (GO / NO-GO)

The phase gate is **GO** only when sections 1–4 all read PASS, the proof screenshot is saved and its
path recorded, and the environment block is fully filled in.

- [ ] **GO** — All four checks PASS; focus never stolen; overlay absent (not black) in real capture;
      packaged `.exe` renders transparent; environment recorded.
- [ ] **NO-GO** — A check failed (describe below); do not proceed to Phase 2 until resolved.

**Notes / failure description:**

_(record any failures, the corrective action taken, and the re-verified working Electron patch)_

**Signed:** _(name)_ **Date:** _(date)_
