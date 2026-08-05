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

function defaultDiagnosisId(observation, observationQuality) {
  if (observationQuality === 'not_assessed') return '';
  return observation?.defaultDiagnosisIdByQuality?.[observationQuality]
    || (observationQuality === 'good' ? observation?.defaultGoodDiagnosisId : '')
    || '';
}

function observationDefault(observation, qualityId, source) {
  const observationQuality = defaultObservationQuality(qualityId);
  return {
    qualityId: observationQuality,
    diagnosisId: defaultDiagnosisId(observation, observationQuality),
    source,
    legacyRatingId: '',
  };
}

function mayBeDefaulted(assessment) {
  return !assessment
    || !assessment.source
    || [
      ASSESSMENT_SOURCES.INHERITED_OVERALL,
      ASSESSMENT_SOURCES.DEFAULTED_OVERALL,
      ASSESSMENT_SOURCES.INHERITED_PHASE,
      ASSESSMENT_SOURCES.DEFAULTED_PHASE,
    ].includes(assessment.source);
}

export function applyPhaseQualityDefault(working, phase, qualityId, qualitySource = ASSESSMENT_SOURCES.COACH_SELECTED) {
  if (!qualityId) {
    return { ...working, qualityId: '', qualitySource: '', observations: { ...(working.observations || {}) } };
  }
  const inherited = qualityId === 'excellent' || qualityId === 'not_assessed';
  const source = inherited ? ASSESSMENT_SOURCES.INHERITED_PHASE : ASSESSMENT_SOURCES.DEFAULTED_PHASE;
  const observations = { ...(working.observations || {}) };
  for (const observation of phase?.observations || []) {
    if (mayBeDefaulted(observations[observation.id])) {
      observations[observation.id] = observationDefault(observation, qualityId, source);
    }
  }
  return {
    ...working,
    qualityId,
    qualitySource,
    observations,
  };
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
