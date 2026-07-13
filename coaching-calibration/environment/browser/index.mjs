export function describeEnvironmentError(error) {
  if (!error) {
    return 'Unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function saveWithFilePicker(globalObject, { content, suggestedName, mimeType }) {
  const handle = await globalObject.showSaveFilePicker({
    suggestedName,
    types: [{ description: 'CSV', accept: { [mimeType]: ['.csv'] } }],
  });
  const stream = await handle.createWritable();
  await stream.write(content);
  await stream.close();
}

function saveWithDownload(globalObject, { content, suggestedName, mimeType }) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = globalObject.document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  link.hidden = true;
  globalObject.document.body.appendChild(link);
  link.click();
  link.remove();
  globalObject.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function createBrowserEnvironment(globalObject = window) {
  return {
    name: 'browser',

    async loadJsonResource(resourceUrl) {
      const response = await globalObject.fetch(resourceUrl);
      if (!response.ok) {
        throw new Error(`Unable to load resource (${response.status})`);
      }
      return response.json();
    },

    async saveTextFile({ content, suggestedName = 'download.txt', mimeType = 'text/plain' }) {
      const safeName = suggestedName.trim() || 'download.txt';
      const request = { content, suggestedName: safeName, mimeType };

      if (typeof globalObject.showSaveFilePicker === 'function') {
        try {
          await saveWithFilePicker(globalObject, request);
          return;
        } catch (error) {
          if (error?.name === 'AbortError') {
            return;
          }
          throw error;
        }
      }

      saveWithDownload(globalObject, request);
    },

    // No native path-based file picker or ffprobe sidecar in browser mode --
    // app.js falls back to the existing <input type="file"> video picker and
    // an explicit frame-rate confirmation prompt (never a silent 30fps default).
    async pickVideoFile() {
      return null;
    },

    async probeVideoFrameRate() {
      return null;
    },
  };
}