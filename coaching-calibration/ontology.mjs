// Coaching Ontology loading and lookup.
//
// The Coaching Ontology is the shared coaching vocabulary. It is treated as part
// of the application rather than something coaches routinely modify. The UI is
// rendered from these files; no coaching terminology is hard-coded.
//
// Ontology files:
//   observations.json       -> { observations: { id: { label, description } } }
//   phases.json             -> { items: { id: { label, description } } }
//   ratings.json            -> { items: { id: { label, description } } }
//   quality_assessments.json-> { items: { id: { label, description } } }

const ONTOLOGY_FILES = {
  observations: './profiles/observations.json',
  phases: './profiles/phases.json',
  ratings: './profiles/ratings.json',
  qualityAssessments: './profiles/quality_assessments.json',
};

function prettifyId(id) {
  if (typeof id !== 'string' || !id.trim()) {
    return '';
  }
  return id
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractItems(raw, key) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const items = raw[key];
  if (!items || typeof items !== 'object') {
    return {};
  }

  const result = {};
  for (const [id, value] of Object.entries(items)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    result[id] = {
      label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : prettifyId(id),
      description: typeof value.description === 'string' ? value.description.trim() : '',
    };
  }
  return result;
}

// Derive a single ontology version from the per-file versions.
//
// - if all present files share the same version, that version is returned
// - if versions differ, a clear combined value is returned and a warning is
//   raised so the mismatch is visible during development
// - if no versions are present, 'unknown' is returned
export function deriveOntologyVersion(fileVersions) {
  const present = (fileVersions || [])
    .map((entry) => (typeof entry?.version === 'string' ? entry.version.trim() : ''))
    .filter(Boolean);

  if (present.length === 0) {
    return 'unknown';
  }

  const unique = [...new Set(present)];
  if (unique.length === 1) {
    return unique[0];
  }

  console.warn('[ontology] version mismatch across ontology files:', fileVersions);
  return `mixed:${unique.slice().sort().join('+')}`;
}

// Normalize the four raw ontology payloads into a single lookup structure.
export function normalizeOntology({ observations, phases, ratings, qualityAssessments } = {}) {
  const fileVersions = [
    { file: 'observations', version: observations && observations.ontology_version },
    { file: 'phases', version: phases && phases.phases_version },
    { file: 'ratings', version: ratings && ratings.ratings_version },
    { file: 'quality_assessments', version: qualityAssessments && qualityAssessments.quality_assessments_version },
  ];

  return {
    observations: extractItems(observations, 'observations'),
    phases: extractItems(phases, 'items'),
    ratings: extractItems(ratings, 'items'),
    qualityAssessments: extractItems(qualityAssessments, 'items'),
    version: deriveOntologyVersion(fileVersions),
    fileVersions,
  };
}

function lookupMeta(collection, id) {
  if (collection && typeof collection === 'object' && collection[id]) {
    return collection[id];
  }
  return { label: prettifyId(id) || String(id ?? ''), description: '' };
}

export function getObservationMeta(ontology, id) {
  return lookupMeta(ontology && ontology.observations, id);
}

export function getPhaseMeta(ontology, id) {
  return lookupMeta(ontology && ontology.phases, id);
}

export function getRatingMeta(ontology, id) {
  return lookupMeta(ontology && ontology.ratings, id);
}

export function getQualityMeta(ontology, id) {
  return lookupMeta(ontology && ontology.qualityAssessments, id);
}

export function getOntologyVersion(ontology) {
  return ontology && typeof ontology.version === 'string' ? ontology.version : 'unknown';
}

export function resolveOntologyFileUrls() {
  return {
    observations: new URL(ONTOLOGY_FILES.observations, import.meta.url).toString(),
    phases: new URL(ONTOLOGY_FILES.phases, import.meta.url).toString(),
    ratings: new URL(ONTOLOGY_FILES.ratings, import.meta.url).toString(),
    qualityAssessments: new URL(ONTOLOGY_FILES.qualityAssessments, import.meta.url).toString(),
  };
}

async function loadJson(fetchOrLoadJson, resourceUrl) {
  const result = await fetchOrLoadJson(resourceUrl);
  if (result && typeof result.json === 'function') {
    return result.json();
  }
  return result;
}

// Load and normalize the ontology using the provided fetch implementation.
export async function loadOntology(fetchImpl = fetch) {
  const urls = resolveOntologyFileUrls();
  const [observations, phases, ratings, qualityAssessments] = await Promise.all([
    loadJson(fetchImpl, urls.observations),
    loadJson(fetchImpl, urls.phases),
    loadJson(fetchImpl, urls.ratings),
    loadJson(fetchImpl, urls.qualityAssessments),
  ]);
  return normalizeOntology({ observations, phases, ratings, qualityAssessments });
}
