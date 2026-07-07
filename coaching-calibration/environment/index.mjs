import { createBrowserEnvironment, describeEnvironmentError } from './browser/index.mjs';
import { createDesktopEnvironment } from './desktop/index.mjs';
import { getTauriInvoke } from './desktop/tauri_bridge.mjs';

export function createEnvironment(globalObject = window) {
  if (getTauriInvoke(globalObject)) {
    return createDesktopEnvironment(globalObject);
  }
  return createBrowserEnvironment(globalObject);
}

export { describeEnvironmentError };