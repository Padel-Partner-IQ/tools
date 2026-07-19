// Canonical annotation-completeness calculation for the Annotation Workbench.
//
// This is the single source of truth for the three v2 completeness
// dimensions (see annotation_csv.mjs's "Schema evolution: v1 -> v2"):
// contact-annotation presence, profile-phase completeness, and coaching-
// assessment completeness. app.js's Shot Detail display, Save Shot, and
// Export all call this module rather than each computing their own notion
// of "done" -- so there is exactly one calculation, never parallel
// implementations that could silently disagree.
//
// Unlike the Python backend (app.contact_point.annotation_csv), this module
// has full access to coaching-profile resolution (profile_resolution.mjs,
// phase_frame_mapping.mjs, phase_assessment.mjs) -- so, unlike Python's
// necessarily-conservative migration defaults, the values computed here are
// always precise, not placeholders.
//
// Completeness here describes the *annotation record itself* -- never a
// judgement of the underlying stroke's technical quality, and never
// conflated with contact-point review provenance (review_status,
// automated_contact_frame vs reviewed_contact_frame) -- see
// docs/architecture/contact-point-annotation-csv.md.

import { getPhaseFrame } from './phase_frame_mapping.mjs';
import { getPhaseAssessment, isPhaseCaptured } from './phase_assessment.mjs';

export const CONTACT_ANNOTATION_STATUS_PRESENT = 'present';
export const CONTACT_ANNOTATION_STATUS_ABSENT = 'absent';

export const COMPLETENESS_NOT_APPLICABLE = 'not_applicable';
export const COMPLETENESS_INCOMPLETE = 'incomplete';
export const COMPLETENESS_COMPLETE = 'complete';

/** Whether reviewed_contact_frame has actually been captured -- profile-independent. */
export function computeContactAnnotationStatus(shot) {
  return shot.reviewed_contact_frame !== null && shot.reviewed_contact_frame !== undefined
    ? CONTACT_ANNOTATION_STATUS_PRESENT
    : CONTACT_ANNOTATION_STATUS_ABSENT;
}

/**
 * Whether every phase the shot's resolved coaching profile configures has
 * been captured (frame + quality) -- `not_applicable` when no profile
 * resolves at all (an honest state, not an error; see profile_resolution.mjs).
 * `phases` is the resolved profile's own phase view models (typically
 * `buildPhaseViewModels(profile, ontology)`'s output) -- pass the same pair
 * `resolveActiveProfileAndPhases` already derives together in app.js.
 */
export function computePhaseAnnotationStatus(shot, profile, phases) {
  if (!profile) return COMPLETENESS_NOT_APPLICABLE;
  const allCaptured = phases.every((phase) => isPhaseCaptured(shot, phase.id));
  return allCaptured ? COMPLETENESS_COMPLETE : COMPLETENESS_INCOMPLETE;
}

/**
 * Whether Overall Quality has been set -- `not_applicable` when no profile
 * resolves (Overall Quality's own options are profile-driven, see
 * buildQualityOptions in profile_state.mjs).
 */
export function computeCoachingAssessmentStatus(shot, profile) {
  if (!profile) return COMPLETENESS_NOT_APPLICABLE;
  return shot.overall_quality_id ? COMPLETENESS_COMPLETE : COMPLETENESS_INCOMPLETE;
}

/**
 * The full v2 completeness record for one shot -- the exact shape written
 * onto the canonical CSV row's own hitter_id-adjacent columns. Call this
 * fresh any time a shot's data or resolved profile could have changed
 * (mutateSelectedShot, CSV import, export) so a stale value can never
 * silently survive an edit -- see the annotation_csv.mjs schema-evolution
 * docstring's "Completeness must be calculated deterministically" rule.
 */
export function computeAnnotationCompleteness(shot, profile, phases) {
  return {
    contact_annotation_status: computeContactAnnotationStatus(shot),
    phase_annotation_status: computePhaseAnnotationStatus(shot, profile, phases),
    coaching_assessment_status: computeCoachingAssessmentStatus(shot, profile),
  };
}

/**
 * A short, coach-facing summary line combining all three dimensions --
 * always renderable regardless of whether a profile resolves, so
 * completeness stays visible and honest for every shot without gating
 * anything (see docs/architecture/annotation-workbench.md#save-shot-semantics).
 */
export function describeAnnotationCompleteness(completeness, { missingPhaseItems = [] } = {}) {
  const contactText = completeness.contact_annotation_status === CONTACT_ANNOTATION_STATUS_PRESENT ? 'captured' : 'not captured';
  const phaseText = describeCompletenessDimension(completeness.phase_annotation_status, missingPhaseItems);
  const coachingText = describeCompletenessDimension(completeness.coaching_assessment_status);
  return `Contact: ${contactText}. Phases: ${phaseText}. Coaching assessment: ${coachingText}.`;
}

function describeCompletenessDimension(status, missingItems = []) {
  if (status === COMPLETENESS_NOT_APPLICABLE) return 'not applicable (no coaching profile)';
  if (status === COMPLETENESS_COMPLETE) return 'complete';
  return missingItems.length > 0 ? `incomplete (missing ${missingItems.join(', ')})` : 'incomplete';
}
