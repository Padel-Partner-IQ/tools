// Annotation Workbench -- main UI/session controller.
//
// A video is simply a collection of shots. This app reads/writes exactly one
// data model, the canonical Annotation CSV (see annotation_csv.mjs), whether
// it started from automated detection, a coach reviewing it, or a coach
// starting from an empty session and adding shots manually. There is no
// separate "manual annotation format".
//
// Following this project's established testing convention, all non-trivial
// logic lives in pure, framework-free modules (annotation_csv.mjs,
// annotation_model.mjs, video_metadata.mjs, video_probe_browser.mjs,
// profile_resolution.mjs) that are unit tested directly; this file is thin
// DOM wiring around them, characterization-tested via tests/app_behavior.test.mjs.

import { createEnvironment, describeEnvironmentError } from './environment/index.mjs';
import { isEditableTarget } from './keyboard_shortcuts.mjs';
import { deriveVideoId } from './video_id.mjs';
import {
  AnnotationValidationError,
  buildAnnotationCsvText,
  createAnnotationRunMetadata,
  newSessionId,
  parseAnnotationCsv,
  validateAnnotationRows,
} from './annotation_csv.mjs';
import {
  canDeleteShot,
  createManualShot,
  deleteShot,
  effectiveContactFrame,
  findDuplicateContactFrame,
  renumberShotIndices,
} from './annotation_model.mjs';
import {
  compareVideoIdentity,
  deriveRealVideoMetadata,
  extractCsvVideoMetadata,
  formatFrameRateLabel,
  parseVideoMetadataFromFfprobeJson,
} from './video_metadata.mjs';
import { probeVideoMetadataInBrowser } from './video_probe_browser.mjs';
import { buildPhaseViewModels, buildRatingOptions, buildQualityOptions } from './profile_state.mjs';
import { resolveProfileForShot } from './profile_resolution.mjs';
import { loadOntology, getQualityMeta } from './ontology.mjs';
import {
  loadTaxonomy,
  getClasses,
  getTypesForClass,
  getVariantsForType,
  getDefaultClassId,
  getDefaultTypeId,
  classificationIdsForShot,
  classificationLabelsForIds,
  reconcileClassSelection,
  reconcileTypeSelection,
} from './classification_taxonomy.mjs';
import { loadRegistry, loadRegisteredProfiles, ProfileRegistryValidationError } from './profile_registry.mjs';
import { getPhaseFrame } from './phase_frame_mapping.mjs';
import { getPhaseAssessment, capturePhaseFrame, clearPhase, isPhaseCaptured } from './phase_assessment.mjs';
import { findPhaseFrameOwner, buildFrameInUseErrorMessage } from './duplicate_frame.mjs';
import { computeShotReadiness } from './shot_readiness.mjs';

const environment = createEnvironment(window);

// A load sequence (video src assignment + metadata probe) that hasn't
// resolved within this window is treated as failed -- the app must always
// reach a terminal loaded/failed state, never spin indefinitely.
const VIDEO_LOAD_TIMEOUT_MS = 20000;

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

const video = document.getElementById('video');
const videoFileInput = document.getElementById('video-file');
const csvFileInput = document.getElementById('csv-file');
const openVideoButton = document.getElementById('open-video');
const openCsvButton = document.getElementById('open-csv');
const videoNameEl = document.getElementById('video-name');
const videoFrameRateEl = document.getElementById('video-frame-rate');
const videoLoadStatusEl = document.getElementById('video-load-status');
const videoLoadErrorEl = document.getElementById('video-load-error');

const frameNumberEl = document.getElementById('frame-number');
const timestampEl = document.getElementById('timestamp');
const prevFrameButton = document.getElementById('prev-frame');
const playPauseButton = document.getElementById('play-pause');
const nextFrameButton = document.getElementById('next-frame');
const captureFeedbackEl = document.getElementById('capture-feedback');
const mismatchErrorEl = document.getElementById('video-csv-mismatch-error');

const annotatorEl = document.getElementById('annotator');
const defaultShotClassEl = document.getElementById('default-shot-class');
const defaultShotTypeEl = document.getElementById('default-shot-type');
const sessionVideoEl = document.getElementById('session-video');
const sessionFrameRateEl = document.getElementById('session-frame-rate');
const sessionCsvEl = document.getElementById('session-csv');
const exportStatusEl = document.getElementById('export-status');
const exportButton = document.getElementById('export-csv');

const addShotButton = document.getElementById('add-shot');

const shotsCountEl = document.getElementById('shots-count');
const shotsStripEl = document.getElementById('shots-strip');
const shotsStripEmptyEl = document.getElementById('shots-strip-empty');

const doneEditingButton = document.getElementById('done-editing');
const shotDetailEmptyEl = document.getElementById('shot-detail-empty');
const shotDetailBodyEl = document.getElementById('shot-detail-body');
const shotDetailIdEl = document.getElementById('shot-detail-id');
const shotDetailSourceEl = document.getElementById('shot-detail-source');
const shotDetailAutomatedFrameEl = document.getElementById('shot-detail-automated-frame');
const shotDetailConfidenceEl = document.getElementById('shot-detail-confidence');
const shotDetailProvidersEl = document.getElementById('shot-detail-providers');
const shotDetailReviewFlagsEl = document.getElementById('shot-detail-review-flags');
const shotDetailReviewedFrameEl = document.getElementById('shot-detail-reviewed-frame');
const shotDetailStatusEl = document.getElementById('shot-detail-status');
const shotDeleteButton = document.getElementById('shot-delete');

const shotDetailShotClassEl = document.getElementById('shot-detail-shot-class');
const shotDetailShotTypeEl = document.getElementById('shot-detail-shot-type');
const shotDetailShotVariantEl = document.getElementById('shot-detail-shot-variant');
const shotDetailProfileEmptyEl = document.getElementById('shot-detail-profile-empty');
const shotDetailProfileBodyEl = document.getElementById('shot-detail-profile-body');
const shotDetailProfileNameEl = document.getElementById('shot-detail-profile-name');
const shotDetailReadinessEl = document.getElementById('shot-detail-readiness');
const phaseSummaryListEl = document.getElementById('phase-summary-list');
const phaseSummaryBlockEl = document.getElementById('phase-summary-block');

const phaseProgressListEl = document.getElementById('phase-progress-list');
const phaseProgressSummaryEl = document.getElementById('phase-progress-summary');
const phaseProgressBlockEl = document.getElementById('phase-progress-block');
const phaseCardEl = document.getElementById('phase-card');
const phaseCardTitleEl = document.getElementById('phase-card-title');
const phaseCardDescriptionEl = document.getElementById('phase-card-description');
const phaseObservationsListEl = document.getElementById('phase-observations-list');
const phaseQualityOptionsEl = document.getElementById('phase-quality-options');
const phaseNotesEl = document.getElementById('phase-notes');
const phaseCaptureButton = document.getElementById('phase-capture');
const phaseClearButton = document.getElementById('phase-clear');

const overallAssessmentBlockEl = document.getElementById('overall-assessment-block');
const overallQualityOptionsEl = document.getElementById('overall-quality-options');
const overallNotesEl = document.getElementById('overall-notes');
const saveShotButton = document.getElementById('save-shot');

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

