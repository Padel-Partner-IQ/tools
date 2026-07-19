// Per-shot export readiness for the Annotation Workbench's phase editor.
// Advisory only -- Save Shot and CSV export are never gated on this (see
// app.js's handleSaveShot/updateExportState); this module only tells a coach
// what's left on one shot.
//
// Restored/adapted from the old Coach Calibration Workbench's
// validation.mjs's canExportCalibration, narrowed to a single shot and with
// the annotator condition removed (annotator is a session-level export gate
// now, not a per-shot concern -- see docs/architecture/annotation-workbench.md).
//
// This is a thin, backward-compatible view over the one canonical
// completeness calculation (annotation_completeness.mjs's
// computeAnnotationCompleteness) -- "ready"/"incomplete"/"no-profile" and the
// itemised `missing` list are derived from it, not computed independently,
// so there is exactly one underlying notion of "done" (see "Prefer a single
// canonical completeness calculation" in docs/architecture/annotation-workbench.md).

import { getPhaseFrame } from './phase_frame_mapping.mjs';
import { getPhaseAssessment } from './phase_assessment.mjs';
import { computeAnnotationCompleteness, COMPLETENESS_COMPLETE, COMPLETENESS_NOT_APPLICABLE } from './annotation_completeness.mjs';

/**
 * `phases` is typically buildPhaseViewModels' output for the shot's resolved
 * profile (contact_point included, checked identically to every other
 * phase). `profile` itself is passed only to detect the no-profile case --
 * pass the resolved profile object (or null) alongside its phases.
 */
export function computeShotReadiness(shot, profile, phases) {
  const completeness = computeAnnotationCompleteness(shot, profile, phases);
  if (completeness.phase_annotation_status === COMPLETENESS_NOT_APPLICABLE) {
    return { status: 'no-profile', missing: [] };
  }

  const missing = [];
  for (const phase of phases) {
    const hasFrame = getPhaseFrame(shot, phase.id) !== null;
    const hasQuality = getPhaseAssessment(shot, phase.id).qualityId !== '';
    if (!hasFrame) missing.push(`${phase.label || phase.id} frame`);
    if (!hasQuality) missing.push(`${phase.label || phase.id} quality`);
  }
  if (completeness.coaching_assessment_status !== COMPLETENESS_COMPLETE) {
    missing.push('Overall Quality');
  }

  return { status: missing.length === 0 ? 'ready' : 'incomplete', missing };
}
