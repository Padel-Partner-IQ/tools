// Shot classification taxonomy loading, normalization and queries.
//
// classification_taxonomy.json defines the coach-facing classification
// vocabulary (shot_class > shot_type > shot_variant) that dropdowns are
// built from. A classification value may be valid even when no coaching
// profile exists for it yet -- see profile_registry.mjs for the separate
// concern of which classifications currently have a profile.
//
// Internally, everything here is keyed on the taxonomy's stable ids
// (lowercase, e.g. "groundstroke"/"forehand"/"drive"). The canonical
// Annotation CSV stores coach-facing labels (e.g. "Groundstroke"/
// "Forehand"/"Drive") in shot_class/shot_type/shot_variant -- see
// classificationIdsForShot/classificationLabelsForIds below for the two
// directions of that conversion.

const TAXONOMY_FILE = './profiles/classification_taxonomy.json';
const SUPPORTED_SCHEMA_VERSIONS = ['1'];

export class TaxonomyValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'TaxonomyValidationError';
    this.errors = [...errors];
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeNode(raw, errors, pathLabel) {
  if (!raw || typeof raw !== 'object') {
    errors.push(`${pathLabel} is not a valid object.`);
    return null;
  }
  const id = isNonEmptyString(raw.id) ? raw.id.trim() : '';
  const label = isNonEmptyString(raw.label) ? raw.label.trim() : '';
  if (!id) errors.push(`${pathLabel} is missing an id.`);
  if (!label) errors.push(`${pathLabel} is missing a label.`);
  return { id, label };
}

/**
 * Validates and normalizes a raw classification_taxonomy.json payload into
 * `{ schemaVersion, taxonomyId, classes: [{ id, label, types: [{ id, label,
 * variants: [{ id, label }] }] }], defaults: { shotClassId, shotTypeId } }`.
 * Throws TaxonomyValidationError with every problem found (not just the
 * first) -- duplicate ids at any level, missing ids/labels, an unsupported
 * schema_version.
 */
export function normalizeTaxonomy(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    throw new TaxonomyValidationError(['Classification taxonomy is not a valid JSON object.']);
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(String(raw.schema_version))) {
    errors.push(`Unsupported classification taxonomy schema_version "${raw.schema_version}" -- supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}.`);
  }

  const seenClassIds = new Set();
  const rawClasses = Array.isArray(raw.classes) ? raw.classes : [];
  const classes = rawClasses.map((rawClass, classIndex) => {
    const classNode = normalizeNode(rawClass, errors, `classes[${classIndex}]`);
    if (!classNode) return null;
    if (seenClassIds.has(classNode.id)) errors.push(`Duplicate shot_class id "${classNode.id}" in classification taxonomy.`);
    seenClassIds.add(classNode.id);

    const seenTypeIds = new Set();
    const rawTypes = Array.isArray(rawClass.types) ? rawClass.types : [];
    const types = rawTypes.map((rawType, typeIndex) => {
      const typeNode = normalizeNode(rawType, errors, `classes[${classIndex}].types[${typeIndex}]`);
      if (!typeNode) return null;
      if (seenTypeIds.has(typeNode.id)) errors.push(`Duplicate shot_type id "${typeNode.id}" under shot_class "${classNode.id}".`);
      seenTypeIds.add(typeNode.id);

      const seenVariantIds = new Set();
      const rawVariants = Array.isArray(rawType.variants) ? rawType.variants : [];
      const variants = rawVariants.map((rawVariant, variantIndex) => {
        const variantNode = normalizeNode(rawVariant, errors, `classes[${classIndex}].types[${typeIndex}].variants[${variantIndex}]`);
        if (!variantNode) return null;
        if (seenVariantIds.has(variantNode.id)) errors.push(`Duplicate shot_variant id "${variantNode.id}" under shot_type "${typeNode.id}".`);
        seenVariantIds.add(variantNode.id);
        return variantNode;
      }).filter(Boolean);

      return { ...typeNode, variants };
    }).filter(Boolean);

    return { ...classNode, types };
  }).filter(Boolean);

  if (errors.length > 0) {
    throw new TaxonomyValidationError(errors);
  }

  const rawDefaults = raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {};
  return {
    schemaVersion: String(raw.schema_version),
    taxonomyId: isNonEmptyString(raw.taxonomy_id) ? raw.taxonomy_id.trim() : '',
    classes,
    defaults: {
      shotClassId: isNonEmptyString(rawDefaults.shot_class_id) ? rawDefaults.shot_class_id.trim() : '',
      shotTypeId: isNonEmptyString(rawDefaults.shot_type_id) ? rawDefaults.shot_type_id.trim() : '',
    },
  };
}

