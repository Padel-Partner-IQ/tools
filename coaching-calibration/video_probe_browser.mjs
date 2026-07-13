// Browser-side video metadata probing via the vendored mp4box.js build
// (src/vendor/mp4box.min.js -- see src/vendor/VENDORED.md for provenance).
//
// This is the browser counterpart to the desktop ffprobe sidecar
// (video_metadata.mjs's parseVideoMetadataFromFfprobeJson). It gives a
// best-effort *average* frame rate derived from a container's own sample
// count and duration, not a frame-accurate reading of variable-frame-rate
// pulldown patterns the way ffprobe's r_frame_rate is -- real-file spikes
// (see docs/architecture/contact-point-annotation-csv.md#browser-and-desktop-metadata)
// showed this average can be off by a few hundredths of an fps on
// camera-original footage. Callers must always record the result with
// video_metadata_provider="mp4box" (never "ffprobe"), and the UI must always
// label it "(estimated)" (see video_metadata.mjs's formatFrameRateLabel) --
// never presented as equivalent to a desktop/ffprobe reading.
//
// Reads the file in fixed-size chunks (never a single full in-memory read)
// so large camera-original files (100MB+) don't require loading the whole
// file into memory at once before mp4box can find the trailing `moov` box on
// non-fast-start files.

import { createFile } from './vendor/mp4box.min.js';

// mp4box logs recoverable box-parsing quirks (e.g. the 1-byte 'hdlr' slack
// real camera footage sometimes contains) via console.error at its default
// log level -- harmless, and not routed through onError below (mp4box only
// does that for fatal parse failures), so it does not affect the resolved
// value here, just console noise during a probe.

const CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * Probe a browser File/Blob for its video metadata. Resolves to
 * `{ frame_rate_fps, width, height, duration_sec }`, or null if mp4box could
 * not parse the file (corrupt/unsupported container, or no usable video
 * track) -- callers must treat null as "metadata unknown", never default it.
 * Never throws.
 */
export async function probeVideoMetadataInBrowser(file) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let mp4boxFile;
    try {
      mp4boxFile = createFile();
    } catch {
      settle(null);
      return;
    }

    mp4boxFile.onReady = (info) => {
      settle(metadataFromMp4BoxInfo(info));
    };
    mp4boxFile.onError = () => settle(null);

    readChunksInto(file, mp4boxFile)
      .then(() => settle(null)) // onReady never fired -- no usable moov/video track found.
      .catch(() => settle(null));
  });
}

function metadataFromMp4BoxInfo(info) {
  const videoTrack = info?.videoTracks?.[0];
  if (!videoTrack || !videoTrack.nb_samples || !videoTrack.timescale) {
    return null;
  }
  const durationSec = videoTrack.duration / videoTrack.timescale;
  if (!(durationSec > 0)) {
    return null;
  }
  const frameRateFps = videoTrack.nb_samples / durationSec;
  if (!Number.isFinite(frameRateFps) || frameRateFps <= 0) {
    return null;
  }
  return {
    frame_rate_fps: frameRateFps,
    width: Number.isFinite(videoTrack.video?.width) ? videoTrack.video.width : null,
    height: Number.isFinite(videoTrack.video?.height) ? videoTrack.video.height : null,
    duration_sec: durationSec,
  };
}

async function readChunksInto(file, mp4boxFile) {
  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await chunk.arrayBuffer();
    if (buffer.byteLength === 0) break;
    buffer.fileStart = offset;
    mp4boxFile.appendBuffer(buffer);
    offset += buffer.byteLength;
  }
  mp4boxFile.flush();
}
