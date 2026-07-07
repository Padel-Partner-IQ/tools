export const TOOL_VERSION = '0.2.0';
export const SCHEMA_VERSION = '3.0';

export function createSessionMetadata() {
  return {
    session_id: `session-${Date.now()}`,
    created_at: new Date().toISOString(),
    tool_version: TOOL_VERSION,
    schema_version: SCHEMA_VERSION,
  };
}

export function getProfileId(config = {}) {
  if (typeof config.profile_id === 'string' && config.profile_id.trim()) {
    return config.profile_id.trim();
  }
  if (typeof config.profile_name === 'string' && config.profile_name.trim()) {
    return config.profile_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  return 'default_profile';
}

// Resolve the ontology version to export. The loaded ontology is the primary
// source; the profile's declared ontology_version is a fallback so a genuine
// version is exported even if the ontology lookup is unavailable. 'unknown' is
// only returned when neither source provides a real version.
export function resolveOntologyVersion(ontologyVersion, profileOntologyVersion) {
  const isReal = (value) => typeof value === 'string' && value.trim().length > 0 && value.trim() !== 'unknown';
  if (isReal(ontologyVersion)) {
    return ontologyVersion.trim();
  }
  if (isReal(profileOntologyVersion)) {
    return profileOntologyVersion.trim();
  }
  return 'unknown';
}

// Normalize a free-text field for CSV output. Empty, null, undefined and NaN
// values export as empty fields rather than the strings 'NaN'/'null'/'undefined'.
function normalizeExportText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    return '';
  }
  const text = String(value);
  if (text === 'NaN' || text === 'null' || text === 'undefined') {
    return '';
  }
  return text;
}

// Export schema v3.0.
//
// Provenance block: schema_version, tool_version, ontology_version, profile_id,
// profile_version, shot_type, session_id, created_at.
//
// Record block: video_id, video_filename, frame, timestamp_seconds, phase_id,
// phase_label.
//
// Assessment block: overall_quality_id, overall_notes, phase_quality_id, notes,
// annotator, structured_observations.
//
// Quality assessments are exported as stable ontology IDs (e.g. 'excellent',
// 'good', 'needs_work'), not display labels.
export function buildCsvHeaders() {
  return [
    'schema_version',
    'tool_version',
    'ontology_version',
    'profile_id',
    'profile_version',
    'shot_type',
    'session_id',
    'created_at',
    'video_id',
    'video_filename',
    'frame',
    'timestamp_seconds',
    'phase_id',
    'phase_label',
    'overall_quality_id',
    'overall_notes',
    'phase_quality_id',
    'notes',
    'annotator',
    'structured_observations',
  ];
}

function serializeStructuredObservations(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return '{}';
  }

  const filteredEntries = Object.entries(value).filter(([, observationValue]) => observationValue && observationValue !== 'not_assessed');
  return JSON.stringify(Object.fromEntries(filteredEntries));
}

export function buildExportRows(entries, metadata) {
  return entries.map((entry) => [
    metadata.schema_version,
    metadata.tool_version,
    metadata.ontology_version,
    metadata.profile_id,
    metadata.profile_version,
    metadata.shot_type,
    metadata.session_id,
    metadata.created_at,
    entry.video_id,
    entry.video_filename,
    entry.frame,
    entry.timestamp_seconds,
    entry.phase_id,
    entry.phase_label,
    metadata.overall_quality_id || '',
    normalizeExportText(metadata.overall_notes),
    entry.phase_quality || '',
    normalizeExportText(entry.notes),
    entry.annotator,
    serializeStructuredObservations(entry.structured_observations),
  ]);
}
