// Canonical multi-shot annotation CSV: schema, writer, parser, and validator.
//
// A JS mirror of the Python implementation
// (platform/src/backend/app/contact_point/annotation_csv.py), which remains
// the authoritative source of truth for this contract -- the Tauri frontend
// has no Python runtime, so the schema/parse/validate/build logic here is
// reimplemented, not shared at runtime. Parity between the two
// implementations is protected by tests that compare both against a shared,
// language-neutral descriptor (platform/schemas/contact_point_annotation_csv.schema.json)
// and by committed cross-language round-trip fixtures -- see
// tests/annotation_csv_parity.test.mjs. See
// docs/architecture/contact-point-annotation-csv.md for the full schema
// design, lifecycle, and rationale.
//
// Three responsibilities are kept deliberately separate, mirroring the
// Python module, so callers can compose them independently (parse without
// validating, or validate rows built in memory without ever going through
// CSV text):
//
// - buildCanonicalRow -- construct a row from a detected/edited shot.
// - parseAnnotationCsv -- parse CSV text into typed rows.
// - validateAnnotationRows -- check parsed rows for problems.

export const CANONICAL_SCHEMA_VERSION = '2';
// An array, not a single value: adding a future "3" is a one-line change here
// plus a new entry in SCHEMA_VERSION_READERS, without touching this version's
// logic. Mirrors the Python SUPPORTED_SCHEMA_VERSIONS set.
export const SUPPORTED_SCHEMA_VERSIONS = ['1', '2'];

export const ANNOTATION_TOOL_VERSION = 'annotation_workbench/1.0';

export const VALID_REVIEW_STATUSES = ['unreviewed', 'accepted', 'corrected', 'rejected', 'manually_added'];
export const VALID_SOURCES = ['automated', 'manual'];
// "ffprobe": authoritative, desktop-derived. "mp4box": a best-effort browser-side
// average, deliberately not authoritative (see docs/architecture/contact-point-annotation-csv.md).
// "manual": reserved for a possible future manual-entry workflow, not produced by
// anything today. "unknown": legacy/imported rows where provenance genuinely isn't
// known -- not a default to fall back to casually.
export const VALID_VIDEO_METADATA_PROVIDERS = ['ffprobe', 'mp4box', 'manual', 'unknown'];

// v2: whether reviewed_contact_frame has actually been captured. See
// "Schema evolution: v1 -> v2" below.
export const CONTACT_ANNOTATION_STATUS_PRESENT = 'present';
export const CONTACT_ANNOTATION_STATUS_ABSENT = 'absent';
export const VALID_CONTACT_ANNOTATION_STATUSES = [CONTACT_ANNOTATION_STATUS_PRESENT, CONTACT_ANNOTATION_STATUS_ABSENT];

// v2: shared three-state vocabulary for phase_annotation_status/coaching_assessment_status.
export const COMPLETENESS_NOT_APPLICABLE = 'not_applicable';
export const COMPLETENESS_INCOMPLETE = 'incomplete';
export const COMPLETENESS_COMPLETE = 'complete';
export const VALID_COMPLETENESS_STATUSES = [COMPLETENESS_NOT_APPLICABLE, COMPLETENESS_INCOMPLETE, COMPLETENESS_COMPLETE];

/**
 * Schema evolution: v1 -> v2 (mirrors annotation_csv.py exactly -- see that
 * module's docstring for the full rationale).
 *
 * v2 adds four columns, appended after the full v1 shape:
 *
 * - `hitter_id` -- an open, coach-entered stable human annotation label
 *   (e.g. "player_1", "player_2"), blank when unknown/unassigned. Never
 *   derived from a runtime tracking/player id -- those are transient,
 *   per-run track identities; a coach's hitter_id is a stable annotation
 *   label that must not be conflated with, or auto-populated from, one.
 * - `contact_annotation_status` ("present"/"absent") -- derived from
 *   `reviewed_contact_frame`.
 * - `phase_annotation_status` ("not_applicable"/"incomplete"/"complete") --
 *   whether every phase the shot's resolved coaching profile configures has
 *   been captured. The Annotation Workbench (this app) is the canonical,
 *   single calculation for this value (see annotation_completeness.mjs) --
 *   it has full access to profile resolution, unlike the Python backend.
 * - `coaching_assessment_status` ("not_applicable"/"incomplete"/"complete")
 *   -- whether Overall Quality has been set.
 *
 * None of these four is a technical judgement of the underlying stroke --
 * they describe the annotation record's own completeness, kept distinct
 * from contact-point review provenance (review_status,
 * automated_contact_frame vs reviewed_contact_frame, review_recommended/
 * review_flags): migrated or freshly-built completeness metadata must never
 * imply an automated contact was human-approved.
 */

