import { getPhaseAssessment, setPhaseAssessment } from './phase_assessment.mjs';

export const ASSESSMENT_SOURCES = Object.freeze({
  COACH_SELECTED: 'coach_selected',
  INHERITED_OVERALL: 'inherited_overall',
  DEFAULTED_OVERALL: 'defaulted_overall',
  INHERITED_PHASE: 'inherited_phase',
  DEFAULTED_PHASE: 'defaulted_phase',
  MIGRATED: 'migrated',
});

function defaultObservationQuality(qualityId) {
  if (qualityId === 'excellent') return 'excellent';
  if (qualityId === 'not_assessed') return 'not_assessed';
  return 'good';
}

function observationDefaults(observations, qualityId, source) {
  const observationQuality = defaultObservationQuality(qualityId);
  return Object.fromEntries((observations || []).map((observation) => [observation.id, {
    qualityId: observationQuality,
    diagnosisId: observationQuality === 'good' ? observation.defaultGoodDiagnosisId || '' : '',
    source,
    legacyRatingId: '',
  }]));
}

export function applyPhaseQualityDefault(working, phase, qualityId, qualitySource = ASSESSMENT_SOURCES.COACH_SELECTED) {
  if (!qualityId) {
    return { ...working, qualityId: '', qualitySource: '', observations: {} };
  }
  const inherited = qualityId === 'excellent' || qualityId === 'not_assessed';
  return {
    ...working,
    qualityId,
    qualitySource,
    observations: observationDefaults(
      phase?.observations || [],
      qualityId,
      inherited ? ASSESSMENT_SOURCES.INHERITED_PHASE : ASSESSMENT_SOURCES.DEFAULTED_PHASE,
    ),
  };
}

export function applyOverallQualityDefault(shot, phases, overallQualityId) {
  let next = { ...shot, overall_quality_id: overallQualityId };
  if (!overallQualityId) return next;

  const phaseQuality = ['excellent', 'not_assessed'].includes(overallQualityId) ? overallQualityId : 'good';
  const phaseSource = ['excellent', 'not_assessed'].includes(overallQualityId)
    ? ASSESSMENT_SOURCES.INHERITED_OVERALL
    : ASSESSMENT_SOURCES.DEFAULTED_OVERALL;
  const observationSource = ['excellent', 'not_assessed'].includes(overallQualityId)
    ? ASSESSMENT_SOURCES.INHERITED_OVERALL
    : ASSESSMENT_SOURCES.DEFAULTED_OVERALL;

  for (const phase of phases || []) {
    const existing = getPhaseAssessment(next, phase.id);
    next = setPhaseAssessment(next, phase.id, {
      ...existing,
      qualityId: phaseQuality,
      qualitySource: phaseSource,
      observations: observationDefaults(
        phase.observations || [],
        phaseQuality,
        observationSource,
      ),
    });
  }
  return next;
}

export function setObservationDiagnosis(working, observationId, diagnosis, source = ASSESSMENT_SOURCES.COACH_SELECTED) {
  const nextObservations = { ...working.observations };
  if (!diagnosis) {
    nextObservations[observationId] = { qualityId: 'not_assessed', diagnosisId: '', source, legacyRatingId: '' };
  } else {
    nextObservations[observationId] = {
      qualityId: diagnosis.qualityId,
      diagnosisId: diagnosis.id,
      source,
      legacyRatingId: '',
    };
  }
  return { ...working, observations: nextObservations };
}

export function observationsLocked(overallQualityId, phaseAssessment) {
  return ['excellent', 'not_assessed'].includes(overallQualityId)
    || ['excellent', 'not_assessed'].includes(phaseAssessment?.qualityId);
}
