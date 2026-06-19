import { useState, type JSX } from 'react';
import { ContextTab } from './components/ContextTab';
import { KeysTab } from './components/KeysTab';
import './settings.css';

/** The two settings tabs. `context` is the DEFAULT/landing tab (D-03). */
type SettingsTab = 'context' | 'keys';

/**
 * The settings window root: a two-tab shell with `Context` and `Keys`.
 *
 * `Context` is the DEFAULT/landing tab (D-03) — the editor the user reaches directly from the
 * Ctrl+Alt+S hotkey window (SET-04). The `Keys` tab hosts the two-key entry/save form (SET-02). All
 * persistence/encryption lives in main behind the `window.settingsApi` bridge (06-01) and the
 * repository (06-02); this is the renderer-only slice.
 *
 * @returns The settings root element.
 */
export function SettingsApp(): JSX.Element {
    const [activeTab, setActiveTab] = useState<SettingsTab>('context');

    return (
        <main className="settings" data-testid="settings-root">
            <nav className="settings__tabs" role="tablist">
                <button
                    className={`settings__tab ${activeTab === 'context' ? 'settings__tab--active' : ''}`}
                    data-testid="tab-context"
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'context'}
                    onClick={(): void => setActiveTab('context')}
                >
                    Context
                </button>
                <button
                    className={`settings__tab ${activeTab === 'keys' ? 'settings__tab--active' : ''}`}
                    data-testid="tab-keys"
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'keys'}
                    onClick={(): void => setActiveTab('keys')}
                >
                    Keys
                </button>
            </nav>

            <div className="settings__body">{activeTab === 'context' ? <ContextTab /> : <KeysTab />}</div>
        </main>
    );
}
