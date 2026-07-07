import { deriveVideoId } from './video_id.mjs';
import { canExportCalibration, getMissingLabelEntries, isQualitySelected } from './validation.mjs';
import { buildCsvHeaders, buildExportRows, createSessionMetadata, getProfileId, resolveOntologyVersion } from './export_metadata.mjs';
import { buildExportFilename } from './export_filename.mjs';
import { buildFrameInUseErrorMessage, findFrameOwner, resolveCaptureFrame } from './duplicate_frame.mjs';
import {
  buildPhaseViewModels,
  buildQualityOptions,
  buildRatingOptions,
  createProfileBannerState,
  getProfileVersion,
  normalizeProfile,
  resolveDefaultProfilePath,
} from './profile_state.mjs';
import { getOntologyVersion, getQualityMeta, getRatingMeta, loadOntology, normalizeOntology } from './ontology.mjs';
import { isEditableTarget } from './keyboard_shortcuts.mjs';
import { createEnvironment, describeEnvironmentError } from './environment/index.mjs';

// ---------------------------------------------------------------- DOM refs

const video = document.getElementById('video');
const frameNumberEl = document.getElementById('frame-number');
const timestampEl = document.getElementById('timestamp');
const captureFeedbackEl = document.getElementById('capture-feedback');
const duplicateFrameErrorEl = document.getElementById('duplicate-frame-error');

const profileNameEl = document.getElementById('profile-name');
const profileShotTypeEl = document.getElementById('profile-shot-type');
const profileVersionsEl = document.getElementById('profile-versions');
const sessionVideoEl = document.getElementById('session-video');
const sessionProfileEl = document.getElementById('session-profile');
const sessionOntologyEl = document.getElementById('session-ontology');

const overallQualityOptionsEl = document.getElementById('overall-quality-options');
const overallNotesEl = document.getElementById('overall-notes');
const annotatorEl = document.getElementById('annotator');
const exportStatusEl = document.getElementById('export-status');
const exportButtonEl = document.getElementById('export-csv');

const progressListEl = document.getElementById('progress-list');
const progressSummaryEl = document.getElementById('progress-summary');

const phaseEmptyEl = document.getElementById('phase-empty');
const phaseBodyEl = document.getElementById('phase-body');
const phaseNameEl = document.getElementById('phase-name');
const phaseDescriptionEl = document.getElementById('phase-description');
const phaseQualityOptionsEl = document.getElementById('phase-quality-options');
const observationsListEl = document.getElementById('observations-list');
const phaseNotesEl = document.getElementById('phase-notes');
const savePhaseButtonEl = document.getElementById('save-phase');

const recordedBody = document.querySelector('#recorded-assessments tbody');

const profileInputEl = document.getElementById('profile-file');
const videoFileInputEl = document.getElementById('video-file');
const loadProfileButtonEl = document.getElementById('load-profile');

const exportConfirmEl = document.getElementById('export-confirm');
const exportSummaryEl = document.getElementById('export-summary');
const exportPhaseListEl = document.getElementById('export-phase-list');
const exportCancelEl = document.getElementById('export-cancel');
const exportConfirmButtonEl = document.getElementById('export-confirm-button');

const environment = createEnvironment(window);

// ---------------------------------------------------------------- State

let ontology = normalizeOntology({});
let activeProfile = normalizeProfile(null);
let phaseViewModels = [];
let qualityOptions = [];
let ratingOptions = [];

let activePhaseId = null;
let perPhaseWorking = {};
let capturedEntries = [];
let overallQuality = '';
let overallNotes = '';
let editingEntryId = null;

let videoFileName = 'Untitled Video';
let currentFrame = 0;
let currentVideoUrl = null;
let sessionMetadata = createSessionMetadata();
let activeProfileFileName = 'forehand_calibration_profile.json';

// ---------------------------------------------------------------- Help popover
//
// Coaching descriptions come from the ontology JSON files. Hover / native
// tooltips proved unreliable in the packaged webview, so help is now explicit:
// every helpable element has a visible info button (ⓘ). Clicking it opens a
// popover showing the description. The buttons are real <button> elements, so
// mouse click and keyboard (Enter / Space) both work reliably.

const helpPopoverEl = document.createElement('div');
helpPopoverEl.className = 'help-popover';
helpPopoverEl.setAttribute('role', 'dialog');
helpPopoverEl.setAttribute('aria-label', 'Description');
helpPopoverEl.hidden = true;
document.body.appendChild(helpPopoverEl);

