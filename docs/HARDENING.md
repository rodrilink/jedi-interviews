# Jedi Interviews — Hardening & Operational Notes

Operational notes for running the packaged portable `.exe` on the target Windows 11 machine.
Covers the four PKG-01 hardening concerns (Phase 7, CONTEXT D-15): SmartScreen friction, the
hardware-acceleration fallback, hotkey-registration recovery, and latency instrumentation.

This is a personal, single-user tool. The decisions below favour an unsigned portable build with
documented, accepted friction over distribution machinery (installers, code-signing certificates) —
see CONTEXT Deferred Ideas.

---

## 1. SmartScreen — unsigned portable `.exe` (accepted friction)

Jedi Interviews ships as a single, unsigned, portable Windows `.exe`
(`release/Jedi Interviews-1.0.0-portable.exe`). Because it is **not code-signed**, Windows Defender
SmartScreen will show a blue **"Windows protected your PC"** warning the first time you run a freshly
downloaded or freshly built copy.

This friction is **ACCEPTED** for a personal single-user tool (D-12 / D-15). Buying a code-signing
certificate is **out of scope** (CONTEXT Deferred Ideas — revisit only if the tool is ever distributed
beyond the owner).

### Click-through steps

1. Double-click `Jedi Interviews-1.0.0-portable.exe`.
2. If SmartScreen appears, click **More info**.
3. Click the **Run anyway** button that appears.
4. The overlay launches. SmartScreen typically only prompts on the first run of a given build; once
   you have clicked **Run anyway**, subsequent launches of the same file run without the prompt.

> If "Run anyway" does not appear, the file may be blocked by the "Mark of the Web" zone flag. Right-click
> the `.exe` → **Properties** → tick **Unblock** at the bottom of the General tab → **Apply**, then retry.

---

## 2. Hardware-acceleration fallback — `JEDI_DISABLE_GPU=1`

The overlay is a transparent, frameless, always-on-top window. On most machines GPU-accelerated
compositing renders the transparency correctly (verified GO at the 07-02 on-machine gate — the fallback
was **not** needed). But transparent-window rendering can glitch on some GPU/driver combinations (black
box, smearing, or a flash of opaque background).

If transparency glitches in the packaged build, **relaunch with hardware acceleration disabled** by
setting the opt-in environment variable `JEDI_DISABLE_GPU=1`. This calls
`app.disableHardwareAcceleration()` at the top of the main process, **before the app is ready** (it is a
no-op if set later — Pitfall 6). Hardware acceleration is the **default**; this fallback is **opt-in** and
only worth trying if you actually see a transparency glitch.

### How to set the env var for the portable `.exe`

**PowerShell (one launch, recommended):**

```powershell
$env:JEDI_DISABLE_GPU = "1"; & ".\Jedi Interviews-1.0.0-portable.exe"
```

**Command Prompt (cmd.exe):**

```cmd
set JEDI_DISABLE_GPU=1 && "Jedi Interviews-1.0.0-portable.exe"
```

To make it permanent for your user account, set it under **System Properties → Environment Variables**,
then relaunch. Unset it (or set to anything other than `1`) to return to the default GPU path.

> Note: `electron#51363` reports that on Electron 38+ this flag no longer fully kills the GPU process.
> That is **irrelevant here** — Jedi Interviews is pinned at Electron **35.7.5**, where the flag behaves
> as documented. This is also a reason not to chase a newer Electron major.

---

## 3. Hotkey-config recovery — registration failure is visible (CTL-03)

All control is via global `Ctrl+Alt` hotkeys (the overlay never takes focus). Hotkeys register once at
startup via the passive `uiohook-napi` hook, falling back to Electron `globalShortcut` if the native hook
cannot attach. A chord can register fine in dev but **fail in the packaged build** — e.g. it collides with
a chord another running app (Teams / Zoom / VS Code) has reserved, or the native hook cannot attach.

A registration failure is **never silently dropped** (CTL-03):

- The failed action labels are surfaced on the **HUD status line** (the hotkey row reflects the active
  layer and any failed chords).
- The outcome is **also logged to the main process** at startup
  (`[hotkey] registration ok …` / `[hotkey] registration FAILED layer=… chords=…`), so a failure is
  visible in the logs even if the HUD is dismissed. The log carries only stable action **labels** — never
  a transcript, key, or payload (T-7-IL2).

This covers the **full current chord set**, including the chords added after the original Phase-2
conflict-tested set: `capture-code-challenge` (`Ctrl+Alt+C`), `copy-code-challenge` (`Ctrl+Alt+Y`),
`toggle-interaction` (`Ctrl+Alt+M`), and `focus-cycle` (`Ctrl+Alt+F`). A failed registration of **any** of
these surfaces through the same path.

### If a chord fails / collides

Check the HUD status line (and the main-process log) for the failed action label, then fall back to the
documented alternate letter for that chord. For the screenshot/code-challenge chord, `Ctrl+Alt+C` has a
documented fallback letter of **`V`** ("vision") if it collides on the machine; update the chord's
`accelerator` in `hotkey-registrar.service.ts` and rebuild.

> **Pending verification (carried from quick task 260619-mcv):** the on-machine Teams/Zoom/VS Code
> conflict re-check for `Ctrl+Alt+Y` (copy) and `Ctrl+Alt+M` (interaction toggle) is **still pending** —
> these two chords are **not yet conflict-verified** on the target machine. Treat them as provisional
> until that re-check is signed off; if either collides, fall back to a reserved letter and update its
> TSDoc + accelerator. `Ctrl+Alt+C` likewise carries the 07-02 packaged-build re-check.

---

## 4. Latency instrumentation

Hotkey → first-token latency is logged in the **main process only** (never pushed to the renderer) for
**all three AI modes**, including the vision / code-challenge mode:

```
[ai] first-token mode=<answer|talking-points|code-challenge> model=<model-id> latencyMs=<ms>
```

- The log carries **only** `mode`, `model`, and `latencyMs` — never the transcript, the captured image
  base64, the API key, or an error payload (T-7-IL2 / T-5-10).
- For `code-challenge`, the start timestamp is captured at the **chord press** — *before* the async
  screenshot capture + downscale — so the measured latency includes the capture time the user actually
  feels.

### Tuning knob

If a code-challenge solution is **truncated** (cut off mid-solution) or feels **too slow**, the tunable
knob is the per-mode `MAX_TOKENS['code-challenge']` constant (currently **1500**) in
`src/main/ai/ai-orchestrator.ts`. Raise it if solutions are truncated; lower it to trade completeness for
speed/cost. The vision model is `claude-opus-4-8` (`CODE_CHALLENGE_MODEL`).