let shots = [];
let selectedShotId = null;
let currentFrame = null;
let currentVideoUrl = null;
let videoFileName = null;
let realVideoMeta = null; // { video_id, video_filename, frame_rate_fps, video_metadata_provider, width, height, duration_sec } -- null until genuinely known, never defaults to 30fps
// The canonical annotation-session frame rate/provider -- drives every frame<->time
// conversion, frame stepping, and newly-exported row (via runMetadata below). Defaults
// to the freshly-probed realVideoMeta rate, then becomes an imported Annotation CSV's
// own frame_rate_fps/video_metadata_provider once that CSV passes compareVideoIdentity
// (see applyCanonicalAnnotationFrameRate) -- the browser/ffprobe probe is only used to
// confirm the loaded video is plausibly the same media, never as the annotation clock
// once a CSV's own rate is available. realVideoMeta itself is left untouched and stays
// visible separately in the video banner (updateVideoBanner) for diagnostics.
let annotationFrameRateFps = null;
let annotationFrameRateProvider = null;
let runMetadata = null; // AnnotationRunMetadata for newly created/edited rows this session
let pendingCsvText = null; // raw CSV text opened before the video (or before its metadata was known)
let csvLoaded = false; // whether an existing CSV backs this session, vs. a fresh Annotation Mode session
let controlsEnabled = false; // editing/seeking gate -- false until frame rate is known and any loaded CSV has validated
let videoLoadState = 'idle'; // 'idle' | 'loading' | 'loaded' | 'failed' -- the app must always reach a terminal state, never spin indefinitely
let videoLoadError = null;
let taxonomy = null; // normalized classification taxonomy (classification_taxonomy.mjs), loaded once at startup
let profileIndex = new Map(); // classification-id key -> normalized coaching profile, built from the registry at startup (see profile_registry.mjs)
let ontology = null; // normalized Coaching Ontology, loaded once at startup -- label/description lookups for phases/observations/ratings/quality
let activePhaseId = null; // the currently selected shot's active phase in the phase editor
let phaseWorking = {}; // phaseId -> { qualityId, notes, observations } draft for the currently selected shot's active phase(s)

// ---------------------------------------------------------------------------
// Frame/time conversion -- always from the canonical annotation-session
// frame rate (annotationFrameRateFps), never a hardcoded default
// ---------------------------------------------------------------------------

function formatTimestamp(time) {
  return `${time.toFixed(3)}s`;
}

function updateFrameInfo() {
  const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  timestampEl.textContent = formatTimestamp(time);
  if (!Number.isFinite(annotationFrameRateFps)) {
    frameNumberEl.textContent = '—';
    currentFrame = null;
    return;
  }
  currentFrame = Math.round(time * annotationFrameRateFps);
  frameNumberEl.textContent = currentFrame;
}

function stepFrame(delta) {
  if (!controlsEnabled || !Number.isFinite(annotationFrameRateFps)) return;
  video.currentTime = Math.min(video.duration || Infinity, Math.max(0, video.currentTime + delta / annotationFrameRateFps));
}

function seekToFrame(frame) {
  if (!controlsEnabled || !Number.isFinite(annotationFrameRateFps) || frame === null || frame === undefined) return;
  video.currentTime = Math.min(video.duration || Infinity, Math.max(0, frame / annotationFrameRateFps));
}

// ---------------------------------------------------------------------------
// Video loading
//
// Every load, on every path (success, picker cancellation, a metadata-probe
// failure, a media-element failure, or an unexpected exception) reaches
// exactly one of two terminal states -- videoLoadState 'loaded' or 'failed'
// -- via the single shared runVideoLoad() below. Nothing here ever leaves
// videoLoadState stuck at 'loading'.
// ---------------------------------------------------------------------------

function resetSessionForNewVideo() {
  shots = [];
  selectedShotId = null;
  realVideoMeta = null;
  annotationFrameRateFps = null;
  annotationFrameRateProvider = null;
  runMetadata = null;
  pendingCsvText = null;
  csvLoaded = false;
  controlsEnabled = false;
  hideCsvError();
}

let openVideoInFlight = false; // guards against a second picker opening while the first is still open (e.g. a rapid double-click)
let openVideoInvocationCounter = 0;

/**
 * Handles the Open Video click. Guarded so exactly one picker is ever open
 * at a time: `openVideoInFlight` covers the whole native-dialog-open window
 * (set before the picker is invoked, cleared once it resolves), which
 * `videoLoadState === 'loading'` alone does not -- that only becomes true
 * once a path has actually been selected and the load sequence starts, so
 * without this guard a second click while the OS dialog is still open would
 * invoke a second concurrent picker.
 */
async function openVideo() {
  if (openVideoInFlight || videoLoadState === 'loading') {
    console.log('[annotation-workbench] Open Video clicked but ignored -- a picker is already open');
    return;
  }
  const invocationId = ++openVideoInvocationCounter;
  console.log(`[annotation-workbench] Open Video clicked (invocation #${invocationId})`);
  openVideoInFlight = true;
  openVideoButton.disabled = true;
  try {
    if (environment.name === 'desktop') {
      console.log(`[annotation-workbench] Picker invocation started (invocation #${invocationId})`);
      const picked = await environment.pickVideoFile();
      if (!picked) {
        console.log(`[annotation-workbench] Picker cancelled (invocation #${invocationId})`);
        return; // coach cancelled the native picker -- no state change
      }
      console.log(`[annotation-workbench] Picker returned selection (invocation #${invocationId}): ${picked.filename}`);
      await loadVideoFromPath(picked.path, picked.filename);
    } else {
      videoFileInput.click();
    }
  } catch (error) {
    console.log(`[annotation-workbench] Picker failed (invocation #${invocationId}): ${describeEnvironmentError(error)}`);
    showFeedback(`Unable to open the video picker: ${describeEnvironmentError(error)}`, 'error');
  } finally {
    openVideoInFlight = false;
    updateVideoLoadUi();
  }
}

async function loadVideoFromFile(file) {
  await runVideoLoad(async () => {
    videoFileName = file.name;
    if (currentVideoUrl) URL.revokeObjectURL(currentVideoUrl);
    currentVideoUrl = URL.createObjectURL(file);
    await assignVideoSrcAndAwaitReady(currentVideoUrl);

    const probed = await probeVideoMetadataInBrowser(file);
    if (!probed) {
      throw new Error("Unable to determine this video's frame rate automatically -- the file may be corrupt or in an unsupported format.");
    }
    applyRealVideoMetadata(deriveRealVideoMetadata({
      filename: videoFileName,
      frameRateFps: probed.frame_rate_fps,
      videoMetadataProvider: 'mp4box',
      width: probed.width,
      height: probed.height,
      durationSec: probed.duration_sec,
    }));
  });
}

async function loadVideoFromPath(path, filename) {
  await runVideoLoad(async () => {
    videoFileName = filename;
    const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
    if (typeof convertFileSrc !== 'function') {
      throw new Error('Unable to load this video: the desktop video bridge is unavailable. Try restarting the app.');
    }
    await assignVideoSrcAndAwaitReady(convertFileSrc(path));

    const rawJson = await environment.probeVideoFrameRate(path);
    const probed = rawJson ? parseVideoMetadataFromFfprobeJson(rawJson) : null;
    if (!probed) {
      throw new Error("Unable to determine this video's frame rate automatically (the ffprobe metadata probe failed or returned no usable video stream).");
    }
    applyRealVideoMetadata(deriveRealVideoMetadata({
      filename,
      frameRateFps: probed.frame_rate_fps,
      videoMetadataProvider: 'ffprobe',
      width: probed.width,
      height: probed.height,
      durationSec: probed.duration_sec,
    }));
  });
}