let helpAnchorEl = null;

function positionHelpPopover(anchor) {
  const margin = 8;
  const rect = anchor.getBoundingClientRect();
  const popRect = helpPopoverEl.getBoundingClientRect();

  // Prefer below the button; flip above when it would overflow the viewport.
  let top = rect.bottom + margin;
  if (top + popRect.height > window.innerHeight - margin) {
    top = rect.top - popRect.height - margin;
  }
  if (top < margin) {
    top = margin;
  }

  // Clamp horizontally within the viewport.
  let left = rect.left;
  const maxLeft = window.innerWidth - popRect.width - margin;
  if (left > maxLeft) {
    left = Math.max(margin, maxLeft);
  }
  if (left < margin) {
    left = margin;
  }

  helpPopoverEl.style.top = `${top}px`;
  helpPopoverEl.style.left = `${left}px`;
}

function openHelpPopover(anchor, text) {
  helpPopoverEl.textContent = text;
  helpPopoverEl.hidden = false;
  helpAnchorEl = anchor;
  positionHelpPopover(anchor);
}

function closeHelpPopover() {
  helpPopoverEl.hidden = true;
  helpAnchorEl = null;
}

function toggleHelpPopover(anchor, text) {
  if (!helpPopoverEl.hidden && helpAnchorEl === anchor) {
    closeHelpPopover();
  } else {
    openHelpPopover(anchor, text);
  }
}

// Create a visible, styled info button that reveals ontology help text on click.
function createInfoButton(text, ariaLabel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'help-button';
  button.textContent = 'ⓘ';
  button.setAttribute('aria-label', ariaLabel || 'Show description');
  if (!text) {
    button.disabled = true;
    return button;
  }
  button.title = text; // harmless native fallback; the popover is the primary UI
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleHelpPopover(button, text);
  });
  return button;
}

// Populate an inline help slot (a placeholder span in index.html) with a fresh
// info button, or hide it when there is no description.
function fillHelpSlot(slotId, text, ariaLabel) {
  const slot = document.getElementById(slotId);
  if (!slot) {
    return;
  }
  slot.innerHTML = '';
  if (!text) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  slot.appendChild(createInfoButton(text, ariaLabel));
}

// Close the popover on outside click, Escape, or viewport resize.
document.addEventListener('click', (event) => {
  if (helpPopoverEl.hidden) {
    return;
  }
  if (event.target.closest && event.target.closest('.help-button')) {
    return;
  }
  closeHelpPopover();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !helpPopoverEl.hidden) {
    closeHelpPopover();
  }
});
window.addEventListener('resize', () => {
  if (!helpPopoverEl.hidden && helpAnchorEl) {
    positionHelpPopover(helpAnchorEl);
  }
});

// Compose a rating-scale legend from the ontology so the meaning of each
// observation rating is discoverable.
function buildRatingLegend() {
  const notAssessed = getRatingMeta(ontology, 'not_assessed');
  const parts = [];
  if (notAssessed.description) {
    parts.push(`Not assessed: ${notAssessed.description}`);
  }
  ratingOptions.forEach((rating) => {
    if (rating.description) {
      parts.push(`${rating.label}: ${rating.description}`);
    }
  });
  return parts.join('\n');
}

// Compose a quality-scale legend from the ontology for the quality controls.
function buildQualityLegend() {
  const notAssessed = getQualityMeta(ontology, 'not_assessed');
  const parts = [];
  if (notAssessed.description) {
    parts.push(`Not assessed: ${notAssessed.description}`);
  }
  qualityOptions.forEach((quality) => {
    if (quality.description) {
      parts.push(`${quality.label}: ${quality.description}`);
    }
  });
  return parts.join('\n');
}

// Populate the profile-level help slots (rating scale + overall quality) once a
// profile and ontology are loaded.
function renderProfileHelp() {
  fillHelpSlot('rating-scale-help', buildRatingLegend(), 'Show observation rating scale');
  fillHelpSlot('overall-quality-help', buildQualityLegend(), 'Show overall quality guidance');
}

// ---------------------------------------------------------------- Init

