/**
 * The internal focus-cycle panel key (D-08/D-09). Stays as-is to avoid churn across main/preload/renderer;
 * only the DISPLAY strings are mapped through {@link PANEL_LABEL}.
 */
export type ActivePanel = 'transcript' | 'ai' | 'vision';

/**
 * The SINGLE source of truth for the user-facing display name of each focus-cycle panel (quick fix
 * 260619-mcv, locked decision A). Used EVERYWHERE a panel name is shown — the focus pills, the HUD
 * active-panel readout, and the panel corner labels — so the names never drift apart again:
 *   - 'transcript' → "Q/A"   (the Questions / Answers transcript panel)
 *   - 'ai'         → "AI"
 *   - 'vision'     → "Code"
 * The internal keys are unchanged; only these display strings are canonical.
 */
export const PANEL_LABEL: Record<ActivePanel, string> = {
    transcript: 'Q/A',
    ai: 'AI',
    vision: 'Code',
};