/** Shared load wrapper: guarantees exactly one terminal videoLoadState transition per call. */
async function runVideoLoad(loadSteps) {
  resetSessionForNewVideo();
  videoLoadState = 'loading';
  videoLoadError = null;
  updateVideoLoadUi();
  try {
    await withTimeout(loadSteps(), VIDEO_LOAD_TIMEOUT_MS, 'Timed out loading this video.');
    videoLoadState = 'loaded';
  } catch (error) {
    videoLoadState = 'failed';
    videoLoadError = describeEnvironmentError(error);
    realVideoMeta = null;
    annotationFrameRateFps = null;
    annotationFrameRateProvider = null;
    runMetadata = null;
    setControlsEnabled(false);
  } finally {
    updateVideoLoadUi();
    updateVideoBanner();
    updateSessionMeta();
    updateExportState();
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Assigns video.src and waits for either 'loadedmetadata' (success) or 'error' (failure) -- never neither. */
function assignVideoSrcAndAwaitReady(src) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    }
    function onLoaded() {
      cleanup();
      resolve();
    }
    function onError() {
      cleanup();
      reject(new Error(describeVideoElementError()));
    }
    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.src = src;
    video.load();
  });
}

function describeVideoElementError() {
  const mediaError = video.error;
  const messages = {
    1: 'Video loading was aborted.',
    2: 'A network error occurred while loading the video.',
    3: 'The video could not be decoded (it may be corrupt or use an unsupported codec).',
    4: 'This video format or source is not supported.',
  };
  return (mediaError && messages[mediaError.code]) || 'The video could not be loaded.';
}

function applyRealVideoMetadata(meta) {
  realVideoMeta = meta;
  annotationFrameRateFps = meta.frame_rate_fps;
  annotationFrameRateProvider = meta.video_metadata_provider;
  ensureRunMetadata();
  setControlsEnabled(true);
  reconcilePendingCsv();
}

function ensureRunMetadata() {
  if (runMetadata || !realVideoMeta) return;
  runMetadata = createAnnotationRunMetadata({
    videoId: realVideoMeta.video_id,
    videoFilename: realVideoMeta.video_filename,
    frameRateFps: realVideoMeta.frame_rate_fps,
    videoMetadataProvider: realVideoMeta.video_metadata_provider,
    sessionId: newSessionId(),
    createdAt: new Date().toISOString(),
  });
}

/**
 * Once an imported Annotation CSV's own video metadata has passed
 * compareVideoIdentity (exact_match/harmless_difference, never called for a
 * conflict), its frame_rate_fps becomes this session's canonical annotation
 * clock -- see the annotationFrameRateFps declaration above for why. Only
 * frame_rate_fps/video_metadata_provider are adopted from the CSV; video_id/
 * video_filename/session_id/created_at on runMetadata stay tied to this
 * session's own real, currently-open video, exactly as before -- this is a
 * narrower, more accurate clock, not a wholesale switch to the CSV's
 * provenance.
 */
function applyCanonicalAnnotationFrameRate(csvMeta) {
  annotationFrameRateFps = csvMeta.frame_rate_fps;
  annotationFrameRateProvider = csvMeta.video_metadata_provider;
  if (runMetadata) {
    runMetadata = { ...runMetadata, frame_rate_fps: annotationFrameRateFps };
  }
}

function updateVideoLoadUi() {
  openVideoButton.disabled = videoLoadState === 'loading';
  if (videoLoadState === 'loading') {
    videoLoadStatusEl.textContent = 'Loading video…';
    hideVideoLoadError();
  } else if (videoLoadState === 'loaded') {
    videoLoadStatusEl.textContent = 'Video loaded successfully.';
    hideVideoLoadError();
  } else if (videoLoadState === 'failed') {
    videoLoadStatusEl.textContent = '';
    showVideoLoadError(`Video load failed: ${videoLoadError}`);
  } else {
    videoLoadStatusEl.textContent = '';
    hideVideoLoadError();
  }
}

function showVideoLoadError(message) {
  videoLoadErrorEl.hidden = false;
  videoLoadErrorEl.textContent = message;
}

function hideVideoLoadError() {
  videoLoadErrorEl.hidden = true;
  videoLoadErrorEl.textContent = '';
}

// ---------------------------------------------------------------------------
// Annotation CSV loading
// ---------------------------------------------------------------------------

function openCsv() {
  csvFileInput.click();
}

function loadCsvText(text) {
  let rows;
  try {
    rows = parseAnnotationCsv(text);
    validateAnnotationRows(rows);
  } catch (error) {
    showCsvError(error instanceof AnnotationValidationError ? error.errors.join('\n') : describeEnvironmentError(error));
    return;
  }

  if (!realVideoMeta) {
    // CSV opened before the video (or before its metadata is known): display
    // the shots, but hold everything else pending -- no editing or seeking
    // until a video opens and its identity is validated below.
    pendingCsvText = text;
    shots = renumberShotIndices(rows);
    selectedShotId = null;
    csvLoaded = true;
    setControlsEnabled(false);
    updateSessionMeta();
    renderShotsStrip();
    renderShotDetail();
    return;
  }

  applyCsvRows(rows);
}

function applyCsvRows(rows) {
  let csvMeta = null;
  try {
    csvMeta = extractCsvVideoMetadata(rows);
  } catch (error) {
    showCsvError(describeEnvironmentError(error));
    return;
  }

  if (csvMeta) {
    const comparison = compareVideoIdentity(csvMeta, realVideoMeta);
    if (comparison === 'conflicting_identity' || comparison === 'conflicting_frame_rate') {
      showCsvError(buildMismatchMessage(comparison, csvMeta, realVideoMeta));
      return;
    }
    if (comparison === 'harmless_difference') {
      showFeedback(`This CSV's own video_filename ("${csvMeta.video_filename}") differs from the open video's filename, but their video_id and frame rate agree -- continuing.`, 'info');
    }
    applyCanonicalAnnotationFrameRate(csvMeta);
  }

  // The CSV's own frame_rate_fps/video_metadata_provider (already present on
  // every parsed row) are never touched here or anywhere else below -- the
  // freshly-derived realVideoMeta above is used only for this identity
  // comparison, never to rewrite imported provenance. See
  // docs/architecture/annotation-workbench.md#imported-metadata-provenance-is-immutable.
  // (applyCanonicalAnnotationFrameRate above only updates this session's own
  // forward-looking annotation clock/runMetadata -- it never edits csvMeta or
  // the parsed `rows` themselves.)
  hideCsvError();
  shots = renumberShotIndices(rows);
  selectedShotId = null;
  csvLoaded = true;
  pendingCsvText = null;
  setControlsEnabled(true);
  updateSessionMeta();
  renderShotsStrip();
  renderShotDetail();
  updateExportState();
}

function reconcilePendingCsv() {
  if (!pendingCsvText) return;
  const text = pendingCsvText;
  pendingCsvText = null;
  loadCsvText(text);
}

function buildMismatchMessage(comparison, csvMeta, realMeta) {
  if (comparison === 'conflicting_identity') {
    return `This Annotation CSV was recorded for a different video (video_id="${csvMeta.video_id}") than the one currently open (video_id="${realMeta.video_id}"). Open the matching video or CSV -- import blocked.`;
  }
  // realMeta.frame_rate_fps is a measurement of the currently-open video, not
  // this CSV's own recorded rate -- an ffprobe reading is exact, but an
  // mp4box browser probe is only a best-effort estimate (see
  // video_probe_browser.mjs), so the wording below must not call either one
  // the video's "real" rate without qualification.
  const realRateDescription = realMeta.video_metadata_provider === 'ffprobe'
    ? `the currently open video's frame rate (${realMeta.frame_rate_fps} fps)`
    : `the browser's estimated frame rate for the currently open video (${realMeta.frame_rate_fps} fps)`;
  return `This Annotation CSV's frame rate (${csvMeta.frame_rate_fps} fps) does not match ${realRateDescription}. The difference is too large for frame annotations to be trusted, so import was blocked.`;
}

function showCsvError(message) {
  mismatchErrorEl.hidden = false;
  mismatchErrorEl.textContent = message;
}

function hideCsvError() {
  mismatchErrorEl.hidden = true;
  mismatchErrorEl.textContent = '';
}