async function loadInitial() {
  try {
    ontology = await loadOntology((resourceUrl) => environment.loadJsonResource(resourceUrl));
  } catch (error) {
    console.error('Unable to load the coaching ontology.', error);
    ontology = normalizeOntology({});
  }

  try {
    const data = await environment.loadJsonResource(resolveDefaultProfilePath());
    applyProfile(data, 'forehand_calibration_profile.json');
  } catch (error) {
    console.error('Unable to load the default calibration profile.', error);
    applyProfile(null, activeProfileFileName);
  }
}

function applyProfile(profileData, profileFileName = activeProfileFileName) {
  activeProfile = normalizeProfile(profileData);
  activeProfileFileName = typeof profileFileName === 'string' && profileFileName.trim()
    ? profileFileName
    : activeProfileFileName;

  phaseViewModels = buildPhaseViewModels(activeProfile, ontology);
  qualityOptions = buildQualityOptions(activeProfile, ontology);
  ratingOptions = buildRatingOptions(activeProfile, ontology);

  // Reset assessment state when a new profile is applied.
  perPhaseWorking = {};
  capturedEntries = [];
  overallQuality = '';
  overallNotes = '';
  editingEntryId = null;
  activePhaseId = phaseViewModels.length > 0 ? phaseViewModels[0].id : null;

  renderBanner(profileData ? { ...activeProfile, loaded: true } : null);
  renderSessionMeta();
  renderOverallQuality();
  renderProfileHelp();
  overallNotesEl.value = '';
  renderProgress();
  renderPhaseCard();
  renderRecorded();
  hideBlockingError();
  updateExportState();
}

// ---------------------------------------------------------------- Banner + session

function renderBanner(profile = null) {
  const state = createProfileBannerState(profile ? { ...profile, loaded: true } : null);
  profileNameEl.textContent = state.title;
  profileShotTypeEl.textContent = state.subtitle;
  profileNameEl.classList.toggle('profile-empty', !state.loaded);
  profileShotTypeEl.classList.toggle('profile-empty', !state.loaded);
  profileVersionsEl.textContent = state.loaded
    ? `Profile v${state.profileVersion} · Ontology v${getOntologyVersion(ontology)}`
    : '';
}

function renderSessionMeta() {
  sessionVideoEl.textContent = videoFileName || 'No video loaded';
  sessionProfileEl.textContent = activeProfile.phases.length > 0
    ? `${activeProfile.profile_name} (v${getProfileVersion(activeProfile)})`
    : 'No profile loaded';
  sessionOntologyEl.textContent = `v${getOntologyVersion(ontology)}`;
}

// ---------------------------------------------------------------- Quality controls

function renderQualityGroup(container, selectedId, onSelect) {
  container.innerHTML = '';
  if (qualityOptions.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'profile-hint';
    empty.textContent = 'No quality scale configured for this profile.';
    container.appendChild(empty);
    return;
  }
  qualityOptions.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quality-option';
    button.setAttribute('role', 'radio');
    button.dataset.qualityId = option.id;
    button.textContent = option.label;
    const selected = option.id === selectedId;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', selected ? 'true' : 'false');
    button.addEventListener('click', () => onSelect(option.id));
    container.appendChild(button);
  });
}

function renderOverallQuality() {
  renderQualityGroup(overallQualityOptionsEl, overallQuality, (id) => {
    overallQuality = overallQuality === id ? '' : id;
    renderOverallQuality();
    updateExportState();
  });
}

// ---------------------------------------------------------------- Working state

function getWorkingState(phaseId) {
  if (!perPhaseWorking[phaseId]) {
    perPhaseWorking[phaseId] = { quality: '', notes: '', observations: {} };
  }
  return perPhaseWorking[phaseId];
}

// ---------------------------------------------------------------- Progress card

function isPhaseCaptured(phaseId) {
  return capturedEntries.some((entry) => entry.phase_id === phaseId);
}

