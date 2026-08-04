import { deriveVideoId } from './video_id.mjs';

export const ARTIFACT_KINDS = Object.freeze({
  ANNOTATED: 'annotated',
  OBSERVED: 'observed',
  OBSERVED_ANNOTATED: 'observed-annotated',
});

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function hasEngineEvidence(shot) {
  return shot?.source === 'automated'
    || hasValue(shot?.automated_contact_frame)
    || hasValue(shot?.confidence)
    || (Array.isArray(shot?.contributing_providers) && shot.contributing_providers.length > 0);
}

function hasCoachAnnotation(shot) {
  return shot?.source === 'manual'
    || (hasValue(shot?.review_status) && shot.review_status !== 'unreviewed')
    || hasValue(shot?.phase_assessments)
    || hasValue(shot?.overall_quality_id)
    || hasValue(shot?.notes)
    || hasValue(shot?.hitter_id);
}

/**
 * Classify the complete CSV artifact, not individual shots. A reviewed engine
 * run can legitimately contain automated shots plus manually-added misses.
 */
export function classifyAnnotationArtifact(shots = []) {
  const observed = shots.some(hasEngineEvidence);
  const annotated = shots.some(hasCoachAnnotation);
  if (observed && annotated) return ARTIFACT_KINDS.OBSERVED_ANNOTATED;
  if (observed) return ARTIFACT_KINDS.OBSERVED;
  return ARTIFACT_KINDS.ANNOTATED;
}

export function buildAnnotationExportFilename(videoFilename, shots = []) {
  const videoName = deriveVideoId(videoFilename) || 'annotation';
  return `${videoName}_${classifyAnnotationArtifact(shots)}.csv`;
}