export const CANONICAL_ANNOTATION_CSV_FIELDNAMES = [
  'schema_version',
  'tool_version',
  'session_id',
  'created_at',
  'video_id',
  'video_filename',
  'frame_rate_fps',
  'video_metadata_provider',
  'shot_id',
  'shot_index',
  'shot_class',
  'shot_type',
  'shot_variant',
  'source',
  'automated_contact_frame',
  'confidence',
  'contributing_providers',
  'reviewed_contact_frame',
  'review_recommended',
  'review_flags',
  'review_status',
  'preparation_frame',
  'backswing_frame',
  'acceleration_frame',
  'follow_through_frame',
  'recovery_frame',
  'phase_assessments',
  'overall_quality_id',
  'notes',
  'annotator',
  // v2 additions -- appended after the full v1 shape so every existing
  // column keeps its position. See "Schema evolution: v1 -> v2" above.
  'hitter_id',
  'contact_annotation_status',
  'phase_annotation_status',
  'coaching_assessment_status',
];

const FRAME_COLUMNS = [
  'automated_contact_frame',
  'reviewed_contact_frame',
  'preparation_frame',
  'backswing_frame',
  'acceleration_frame',
  'follow_through_frame',
  'recovery_frame',
];
const LIST_COLUMNS = ['contributing_providers', 'review_flags'];

// Columns added after this workbench already had real users and real
// exported files. Absent on read, a row from an older export simply gets
// this column's default value instead of parseAnnotationCsv throwing -- the
// file upgrades to the full canonical shape in memory, transparently, and
// every write always emits all of CANONICAL_ANNOTATION_CSV_FIELDNAMES
// regardless of what was read. Mirrors Python's _OPTIONAL_ON_IMPORT_COLUMNS;
// the general mechanism for future additive columns, not a one-off special
// case for phase_assessments alone -- the v2 columns below reuse it exactly
// the same way (a v1 file's header simply never had them).
const OPTIONAL_ON_IMPORT_COLUMNS = [
  'phase_assessments',
  'hitter_id',
  'contact_annotation_status',
  'phase_annotation_status',
  'coaching_assessment_status',
];
const V2_ONLY_COLUMNS = ['hitter_id', 'contact_annotation_status', 'phase_annotation_status', 'coaching_assessment_status'];

/**
 * Raised when one or more rows fail canonical annotation CSV validation, or
 * when CSV text cannot even be parsed (missing columns, unsupported schema
 * version). Collects every problem found rather than failing on the first
 * one, since a coach or migration tool fixing a file wants the full list at
 * once. Mirrors Python's CanonicalAnnotationValidationError.
 */
export class AnnotationValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'AnnotationValidationError';
    this.errors = [...errors];
  }
}

/** Run-level fields denormalized onto every row of one export. Mirrors Python's AnnotationRunMetadata. */
export function createAnnotationRunMetadata({
  videoId = '',
  videoFilename = '',
  frameRateFps = null,
  videoMetadataProvider = '',
  schemaVersion = CANONICAL_SCHEMA_VERSION,
  toolVersion = ANNOTATION_TOOL_VERSION,
  sessionId = '',
  createdAt = '',
} = {}) {
  return {
    video_id: videoId,
    video_filename: videoFilename,
    frame_rate_fps: frameRateFps,
    video_metadata_provider: videoMetadataProvider,
    schema_version: schemaVersion,
    tool_version: toolVersion,
    session_id: sessionId,
    created_at: createdAt,
  };
}

/** A session id matching the app's own convention (`session-<epoch-ms>`), same as the Python/Workbench convention. */
export function newSessionId() {
  return `session-${Date.now()}`;
}

