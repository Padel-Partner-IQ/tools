// Per-shot export readiness for the Annotation Workbench's phase editor.
// Advisory only -- CSV export is session-wide and gated purely on the
// session Annotator (see app.js's updateExportState); this module never
// blocks anything, it only tells a coach what's left on one shot.
//
// Restored/adapted from the old Coach Calibration Workbench's
// validation.mjs's canExportCalibration, narrowed to a single shot and with
// the annotator condition removed (annotator is a session-level export gate
// now, not a per-shot concern -- see docs/architecture/annotation-workbench.md).

import { getPhaseFrame } from './phase_frame_mapping.mjs';
import { getPhaseAssessment } from './phase_assessment.mjs';

/**
 * `phases` is typically buildPhaseViewModels' output for the shot's resolved
 * profile (contact_point included, checked identically to every other
 * phase). `profile` itself is passed only to detect the no-profile case --
 * pass the resolved profile object (or null) alongside its phases.
 */
export function computeShotReadiness(shot, profile, phases) {
  if (!profile) {
    return { status: 'no-profile', missing: [] };
  }

  const missing = [];
  for (const phase of phases) {
    const hasFrame = getPhaseFrame(shot, phase.id) !== null;
    const hasQuality = getPhaseAssessment(shot, phase.id).qualityId !== '';
    if (!hasFrame) missing.push(`${phase.label || phase.id} frame`);
    if (!hasQuality) missing.push(`${phase.label || phase.id} quality`);
  }
  if (!shot.overall_quality_id) {
    missing.push('Overall Quality');
  }

  return { status: missing.length === 0 ? 'ready' : 'incomplete', missing };
}
