import { useEffect, useState, type JSX } from 'react';
import type { IApiKeyPresence } from '../settings-api.d';

/** The local save lifecycle indicator state for the Keys tab. */
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The Keys tab (SET-02): two masked inputs for the Deepgram + Anthropic API keys, an explicit Save
 * button, and a presence display.
 *
 * SECURITY (T-06-10): the presence display is driven SOLELY by `getKeys()`, which returns booleans
 * only — this component never receives, stores, or renders a saved key string. The inputs are
 * write-only: they start empty on mount and are cleared after a successful save. `saveKeys` sends only
 * the fields the user actually filled (empty fields are omitted so an existing key is left unchanged).
 *
 * @returns The Keys tab element.
 */
export function KeysTab(): JSX.Element {
    const [deepgramInput, setDeepgramInput] = useState<string>('');
    const [anthropicInput, setAnthropicInput] = useState<string>('');
    const [reveal, setReveal] = useState<boolean>(false);
    const [presence, setPresence] = useState<IApiKeyPresence>({ deepgram: false, anthropic: false });
    const [status, setStatus] = useState<SaveStatus>('idle');

    // Load presence booleans on mount. NEVER reads a key value — getKeys is presence-only (T-06-10).
    useEffect(() => {
        let cancelled = false;
        void window.settingsApi.getKeys().then((next: IApiKeyPresence) => {
            if (!cancelled) {
                setPresence(next);
            }
        });

        return (): void => {
            cancelled = true;
        };
    }, []);

    const handleSave = async (): Promise<void> => {
        const keys: { deepgram?: string; anthropic?: string } = {};
        // Only send fields the user actually filled — an empty field leaves the existing key unchanged.
        if (deepgramInput.trim().length > 0) {
            keys.deepgram = deepgramInput.trim();
        }
        if (anthropicInput.trim().length > 0) {
            keys.anthropic = anthropicInput.trim();
        }

        if (keys.deepgram === undefined && keys.anthropic === undefined) {
            return;
        }

        setStatus('saving');
        try {
            await window.settingsApi.saveKeys(keys);
            // Write-only inputs: clear after save so a key value never lingers in the field.
            setDeepgramInput('');
            setAnthropicInput('');
            const next = await window.settingsApi.getKeys();
            setPresence(next);
            setStatus('saved');
        } catch {
            setStatus('error');
        }
    };

    const inputType = reveal ? 'text' : 'password';

    return (
        <section className="settings-tab" data-testid="card-keys-tab">
            <div className="settings-field">
                <label className="settings-field__label" htmlFor="input-deepgram-key">
                    Deepgram API key
                </label>
                <div className="settings-field__key-row">
                    <input
                        className="settings-field__input"
                        data-testid="input-deepgram-key"
                        id="input-deepgram-key"
                        type={inputType}
                        autoComplete="off"
                        placeholder="Enter to set or replace"
                        value={deepgramInput}
                        onChange={(event): void => setDeepgramInput(event.target.value)}
                    />
                </div>
            </div>

            <div className="settings-field">
                <label className="settings-field__label" htmlFor="input-anthropic-key">
                    Anthropic API key
                </label>
                <div className="settings-field__key-row">
                    <input
                        className="settings-field__input"
                        data-testid="input-anthropic-key"
                        id="input-anthropic-key"
                        type={inputType}
                        autoComplete="off"
                        placeholder="Enter to set or replace"
                        value={anthropicInput}
                        onChange={(event): void => setAnthropicInput(event.target.value)}
                    />
                </div>
            </div>

            <div className="settings-presence" data-testid="text-key-presence">
                <span className={presence.deepgram ? 'settings-presence__set' : 'settings-presence__unset'}>Deepgram: {presence.deepgram ? 'set ✓' : 'not set'}</span>
                <span className={presence.anthropic ? 'settings-presence__set' : 'settings-presence__unset'}>Anthropic: {presence.anthropic ? 'set ✓' : 'not set'}</span>
            </div>

            <div className="settings-actions">
                <button className="settings-button" data-testid="btn-save-keys" type="button" onClick={(): void => void handleSave()}>
                    Save keys
                </button>
                <button className="settings-button settings-button--ghost" data-testid="btn-toggle-key-reveal" type="button" onClick={(): void => setReveal((value) => !value)}>
                    {reveal ? 'Hide' : 'Show'}
                </button>
                {status === 'saving' && <span className="settings-status">Saving…</span>}
                {status === 'saved' && (
                    <span className="settings-status settings-status--saved" data-testid="text-keys-saved">
                        saved ✓
                    </span>
                )}
                {status === 'error' && <span className="settings-status settings-status--dirty">Save failed — try again.</span>}
            </div>
        </section>
    );
}
