import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsApp } from './SettingsApp';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Root element #root was not found in settings.html.');
}

/**
 * The settings window renderer root (06-03). Renders the two-tab `SettingsApp` (Context landing + Keys)
 * that consumes the scoped two-way `window.settingsApi` bridge (06-01). All persistence/encryption
 * stays in main; this is the renderer-only slice.
 */
createRoot(rootElement).render(
    <StrictMode>
        <SettingsApp />
    </StrictMode>
);