function renderProgress() {
  progressListEl.innerHTML = '';
  phaseViewModels.forEach((phase) => {
    const item = document.createElement('li');
    item.className = 'progress-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'progress-item';
    button.dataset.phaseId = phase.id;

    const captured = isPhaseCaptured(phase.id);
    const active = phase.id === activePhaseId;
    button.classList.add(captured ? 'captured' : 'pending');
    if (active) {
      button.classList.add('active');
    }

    const icon = document.createElement('span');
    icon.className = 'status-icon';
    icon.textContent = captured ? '✓' : active ? '●' : '○';

    const label = document.createElement('span');
    label.className = 'phase-label';
    label.textContent = phase.label;

    button.appendChild(icon);
    button.appendChild(label);

    if (phase.shortcut) {
      const shortcut = document.createElement('span');
      shortcut.className = 'shortcut-hint';
      shortcut.textContent = phase.shortcut;
      button.appendChild(shortcut);
    }

    button.addEventListener('click', () => selectPhase(phase.id));
    item.appendChild(button);
    if (phase.description) {
      item.appendChild(createInfoButton(phase.description, `Show ${phase.label} description`));
    }
    progressListEl.appendChild(item);
  });

  const capturedCount = phaseViewModels.filter((phase) => isPhaseCaptured(phase.id)).length;
  const total = phaseViewModels.length;
  if (total > 0 && capturedCount === total) {
    progressSummaryEl.textContent = 'All phases recorded ✓';
    progressSummaryEl.classList.add('progress-complete');
  } else {
    progressSummaryEl.textContent = `${capturedCount} of ${total} phases recorded`;
    progressSummaryEl.classList.remove('progress-complete');
  }
}

// ---------------------------------------------------------------- Phase card

function selectPhase(phaseId) {
  activePhaseId = phaseId;
  // Selecting a phase from the progress list cancels any in-progress edit.
  editingEntryId = null;
  renderProgress();
  renderPhaseCard();
}

function renderPhaseCard() {
  const phase = phaseViewModels.find((entry) => entry.id === activePhaseId);
  if (!phase) {
    phaseEmptyEl.hidden = false;
    phaseBodyEl.hidden = true;
    return;
  }

  phaseEmptyEl.hidden = true;
  phaseBodyEl.hidden = false;

  phaseNameEl.textContent = phase.label;
  phaseDescriptionEl.textContent = phase.description || '';
  fillHelpSlot('phase-name-help', phase.description, `Show ${phase.label} description`);
  fillHelpSlot('phase-quality-help', buildQualityLegend(), 'Show phase quality guidance');

  const working = getWorkingState(phase.id);

  renderQualityGroup(phaseQualityOptionsEl, working.quality, (id) => {
    working.quality = working.quality === id ? '' : id;
    renderPhaseCard();
  });

  renderObservations(phase, working);

  phaseNotesEl.value = working.notes;

  savePhaseButtonEl.textContent = editingEntryId
    ? `Update ${phase.label} Assessment`
    : `Save ${phase.label} Assessment`;
}