// ---------------------------------------------------------------------------
// Shot list / detail rendering
// ---------------------------------------------------------------------------

function setControlsEnabled(enabled) {
  controlsEnabled = enabled;
  prevFrameButton.disabled = !enabled;
  playPauseButton.disabled = !enabled;
  nextFrameButton.disabled = !enabled;
  renderShotsStrip();
  renderShotDetail();
}

/**
 * Add Shot is disabled whenever a shot is currently selected -- competing
 * incomplete shots and confusing state otherwise. Re-enabled only once the
 * coach leaves the current-shot workflow (Save Shot/Done Editing/Delete
 * Shot all clear selectedShotId before the next render). Deliberately
 * independent of whether the selected shot is complete -- the rule is
 * purely "a shot is selected" vs "no shot is selected", nothing else.
 * Called from renderShotDetail(), which every path that changes
 * selectedShotId or controlsEnabled already calls, so this one place stays
 * in sync with both.
 */
function updateAddShotButtonState() {
  addShotButton.disabled = !controlsEnabled || Boolean(selectedShotId);
}

function getSelectedShot() {
  return shots.find((candidate) => candidate.shot_id === selectedShotId) ?? null;
}

/** Resolves the shot's coaching profile and its phase view models together -- the one place both are derived from a shot. */
function resolveActiveProfileAndPhases(shot) {
  const profile = shot ? resolveProfileForShot(shot, taxonomy, profileIndex) : null;
  const phases = profile ? buildPhaseViewModels(profile, ontology) : [];
  return { profile, phases };
}

/** The first phase (in profile order) without both a captured frame and a quality rating, or the first phase if all are captured. */
function firstIncompletePhaseId(shot, phases) {
  if (!shot || phases.length === 0) return null;
  const incomplete = phases.find((phase) => !isPhaseCaptured(shot, phase.id));
  return (incomplete || phases[0]).id;
}

/** True if a phase has a captured frame, a stored assessment, or both -- used only to decide whether Clear has anything to do. */
function phaseHasAnyData(shot, phaseId) {
  if (getPhaseFrame(shot, phaseId) !== null) return true;
  const assessment = getPhaseAssessment(shot, phaseId);
  return assessment.qualityId !== '' || assessment.notes !== '' || Object.keys(assessment.observations).length > 0;
}

/**
 * Selecting a shot (from the saved-shots strip beneath the video) seeks the
 * video to its Contact Point frame and syncs the phase editor to match --
 * the video and the phase editor should never disagree about what the coach
 * is reviewing. Contact Point is preferred whenever this shot's resolved
 * profile actually configures it; otherwise this falls back to the existing
 * firstIncompletePhaseId behaviour (no profile resolved, or a hypothetical
 * future profile without a contact_point phase) rather than inventing one.
 *
 * `preferredPhaseId` overrides that Contact-Point preference when the phase
 * genuinely exists on this shot's resolved profile -- used only by
 * handleAddShot so a freshly-created manual shot opens at Ready Position
 * instead. `seek: false` skips the video seek entirely -- also used only by
 * handleAddShot, since a newly-created shot's effective contact frame is
 * already the current frame, so seeking would only be pointless movement,
 * never an actual navigation. This remains the one, single navigation path;
 * both are optional, additive parameters, not a second selection function.
 */
function selectShot(shotId, { preferredPhaseId = null, seek = true } = {}) {
  selectedShotId = shotId;
  const shot = getSelectedShot();
  const { phases } = resolveActiveProfileAndPhases(shot);
  if (preferredPhaseId && phases.some((phase) => phase.id === preferredPhaseId)) {
    activePhaseId = preferredPhaseId;
  } else {
    const contactPhase = phases.find((phase) => phase.id === 'contact_point');
    activePhaseId = contactPhase ? contactPhase.id : firstIncompletePhaseId(shot, phases);
  }
  phaseWorking = {};
  if (shot && activePhaseId) {
    phaseWorking[activePhaseId] = getPhaseAssessment(shot, activePhaseId);
  }
  renderShotsStrip();
  renderShotDetail();
  if (seek && controlsEnabled) {
    seekToFrame(effectiveContactFrame(shot));
  }
}

/**
 * Selects a phase within the currently selected shot's editor -- clicking a
 * phase progress row or a keyboard shortcut. The draft in `phaseWorking` is
 * seeded once from the stored assessment the first time a phase is visited,
 * then preserved across navigation until an explicit Capture/Clear (never
 * silently re-hydrated on every click), matching the old workflow's model.
 */
function selectPhase(phaseId) {
  const shot = getSelectedShot();
  if (!shot) return;
  activePhaseId = phaseId;
  if (!phaseWorking[phaseId]) {
    phaseWorking[phaseId] = getPhaseAssessment(shot, phaseId);
  }
  renderShotDetail();
}

/**
 * The sole shot-navigation UI, beneath the video alongside Add Shot -- lists
 * every shot currently in the session, complete or not. Every shot that
 * exists in memory must stay visible and reachable: an incomplete/unsaved
 * shot still reserves its frame (findDuplicateContactFrame checks all
 * shots), so hiding it here would leave a coach unable to explain, reopen,
 * complete, or delete whatever is blocking a frame -- an orphaned shot with
 * no way back to it. "Saved" (see handleSaveShot) only governs CSV export
 * eligibility (exportableShots), never navigation visibility. Labels are
 * compact and navigation-only (stable shot id + contact frame + a Ready/
 * Incomplete status derived live from computeShotReadiness), never verbose
 * implementation text like a raw review_status. Selecting one just calls
 * the existing selectShot(), which already restores the whole editor --
 * phases, qualities, observations, notes, overall assessment -- from that
 * shot's own row, since that's how selecting any shot has always worked.
 */
function renderShotsStrip() {
  shotsCountEl.textContent = shots.length > 0 ? `${shots.length} shot${shots.length === 1 ? '' : 's'}` : '';
  shotsStripEl.innerHTML = '';
  for (const shot of shots) {
    const button = document.createElement('button');
    button.type = 'button';
    const frame = effectiveContactFrame(shot);
    const { profile, phases } = resolveActiveProfileAndPhases(shot);
    const readiness = computeShotReadiness(shot, profile, phases);
    const isReady = readiness.status === 'ready';
    const isSelected = shot.shot_id === selectedShotId;
    button.className = [
      'shot-chip',
      isReady ? 'ready' : 'incomplete',
      isSelected ? 'selected' : '',
    ].filter(Boolean).join(' ');
    button.textContent = `${shot.shot_id} · f${frame ?? '?'} · ${isReady ? 'Ready' : 'Incomplete'}`;
    button.addEventListener('click', () => selectShot(shot.shot_id));
    shotsStripEl.appendChild(button);
    // The strip is height-bounded and scrolls (~70-shot clips) -- keep the
    // selected chip in view rather than requiring the coach to hunt for it.
    if (isSelected) button.scrollIntoView({ block: 'nearest' });
  }
  shotsStripEmptyEl.hidden = shots.length > 0;
}

