// Per-phase quality/notes/observation-rating storage for the Annotation
// Workbench's phase editor, backed by the canonical CSV's `phase_assessments`
// column (JSON text, keyed by phase id, uniform for all five phases
// including contact_point). See
// docs/architecture/contact-point-annotation-csv.md's "Deliberately not in
// v1" section for why this column exists and what it deliberately does not
// store (frames stay in their own dedicated columns; see phase_frame_mapping.mjs).

import { getPhaseFrame, setPhaseFrame } from './phase_frame_mapping.mjs';

/** Raised when a shot's phase_assessments column holds corrupt or unexpected data. */
export class InvalidPhaseAssessmentsError extends Error {
  constructor(rawValue) {
    super(`shot.phase_assessments must be blank or a JSON object keyed by phase id (got ${JSON.stringify(rawValue)}).`);
    this.name = 'InvalidPhaseAssessmentsError';
    this.rawValue = rawValue;
  }
}

/**
 * Parses `shot.phase_assessments`. Blank (''/null/undefined) returns `{}`.
 * Malformed JSON, or valid JSON that isn't a plain object (array, string,
 * number, `null` literal, etc.), throws InvalidPhaseAssessmentsError rather
 * than silently defaulting to `{}` -- corrupt or unexpected data must never
 * be quietly discarded.
 */
export function parsePhaseAssessments(shot) {
  const raw = shot?.phase_assessments;
  if (raw === null || raw === undefined || raw === '') {
    return {};
  }
  let decoded;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new InvalidPhaseAssessmentsError(raw);
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new InvalidPhaseAssessmentsError(raw);
  }
  return decoded;
}

const EMPTY_ASSESSMENT = Object.freeze({ qualityId: '', notes: '', observations: {} });

/** The stored assessment for `phaseId`, or empty defaults if not yet captured. */
export function getPhaseAssessment(shot, phaseId) {
  const all = parsePhaseAssessments(shot);
  const entry = all[phaseId];
  if (!entry || typeof entry !== 'object') {
    return { ...EMPTY_ASSESSMENT, observations: {} };
  }
  return {
    qualityId: typeof entry.quality_id === 'string' ? entry.quality_id : '',
    notes: typeof entry.notes === 'string' ? entry.notes : '',
    observations: entry.observations && typeof entry.observations === 'object' ? { ...entry.observations } : {},
  };
}

/** Pure: returns a new shot with `phaseId`'s assessment set. Throws InvalidPhaseAssessmentsError if existing data is corrupt. */
export function setPhaseAssessment(shot, phaseId, { qualityId = '', notes = '', observations = {} } = {}) {
  const all = parsePhaseAssessments(shot);
  const next = {
    ...all,
    [phaseId]: { quality_id: qualityId, notes, observations: { ...observations } },
  };
  return { ...shot, phase_assessments: JSON.stringify(next) };
}

/** Pure: returns a new shot with `phaseId`'s assessment removed. Throws InvalidPhaseAssessmentsError if existing data is corrupt. */
export function clearPhaseAssessment(shot, phaseId) {
  const all = parsePhaseAssessments(shot);
  if (!(phaseId in all)) {
    return shot;
  }
  const next = { ...all };
  delete next[phaseId];
  return { ...shot, phase_assessments: JSON.stringify(next) };
}

/**
 * The single combining transform used by the Capture button for every
 * phase, uniformly: writes the frame (phase_frame_mapping.setPhaseFrame)
 * and the assessment (setPhaseAssessment) in one pure step. Propagates
 * InvalidPhaseAssessmentsError rather than masking it.
 */
export function capturePhaseFrame(shot, { phaseId, frame, qualityId, notes, observations }) {
  const withFrame = setPhaseFrame(shot, phaseId, frame);
  return setPhaseAssessment(withFrame, phaseId, { qualityId, notes, observations });
}

/**
 * Uniform "clear" for the Capture/Clear button pair: removes both the
 * phase's assessment and its frame. Every phase, every shot -- no
 * phase-id or shot-source exception anywhere above phase_frame_mapping.mjs.
 */
export function clearPhase(shot, phaseId) {
  const withoutAssessment = clearPhaseAssessment(shot, phaseId);
  return setPhaseFrame(withoutAssessment, phaseId, null);
}

/** True once a phase has both a captured frame and a quality rating. */
export function isPhaseCaptured(shot, phaseId) {
  return getPhaseFrame(shot, phaseId) !== null && getPhaseAssessment(shot, phaseId).qualityId !== '';
}