/**
 * Build one canonical row for a freshly detected/manually created shot.
 * Represents the "unreviewed automated row" lifecycle state by default --
 * reviewed_contact_frame and every coach-editable field are blank,
 * review_status is "unreviewed", source is "automated". Callers building a
 * manually-added shot should override automated_contact_frame (null),
 * reviewed_contact_frame, review_status ("manually_added") and source
 * ("manual") explicitly via `overrides`; see annotation_model.mjs.
 */
export function buildCanonicalRow(shot, { runMetadata, overrides = {} } = {}) {
  const row = {
    schema_version: runMetadata.schema_version,
    tool_version: runMetadata.tool_version,
    session_id: runMetadata.session_id,
    created_at: runMetadata.created_at,
    video_id: runMetadata.video_id,
    video_filename: runMetadata.video_filename,
    frame_rate_fps: runMetadata.frame_rate_fps,
    video_metadata_provider: runMetadata.video_metadata_provider,
    shot_id: shot.shot_id,
    shot_index: shot.shot_index,
    shot_class: '',
    shot_type: '',
    shot_variant: '',
    source: 'automated',
    automated_contact_frame: shot.contact_frame ?? null,
    confidence: shot.confidence ?? null,
    contributing_providers: shot.contributing_providers ? [...shot.contributing_providers] : [],
    reviewed_contact_frame: null,
    review_recommended: shot.review_recommended ?? false,
    review_flags: shot.review_flags ? [...shot.review_flags] : [],
    review_status: 'unreviewed',
    preparation_frame: null,
    backswing_frame: null,
    acceleration_frame: null,
    follow_through_frame: null,
    recovery_frame: null,
    phase_assessments: '',
    overall_quality_id: '',
    notes: '',
    annotator: '',
    // v2: a freshly-detected automated row has no coach-confirmed hitter, no
    // reviewed contact frame, and no classification -- so both
    // profile-dependent dimensions are honestly not_applicable (blank
    // classification can never resolve a coaching profile) and contact
    // annotation is genuinely absent (never fabricated as reviewed).
    hitter_id: '',
    contact_annotation_status: CONTACT_ANNOTATION_STATUS_ABSENT,
    phase_annotation_status: COMPLETENESS_NOT_APPLICABLE,
    coaching_assessment_status: COMPLETENESS_NOT_APPLICABLE,
  };
  return { ...row, ...overrides };
}

function rowToCsvStrings(row) {
  const csvRow = {};
  for (const column of CANONICAL_ANNOTATION_CSV_FIELDNAMES) {
    const value = row[column];
    if (value === null || value === undefined) {
      csvRow[column] = '';
    } else if (LIST_COLUMNS.includes(column)) {
      csvRow[column] = value.join('|');
    } else {
      csvRow[column] = String(value);
    }
  }
  return csvRow;
}