function renderShotDetail() {
  updateAddShotButtonState();
  const shot = getSelectedShot();
  if (!shot) {
    shotDetailEmptyEl.hidden = false;
    shotDetailBodyEl.hidden = true;
    return;
  }

  shotDetailEmptyEl.hidden = true;
  shotDetailBodyEl.hidden = false;
  shotDetailIdEl.textContent = shot.shot_id;
  shotDetailSourceEl.textContent = shot.source;
  shotDetailAutomatedFrameEl.textContent = shot.automated_contact_frame ?? '—';
  shotDetailConfidenceEl.textContent = typeof shot.confidence === 'number' ? shot.confidence.toFixed(2) : '—';
  shotDetailProvidersEl.textContent = shot.contributing_providers?.length ? shot.contributing_providers.join(', ') : '—';
  shotDetailReviewFlagsEl.textContent = shot.review_flags?.length ? shot.review_flags.join(', ') : '—';
  shotDetailReviewedFrameEl.textContent = shot.reviewed_contact_frame ?? '—';
  shotDetailStatusEl.textContent = shot.review_status;

  // Accept and "Mark as False Detection" have both been removed from the UI
  // (the workbench has moved from an AI-review tool to a coaching
  // annotation tool) -- the underlying setPhaseFrame/rejectShot/'rejected'
  // lifecycle in annotation_model.mjs/phase_frame_mapping.mjs is untouched
  // for CSV/tooling compatibility, it simply has no button wired to it any
  // more.
  shotDeleteButton.disabled = !controlsEnabled || !canDeleteShot(shot);
  shotDeleteButton.hidden = !canDeleteShot(shot);

  renderClassificationFields(shot);
  renderResolvedProfile(shot);
}

/**
 * Populates the three Classification selects (taxonomy-driven, ids as
 * option values) from the shot's own stored coach-facing labels -- Shot
 * Type options are always freshly filtered to the currently-selected Shot
 * Class, Shot Variant to the currently-selected Shot Type. Shot Class/Type
 * have no separate blank placeholder any more -- the taxonomy's own Unknown
 * entry (present under every class, plus a top-level Unknown class) is the
 * one honest, real, exportable option for "can't classify this precisely",
 * never a second overlapping concept. Shot Variant keeps a blank "None"
 * option -- a genuinely different concept (this type has no variant
 * selected/needed), not a classification-uncertainty placeholder.
 */
function renderClassificationFields(shot) {
  const ids = classificationIdsForShot(taxonomy, shot);
  populateSelectOptions(shotDetailShotClassEl, getClasses(taxonomy));
  shotDetailShotClassEl.value = ids.classId || '';
  populateSelectOptions(shotDetailShotTypeEl, getTypesForClass(taxonomy, ids.classId));
  shotDetailShotTypeEl.value = ids.typeId || '';
  populateSelectOptions(shotDetailShotVariantEl, getVariantsForType(taxonomy, ids.classId, ids.typeId), { includeBlank: true, blankLabel: 'None' });
  shotDetailShotVariantEl.value = ids.variantId || '';
  shotDetailShotClassEl.disabled = !controlsEnabled;
  shotDetailShotTypeEl.disabled = !controlsEnabled;
  shotDetailShotVariantEl.disabled = !controlsEnabled;
}

/**
 * Replaces a <select>'s options from a taxonomy-derived `{id,label}` list --
 * shared by the per-shot Classification selects and the session Default
 * selects. Option value is always the taxonomy id (never the label), so
 * every classification handler works in ids until the moment it writes back
 * to a shot via classificationLabelsForIds.
 */
function populateSelectOptions(selectEl, options, { includeBlank = false, blankLabel = '' } = {}) {
  selectEl.innerHTML = '';
  if (includeBlank) {
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = blankLabel;
    selectEl.appendChild(blank);
  }
  for (const option of options) {
    const el = document.createElement('option');
    el.value = option.id;
    el.textContent = option.label;
    selectEl.appendChild(el);
  }
}

function renderResolvedProfile(shot) {
  const { profile, phases } = resolveActiveProfileAndPhases(shot);
  if (!profile) {
    shotDetailProfileEmptyEl.hidden = false;
    shotDetailProfileBodyEl.hidden = true;
    overallAssessmentBlockEl.hidden = true;
    // The phase editor/progress/summary now live above Shot Detail, no
    // longer nested inside shotDetailProfileBodyEl -- hide them explicitly
    // here since a profile-less shot has no phases to show.
    phaseCardEl.hidden = true;
    phaseProgressBlockEl.hidden = true;
    phaseSummaryBlockEl.hidden = true;
    saveShotButton.disabled = true;
    return;
  }

  shotDetailProfileEmptyEl.hidden = true;
  shotDetailProfileBodyEl.hidden = false;
  overallAssessmentBlockEl.hidden = false;
  phaseProgressBlockEl.hidden = false;
  phaseSummaryBlockEl.hidden = false;
  shotDetailProfileNameEl.textContent = profile.profile_name;

  // The resolved profile can change (a coach reclassifying shot_type) out
  // from under an activePhaseId that no longer exists in the new profile --
  // recover the same way a fresh selectShot() would.
  if (!activePhaseId || !phases.some((phase) => phase.id === activePhaseId)) {
    activePhaseId = firstIncompletePhaseId(shot, phases);
  }
  if (activePhaseId && !phaseWorking[activePhaseId]) {
    phaseWorking[activePhaseId] = getPhaseAssessment(shot, activePhaseId);
  }

  renderPhaseSummary(shot, phases);
  renderPhaseProgress(shot, phases);
  renderPhaseCard(shot, phases, profile);
  renderOverallAssessment(shot, profile);

  const readiness = computeShotReadiness(shot, profile, phases);
  const readinessText = {
    ready: 'Ready to export.',
    incomplete: `Missing: ${readiness.missing.join(', ')}.`,
    'no-profile': '',
  }[readiness.status];
  shotDetailReadinessEl.textContent = readinessText;
  shotDetailReadinessEl.classList.toggle('progress-complete', readiness.status === 'ready');
  saveShotButton.disabled = !controlsEnabled || readiness.status !== 'ready';
}

// ---------------------------------------------------------------------------
// Phase editor
// ---------------------------------------------------------------------------

/**
 * A compact, read-only summary -- one row per configured phase (frame,
 * quality) -- so a coach can see what's actually been labelled without
 * hunting through the automated-evidence metadata below or opening each
 * phase individually. Built entirely from the existing resolved profile,
 * getPhaseFrame (phase_frame_mapping.mjs) and getPhaseAssessment
 * (phase_assessment.mjs) -- no new editing controls, no duplicated frame or
 * assessment lookup.
 */
function renderPhaseSummary(shot, phases) {
  phaseSummaryListEl.innerHTML = '';
  for (const phase of phases) {
    const frame = getPhaseFrame(shot, phase.id);
    const assessment = getPhaseAssessment(shot, phase.id);
    const qualityLabel = assessment.qualityId ? getQualityMeta(ontology, assessment.qualityId).label : 'Not assessed';

    const row = document.createElement('div');
    row.className = 'phase-summary-row';

    const label = document.createElement('span');
    label.className = 'phase-summary-label';
    label.textContent = phase.label;

    const frameEl = document.createElement('span');
    frameEl.className = 'phase-summary-frame';
    frameEl.textContent = frame !== null ? `f${frame}` : 'Not captured';

    const qualityEl = document.createElement('span');
    qualityEl.className = 'phase-summary-quality';
    qualityEl.textContent = qualityLabel;

    row.append(label, frameEl, qualityEl);
    phaseSummaryListEl.appendChild(row);
  }
}