// ---------------------------------------------------------------------------
// Lookups by id
// ---------------------------------------------------------------------------

export function findClassById(taxonomy, classId) {
  if (!taxonomy || !classId) return null;
  return taxonomy.classes.find((entry) => entry.id === classId) ?? null;
}

export function findTypeById(taxonomy, classId, typeId) {
  if (!typeId) return null;
  const classNode = findClassById(taxonomy, classId);
  return classNode?.types.find((entry) => entry.id === typeId) ?? null;
}

export function findVariantById(taxonomy, classId, typeId, variantId) {
  if (!variantId) return null;
  const typeNode = findTypeById(taxonomy, classId, typeId);
  return typeNode?.variants.find((entry) => entry.id === variantId) ?? null;
}

// ---------------------------------------------------------------------------
// Lookups by coach-facing label (case-insensitive, trimmed) -- the direction
// needed to map a shot's stored shot_class/shot_type/shot_variant text back
// to taxonomy ids for profile resolution and dropdown hydration.
// ---------------------------------------------------------------------------

function matchesLabel(node, label) {
  return node.label.trim().toLowerCase() === label.trim().toLowerCase();
}

export function findClassByLabel(taxonomy, label) {
  if (!taxonomy || !isNonEmptyString(label)) return null;
  return taxonomy.classes.find((entry) => matchesLabel(entry, label)) ?? null;
}

export function findTypeByLabel(taxonomy, classId, label) {
  if (!isNonEmptyString(label)) return null;
  const classNode = findClassById(taxonomy, classId);
  return classNode?.types.find((entry) => matchesLabel(entry, label)) ?? null;
}

export function findVariantByLabel(taxonomy, classId, typeId, label) {
  if (!isNonEmptyString(label)) return null;
  const typeNode = findTypeById(taxonomy, classId, typeId);
  return typeNode?.variants.find((entry) => matchesLabel(entry, label)) ?? null;
}

// ---------------------------------------------------------------------------
// UI option lists
// ---------------------------------------------------------------------------

export function getClasses(taxonomy) {
  if (!taxonomy) return [];
  return taxonomy.classes.map(({ id, label }) => ({ id, label }));
}

export function getTypesForClass(taxonomy, classId) {
  const classNode = findClassById(taxonomy, classId);
  return classNode ? classNode.types.map(({ id, label }) => ({ id, label })) : [];
}

export function getVariantsForType(taxonomy, classId, typeId) {
  const typeNode = findTypeById(taxonomy, classId, typeId);
  return typeNode ? typeNode.variants.map(({ id, label }) => ({ id, label })) : [];
}

// ---------------------------------------------------------------------------
// Session defaults -- driven entirely by taxonomy.defaults so a future
// taxonomy edit can change them without a JavaScript change. Falls back to
// the first class/type if defaults metadata is absent or stale (e.g. points
// at a since-removed id), rather than resolving to nothing.
// ---------------------------------------------------------------------------

export function getDefaultClassId(taxonomy) {
  if (!taxonomy) return null;
  const configured = taxonomy.defaults?.shotClassId;
  if (configured && findClassById(taxonomy, configured)) return configured;
  return taxonomy.classes[0]?.id ?? null;
}