function renderObservations(phase, working) {
  observationsListEl.innerHTML = '';
  if (phase.observations.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'profile-hint';
    empty.textContent = 'No structured observations are configured for this phase.';
    observationsListEl.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  phase.observations.forEach((observation) => {
    const item = document.createElement('li');
    item.className = 'observation-row';

    const labelWrap = document.createElement('span');
    labelWrap.className = 'observation-label';

    const labelText = document.createElement('span');
    labelText.textContent = observation.label;
    labelWrap.appendChild(labelText);

    if (observation.description) {
      labelWrap.appendChild(
        createInfoButton(observation.description, `Show ${observation.label} description`),
      );
    }

    const select = document.createElement('select');
    select.dataset.observationId = observation.id;

    const defaultOption = document.createElement('option');
    defaultOption.value = 'not_assessed';
    defaultOption.textContent = 'Not assessed';
    select.appendChild(defaultOption);

    ratingOptions.forEach((rating) => {
      const option = document.createElement('option');
      option.value = rating.id;
      option.textContent = rating.label;
      if (rating.description) {
        option.title = rating.description;
      }
      select.appendChild(option);
    });

    select.value = working.observations[observation.id] || 'not_assessed';
    select.addEventListener('change', (event) => {
      working.observations[observation.id] = event.target.value;
    });

    item.appendChild(labelWrap);
    item.appendChild(select);
    fragment.appendChild(item);
  });
  observationsListEl.appendChild(fragment);
}

function buildStructuredObservations(phase, working) {
  return phase.observations.reduce((result, observation) => {
    const value = working.observations[observation.id];
    if (value && value !== 'not_assessed') {
      result[observation.id] = value;
    }
    return result;
  }, {});
}

// ---------------------------------------------------------------- Save / edit / delete

function savePhaseAssessment() {
  const phase = phaseViewModels.find((entry) => entry.id === activePhaseId);
  if (!phase) {
    return;
  }

  updateFrameInfo();
  const working = getWorkingState(phase.id);

  // Phase Quality is a required coaching judgement.
  if (!isQualitySelected(working.quality)) {
    showBlockingError('Select a Phase Quality rating before saving this assessment.');
    return;
  }

  // A frame may be used by at most one phase assessment. Editing re-saves at the
  // current frame and is still subject to this check (its own entry excluded).
  const frameForCapture = resolveCaptureFrame({
    videoTime: video.currentTime,
    currentFrame,
    displayedFrame: frameNumberEl.textContent,
  });

  const owner = findFrameOwner(capturedEntries, frameForCapture, editingEntryId);
  if (owner) {
    showBlockingError(buildFrameInUseErrorMessage(frameForCapture, owner.phase_label));
    return;
  }
  hideBlockingError();

  const existing = editingEntryId
    ? capturedEntries.find((entry) => entry.id === editingEntryId)
    : null;

  const structuredObservations = buildStructuredObservations(phase, working);
  const timestamp = Number.isFinite(video.currentTime) ? video.currentTime.toFixed(3) : '0.000';

  const entryData = {
    video_id: deriveVideoId(videoFileName),
    video_filename: videoFileName,
    frame: frameForCapture,
    timestamp_seconds: timestamp,
    phase_id: phase.id,
    phase_label: phase.label,
    phase_quality: working.quality || '',
    annotator: annotatorEl.value.trim(),
    notes: phaseNotesEl.value.trim(),
    structured_observations: structuredObservations,
  };

  const wasEditing = Boolean(editingEntryId);
  if (existing) {
    Object.assign(existing, entryData);
    editingEntryId = null;
    showFeedback(`Updated ${phase.label} at Frame ${frameForCapture}`);
  } else {
    capturedEntries.push({ id: `${Date.now()}`, ...entryData });
    showFeedback(`Saved ${phase.label} at Frame ${frameForCapture}`);
  }

  // Persist working state so returning to the phase shows what was saved.
  working.notes = entryData.notes;

  renderRecorded();
  renderProgress();
  updateExportState();

  // Auto-advance to the next incomplete phase, but never while editing (Section 7.4).
  if (!wasEditing) {
    advanceToNextIncompletePhase();
  } else {
    renderPhaseCard();
  }
}

function advanceToNextIncompletePhase() {
  const next = phaseViewModels.find((phase) => !isPhaseCaptured(phase.id));
  if (next) {
    activePhaseId = next.id;
  }
  renderProgress();
  renderPhaseCard();
}

function editEntry(entryId) {
  const entry = capturedEntries.find((item) => item.id === entryId);
  if (!entry) {
    return;
  }
  editingEntryId = entryId;
  activePhaseId = entry.phase_id;

  const working = getWorkingState(entry.phase_id);
  working.quality = entry.phase_quality || '';
  working.notes = entry.notes || '';
  working.observations = { ...(entry.structured_observations || {}) };

  // Seek to the frame that owns this assessment so an unchanged edit re-saves at
  // the same frame. Moving the video before saving re-validates the new frame.
  const frameValue = Number.parseInt(String(entry.frame), 10);
  if (Number.isFinite(frameValue) && video.duration) {
    video.currentTime = Math.min(video.duration, Math.max(0, frameValue / 30));
  }

  hideBlockingError();
  renderProgress();
  renderPhaseCard();
}

function deleteEntry(entryId) {
  capturedEntries = capturedEntries.filter((item) => item.id !== entryId);
  if (editingEntryId === entryId) {
    editingEntryId = null;
  }
  renderRecorded();
  renderProgress();
  renderPhaseCard();
  updateExportState();
}

function renderRecorded() {
  recordedBody.innerHTML = '';
  capturedEntries.forEach((entry) => {
    const row = document.createElement('tr');
    const qualityLabel = entry.phase_quality
      ? getQualityMeta(ontology, entry.phase_quality).label
      : '—';

    const frameCell = document.createElement('td');
    frameCell.textContent = entry.frame;
    const phaseCell = document.createElement('td');
    phaseCell.textContent = entry.phase_label;
    const qualityCell = document.createElement('td');
    qualityCell.textContent = qualityLabel;

    const actionsCell = document.createElement('td');
    actionsCell.className = 'actions';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => editEntry(entry.id));
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => deleteEntry(entry.id));
    actionsCell.appendChild(editButton);
    actionsCell.appendChild(deleteButton);

    row.appendChild(frameCell);
    row.appendChild(phaseCell);
    row.appendChild(qualityCell);
    row.appendChild(actionsCell);
    recordedBody.appendChild(row);
  });
}