function renderPhaseProgress(shot, phases) {
  phaseProgressListEl.innerHTML = '';
  for (const phase of phases) {
    const li = document.createElement('li');
    li.className = 'progress-item';
    const isActive = phase.id === activePhaseId;
    const captured = isPhaseCaptured(shot, phase.id);
    if (isActive) li.classList.add('active');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `phase-status ${captured ? 'captured' : isActive ? 'active pending' : 'pending'}`;
    const icon = captured ? '✓' : isActive ? '●' : '○';
    const shortcutHint = phase.shortcut ? ` (${phase.shortcut})` : '';
    // Reuses getPhaseFrame (phase_frame_mapping.mjs) -- the same lookup the
    // rest of the app already uses -- never a second frame-lookup path. An
    // incomplete phase never invents a frame; captured is the one and only
    // gate for showing one.
    const frame = captured ? getPhaseFrame(shot, phase.id) : null;
    const frameHint = frame !== null ? ` · f${frame}` : '';
    button.textContent = `${icon} ${phase.label}${frameHint}${shortcutHint}`;
    button.addEventListener('click', () => selectPhase(phase.id));
    li.appendChild(button);
    phaseProgressListEl.appendChild(li);
  }
  const capturedCount = phases.filter((phase) => isPhaseCaptured(shot, phase.id)).length;
  phaseProgressSummaryEl.textContent =
    phases.length > 0 && capturedCount === phases.length
      ? 'All phases recorded ✓'
      : `${capturedCount} of ${phases.length} phases recorded`;
  phaseProgressSummaryEl.classList.toggle('progress-complete', phases.length > 0 && capturedCount === phases.length);
}

function renderPhaseCard(shot, phases, profile) {
  const phase = phases.find((candidate) => candidate.id === activePhaseId);
  if (!phase) {
    phaseCardEl.hidden = true;
    return;
  }
  phaseCardEl.hidden = false;
  phaseCardTitleEl.textContent = phase.label;
  phaseCardDescriptionEl.textContent = phase.description || '';
  phaseCardDescriptionEl.hidden = !phase.description;

  const working = phaseWorking[phase.id] || getPhaseAssessment(shot, phase.id);
  phaseWorking[phase.id] = working;

  renderPhaseObservations(phase, working, profile);

  const qualityOptions = buildQualityOptions(profile, ontology);
  renderQualityGroup(phaseQualityOptionsEl, qualityOptions, working.qualityId, (qualityId) => {
    working.qualityId = working.qualityId === qualityId ? '' : qualityId;
    renderPhaseCard(shot, phases, profile);
  });

  phaseNotesEl.value = working.notes;

  phaseCaptureButton.disabled = !controlsEnabled || currentFrame === null;
  phaseClearButton.disabled = !controlsEnabled || !phaseHasAnyData(shot, phase.id);
}

function renderPhaseObservations(phase, working, profile) {
  phaseObservationsListEl.innerHTML = '';
  const ratingOptions = buildRatingOptions(profile, ontology);
  for (const observation of phase.observations) {
    const li = document.createElement('li');
    li.className = 'observation-row';
    const label = document.createElement('span');
    label.className = 'observation-label';
    label.textContent = observation.label;
    li.appendChild(label);

    const select = document.createElement('select');
    select.disabled = !controlsEnabled;
    const notAssessedOption = document.createElement('option');
    notAssessedOption.value = 'not_assessed';
    notAssessedOption.textContent = 'Not assessed';
    select.appendChild(notAssessedOption);
    for (const rating of ratingOptions) {
      const option = document.createElement('option');
      option.value = rating.id;
      option.textContent = rating.label;
      select.appendChild(option);
    }
    select.value = working.observations[observation.id] || 'not_assessed';
    select.addEventListener('change', () => {
      if (select.value === 'not_assessed') {
        delete working.observations[observation.id];
      } else {
        working.observations[observation.id] = select.value;
      }
    });
    li.appendChild(select);
    phaseObservationsListEl.appendChild(li);
  }
}

/** Renders a toggle-button group (Phase Quality or Overall Quality): re-clicking the selected option deselects it. */
function renderQualityGroup(container, options, selectedId, onSelect) {
  container.innerHTML = '';
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `quality-option${option.id === selectedId ? ' selected' : ''}`;
    button.textContent = option.label;
    button.disabled = !controlsEnabled;
    button.addEventListener('click', () => onSelect(option.id));
    container.appendChild(button);
  }
}

function renderOverallAssessment(shot, profile) {
  const qualityOptions = buildQualityOptions(profile, ontology);
  renderQualityGroup(overallQualityOptionsEl, qualityOptions, shot.overall_quality_id, (qualityId) => {
    const nextValue = shot.overall_quality_id === qualityId ? '' : qualityId;
    mutateSelectedShot((candidate) => ({ ...candidate, overall_quality_id: nextValue }));
  });
  overallNotesEl.value = shot.notes || '';
}

function handleCapturePhase() {
  const shot = getSelectedShot();
  if (!shot || !activePhaseId || currentFrame === null) return;
  const phaseId = activePhaseId;
  const working = phaseWorking[phaseId] || getPhaseAssessment(shot, phaseId);
  if (!working.qualityId) {
    showFeedback('Select a Phase Quality rating before capturing this phase.', 'error');
    return;
  }
  const { phases } = resolveActiveProfileAndPhases(shot);
  const conflict = findPhaseFrameOwner(shot, phases, currentFrame, phaseId);
  if (conflict) {
    showFeedback(buildFrameInUseErrorMessage(currentFrame, conflict.label), 'error');
    return;
  }
  const phaseLabel = phases.find((candidate) => candidate.id === phaseId)?.label || phaseId;
  const wasCaptured = isPhaseCaptured(shot, phaseId);
  try {
    mutateSelectedShot((candidate) =>
      capturePhaseFrame(candidate, {
        phaseId,
        frame: currentFrame,
        qualityId: working.qualityId,
        notes: working.notes,
        observations: working.observations,
      }),
    );
  } catch (error) {
    showFeedback(describeEnvironmentError(error), 'error');
    return;
  }
  showFeedback(`Captured ${phaseLabel} at frame ${currentFrame}.`, 'success');
  if (!wasCaptured) {
    const updatedShot = getSelectedShot();
    const nextPhaseId = firstIncompletePhaseId(updatedShot, phases);
    if (nextPhaseId && nextPhaseId !== phaseId) {
      selectPhase(nextPhaseId);
    }
  }
}

function handleClearPhase() {
  const shot = getSelectedShot();
  if (!shot || !activePhaseId) return;
  const phaseId = activePhaseId;
  const { phases } = resolveActiveProfileAndPhases(shot);
  const phaseLabel = phases.find((candidate) => candidate.id === phaseId)?.label || phaseId;
  phaseWorking[phaseId] = { qualityId: '', notes: '', observations: {} };
  try {
    mutateSelectedShot((candidate) => clearPhase(candidate, phaseId));
  } catch (error) {
    showFeedback(describeEnvironmentError(error), 'error');
    return;
  }
  showFeedback(`Cleared ${phaseLabel}.`, 'success');
}

/**
 * `type` drives the feedback area's visual class -- 'success' (green),
 * 'error' (red, the default: most calls are reporting a blocked/failed
 * action), or 'info' (neutral) -- so a blocking/failed action never renders
 * with the same colour as a successful one.
 */
function showFeedback(message, type = 'error') {
  captureFeedbackEl.textContent = message;
  captureFeedbackEl.className = `capture-feedback ${type}`;
}

// ---------------------------------------------------------------------------
// Shot actions
// ---------------------------------------------------------------------------

function withAnnotatorStamp(row) {
  const annotator = annotatorEl.value.trim();
  return annotator ? { ...row, annotator } : row;
}

function mutateSelectedShot(mutator) {
  const shot = shots.find((candidate) => candidate.shot_id === selectedShotId);
  if (!shot) return;
  const updated = withAnnotatorStamp(mutator(shot));
  shots = renumberShotIndices(shots.map((candidate) => (candidate.shot_id === updated.shot_id ? updated : candidate)));
  selectedShotId = updated.shot_id;
  renderShotsStrip();
  renderShotDetail();
  updateExportState();
}

/**
 * Every keystroke in the session-level Annotator field immediately syncs to
 * every shot -- Annotator is required, session-level metadata for the whole
 * clip, not a per-shot field (restores the old workflow's "one global
 * annotator synced across every entry" behaviour, scoped to shots instead of
 * a flat entry list). Newly-created shots inherit it via withAnnotatorStamp
 * in handleAddShot, same as always.
 */
