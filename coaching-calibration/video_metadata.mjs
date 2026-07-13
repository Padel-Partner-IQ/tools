// Real video frame-rate/dimension/duration parsing and CSV/video identity validation.
//
// Prevents three related mistakes: (1) silently assuming a video runs at
// 30fps when its real rate is unknown (see parseFrameRateFraction, used with
// the bundled ffprobe sidecar's output on desktop or the vendored mp4box.js
// probe in browser mode -- see video_probe_browser.mjs -- never a hardcoded
// default), (2) silently pairing a coach's Annotation CSV with the wrong
// video (see compareVideoIdentity), and (3) silently rewriting an imported
// CSV's own provenance: a freshly-derived deriveRealVideoMetadata() result
// for the currently-open video is used only for compareVideoIdentity,
// diagnostics, and stamping *newly created* rows -- it must never replace an
// existing row's own frame_rate_fps/video_metadata_provider, regardless of
// which environment (desktop/ffprobe vs browser/mp4box) opens the file. All
// pure functions, testable with injected fixture data -- no real video,
// ffprobe, mp4box, or Tauri involved.

import { deriveVideoId } from './video_id.mjs';

/** Frame rates within this many fps of each other are treated as the same rate (float rounding tolerance), not a conflict. */
export const FRAME_RATE_EPSILON = 0.01;

/**
 * Parse an ffprobe `r_frame_rate` value (e.g. "30000/1001") into a float fps.
 * Direct port of the Python `_parse_frame_rate()` in
 * run_contact_point_multi_shot.py, so both sides interpret the same ffprobe
 * output identically. Returns null for anything unparseable -- callers must
 * treat that as "frame rate unknown", never default it to 30.
 */
export function parseFrameRateFraction(value) {
  if (typeof value !== 'string' || !value.includes('/')) {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const [numeratorRaw, denominatorRaw] = value.split('/');
  const numerator = Number.parseFloat(numeratorRaw);
  const denominator = Number.parseFloat(denominatorRaw);
  if (Number.isNaN(numerator) || !denominator) {
    return null;
  }
  return numerator / denominator;
}

/**
 * Extract the `r_frame_rate` of the first video stream from raw ffprobe JSON
 * stdout (as returned by the `probe_video_frame_rate` Tauri command), and
 * parse it. Returns null if no video stream / r_frame_rate is present.
 */
export function parseFrameRateFromFfprobeJson(rawJsonText) {
  return parseVideoMetadataFromFfprobeJson(rawJsonText)?.frame_rate_fps ?? null;
}

/**
 * Parse the full platform-neutral metadata shape (frame rate, dimensions,
 * duration) from raw ffprobe JSON stdout in one pass. Returns null if no
 * video stream / r_frame_rate is present or unparseable -- callers must
 * treat that as "metadata unknown", never default any field.
 */
export function parseVideoMetadataFromFfprobeJson(rawJsonText) {
  let payload;
  try {
    payload = JSON.parse(rawJsonText);
  } catch {
    return null;
  }
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  if (!videoStream || typeof videoStream.r_frame_rate !== 'string') {
    return null;
  }
  const frameRateFps = parseFrameRateFraction(videoStream.r_frame_rate);
  if (!frameRateFps) {
    return null;
  }
  const durationSec = Number.parseFloat(payload?.format?.duration ?? videoStream.duration);
  return {
    frame_rate_fps: frameRateFps,
    width: Number.isFinite(videoStream.width) ? videoStream.width : null,
    height: Number.isFinite(videoStream.height) ? videoStream.height : null,
    duration_sec: Number.isFinite(durationSec) ? durationSec : null,
  };
}

/**
 * Real metadata for the currently-open video: its derived id, filename, and
 * whatever the given provider determined about its frame rate/dimensions/
 * duration. `videoMetadataProvider` must be one of annotation_csv.mjs's
 * VALID_VIDEO_METADATA_PROVIDERS ('ffprobe' on desktop, 'mp4box' in browser).
 */
export function deriveRealVideoMetadata({ filename, frameRateFps, videoMetadataProvider, width = null, height = null, durationSec = null }) {
  return {
    video_id: deriveVideoId(filename),
    video_filename: filename,
    frame_rate_fps: frameRateFps,
    video_metadata_provider: videoMetadataProvider,
    width,
    height,
    duration_sec: durationSec,
  };
}

/**
 * User-facing frame-rate label. Never surfaces the underlying provider name
 * (see docs/architecture/annotation-workbench.md#coaching-oriented-ui-wording)
 * -- an authoritative ('ffprobe') reading is shown as an exact value; any
 * other provider ('mp4box' etc.) is shown rounded with "(estimated)", since
 * it is a best-effort average, not a guaranteed-correct reading.
 */
export function formatFrameRateLabel(realVideoMeta) {
  if (!realVideoMeta || !Number.isFinite(realVideoMeta.frame_rate_fps)) {
    return '';
  }
  if (realVideoMeta.video_metadata_provider === 'ffprobe') {
    return `${realVideoMeta.frame_rate_fps.toFixed(3)} fps`;
  }
  return `${realVideoMeta.frame_rate_fps.toFixed(2)} fps (estimated)`;
}

/**
 * Extract the video identity a set of parsed CSV rows agree on. Throws if
 * the rows don't even agree with each other on video_id/frame_rate_fps --
 * that is a distinct problem from a CSV/video mismatch and must not be
 * silently resolved by picking one row's values.
 */
export function extractCsvVideoMetadata(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }
  const distinctIdentities = new Set(rows.map((row) => `${row.video_id} ${row.frame_rate_fps}`));
  if (distinctIdentities.size > 1) {
    throw new Error('CSV rows do not agree on video_id/frame_rate_fps -- this file appears to mix rows from more than one video.');
  }
  const [first] = rows;
  return {
    video_id: first.video_id,
    video_filename: first.video_filename,
    frame_rate_fps: first.frame_rate_fps,
    video_metadata_provider: first.video_metadata_provider,
  };
}

/**
 * Compare a CSV's own video metadata against the currently-open video's real
 * metadata. Precondition: `realMeta.frame_rate_fps` is already known (never
 * call this while frame rate is still unresolved).
 *
 * - 'exact_match': video_id and frame_rate_fps agree, video_filename agrees too.
 * - 'harmless_difference': video_id and frame_rate_fps agree, only the raw
 *   video_filename string differs (e.g. different path/capitalization).
 * - 'conflicting_identity': video_id differs -- likely the wrong video entirely.
 * - 'conflicting_frame_rate': video_id agrees but frame_rate_fps differs
 *   beyond FRAME_RATE_EPSILON -- frame annotations would not be trustworthy.
 *
 * Identity conflicts take priority over frame-rate conflicts when both are present.
 */
export function compareVideoIdentity(csvMeta, realMeta) {
  if (csvMeta.video_id !== realMeta.video_id) {
    return 'conflicting_identity';
  }
  const rateKnown = typeof csvMeta.frame_rate_fps === 'number' && typeof realMeta.frame_rate_fps === 'number';
  const rateMatches = rateKnown && Math.abs(csvMeta.frame_rate_fps - realMeta.frame_rate_fps) <= FRAME_RATE_EPSILON;
  if (!rateMatches) {
    return 'conflicting_frame_rate';
  }
  if (csvMeta.video_filename !== realMeta.video_filename) {
    return 'harmless_difference';
  }
  return 'exact_match';
}
