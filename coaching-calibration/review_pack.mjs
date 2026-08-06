const PHASE_IDS = ['ready_position', 'max_take_back', 'contact_point', 'max_follow_through'];
export const CURRENT_REVIEW_CONTRACT_VERSION = '2.0.0';
export const CURRENT_REVIEW_MAPPING_VERSION = '3.0.0';

export class ReviewPackValidationError extends Error {}

export function parseReviewPack(text) {
  let pack;
  try {
    pack = JSON.parse(text);
  } catch {
    throw new ReviewPackValidationError('Review Pack is not valid JSON.');
  }
  if (pack?.artifact_type !== 'annotation_workbench_review_pack' || pack?.schema_version !== '1') {
    throw new ReviewPackValidationError('Unsupported Review Pack type or schema version.');
  }
  if (typeof pack.coach_annotation_csv_text !== 'string' || !Array.isArray(pack.shots)) {
    throw new ReviewPackValidationError('Review Pack is missing coach annotations or shot evidence.');
  }
  for (const shot of pack.shots) {
    if (!shot.coach_shot_id || typeof shot.phases !== 'object') {
      throw new ReviewPackValidationError('Review Pack contains an invalid shot mapping.');
    }
    for (const phaseId of Object.keys(shot.phases)) {
      if (!PHASE_IDS.includes(phaseId)) {
        throw new ReviewPackValidationError(`Review Pack contains unsupported phase "${phaseId}".`);
      }
    }
  }
  return pack;
}

export function reviewShotFor(pack, coachShotId) {
  return pack?.shots?.find((shot) => shot.coach_shot_id === coachShotId) ?? null;
}

export function phaseReviewFor(pack, coachShotId, phaseId) {
  return reviewShotFor(pack, coachShotId)?.phases?.[phaseId] ?? null;
}

export function frameDelta(coachFrame, automatedFrame, frameRateFps) {
  if (!Number.isFinite(coachFrame) || !Number.isFinite(automatedFrame)) return null;
  const frames = automatedFrame - coachFrame;
  return {
    frames,
    milliseconds: Number.isFinite(frameRateFps) && frameRateFps > 0 ? (frames / frameRateFps) * 1000 : null,
  };
}

export function reviewVocabularyStatus(pack) {
  const contractVersion = pack?.contracts?.observation_contract?.contract_version ?? null;
  const mappingVersion = pack?.contracts?.evidence_mapping?.mapping_version ?? null;
  return {
    contractVersion,
    mappingVersion,
    current: contractVersion === CURRENT_REVIEW_CONTRACT_VERSION && mappingVersion === CURRENT_REVIEW_MAPPING_VERSION,
  };
}

export function primaryEvidenceComparison(runtimeObservation, coachObservation) {
  const runtimePrimary = (runtimeObservation?.measurements || []).filter(
    (measurement) => measurement.evidence_role === 'primary',
  );
  const coachPrimary = (coachObservation?.measurements || []).filter(
    (measurement) => measurement.evidence_role === 'primary',
  );
  const geometryMetricIds = [...new Set(
    [...runtimePrimary, ...coachPrimary].map((measurement) => measurement.geometry_metric_id),
  )];
  return geometryMetricIds.map((geometryMetricId) => ({
    geometryMetricId,
    runtime: runtimePrimary.find((measurement) => measurement.geometry_metric_id === geometryMetricId) ?? null,
    coach: coachPrimary.find((measurement) => measurement.geometry_metric_id === geometryMetricId) ?? null,
  }));
}
