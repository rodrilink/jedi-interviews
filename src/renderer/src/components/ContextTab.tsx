import { useEffect, useMemo, useState, type JSX } from 'react';
import type { ISettingsSessionContextDto } from '../settings-api.d';

/** The local save lifecycle indicator state for the Context tab. */
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** The four editable grounding fields as plain textarea strings (Links is newline-joined for editing). */
interface IContextForm {
    notes: string;
    ticketText: string;
    repoSnippets: string;
    /** One URL per line. Parsed into `string[]` authoritatively in MAIN via `parseLinks` (06-02/06-04). */
    links: string;
}

/** An empty form — the baseline when no active context exists yet. */
const EMPTY_FORM: IContextForm = { notes: '', ticketText: '', repoSnippets: '', links: '' };

/**
 * Maps the loaded active context DTO into the editable form. The four grounding fields map 1:1 to
 * `IGroundingContext` (D-05); `links[]` is rendered back as newline-joined text for the textarea
 * (round-trips with `parseLinks`, 06-02).
 *
 * @param dto - The loaded active context, or undefined when none is saved yet.
 * @returns The editable form values.
 */
function toForm(dto: ISettingsSessionContextDto | undefined): IContextForm {
    if (dto === undefined) {
        return EMPTY_FORM;
    }

    return {
        notes: dto.notes ?? '',
        ticketText: dto.ticketText ?? '',
        repoSnippets: dto.repoSnippets ?? '',
        links: (dto.links ?? []).join('\n'),
    };
}

/**
 * The Context tab (CTX-01, D-05/D-06): the four grounding-field editor — Notes, Ticket text, Repo
 * snippets, and Links (one URL per line) — with an unsaved-changes (dirty) indicator and an EXPLICIT
 * single Save (NOT autosave, D-06).
 *
 * On mount it pre-fills from `getContext()` (fully meaningful once 06-04 wires the handler; until then
 * it resolves to `undefined` and the form starts empty). The dirty flag is derived by comparing the
 * live form against the loaded baseline. Save sends the four fields ONCE per click with `links` as the
 * RAW newline-joined string — parsing into `string[]` is authoritative in main (06-02 `parseLinks`).
 *
 * @returns The Context tab element.
 */
export function ContextTab(): JSX.Element {
    const [form, setForm] = useState<IContextForm>(EMPTY_FORM);
    const [baseline, setBaseline] = useState<IContextForm>(EMPTY_FORM);
    const [status, setStatus] = useState<SaveStatus>('idle');

    // Pre-fill from the saved active context on mount. getContext resolves to undefined until 06-04
    // wires the handler body; the form simply starts empty in that case (no error).
    useEffect(() => {
        let cancelled = false;
        void window.settingsApi.getContext().then((dto: ISettingsSessionContextDto | undefined) => {
            if (!cancelled) {
                const loaded = toForm(dto);
                setForm(loaded);
                setBaseline(loaded);
            }
        });

        return (): void => {
            cancelled = true;
        };
    }, []);

    // Derived dirty state — any field differing from the loaded baseline. No save side effect here
    // (D-06: save is explicit, never on change).
    const dirty = useMemo<boolean>(
        () => form.notes !== baseline.notes || form.ticketText !== baseline.ticketText || form.repoSnippets !== baseline.repoSnippets || form.links !== baseline.links,
        [form, baseline]
    );

    // A single typed field updater. Editing only mutates local state + resets the saved indicator — it
    // NEVER calls saveContext (D-06).
    const updateField =
        (field: keyof IContextForm) =>
        (value: string): void => {
            setForm((current) => ({ ...current, [field]: value }));
            setStatus('idle');
        };

    const handleSave = async (): Promise<void> => {
        setStatus('saving');
        try {
            // Send links as the RAW newline-joined string — main parses via parseLinks (single authority).
            await window.settingsApi.saveContext({
                notes: form.notes,
                ticketText: form.ticketText,
                repoSnippets: form.repoSnippets,
                links: form.links,
            });
            // On success the live form becomes the new clean baseline → dirty clears.
            setBaseline(form);
            setStatus('saved');
        } catch {
            setStatus('error');
        }
    };

    return (
        <section className="settings-tab" data-testid="card-context-tab">
            <div className="settings-field">
                <label className="settings-field__label" htmlFor="input-notes">
                    Notes
                </label>
                <textarea
                    className="settings-field__textarea"
                    data-testid="input-notes"
                    id="input-notes"
                    value={form.notes}
                    onChange={(event): void => updateField('notes')(event.target.value)}
                />
            </div>

            <div className="settings-field">
                <label className="settings-field__label" htmlFor="input-ticket-text">
                    Ticket text
                </label>
                <textarea
                    className="settings-field__textarea"
                    data-testid="input-ticket-text"
                    id="input-ticket-text"
                    value={form.ticketText}
                    onChange={(event): void => updateField('ticketText')(event.target.value)}
                />
            </div>

            <div className="settings-field">
                <label className="settings-field__label" htmlFor="input-repo-snippets">
                    Repo snippets
                </label>
                <textarea
                    className="settings-field__textarea"
                    data-testid="input-repo-snippets"
                    id="input-repo-snippets"
                    value={form.repoSnippets}
                    onChange={(event): void => updateField('repoSnippets')(event.target.value)}
                />
            </div>

            <div className="settings-field">
                <label className="settings-field__label" htmlFor="input-links">
                    Links
                </label>
                <span className="settings-field__hint">One URL per line.</span>
                <textarea
                    className="settings-field__textarea"
                    data-testid="input-links"
                    id="input-links"
                    value={form.links}
                    onChange={(event): void => updateField('links')(event.target.value)}
                />
            </div>

            <div className="settings-actions">
                <button className="settings-button" data-testid="btn-save-context" type="button" disabled={!dirty || status === 'saving'} onClick={(): void => void handleSave()}>
                    Save context
                </button>
                {dirty && (
                    <span className="settings-status settings-status--dirty" data-testid="text-dirty-indicator">
                        unsaved changes
                    </span>
                )}
                {!dirty && status === 'saved' && (
                    <span className="settings-status settings-status--saved" data-testid="text-context-saved">
                        saved ✓
                    </span>
                )}
                {status === 'error' && <span className="settings-status settings-status--dirty">Save failed — try again.</span>}
            </div>
        </section>
    );
}
