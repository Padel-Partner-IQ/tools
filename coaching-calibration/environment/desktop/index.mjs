import { createBrowserEnvironment } from '../browser/index.mjs';
import { getTauriInvoke } from './tauri_bridge.mjs';

export function createDesktopEnvironment(globalObject = window) {
  const browserEnvironment = createBrowserEnvironment(globalObject);
  const invoke = getTauriInvoke(globalObject);

  return {
    name: 'desktop',

    loadJsonResource: browserEnvironment.loadJsonResource,

    async saveTextFile({ content, suggestedName = 'download.txt', mimeType = 'text/plain' }) {
      if (!invoke) {
        await browserEnvironment.saveTextFile({ content, suggestedName, mimeType });
        return;
      }

      await invoke('save_csv_export', { content, suggestedName });
    },
  };
}