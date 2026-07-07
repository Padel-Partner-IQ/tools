import { getTauriInvoke, isTauriExportAvailable } from './environment/desktop/tauri_bridge.mjs';

export function describeTauriError(error) {
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  if (error && typeof error === 'object') {
    const candidates = [
      error.message,
      error.error,
      error.payload,
      error.details,
      error?.cause?.message,
      error?.cause?.error,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    if (typeof error.toString === 'function') {
      const fallback = error.toString();
      if (fallback && fallback !== '[object Object]') {
        return fallback;
      }
    }
  }

  return 'Unknown error';
}

export { getTauriInvoke, isTauriExportAvailable };