function handleAnnotatorInput() {
  const annotator = annotatorEl.value.trim();
  shots = shots.map((shot) => ({ ...shot, annotator }));
  renderShotsStrip();
  renderShotDetail();
  updateExportState();
}

function handleDeleteShot() {
  if (!selectedShotId) return;
  try {
    shots = renumberShotIndices(deleteShot(shots, selectedShotId));
    selectedShotId = null;
    renderShotsStrip();
    renderShotDetail();
    updateExportState();
  } catch (error) {
    showFeedback(describeEnvironmentError(error), 'error');
  }
}

/**
 * Disabled whenever a shot is currently selected (see
 * updateAddShotButtonState) -- so while this fires, selectedShotId is always
 * already null and no other shot's editor state can leak into the new one.
 */
function handleAddShot() {
  if (currentFrame === null || !runMetadata) return;
  const duplicate = findDuplicateContactFrame(shots, currentFrame);
  if (duplicate) {
    showFeedback(`Frame ${currentFrame} is already used by shot ${duplicate.shot_id} -- move to a different frame before adding a new shot here.`, 'error');
    return;
  }
  // The Default selects store taxonomy ids (see populateSelectOptions) --
  // converted to coach-facing labels here, since that's what the canonical
  // schema (and createManualShot's defaultShotType parameter) expects.
  // shot_class isn't a createManualShot parameter (that pure module only
  // knows about defaultShotType) -- prefilled here the same way `saved` is,
  // by overriding the field on the built shot. Affects only this new shot;
  // existing shots are never touched, and it stays editable afterward via
  // the ordinary Classification field like any other shot's shot_class.
  const defaultLabels = classificationLabelsForIds(taxonomy, {
    classId: defaultShotClassEl.value || null,
    typeId: defaultShotTypeEl.value || null,
    variantId: null,
  });
  const newShot = {
    ...withAnnotatorStamp(createManualShot({ frame: currentFrame, shots, runMetadata, defaultShotType: defaultLabels.shot_type })),
    shot_class: defaultLabels.shot_class,
    saved: false,
  };
  // Routed through the one canonical selectShot() (see its own doc comment),
  // but a freshly-created manual shot deliberately opens at Ready Position
  // rather than the usual Contact Point preference -- for manual labelling
  // the coach starts at the first phase, not the middle one -- and never
  // seeks the video (the shot was just created at the current frame, so
  // there is nowhere to seek to).
  shots = renumberShotIndices([...shots, newShot]);
  selectShot(newShot.shot_id, { preferredPhaseId: 'ready_position', seek: false });
  updateExportState();
  showFeedback(`Added ${newShot.shot_id} at frame ${currentFrame}.`, 'success');
}

/**
 * Commits the selected shot into the annotation session -- reuses the exact
 * same "complete" definition already computed for the readiness badge
 * (computeShotReadiness's 'ready' status: every configured phase captured
 * with a Phase Quality, plus Overall Quality set). Deselects afterward so
 * the existing, unchanged Add Shot button is the obvious next action for
 * the next shot -- no new "next shot" UI needed.
 */
/** Clears the current shot selection, hiding the Shot Detail/phase editor and returning to the saved-shots strip -- shared by Save Shot and Done Editing. */
function deselectShot() {
  selectedShotId = null;
  activePhaseId = null;
  phaseWorking = {};
  renderShotsStrip();
  renderShotDetail();
}

function handleSaveShot() {
  const shot = getSelectedShot();
  if (!shot || !controlsEnabled) return;
  const { profile, phases } = resolveActiveProfileAndPhases(shot);
  const readiness = computeShotReadiness(shot, profile, phases);
  if (readiness.status !== 'ready') {
    showFeedback(`Complete every phase and Overall Quality before saving this shot. Missing: ${readiness.missing.join(', ')}.`, 'error');
    return;
  }
  const shotId = shot.shot_id;
  mutateSelectedShot((candidate) => ({ ...candidate, saved: true }));
  deselectShot();
  showFeedback(`${shotId} saved. Click Add Shot at Current Frame to start the next shot.`, 'success');
}

/**
 * "Done Editing" -- an explicit way to leave the editor for a reopened saved
 * shot without triggering another save. Edits already mutated the shot in
 * memory as they happened (Capture/Clear/Overall Quality/notes all commit
 * immediately); this only clears the selection and returns focus to the
 * saved-shots strip, leaving the video at its current frame.
 */
function handleDoneEditing() {
  deselectShot();
  addShotButton.focus();
}

/**
 * Changing Shot Class re-derives Shot Type/Variant via
 * reconcileClassSelection (classification_taxonomy.mjs) -- a previously
 * selected type/variant only survives if it's genuinely still valid under
 * the new class, otherwise it's cleared, never left pointing at a
 * combination the taxonomy doesn't define.
 */
function handleShotClassChange() {
  const previousIds = classificationIdsForShot(taxonomy, getSelectedShot());
  const nextIds = reconcileClassSelection(taxonomy, previousIds, shotDetailShotClassEl.value || null);
  const labels = classificationLabelsForIds(taxonomy, nextIds);
  mutateSelectedShot((shot) => ({ ...shot, shot_class: labels.shot_class, shot_type: labels.shot_type, shot_variant: labels.shot_variant }));
}

/** Changing Shot Type clears an incompatible Shot Variant via reconcileTypeSelection, same reasoning as handleShotClassChange. */
function handleShotTypeChange() {
  const previousIds = classificationIdsForShot(taxonomy, getSelectedShot());
  const nextIds = reconcileTypeSelection(taxonomy, previousIds, shotDetailShotTypeEl.value || null);
  const labels = classificationLabelsForIds(taxonomy, nextIds);
  mutateSelectedShot((shot) => ({ ...shot, shot_type: labels.shot_type, shot_variant: labels.shot_variant }));
}

function handleShotVariantChange() {
  const previousIds = classificationIdsForShot(taxonomy, getSelectedShot());
  const labels = classificationLabelsForIds(taxonomy, { ...previousIds, variantId: shotDetailShotVariantEl.value || null });
  mutateSelectedShot((shot) => ({ ...shot, shot_variant: labels.shot_variant }));
}

// ---------------------------------------------------------------------------
// Classification taxonomy + coaching profile registry (loaded once at
// startup). JSON-driven discovery: adding a supported shot type/variant is a
// taxonomy + profile file + registry entry change, never a JavaScript edit
// (see docs/architecture/annotation-workbench.md#profile-aware-shot-classification-taxonomy--registry-json-driven).
// ---------------------------------------------------------------------------

async function loadTaxonomyAndProfiles() {
  try {
    taxonomy = await loadTaxonomy(environment.loadJsonResource);
  } catch (error) {
    // Genuinely unavailable/invalid -- every classification falls through to
    // the explicit "no profile configured" state (resolveProfileForShot
    // requires a taxonomy), never a guess.
    taxonomy = null;
    console.error('[annotation-workbench] Failed to load classification taxonomy:', describeEnvironmentError(error));
  }

  try {
    ontology = await loadOntology(environment.loadJsonResource);
  } catch {
    // Same fallback posture as the taxonomy above -- phase/observation/
    // rating/quality labels fall back to prettified ids (ontology.mjs's own
    // lookupMeta), never a guess at real coaching terminology.
    ontology = null;
  }

  try {
    const registry = await loadRegistry(environment.loadJsonResource);
    const { profileIndex: loadedIndex } = await loadRegisteredProfiles(registry, {
      fetchImpl: environment.loadJsonResource,
      taxonomy,
      ontology,
      onError: (registryEntry, error) => {
        // An enabled profile that fails to load/validate is a real,
        // actionable configuration error -- logged clearly rather than
        // silently dropped, even though (matching the taxonomy/ontology
        // posture above) the app keeps running with that one classification
        // simply resolving to "no profile configured".
        const detail = error instanceof ProfileRegistryValidationError ? error.errors.join('; ') : describeEnvironmentError(error);
        console.error(`[annotation-workbench] Failed to load coaching profile "${registryEntry.profileId}": ${detail}`);
      },
    });
    profileIndex = loadedIndex;
  } catch (error) {
    profileIndex = new Map();
    console.error('[annotation-workbench] Failed to load profile registry:', describeEnvironmentError(error));
  }

  populateDefaultClassificationSelects();
}