export function getDefaultTypeId(taxonomy) {
  if (!taxonomy) return null;
  const classId = getDefaultClassId(taxonomy);
  const configured = taxonomy.defaults?.shotTypeId;
  if (configured && findTypeById(taxonomy, classId, configured)) return configured;
  return findClassById(taxonomy, classId)?.types[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Shot <-> taxonomy id conversion. The canonical CSV/shot object stores
// coach-facing labels (docs/architecture/contact-point-annotation-csv.md);
// these are the only two functions that translate between that and the
// taxonomy's internal ids.
// ---------------------------------------------------------------------------

// "Unclassified" was this app's old blank-placeholder label (never itself
// written to a shot -- selecting it produced a blank shot_class/shot_type).
// Now that the taxonomy has a real, honest "Unknown" classification, a shot
// that genuinely does carry the literal legacy text "Unclassified" (a
// hypothetical import from elsewhere, or a future data source) is treated as
// "Unknown" for lookup purposes -- read-only normalization, never a rewrite
// of the shot's own stored value. "Unclassified" and "Unknown" must not
// coexist as two overlapping coach-facing concepts (see
// docs/architecture/annotation-workbench.md).
const LEGACY_UNCLASSIFIED_LABEL = 'unclassified';
const UNKNOWN_LABEL = 'Unknown';

function resolveLegacyLabelAlias(label) {
  if (isNonEmptyString(label) && label.trim().toLowerCase() === LEGACY_UNCLASSIFIED_LABEL) {
    return UNKNOWN_LABEL;
  }
  return label;
}

export function classificationIdsForShot(taxonomy, shot) {
  const empty = { classId: null, typeId: null, variantId: null };
  if (!taxonomy || !shot) return empty;
  const classNode = findClassByLabel(taxonomy, resolveLegacyLabelAlias(shot.shot_class));
  if (!classNode) return empty;
  const typeNode = findTypeByLabel(taxonomy, classNode.id, resolveLegacyLabelAlias(shot.shot_type));
  if (!typeNode) return { classId: classNode.id, typeId: null, variantId: null };
  const variantNode = findVariantByLabel(taxonomy, classNode.id, typeNode.id, shot.shot_variant);
  return { classId: classNode.id, typeId: typeNode.id, variantId: variantNode ? variantNode.id : null };
}

export function classificationLabelsForIds(taxonomy, { classId, typeId, variantId } = {}) {
  const classNode = findClassById(taxonomy, classId);
  const typeNode = classNode ? findTypeById(taxonomy, classId, typeId) : null;
  const variantNode = typeNode ? findVariantById(taxonomy, classId, typeId, variantId) : null;
  return {
    shot_class: classNode ? classNode.label : '',
    shot_type: typeNode ? typeNode.label : '',
    shot_variant: variantNode ? variantNode.label : '',
  };
}

// ---------------------------------------------------------------------------
// Cascading-select reconciliation: dropped down to pure functions so the
// "changing class clears an incompatible type/variant" behaviour is directly
// tested rather than only exercised through app.js DOM wiring.
// ---------------------------------------------------------------------------

export function reconcileClassSelection(taxonomy, { typeId, variantId } = {}, nextClassId) {
  const types = getTypesForClass(taxonomy, nextClassId);
  const nextTypeId = types.some((entry) => entry.id === typeId) ? typeId : null;
  const variants = getVariantsForType(taxonomy, nextClassId, nextTypeId);
  const nextVariantId = variants.some((entry) => entry.id === variantId) ? variantId : null;
  return { classId: nextClassId || null, typeId: nextTypeId, variantId: nextVariantId };
}

export function reconcileTypeSelection(taxonomy, { classId, variantId } = {}, nextTypeId) {
  const variants = getVariantsForType(taxonomy, classId, nextTypeId);
  const nextVariantId = variants.some((entry) => entry.id === variantId) ? variantId : null;
  return { classId: classId || null, typeId: nextTypeId || null, variantId: nextVariantId };
}

// ---------------------------------------------------------------------------
// Resource loading -- mirrors ontology.mjs's loadOntology pattern.
// ---------------------------------------------------------------------------

export function resolveTaxonomyFileUrl() {
  return new URL(TAXONOMY_FILE, import.meta.url).toString();
}

async function loadJson(fetchOrLoadJson, resourceUrl) {
  const result = await fetchOrLoadJson(resourceUrl);
  if (result && typeof result.json === 'function') {
    return result.json();
  }
  return result;
}

export async function loadTaxonomy(fetchImpl = fetch) {
  const raw = await loadJson(fetchImpl, resolveTaxonomyFileUrl());
  return normalizeTaxonomy(raw);
}
