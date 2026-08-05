// Versioned, pure assessment aggregation policy. The Workbench uses this for
// reporting; it never mutates coach-authored phase or observation evidence.

export const ASSESSMENT_POLICY_VERSION = '1.0.0';

const QUALITY_ORDER = Object.freeze({
  red_flag: 0,
  needs_work: 1,
  good: 2,
  excellent: 3,
});

const DEFAULTING_SOURCES = new Set([
  'inherited_overall',
  'defaulted_overall',
  'inherited_phase',
  'defaulted_phase',
]);

function worstQuality(values) {
  return values.reduce((worst, value) => (
    worst === null || QUALITY_ORDER[value] < QUALITY_ORDER[worst] ? value : worst
  ), null);
}

function isIndependentObservationEvidence(assessment) {
  return assessment
    && Object.hasOwn(QUALITY_ORDER, assessment.qualityId)
    && !DEFAULTING_SOURCES.has(assessment.source);
}

export function derivePhaseEvidenceRecommendation(phaseAssessment, phase) {
  const configured = phase?.observations || [];
  const evidence = configured
    .map((observation) => ({ observation, assessment: phaseAssessment?.observations?.[observation.id] }))
    .filter(({ assessment }) => isIndependentObservationEvidence(assessment));

  if (evidence.length === 0) {
    return {
      policyVersion: ASSESSMENT_POLICY_VERSION,
      qualityId: 'not_assessed',
      assessedCount: 0,
      totalCount: configured.length,
      complete: false,
      driverObservationIds: [],
    };
  }

  const qualityId = worstQuality(evidence.map(({ assessment }) => assessment.qualityId));
  return {
    policyVersion: ASSESSMENT_POLICY_VERSION,
    qualityId,
    assessedCount: evidence.length,
    totalCount: configured.length,
    complete: evidence.length === configured.length,
    driverObservationIds: evidence
      .filter(({ assessment }) => assessment.qualityId === qualityId)
      .map(({ observation }) => observation.id),
  };
}

export function deriveOverallAssessment(phases, assessmentForPhase) {
  const phaseResults = (phases || []).map((phase) => ({
    phase,
    qualityId: assessmentForPhase(phase)?.qualityId || '',
  }));
  const missingPhaseIds = phaseResults
    .filter(({ qualityId }) => !qualityId || qualityId === 'not_assessed')
    .map(({ phase }) => phase.id);
  const assessed = phaseResults.filter(({ qualityId }) => Object.hasOwn(QUALITY_ORDER, qualityId));

  if (assessed.length === 0) {
    return {
      policyVersion: ASSESSMENT_POLICY_VERSION,
      qualityId: 'not_assessed',
      complete: false,
      driverPhaseIds: [],
      missingPhaseIds,
    };
  }

  const worst = worstQuality(assessed.map(({ qualityId }) => qualityId));
  // A material concern remains reportable even while another phase is
  // unassessed. Positive conclusions require complete phase coverage.
  const qualityId = missingPhaseIds.length > 0 && ['good', 'excellent'].includes(worst)
    ? 'not_assessed'
    : worst;
  return {
    policyVersion: ASSESSMENT_POLICY_VERSION,
    qualityId,
    complete: missingPhaseIds.length === 0,
    driverPhaseIds: assessed
      .filter(({ qualityId: candidate }) => candidate === worst)
      .map(({ phase }) => phase.id),
    missingPhaseIds,
  };
}
