// Phase-id <-> canonical CSV column mapping for the Annotation Workbench's
// phase editor. This is the single place Contact Point's one genuine
// difference from the other four phases lives: it shares reviewed_contact_frame
// with the automated-detection review lifecycle (accept/correct/reject) and
// has a review_status side effect the other phases don't. Encoding that here,
// as data plus one small pure function, means app.js's Capture/Clear handlers
// can call getPhaseFrame/setPhaseFrame identically for every phase with no
// `if (phaseId === 'contact_point')` branch anywhere above this module.
//
// See docs/architecture/contact-point-annotation-csv.md's migration table for
// the mapping's origin, and its Lifecycle section for the relaxed
// manually_added rule setPhaseFrame relies on.

export const PHASE_FRAME_COLUMNS = {
  ready_position: 'preparation_frame',
  max_take_back: 'backswing_frame',
  contact_point: 'reviewed_contact_frame',
  max_follow_through: 'follow_through_frame',
  recovery_position: 'recovery_frame',
};

/** The phase's currently captured frame, or null if unmapped/uncaptured. */
export function getPhaseFrame(shot, phaseId) {
  const column = PHASE_FRAME_COLUMNS[phaseId];
  if (!column) return null;
  const value = shot[column];
  return value === undefined ? null : value;
}

/**
 * Writes `frame` for `phaseId`. For every phase but contact_point this is
 * just `{ ...shot, [column]: frame }`. For contact_point it additionally
 * derives review_status, purely from the shot's own data (never from which
 * button the caller is implementing):
 *
 *   shot.source === 'manual'     -> review_status stays 'manually_added',
 *     whether frame is null or populated -- a manually-created shot never
 *     had an automated estimate to be 'corrected' from or 'accepted'
 *     against, and clearing its Contact Point is a valid, unremarkable
 *     state (see the relaxed lifecycle rule in the architecture doc).
 *   shot.source === 'automated':
 *     frame === null                          -> 'unreviewed'
 *     frame === shot.automated_contact_frame   -> 'accepted' (true whenever
 *       the captured frame happens to match the detector, regardless of
 *       whether it came from the Accept shortcut or a manual Capture that
 *       landed on the same frame)
 *     frame is anything else                   -> 'corrected'
 *
 * automated_contact_frame/confidence/contributing_providers are never
 * touched here, for either source -- they stay inspection-only evidence.
 */
export function setPhaseFrame(shot, phaseId, frame) {
  const column = PHASE_FRAME_COLUMNS[phaseId];
  if (!column) return shot;

  if (column !== 'reviewed_contact_frame') {
    return { ...shot, [column]: frame };
  }

  if (shot.source === 'manual') {
    return { ...shot, reviewed_contact_frame: frame, review_status: 'manually_added' };
  }

  let reviewStatus;
  if (frame === null || frame === undefined) {
    reviewStatus = 'unreviewed';
  } else if (frame === shot.automated_contact_frame) {
    reviewStatus = 'accepted';
  } else {
    reviewStatus = 'corrected';
  }
  return { ...shot, reviewed_contact_frame: frame, review_status: reviewStatus };
}