// ---------------------------------------------------------------- Feedback + error

function showFeedback(message) {
  captureFeedbackEl.textContent = message;
  captureFeedbackEl.className = 'capture-feedback visible';
  window.clearTimeout(showFeedback.timeoutId);
  showFeedback.timeoutId = window.setTimeout(() => {
    captureFeedbackEl.className = 'capture-feedback';
    captureFeedbackEl.textContent = '';
  }, 2200);
}

function showBlockingError(message) {
  duplicateFrameErrorEl.hidden = false;
  duplicateFrameErrorEl.innerHTML = `
    <span class="error-icon">✕</span>
    <span><strong>Error</strong><br />${message}</span>
  `;
}

function hideBlockingError() {
  duplicateFrameErrorEl.hidden = true;
  duplicateFrameErrorEl.innerHTML = '';
}

// ---------------------------------------------------------------- Video + frames

function updateFrameInfo() {
  const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const frame = Math.round(time * 30);
  currentFrame = frame;
  frameNumberEl.textContent = frame;
  timestampEl.textContent = formatTimestamp(time);
}

function formatTimestamp(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${safe.toFixed(3)}s`;
}

function stepFrame(delta) {
  if (!video.duration) return;
  video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + delta / 30));
}

function revokeCurrentVideoUrl() {
  if (currentVideoUrl) {
    URL.revokeObjectURL(currentVideoUrl);
    currentVideoUrl = null;
  }
}

async function loadVideoFile(file) {
  if (!file) return;
  revokeCurrentVideoUrl();
  videoFileName = file.name || 'Untitled Video';
  const url = URL.createObjectURL(file);
  currentVideoUrl = url;
  video.src = url;
  video.load();
  video.currentTime = 0;
  renderSessionMeta();
  try {
    await video.play();
  } catch {
    // Autoplay may be blocked until the user interacts; the video still renders.
  }
}

function openVideoFile() {
  if (videoFileInputEl) {
    videoFileInputEl.value = '';
    videoFileInputEl.click();
  }
}

// ---------------------------------------------------------------- Export

function validationLabels() {
  return phaseViewModels.map((phase) => ({ id: phase.id, label: phase.label }));
}

function validationEntries() {
  return capturedEntries.map((entry) => ({ label_id: entry.phase_id }));
}

function updateExportState() {
  const labels = validationLabels();
  const entries = validationEntries();
  const missing = getMissingLabelEntries(labels, entries);
  const valid = canExportCalibration({
    annotator: annotatorEl.value,
    labels,
    capturedEntries: entries,
    overallQuality,
  });

  exportButtonEl.disabled = !valid;
  if (!valid) {
    if (!annotatorEl.value.trim()) {
      exportStatusEl.textContent = 'Enter an annotator before exporting.';
    } else if (missing.length > 0) {
      const missingList = missing
        .map((label) => (phaseViewModels.find((phase) => phase.id === label.id) || {}).label || label.id)
        .join(', ');
      exportStatusEl.textContent = `Record every phase before exporting: ${missingList}`;
    } else if (!isQualitySelected(overallQuality)) {
      exportStatusEl.textContent = 'Select an Overall Quality rating before exporting.';
    } else {
      exportStatusEl.textContent = 'Enter an annotator before exporting.';
    }
    exportStatusEl.className = 'export-status error';
  } else {
    exportStatusEl.textContent = 'Ready to export.';
    exportStatusEl.className = 'export-status success';
  }
}

function openExportConfirm() {
  const labels = validationLabels();
  const canExport = canExportCalibration({
    annotator: annotatorEl.value,
    labels,
    capturedEntries: validationEntries(),
    overallQuality,
  });
  if (!canExport) {
    updateExportState();
    return;
  }

  const qualityLabel = overallQuality ? getQualityMeta(ontology, overallQuality).label : 'Not assessed';
  exportSummaryEl.innerHTML = `
    <div><dt>Profile</dt><dd>${activeProfile.profile_name}</dd></div>
    <div><dt>Profile Version</dt><dd>v${getProfileVersion(activeProfile)}</dd></div>
    <div><dt>Ontology</dt><dd>v${getOntologyVersion(ontology)}</dd></div>
    <div><dt>Annotator</dt><dd>${annotatorEl.value.trim()}</dd></div>
    <div><dt>Overall Quality</dt><dd>${qualityLabel}</dd></div>
  `;

  exportPhaseListEl.innerHTML = '';
  phaseViewModels.forEach((phase) => {
    const captured = isPhaseCaptured(phase.id);
    const item = document.createElement('li');
    item.className = captured ? 'recorded' : 'missing';
    item.textContent = `${captured ? '✓' : '✗'}  ${phase.label}${captured ? '' : '   (not recorded)'}`;
    exportPhaseListEl.appendChild(item);
  });

  exportConfirmEl.hidden = false;
}

function closeExportConfirm() {
  exportConfirmEl.hidden = true;
}

async function writeCsv() {
  const rows = [
    buildCsvHeaders(),
    ...buildExportRows(capturedEntries, {
      ...sessionMetadata,
      profile_id: getProfileId(activeProfile),
      profile_version: getProfileVersion(activeProfile),
      ontology_version: resolveOntologyVersion(getOntologyVersion(ontology), activeProfile.ontology_version),
      shot_type: activeProfile.shot_type,
      overall_quality_id: overallQuality,
      overall_notes: overallNotes,
    }),
  ];
  const csv = rows.map((row) => row.map((value) => {
    const safeValue = value === null || value === undefined ? '' : String(value);
    return `"${safeValue.replace(/"/g, '""')}"`;
  }).join(',')).join('\n');
  const suggestedName = buildExportFilename(videoFileName, activeProfileFileName);

  try {
    await environment.saveTextFile({ content: csv, suggestedName, mimeType: 'text/csv' });
  } catch (error) {
    console.error('Unable to save CSV export.', error);
    window.alert(`Unable to save CSV export: ${describeEnvironmentError(error)}`);
  }
}

