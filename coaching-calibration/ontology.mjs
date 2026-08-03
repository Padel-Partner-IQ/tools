// Coaching Ontology loading and lookup.
//
// The Coaching Ontology is the shared coaching vocabulary. It is treated as part
// of the application rather than something coaches routinely modify. The UI is
// rendered from these files; no coaching terminology is hard-coded.
//
// Phase and observation identifiers come from the generated build copy of the
// repository-level forehand observation contract. Ratings remain independent
// Workbench assessment vocabularies.
//   ratings.json            -> { items: { id: { label, description } } }
//   quality_assessments.json-> { items: { id: { label, description } } }

const ONTOLOGY_FILES = {
  contract: './generated/forehand-observation-contract.json',
  observations: './profiles/observations.json',
  phases: './profiles/phases.json',
  ratings: './profiles/ratings.json',
  qualityAssessments: './profiles/quality_assessments.json',
  diagnosticScales: './profiles/diagnostic_scales.json',
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
      diagnosticScaleId: typeof value.diagnostic_scale_id === 'string' ? value.diagnostic_scale_id.trim() : '',
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
export function normalizeOntology({ contract, observations, phases, ratings, qualityAssessments, diagnosticScales } = {}) {
  const contractPhases = contract && contract.phases;
  const contractMetrics = contract && contract.metrics;
  const fileVersions = [
    { file: 'forehand_observation_contract', version: contract && contract.contract_version },
    { file: 'ratings', version: ratings && ratings.ratings_version },
    { file: 'quality_assessments', version: qualityAssessments && qualityAssessments.quality_assessments_version },
    { file: 'diagnostic_scales', version: diagnosticScales && diagnosticScales.diagnostic_scales_version },
  ];

  const groups = {};
  for (const [id, value] of Object.entries(contract?.groups || {})) {
    groups[id] = { label: typeof value?.label === 'string' ? value.label : prettifyId(id) };
  }
  const normalizedScales = {};
  for (const [scaleId, scale] of Object.entries(diagnosticScales?.scales || {})) {
    normalizedScales[scaleId] = Array.isArray(scale?.items)
      ? scale.items
        .filter((item) => item && typeof item.id === 'string' && typeof item.label === 'string')
        .map((item) => ({ id: item.id, label: item.label, qualityId: typeof item.quality_id === 'string' ? item.quality_id : '' }))
      : [];
  }

  return {
    observations: {
      ...extractItems(observations, 'observations'),
      ...(contractMetrics ? extractItems({ observations: contractMetrics }, 'observations') : {}),
    },
    phases: {
      ...extractItems(phases, 'items'),
      ...(contractPhases ? extractItems({ items: contractPhases }, 'items') : {}),
    },
    contractPhaseMetrics: contractPhases
      ? Object.fromEntries(Object.entries(contractPhases).map(([id, definition]) => [id, [...(definition.metrics || [])]]))
      : null,
    contractPhaseGroups: contractPhases
      ? Object.fromEntries(Object.entries(contractPhases).map(([id, definition]) => [id, (definition.observation_groups || []).map((group) => ({ id: group.id, observations: [...(group.metrics || [])] }))]))
      : null,
    ratings: extractItems(ratings, 'items'),
    qualityAssessments: extractItems(qualityAssessments, 'items'),
    groups,
    diagnosticScales: normalizedScales,
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
    contract: new URL(ONTOLOGY_FILES.contract, import.meta.url).toString(),
    observations: new URL(ONTOLOGY_FILES.observations, import.meta.url).toString(),
    phases: new URL(ONTOLOGY_FILES.phases, import.meta.url).toString(),
    ratings: new URL(ONTOLOGY_FILES.ratings, import.meta.url).toString(),
    qualityAssessments: new URL(ONTOLOGY_FILES.qualityAssessments, import.meta.url).toString(),
    diagnosticScales: new URL(ONTOLOGY_FILES.diagnosticScales, import.meta.url).toString(),
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
  const [contract, observations, phases, ratings, qualityAssessments, diagnosticScales] = await Promise.all([
    loadJson(fetchImpl, urls.contract),
    loadJson(fetchImpl, urls.observations),
    loadJson(fetchImpl, urls.phases),
    loadJson(fetchImpl, urls.ratings),
    loadJson(fetchImpl, urls.qualityAssessments),
    loadJson(fetchImpl, urls.diagnosticScales),
  ]);
  return normalizeOntology({ contract, observations, phases, ratings, qualityAssessments, diagnosticScales });
}