function quoteCsvField(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Serialize already-built canonical rows to CSV text, in deterministic column order. RFC 4180-valid. */
export function buildAnnotationCsvText(rows) {
  const lines = [CANONICAL_ANNOTATION_CSV_FIELDNAMES.map(quoteCsvField).join(',')];
  for (const row of rows) {
    const csvRow = rowToCsvStrings(row);
    lines.push(CANONICAL_ANNOTATION_CSV_FIELDNAMES.map((column) => quoteCsvField(csvRow[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Minimal RFC 4180 CSV parser: quoted fields, escaped "" quotes, commas/newlines inside quotes. */
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, '\n');

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function parseOptionalInt(rawValue) {
  if (!rawValue || !rawValue.trim()) return null;
  return Number.parseInt(rawValue, 10);
}

function parseOptionalFloat(rawValue) {
  if (!rawValue || !rawValue.trim()) return null;
  return Number.parseFloat(rawValue);
}

function parseOptionalBool(rawValue) {
  if (!rawValue || !rawValue.trim()) return null;
  return rawValue.trim().toLowerCase() === 'true';
}

/** Shared parsing for every column that has existed since v1 -- used by both readV1Row and readV2Row so neither independently reimplements the same int/float/bool/list parsing rules. */
function parseBaseV1Columns(rawRow) {
  const parsed = {};
  for (const column of CANONICAL_ANNOTATION_CSV_FIELDNAMES) {
    if (V2_ONLY_COLUMNS.includes(column)) continue;
    const rawValue = rawRow[column] ?? '';
    if (FRAME_COLUMNS.includes(column) || column === 'shot_index') {
      parsed[column] = parseOptionalInt(rawValue);
    } else if (column === 'confidence' || column === 'frame_rate_fps') {
      parsed[column] = parseOptionalFloat(rawValue);
    } else if (column === 'review_recommended') {
      parsed[column] = parseOptionalBool(rawValue);
    } else if (LIST_COLUMNS.includes(column)) {
      parsed[column] = rawValue ? rawValue.split('|') : [];
    } else {
      parsed[column] = rawValue;
    }
  }
  return parsed;
}

/** Fully deterministic from reviewed_contact_frame alone -- see "Schema evolution: v1 -> v2". Used for v1 migration and as v2's own validated default. */
function defaultContactAnnotationStatus(parsedRow) {
  return parsedRow.reviewed_contact_frame !== null && parsedRow.reviewed_contact_frame !== undefined
    ? CONTACT_ANNOTATION_STATUS_PRESENT
    : CONTACT_ANNOTATION_STATUS_ABSENT;
}

function rowHasAnyClassification(parsedRow) {
  return Boolean(parsedRow.shot_class) || Boolean(parsedRow.shot_type);
}

/**
 * Conservative default for a migrated v1 row: blank classification
 * deterministically means no coaching profile could ever resolve
 * (not_applicable); once classified, this function cannot verify phase
 * completeness without a resolved profile, so it defaults to the
 * conservative "incomplete" rather than assuming "complete" without
 * evidence. Superseded the moment app.js recomputes it via the canonical
 * annotation_completeness.mjs, which has real profile access.
 */
function defaultPhaseAnnotationStatus(parsedRow) {
  if (!rowHasAnyClassification(parsedRow)) return COMPLETENESS_NOT_APPLICABLE;
  return COMPLETENESS_INCOMPLETE;
}

/** Unlike phase completeness, this dimension depends only on overall_quality_id (once classified) -- a precise value, not a placeholder. */
function defaultCoachingAssessmentStatus(parsedRow) {
  if (!rowHasAnyClassification(parsedRow)) return COMPLETENESS_NOT_APPLICABLE;
  return parsedRow.overall_quality_id ? COMPLETENESS_COMPLETE : COMPLETENESS_INCOMPLETE;
}

/**
 * Parse a v1 row and migrate it to the current v2 in-memory shape. Every v1
 * field is preserved exactly; the four v2 columns are derived
 * deterministically from data already on the row -- never fabricated -- and
 * the returned row's own schema_version becomes "2", since the row is now
 * genuinely v2-shaped in memory with real values in every v2 field.
 */
function readV1Row(rawRow) {
  const parsed = parseBaseV1Columns(rawRow);
  parsed.hitter_id = '';
  parsed.contact_annotation_status = defaultContactAnnotationStatus(parsed);
  parsed.phase_annotation_status = defaultPhaseAnnotationStatus(parsed);
  parsed.coaching_assessment_status = defaultCoachingAssessmentStatus(parsed);
  parsed.schema_version = '2';
  return parsed;
}

/**
 * Parse a genuine v2 row. Trusts the file's own v2 column values when the
 * column is present in the header at all; falls back to the same
 * deterministic defaults readV1Row uses only if a v2 column is entirely
 * absent from the header (the OPTIONAL_ON_IMPORT_COLUMNS leniency), a
 * defensive case a genuine writer should never produce.
 */
function readV2Row(rawRow) {
  const parsed = parseBaseV1Columns(rawRow);
  parsed.hitter_id = rawRow.hitter_id ?? '';
  parsed.contact_annotation_status = rawRow.contact_annotation_status || defaultContactAnnotationStatus(parsed);
  parsed.phase_annotation_status = rawRow.phase_annotation_status || defaultPhaseAnnotationStatus(parsed);
  parsed.coaching_assessment_status = rawRow.coaching_assessment_status || defaultCoachingAssessmentStatus(parsed);
  parsed.schema_version = rawRow.schema_version ?? CANONICAL_SCHEMA_VERSION;
  return parsed;
}

const SCHEMA_VERSION_READERS = { 1: readV1Row, 2: readV2Row };

/**
 * Parse canonical annotation CSV text into typed rows.
 *
 * Parsing only -- does not validate. An unsupported schema_version still
 * throws immediately, since parsing cannot proceed without knowing which
 * version's column shape to read; every other check (duplicate ids,
 * out-of-range values, lifecycle consistency) is left entirely to
 * validateAnnotationRows, called separately by the caller.
 *
 * Columns in OPTIONAL_ON_IMPORT_COLUMNS (e.g. phase_assessments, added after
 * this workbench had real users, plus every v2 addition) may be absent from
 * an older file without throwing -- each reader's own fallback fills in that
 * column's default for every row, so the file upgrades to the full canonical
 * shape in memory. Any other missing column still throws immediately, since
 * that indicates a genuinely malformed file rather than one predating a
 * later, additive schema change.
 */
export function parseAnnotationCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    throw new AnnotationValidationError(['Empty CSV: no header row found.']);
  }
  const [header, ...dataRows] = rows;
  const requiredColumns = CANONICAL_ANNOTATION_CSV_FIELDNAMES.filter((name) => !OPTIONAL_ON_IMPORT_COLUMNS.includes(name));
  const missingColumns = requiredColumns.filter((name) => !header.includes(name));
  if (missingColumns.length > 0) {
    throw new AnnotationValidationError([`Missing required column(s): ${missingColumns.join(', ')}.`]);
  }

  const rawRows = dataRows.map((values) => {
    const rawRow = {};
    header.forEach((column, index) => {
      rawRow[column] = values[index] ?? '';
    });
    return rawRow;
  });

  const schemaVersions = new Set(rawRows.map((row) => row.schema_version));
  const unsupported = [...schemaVersions].filter((version) => !SUPPORTED_SCHEMA_VERSIONS.includes(version));
  if (unsupported.length > 0) {
    throw new AnnotationValidationError([`Unsupported schema_version(s): ${unsupported.sort().join(', ')}.`]);
  }

  // Dispatched per row (not once for the whole file): each row's own
  // schema_version selects its reader. In practice every row of one export
  // shares the same schema_version (it is run-level metadata denormalized
  // onto every row), but nothing here assumes that.
  return rawRows.map((rawRow) => (SCHEMA_VERSION_READERS[rawRow.schema_version] ?? readV1Row)(rawRow));
}

/**
 * Validate already-parsed canonical rows, throwing AnnotationValidationError
 * with every problem found. No silent coercion: a malformed value is always
 * reported, never quietly defaulted. File-level checks (schema_version
 * consistency, duplicate ids) run once; row-level checks run independently
 * per row. Mirrors Python's validate_canonical_annotation_csv exactly.
 */
export function validateAnnotationRows(rows) {
  const errors = [];

  const schemaVersions = new Set(rows.map((row) => row.schema_version));
  const unsupported = [...schemaVersions].filter((version) => !SUPPORTED_SCHEMA_VERSIONS.includes(version));
  if (unsupported.length > 0) {
    errors.push(`Unsupported schema_version(s): ${unsupported.sort().join(', ')}.`);
  }

  const shotIds = rows.map((row) => row.shot_id);
  const duplicateShotIds = [...new Set(shotIds.filter((value) => value && shotIds.filter((v) => v === value).length > 1))].sort();
  if (duplicateShotIds.length > 0) {
    errors.push(`Duplicate shot_id value(s): ${duplicateShotIds.join(', ')}.`);
  }

  const shotIndices = rows.map((row) => row.shot_index);
  const duplicateShotIndices = [
    ...new Set(shotIndices.filter((value) => value !== null && value !== undefined && shotIndices.filter((v) => v === value).length > 1)),
  ].sort((a, b) => a - b);
  if (duplicateShotIndices.length > 0) {
    errors.push(`Duplicate shot_index value(s): ${duplicateShotIndices.join(', ')}.`);
  }

  rows.forEach((row, index) => {
    errors.push(...validateRow(row, index + 2));
  });

  if (errors.length > 0) {
    throw new AnnotationValidationError(errors);
  }
}

function validateRow(row, rowNumber) {
  const errors = [];
  const shotId = row.shot_id || '?';
  const label = `row ${rowNumber} (shot_id=${shotId})`;

  for (const column of FRAME_COLUMNS) {
    const value = row[column];
    if (value !== null && value !== undefined && (!Number.isInteger(value) || value < 0)) {
      errors.push(`${label}: ${column} must be a non-negative integer or blank (got ${JSON.stringify(value)}).`);
    }
  }

  const frameRateFps = row.frame_rate_fps;
  if (frameRateFps !== null && frameRateFps !== undefined && (typeof frameRateFps !== 'number' || Number.isNaN(frameRateFps) || frameRateFps <= 0)) {
    errors.push(`${label}: frame_rate_fps must be a positive number or blank (got ${JSON.stringify(frameRateFps)}).`);
  }

  const videoMetadataProvider = row.video_metadata_provider;
  if (videoMetadataProvider && !VALID_VIDEO_METADATA_PROVIDERS.includes(videoMetadataProvider)) {
    errors.push(`${label}: video_metadata_provider ${JSON.stringify(videoMetadataProvider)} is not one of ${JSON.stringify([...VALID_VIDEO_METADATA_PROVIDERS].sort())}.`);
  }
  const frameRateKnown = frameRateFps !== null && frameRateFps !== undefined;
  const providerKnown = Boolean(videoMetadataProvider);
  if (frameRateKnown !== providerKnown) {
    errors.push(`${label}: frame_rate_fps and video_metadata_provider must be populated together or both blank (frame_rate_fps=${JSON.stringify(frameRateFps)}, video_metadata_provider=${JSON.stringify(videoMetadataProvider)}).`);
  }

  const confidence = row.confidence;
  if (confidence !== null && confidence !== undefined && (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0.0 || confidence > 1.0)) {
    errors.push(`${label}: confidence must be within [0.0, 1.0] or blank (got ${JSON.stringify(confidence)}).`);
  }

  const reviewStatus = row.review_status;
  if (reviewStatus && !VALID_REVIEW_STATUSES.includes(reviewStatus)) {
    errors.push(`${label}: review_status ${JSON.stringify(reviewStatus)} is not one of ${JSON.stringify([...VALID_REVIEW_STATUSES].sort())}.`);
  }

  const source = row.source;
  if (source && !VALID_SOURCES.includes(source)) {
    errors.push(`${label}: source ${JSON.stringify(source)} is not one of ${JSON.stringify([...VALID_SOURCES].sort())}.`);
  }

  const phaseAssessments = row.phase_assessments;
  if (phaseAssessments) {
    let decoded;
    let parseFailed = false;
    try {
      decoded = JSON.parse(phaseAssessments);
    } catch {
      parseFailed = true;
    }
    if (parseFailed) {
      errors.push(`${label}: phase_assessments must be valid JSON or blank (got ${JSON.stringify(phaseAssessments)}).`);
    } else if (
      typeof decoded !== 'object' ||
      decoded === null ||
      Array.isArray(decoded) ||
      !Object.keys(decoded).every((key) => typeof key === 'string' && key.length > 0)
    ) {
      errors.push(`${label}: phase_assessments must decode to a JSON object keyed by non-empty phase id strings (got ${JSON.stringify(phaseAssessments)}).`);
    }
  }

  errors.push(...validateLifecycle(row, label));
  errors.push(...validateCompleteness(row, label));
  return errors;
}

function validateLifecycle(row, label) {
  const reviewStatus = row.review_status;
  const automatedFrame = row.automated_contact_frame;
  const reviewedFrame = row.reviewed_contact_frame;
  const source = row.source;
  const errors = [];
  const isBlank = (value) => value === null || value === undefined;

  if (reviewStatus === 'unreviewed') {
    if (isBlank(automatedFrame)) {
      errors.push(`${label}: review_status='unreviewed' requires automated_contact_frame to be populated.`);
    }
    if (!isBlank(reviewedFrame)) {
      errors.push(`${label}: review_status='unreviewed' requires reviewed_contact_frame to be blank.`);
    }
  } else if (reviewStatus === 'accepted') {
    if (isBlank(automatedFrame) || isBlank(reviewedFrame)) {
      errors.push(`${label}: review_status='accepted' requires both automated_contact_frame and reviewed_contact_frame to be populated.`);
    } else if (reviewedFrame !== automatedFrame) {
      errors.push(`${label}: review_status='accepted' requires reviewed_contact_frame == automated_contact_frame (got ${reviewedFrame} != ${automatedFrame}).`);
    }
  } else if (reviewStatus === 'corrected') {
    if (isBlank(automatedFrame) || isBlank(reviewedFrame)) {
      errors.push(`${label}: review_status='corrected' requires both automated_contact_frame and reviewed_contact_frame to be populated.`);
    }
  } else if (reviewStatus === 'manually_added') {
    // No "reviewed_contact_frame must be populated" requirement here,
    // deliberately: the phase editor treats Contact Point as a normal phase
    // a coach can Capture and Clear like any other, and clearing it on a
    // manually-created shot (no automated estimate to fall back to) must
    // remain a valid state -- it just means this shot's Contact Point
    // hasn't been (re-)captured yet, exactly like any other phase.
    if (!isBlank(automatedFrame)) {
      errors.push(`${label}: review_status='manually_added' requires automated_contact_frame to be blank.`);
    }
    if (source !== 'manual') {
      errors.push(`${label}: review_status='manually_added' requires source='manual' (got ${JSON.stringify(source)}).`);
    }
  } else if (reviewStatus === 'rejected') {
    if (isBlank(automatedFrame)) {
      errors.push(`${label}: review_status='rejected' requires automated_contact_frame to be populated.`);
    }
    if (!isBlank(reviewedFrame)) {
      errors.push(`${label}: review_status='rejected' requires reviewed_contact_frame to be blank.`);
    }
    if (source !== 'automated') {
      errors.push(`${label}: review_status='rejected' requires source='automated' (got ${JSON.stringify(source)}).`);
    }
  }

  return errors;
}

/**
 * v2 completeness metadata: type/enum-check all three dimensions, and
 * cross-check the two this module has enough information to fully verify
 * against the row's own other data -- so a stale value left over from a
 * prior edit (rather than recomputed) is always caught here, not silently
 * trusted. Mirrors Python's _validate_completeness exactly. See
 * "Schema evolution: v1 -> v2" above for why phase_annotation_status's
 * complete/incomplete distinction (and the "not_applicable" case for both
 * profile-dependent dimensions) cannot be fully re-derived here -- only enum
 * membership is checked for those.
 */
function validateCompleteness(row, label) {
  const errors = [];

  const contactStatus = row.contact_annotation_status;
  if (contactStatus && !VALID_CONTACT_ANNOTATION_STATUSES.includes(contactStatus)) {
    errors.push(`${label}: contact_annotation_status ${JSON.stringify(contactStatus)} is not one of ${JSON.stringify([...VALID_CONTACT_ANNOTATION_STATUSES].sort())}.`);
  } else if (contactStatus) {
    const expected = defaultContactAnnotationStatus(row);
    if (contactStatus !== expected) {
      errors.push(
        `${label}: contact_annotation_status=${JSON.stringify(contactStatus)} does not match reviewed_contact_frame `
        + `(expected ${JSON.stringify(expected)} from reviewed_contact_frame=${JSON.stringify(row.reviewed_contact_frame)}); `
        + 'this field must be regenerated from the shot\'s own data, never left stale after an edit.',
      );
    }
  }

  const phaseStatus = row.phase_annotation_status;
  if (phaseStatus && !VALID_COMPLETENESS_STATUSES.includes(phaseStatus)) {
    errors.push(`${label}: phase_annotation_status ${JSON.stringify(phaseStatus)} is not one of ${JSON.stringify([...VALID_COMPLETENESS_STATUSES].sort())}.`);
  }

  const coachingStatus = row.coaching_assessment_status;
  if (coachingStatus && !VALID_COMPLETENESS_STATUSES.includes(coachingStatus)) {
    errors.push(`${label}: coaching_assessment_status ${JSON.stringify(coachingStatus)} is not one of ${JSON.stringify([...VALID_COMPLETENESS_STATUSES].sort())}.`);
  } else if (coachingStatus && coachingStatus !== COMPLETENESS_NOT_APPLICABLE) {
    // not_applicable depends on profile resolution this module cannot
    // perform -- only complete/incomplete's dependency on overall_quality_id
    // is verified here.
    const expected = row.overall_quality_id ? COMPLETENESS_COMPLETE : COMPLETENESS_INCOMPLETE;
    if (coachingStatus !== expected) {
      errors.push(
        `${label}: coaching_assessment_status=${JSON.stringify(coachingStatus)} does not match overall_quality_id `
        + `(expected ${JSON.stringify(expected)} from overall_quality_id=${JSON.stringify(row.overall_quality_id)}); `
        + 'this field must be regenerated from the shot\'s own data, never left stale after an edit.',
      );
    }
  }

  return errors;
}