// ---------------------------------------------------------------- Profile loading

async function loadProfileFromFile(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    applyProfile(data, file.name);
  } catch (error) {
    console.error('Unable to parse the selected calibration profile.', error);
    window.alert(`Unable to load profile JSON: ${error.message}`);
    renderBanner(null);
  }
}

// ---------------------------------------------------------------- Event wiring

overallNotesEl.addEventListener('input', () => {
  overallNotes = overallNotesEl.value.trim();
});

phaseNotesEl.addEventListener('input', () => {
  if (activePhaseId) {
    getWorkingState(activePhaseId).notes = phaseNotesEl.value;
  }
});

annotatorEl.addEventListener('input', () => {
  capturedEntries = capturedEntries.map((entry) => ({ ...entry, annotator: annotatorEl.value.trim() }));
  updateExportState();
});

loadProfileButtonEl.addEventListener('click', () => profileInputEl.click());

profileInputEl.addEventListener('change', async () => {
  const file = profileInputEl.files?.[0];
  if (!file) return;
  await loadProfileFromFile(file);
  profileInputEl.value = '';
});

videoFileInputEl?.addEventListener('change', async () => {
  const file = videoFileInputEl.files?.[0];
  if (!file) return;
  await loadVideoFile(file);
  videoFileInputEl.value = '';
});

document.getElementById('open-video').addEventListener('click', openVideoFile);
document.getElementById('play-pause').addEventListener('click', () => {
  if (video.paused) video.play(); else video.pause();
});
document.getElementById('prev-frame').addEventListener('click', () => stepFrame(-1));
document.getElementById('next-frame').addEventListener('click', () => stepFrame(1));
savePhaseButtonEl.addEventListener('click', savePhaseAssessment);
exportButtonEl.addEventListener('click', openExportConfirm);
exportCancelEl.addEventListener('click', closeExportConfirm);
exportConfirmButtonEl.addEventListener('click', () => {
  closeExportConfirm();
  writeCsv();
});

document.addEventListener('keydown', (event) => {
  if (isEditableTarget(event.target)) {
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    if (video.paused) video.play(); else video.pause();
    return;
  }
  if (event.key === 'ArrowLeft') { stepFrame(-1); return; }
  if (event.key === 'ArrowRight') { stepFrame(1); return; }

  // Phase shortcuts defined by the active Calibration Profile.
  const shortcutPhase = phaseViewModels.find((phase) => phase.shortcut && phase.shortcut === event.key);
  if (shortcutPhase) {
    selectPhase(shortcutPhase.id);
  }
});

video.addEventListener('timeupdate', updateFrameInfo);
video.addEventListener('loadedmetadata', updateFrameInfo);
video.addEventListener('loadeddata', updateFrameInfo);
video.addEventListener('seeked', updateFrameInfo);

updateExportState();
loadInitial();
