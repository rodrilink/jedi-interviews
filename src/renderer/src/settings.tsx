import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Root element #root was not found in settings.html.');
}

/**
 * The settings window renderer root. This is a minimal placeholder shell for 06-01 — it only proves
 * the second renderer entry loads in both dev and a production build. The full two-tab Keys/Context
 * editor UI (D-03) that consumes `window.settingsApi` lands in 06-03; the boolean-only key presence
 * and the encrypted save are wired here in 06-01.
 */
createRoot(rootElement).render(
    <StrictMode>
        <div data-testid="settings-root">Settings</div>
    </StrictMode>
);
