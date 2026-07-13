// Shot-scoped duplicate-frame protection for the Annotation Workbench's
// phase editor: prevents two phases *within the same shot* from claiming the
// same frame. This is the phase-granularity analogue of
// annotation_model.mjs's findDuplicateContactFrame, which prevents two
// different *shots* from claiming the same frame -- the two checks operate
// at different granularities and are used independently.
//
// Restored from the old Coach Calibration Workbench's duplicate_frame.mjs
// (whole-session, phase-granularity check), adapted to check one shot's
// configured phases instead of a flat session-wide entry list.

import { getPhaseFrame } from './phase_frame_mapping.mjs';
import { isPhaseCaptured } from './phase_assessment.mjs';

/**
 * Checks every phase in `phases` (typically buildPhaseViewModels' output --
 * `[{ id, label, ... }]` -- for the shot's resolved profile, contact_point
 * included with no exclusion) for one already holding `frame`, other than
 * `excludePhaseId` (normally the phase currently being captured, so
 * recapturing the same phase at the same frame is never treated as a
 * conflict with itself). Returns the conflicting phase's `{ id, label }`, or
 * null if `frame` is free within this shot.
 *
 * A phase only counts as a genuine occupant of a frame once it has actually
 * been recorded (isPhaseCaptured: a frame *and* a quality rating) -- a bare
 * frame value with no quality assigned isn't a real conflict source. This
 * matters for Contact Point specifically: createManualShot sets
 * reviewed_contact_frame to the shot's creation frame as a starting point,
 * with no phase_assessments entry, so a fresh manual shot's Contact Point
 * must never block capturing another phase at that same frame before Contact
 * Point has genuinely been assessed.
 */
export function findPhaseFrameOwner(shot, phases, frame, excludePhaseId = null) {
  if (frame === null || frame === undefined) return null;
  for (const phase of phases) {
    if (phase.id === excludePhaseId) continue;
    if (!isPhaseCaptured(shot, phase.id)) continue;
    if (getPhaseFrame(shot, phase.id) === frame) {
      return { id: phase.id, label: phase.label || phase.id };
    }
  }
  return null;
}

/** Human-readable message for a blocked capture, matching the old workflow's wording. */
export function buildFrameInUseErrorMessage(frame, ownerPhaseLabel) {
  return `Frame ${frame} is already used by ${ownerPhaseLabel} -- move to a different frame before capturing this phase here.`;
}