/** Session Default Class/Type selects -- Default Type is always re-filtered to whichever class is currently selected as default. */
function populateDefaultClassificationSelects() {
  populateSelectOptions(defaultShotClassEl, getClasses(taxonomy));
  const defaultClassId = getDefaultClassId(taxonomy);
  if (defaultClassId) defaultShotClassEl.value = defaultClassId;
  populateDefaultShotTypeSelect();
}

function populateDefaultShotTypeSelect() {
  const classId = defaultShotClassEl.value || null;
  const types = getTypesForClass(taxonomy, classId);
  populateSelectOptions(defaultShotTypeEl, types);
  const defaultTypeId = getDefaultTypeId(taxonomy);
  if (defaultTypeId && types.some((entry) => entry.id === defaultTypeId)) {
    defaultShotTypeEl.value = defaultTypeId;
  }
}

// ---------------------------------------------------------------------------
// Session / export status
// ---------------------------------------------------------------------------

function updateVideoBanner() {
  videoNameEl.textContent = videoFileName || 'No video loaded';
  videoNameEl.classList.toggle('profile-empty', !videoFileName);
  // Diagnostic only -- the currently-open video's own freshly-probed rate,
  // regardless of what an imported CSV's canonical rate is. See
  // updateSessionMeta for the rate that actually drives the annotation clock.
  videoFrameRateEl.textContent = formatFrameRateLabel(realVideoMeta);
}

function updateSessionMeta() {
  sessionVideoEl.textContent = videoFileName || 'No video loaded';
  // The canonical annotation-session rate -- realVideoMeta's own probe until
  // an Annotation CSV imports successfully, then that CSV's own rate (see
  // applyCanonicalAnnotationFrameRate). This is the rate frame/time
  // conversion and newly-exported rows actually use, so it -- not
  // realVideoMeta -- is what belongs in this session-facing display.
  const annotationRateMeta = Number.isFinite(annotationFrameRateFps)
    ? { frame_rate_fps: annotationFrameRateFps, video_metadata_provider: annotationFrameRateProvider }
    : null;
  sessionFrameRateEl.textContent = formatFrameRateLabel(annotationRateMeta) || '—';
  sessionCsvEl.textContent = csvLoaded ? 'Loaded existing annotation CSV' : 'None (new annotation session)';
}

/**
 * A manually-created shot starts unsaved (see handleAddShot/handleSaveShot)
 * and isn't part of the exportable session until Save Shot commits it --
 * everything else (automated-origin shots, anything loaded from a CSV) has
 * no "unsaved" concept and is exportable as before.
 */
function exportableShots() {
  return shots.filter((shot) => shot.saved !== false);
}

/**
 * Export is blocked only on missing global metadata -- Annotator, required
 * and session-level. Per-shot completeness (phases, Overall Quality) is
 * advisory only, via each shot's readiness badge (renderShotDetail/
 * renderShotsStrip) -- never a reason to block exporting a session with
 * partially-reviewed shots still in it. An unsaved draft is excluded from
 * both the count and the export itself until Save Shot commits it.
 */
function updateExportState() {
  const hasVideo = Boolean(videoFileName) && Boolean(realVideoMeta);
  const annotator = annotatorEl.value.trim();
  exportButton.disabled = !hasVideo || !annotator;
  if (!hasVideo) {
    exportStatusEl.textContent = 'Open a video to begin.';
  } else if (!annotator) {
    exportStatusEl.textContent = 'Enter an annotator before exporting.';
  } else {
    const count = exportableShots().length;
    exportStatusEl.textContent = `${count} shot${count === 1 ? '' : 's'} ready to export.`;
  }
}

function buildExportFilename() {
  const base = videoFileName ? deriveVideoId(videoFileName) : 'annotation';
  return `${base}_annotations.csv`;
}

async function exportAnnotationCsv() {
  try {
    const text = buildAnnotationCsvText(exportableShots());
    await environment.saveTextFile({ content: text, suggestedName: buildExportFilename(), mimeType: 'text/csv' });
    showFeedback('Annotation CSV saved.', 'success');
  } catch (error) {
    showFeedback(`Unable to save Annotation CSV: ${describeEnvironmentError(error)}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

openVideoButton.addEventListener('click', () => openVideo());
openCsvButton.addEventListener('click', () => openCsv());

videoFileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  await loadVideoFromFile(file);
  videoFileInput.value = '';
});

csvFileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  loadCsvText(text);
  csvFileInput.value = '';
});

prevFrameButton.addEventListener('click', () => stepFrame(-1));
nextFrameButton.addEventListener('click', () => stepFrame(1));
playPauseButton.addEventListener('click', () => {
  if (video.paused) video.play();
  else video.pause();
});

addShotButton.addEventListener('click', () => handleAddShot());
shotDeleteButton.addEventListener('click', () => handleDeleteShot());
exportButton.addEventListener('click', () => exportAnnotationCsv());

shotDetailShotClassEl.addEventListener('change', () => handleShotClassChange());
shotDetailShotTypeEl.addEventListener('change', () => handleShotTypeChange());
shotDetailShotVariantEl.addEventListener('change', () => handleShotVariantChange());
defaultShotClassEl.addEventListener('change', () => populateDefaultShotTypeSelect());

annotatorEl.addEventListener('input', () => handleAnnotatorInput());

phaseCaptureButton.addEventListener('click', () => handleCapturePhase());
phaseClearButton.addEventListener('click', () => handleClearPhase());
saveShotButton.addEventListener('click', () => handleSaveShot());
doneEditingButton.addEventListener('click', () => handleDoneEditing());
phaseNotesEl.addEventListener('input', () => {
  const working = phaseWorking[activePhaseId];
  if (working) working.notes = phaseNotesEl.value;
});
overallNotesEl.addEventListener('input', () => {
  if (!getSelectedShot()) return;
  mutateSelectedShot((candidate) => ({ ...candidate, notes: overallNotesEl.value }));
});

video.addEventListener('timeupdate', updateFrameInfo);
video.addEventListener('loadedmetadata', updateFrameInfo);
video.addEventListener('loadeddata', updateFrameInfo);
video.addEventListener('seeked', updateFrameInfo);

document.addEventListener('keydown', (event) => {
  if (isEditableTarget(event.target)) {
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    if (video.paused) video.play();
    else video.pause();
    return;
  }
  if (event.key === 'ArrowLeft') {
    stepFrame(-1);
    return;
  }
  if (event.key === 'ArrowRight') {
    stepFrame(1);
    return;
  }
  const shot = getSelectedShot();
  if (!shot) return;
  const { phases } = resolveActiveProfileAndPhases(shot);
  const shortcutPhase = phases.find((phase) => phase.shortcut === event.key);
  if (shortcutPhase) {
    selectPhase(shortcutPhase.id);
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  updateVideoBanner();
  updateSessionMeta();
  updateExportState();
  renderShotsStrip();
  renderShotDetail();
  loadTaxonomyAndProfiles().then(() => renderShotDetail());
}

init();
