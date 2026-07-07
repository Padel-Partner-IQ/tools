export function getTauriInvoke(globalObject = window) {
  const tauriApi = globalObject?.__TAURI__;
  if (tauriApi?.core?.invoke && typeof tauriApi.core.invoke === 'function') {
    return tauriApi.core.invoke.bind(tauriApi.core);
  }

  if (globalObject?.__TAURI_INTERNALS__?.invoke && typeof globalObject.__TAURI_INTERNALS__.invoke === 'function') {
    return globalObject.__TAURI_INTERNALS__.invoke.bind(globalObject.__TAURI_INTERNALS__);
  }

  return null;
}

export function isTauriExportAvailable(globalObject = window) {
  return Boolean(getTauriInvoke(globalObject));
}