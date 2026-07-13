// Pure shot-list state transitions for the Annotation Workbench.
//
// A "shot" here is exactly one canonical annotation CSV row (see
// annotation_csv.mjs) -- there is no separate shot object distinct from its
// row representation. Every function is pure (returns new objects/arrays,
// never mutates its arguments), directly implementing the lifecycle table
// from docs/architecture/contact-point-annotation-csv.md.

/**
 * The frame a shot is currently understood to be at: the coach-confirmed
 * Contact Point frame if one has genuinely been captured, otherwise the
 * automated estimate, otherwise (for a shot with neither -- e.g. a
 * freshly-created manual shot with nothing captured yet) its own
 * `reference_frame` if one has been attached. `reference_frame` is a
 * navigation-only convenience -- typically the frame a manual shot was
 * created at (see app.js's handleAddShot) -- never itself a phase
 * annotation, and never part of the canonical CSV schema (see
 * annotation_csv.mjs's CANONICAL_ANNOTATION_CSV_FIELDNAMES, which does not
 * include it -- same non-canonical, in-memory-only treatment as `saved`).
 * Used for sorting/display/seeking/duplicate-frame checks, never to imply
 * Contact Point itself has been reviewed.
 */
export function effectiveContactFrame(shot) {
  if (shot.reviewed_contact_frame !== null && shot.reviewed_contact_frame !== undefined) {
    return shot.reviewed_contact_frame;
  }
  if (shot.automated_contact_frame !== null && shot.automated_contact_frame !== undefined) {
    return shot.automated_contact_frame;
  }
  if (shot.reference_frame !== null && shot.reference_frame !== undefined) {
    return shot.reference_frame;
  }
  return null;
}

/**
 * Create a new manually-added shot at `frame`. Represents the
 * "manually_added" lifecycle state directly: no automated estimate ever
 * existed, so automated_contact_frame stays blank. Every phase frame column
 * -- including `reviewed_contact_frame` (Contact Point's) -- starts
 * genuinely blank: creating a shot at a frame is not the same as reviewing
 * or capturing any phase there, and must never be treated as though it
 * were. The creation frame is only ever attached separately, as a
 * navigation aid (see effectiveContactFrame above and app.js's
 * handleAddShot, which sets `reference_frame` on the built shot the same
 * way it already does for `shot_class`/`saved` -- a non-canonical,
 * in-memory-only override, not a createManualShot parameter).
 *
 * `defaultShotType` optionally pre-fills shot_type for a homogeneous drill
 * (a session-level convenience only -- see the "default shot type for new
 * shots" control in app.js); shot_class/shot_variant are never pre-filled,
 * and every shot keeps its own independent classification once created, so
 * mixed-shot sessions stay possible.
 */
export function createManualShot({ frame, shots, runMetadata, defaultShotType = '' }) {
  const shotId = nextShotId(shots);
  return {
    schema_version: runMetadata.schema_version,
    tool_version: runMetadata.tool_version,
    session_id: runMetadata.session_id,
    created_at: runMetadata.created_at,
    video_id: runMetadata.video_id,
    video_filename: runMetadata.video_filename,
    frame_rate_fps: runMetadata.frame_rate_fps,
    video_metadata_provider: runMetadata.video_metadata_provider,
    shot_id: shotId,
    shot_index: shots.length + 1,
    shot_class: '',
    shot_type: defaultShotType,
    shot_variant: '',
    source: 'manual',
    automated_contact_frame: null,
    confidence: null,
    contributing_providers: [],
    reviewed_contact_frame: null,
    review_recommended: false,
    review_flags: [],
    review_status: 'manually_added',
    preparation_frame: null,
    backswing_frame: null,
    acceleration_frame: null,
    follow_through_frame: null,
    recovery_frame: null,
    phase_assessments: '',
    overall_quality_id: '',
    notes: '',
    annotator: '',
    // Not a canonical CSV column (see CANONICAL_ANNOTATION_CSV_FIELDNAMES) --
    // a navigation-only convenience for effectiveContactFrame, same
    // in-memory-only treatment as `saved`. Lets a still-empty shot be found
    // and reopened by its creation frame without pretending any phase,
    // Contact Point included, has actually been captured there.
    reference_frame: frame,
  };
}

/**
 * Coach rejects the automated estimate outright: "the detector found
 * something, but the coach rejected it." automated_contact_frame is
 * preserved (never discarded); no reviewed frame is introduced. This is what
 * distinguishes `rejected` from `manually_added`, where no automated
 * estimate ever existed.
 */
export function rejectShot(shot) {
  return {
    ...shot,
    reviewed_contact_frame: null,
    review_status: 'rejected',
  };
}

/** Only manually-added shots may be deleted -- an automated-origin shot a coach wants gone is rejected, not deleted, so the estimate is never lost. */
export function canDeleteShot(shot) {
  return shot.source === 'manual';
}

/**
 * Remove a shot by id. Throws if the shot doesn't exist or isn't deletable
 * (source !== 'manual') rather than silently no-op'ing, since a delete
 * request that can't be honoured is something the UI must surface, not swallow.
 */
export function deleteShot(shots, shotId) {
  const shot = shots.find((candidate) => candidate.shot_id === shotId);
  if (!shot) {
    throw new Error(`deleteShot: no shot with shot_id=${shotId}.`);
  }
  if (!canDeleteShot(shot)) {
    throw new Error(`deleteShot: shot_id=${shotId} has source=${shot.source}; only manually-added shots (source='manual') can be deleted -- reject it instead to discard an automated estimate without losing it.`);
  }
  return shots.filter((candidate) => candidate.shot_id !== shotId);
}

/**
 * Recompute shot_index as 1-based chronological rank by effectiveContactFrame
 * after any add/delete. shot_id stays stable once assigned (never renumbered)
 * -- only the ordering/index changes. Returns a new array sorted the same way.
 */
export function renumberShotIndices(shots) {
  const sorted = [...shots].sort((a, b) => {
    const frameA = effectiveContactFrame(a);
    const frameB = effectiveContactFrame(b);
    if (frameA === null && frameB === null) return 0;
    if (frameA === null) return 1;
    if (frameB === null) return -1;
    return frameA - frameB;
  });
  return sorted.map((shot, index) => ({ ...shot, shot_index: index + 1 }));
}

/** Next available shot_id (`S{max existing numeric suffix + 1}`, zero-padded to 3 digits), matching the Python ShotEvent.shot_id convention. */
export function nextShotId(shots) {
  const maxNumber = shots.reduce((max, shot) => {
    const match = /^S(\d+)$/.exec(shot.shot_id || '');
    if (!match) return max;
    return Math.max(max, Number.parseInt(match[1], 10));
  }, 0);
  const nextNumber = maxNumber + 1;
  return `S${String(nextNumber).padStart(3, '0')}`;
}

/**
 * Prevents two shots claiming the same effective contact frame -- a
 * shot-scoped analogue of the old duplicate_frame.mjs's per-video-frame
 * uniqueness, but at shot granularity rather than phase granularity. Returns
 * the conflicting shot, or null if `frame` is free.
 */
export function findDuplicateContactFrame(shots, frame, excludeShotId = null) {
  return shots.find((shot) => shot.shot_id !== excludeShotId && effectiveContactFrame(shot) === frame) ?? null;
}
