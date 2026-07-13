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

    /**
     * Picks a video file via a native dialog, returning `{ path, filename }`
     * or null if the coach cancelled. Unlike the browser `<input
     * type="file">` used elsewhere, this gives a real filesystem path, which
     * `probeVideoFrameRate` needs to hand to the bundled ffprobe sidecar.
     * Not available in browser mode (see createBrowserEnvironment).
     *
     * Invokes the `tauri-plugin-dialog` plugin's own `plugin:dialog|open`
     * IPC command directly, rather than routing through a custom Rust
     * command -- a prior custom command wrapped a *synchronous* Rust
     * function around `.blocking_pick_file()`, which the plugin's own docs
     * warn must never run on the main thread (Tauri dispatches non-async
     * commands there): the native panel would open but then stall,
     * deadlocked against the very run loop it needed pumped to process
     * clicks. The plugin's own `open` command is `async fn`, so it runs off
     * the main thread and calls the same blocking dialog API safely. See
     * docs/architecture/annotation-workbench.md#native-video-picker.
     *
     * The IPC payload must nest the dialog options under a top-level
     * `options` key -- the plugin's Rust command signature is literally
     * `async fn open(window, dialog, options: OpenDialogOptions)`, and
     * Tauri's command macro maps each JSON payload key to a parameter by
     * name. Passing `multiple`/`directory`/`filters` directly at the top
     * level (no `options` wrapper) fails with "missing required key
     * options" -- confirmed by reading the installed
     * tauri-plugin-dialog@2.7.1 source directly, not assumed.
     */
    async pickVideoFile() {
      if (!invoke) return null;
      const selection = await invoke('plugin:dialog|open', {
        options: {
          multiple: false,
          directory: false,
          filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v'] }],
        },
      });
      if (typeof selection !== 'string' || !selection) {
        return null; // coach cancelled the dialog
      }
      const filename = selection.split('/').pop() || selection;
      return { path: selection, filename };
    },

    /**
     * Runs the bundled ffprobe sidecar against a real video path and
     * returns its raw JSON stdout (parse with
     * video_metadata.mjs's parseFrameRateFromFfprobeJson), or null if the
     * sidecar failed. Never throws to the caller and never returns a
     * default -- callers must fall back to an explicit confirmation prompt
     * on null, exactly as browser mode always does.
     */
    async probeVideoFrameRate(path) {
      if (!invoke) return null;
      try {
        return await invoke('probe_video_frame_rate', { path });
      } catch {
        return null;
      }
    },
  };
}