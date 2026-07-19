// Coaching profile registry loading, validation and indexing.
//
// profile_registry.json is the explicit manifest of which classifications
// currently have a coaching profile, and where its file lives. Adding a
// supported shot type/variant is a JSON-only change: a taxonomy entry, a
// profile file under shot_profiles/, and a registry entry -- no JavaScript
// edit (see docs/ARCHITECTURE.md in the profile architecture pack).
//
// This module owns two distinct validation passes:
//   - normalizeRegistry: the registry file's own internal consistency
//     (duplicate profile ids, duplicate enabled match keys, missing
//     required fields, unsupported schema_version).
//   - validateLoadedProfile: a single loaded profile file against the
//     registry entry that pointed at it, the taxonomy, and the ontology
//     (classification agreement, unsupported profile schema_version,
//     references to phase/observation/rating/quality ids that don't exist).
//
// Neither pass ever throws for a *disabled* entry -- disabled entries are
// simply never loaded, so an absent example file never blocks startup.

import { normalizeProfile } from './profile_state.mjs';
import { findClassById } from './classification_taxonomy.mjs';
import { buildProfileIndexKey } from './profile_resolution.mjs';

const REGISTRY_FILE = './profiles/profile_registry.json';
const PROFILES_DIR = './profiles/';
const SUPPORTED_REGISTRY_SCHEMA_VERSIONS = ['1'];
const SUPPORTED_PROFILE_SCHEMA_VERSIONS = ['1', '2'];

// Well-established sentinel used throughout the app (phaseWorking defaults,
// buildRatingOptions/buildQualityOptions filtering) to mean "no rating/
// quality selected yet". It is deliberately not a real ontology entry in
// ratings.json/quality_assessments.json, so it must never be flagged as an
// unknown reference.
const NOT_ASSESSED = 'not_assessed';

export class ProfileRegistryValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'ProfileRegistryValidationError';
    this.errors = [...errors];
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultString(value, fallback = '') {
  return isNonEmptyString(value) ? value.trim() : fallback;
}

/**
 * Validates and normalizes a raw profile_registry.json payload into
 * `{ schemaVersion, registryId, profiles: [{ profileId, enabled, status,
 * match: { shotClass, shotType, shotVariant }, file }] }`. Throws
 * ProfileRegistryValidationError with every problem found.
 */
export function normalizeRegistry(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    throw new ProfileRegistryValidationError(['Profile registry is not a valid JSON object.']);
  }
  if (!SUPPORTED_REGISTRY_SCHEMA_VERSIONS.includes(String(raw.schema_version))) {
    errors.push(`Unsupported profile registry schema_version "${raw.schema_version}" -- supported: ${SUPPORTED_REGISTRY_SCHEMA_VERSIONS.join(', ')}.`);
  }

  const rawEntries = Array.isArray(raw.profiles) ? raw.profiles : [];
  const seenIds = new Set();
  const seenEnabledKeys = new Set();
  const profiles = rawEntries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      errors.push(`Registry entry #${index} is not a valid object.`);
      return null;
    }
    const profileId = defaultString(entry.profile_id);
    if (!profileId) {
      errors.push(`Registry entry #${index} is missing profile_id.`);
      return null;
    }
    if (seenIds.has(profileId)) errors.push(`Duplicate profile_id "${profileId}" in profile registry.`);
    seenIds.add(profileId);

    const match = entry.match && typeof entry.match === 'object' ? entry.match : {};
    const shotClass = defaultString(match.shot_class);
    const shotType = defaultString(match.shot_type);
    const shotVariant = defaultString(match.shot_variant);
    if (!shotClass) errors.push(`Registry entry "${profileId}" is missing match.shot_class.`);

    const file = defaultString(entry.file);
    if (!file) errors.push(`Registry entry "${profileId}" is missing file.`);

    const enabled = entry.enabled === true;
    if (enabled) {
      const key = buildProfileIndexKey(shotClass, shotType, shotVariant);
      if (seenEnabledKeys.has(key)) {
        errors.push(`Duplicate enabled match (shot_class="${shotClass}", shot_type="${shotType || '*'}", shot_variant="${shotVariant || '*'}") in profile registry -- resolution would be ambiguous.`);
      }
      seenEnabledKeys.add(key);
    }

    return {
      profileId,
      enabled,
      status: defaultString(entry.status),
      match: { shotClass: shotClass || null, shotType: shotType || null, shotVariant: shotVariant || null },
      file,
    };
  }).filter(Boolean);

  if (errors.length > 0) {
    throw new ProfileRegistryValidationError(errors);
  }

  return {
    schemaVersion: String(raw.schema_version),
    registryId: defaultString(raw.registry_id),
    profiles,
  };
}

/**
 * Validates one loaded profile file against the registry entry that
 * referenced it, the taxonomy, and the ontology, then returns the
 * normalized profile. Throws ProfileRegistryValidationError (with every
 * problem found) rather than returning a partially-valid profile.
 */
export function validateLoadedProfile({ profileRaw, registryEntry, taxonomy = null, ontology = null }) {
  const errors = [];
  if (!profileRaw || typeof profileRaw !== 'object') {
    throw new ProfileRegistryValidationError([`Profile file for "${registryEntry.profileId}" is not a valid JSON object.`]);
  }
  if (!SUPPORTED_PROFILE_SCHEMA_VERSIONS.includes(String(profileRaw.schema_version))) {
    errors.push(`Profile "${registryEntry.profileId}" has unsupported schema_version "${profileRaw.schema_version}" -- supported: ${SUPPORTED_PROFILE_SCHEMA_VERSIONS.join(', ')}.`);
  }

  const profile = normalizeProfile(profileRaw);
  profile.status = registryEntry.status || profile.status;
  if (profile.profile_id !== registryEntry.profileId) {
    errors.push(`Profile file registered as "${registryEntry.profileId}" declares a different profile_id ("${profile.profile_id}").`);
  }

  const classification = profile.classification;
  if (!classification) {
    errors.push(`Profile "${registryEntry.profileId}" has no classification block.`);
  } else {
    if ((classification.shot_class?.id || null) !== registryEntry.match.shotClass) {
      errors.push(`Profile "${registryEntry.profileId}" classification.shot_class ("${classification.shot_class?.id}") does not match its registry entry ("${registryEntry.match.shotClass}").`);
    }
    if ((classification.shot_type?.id || null) !== registryEntry.match.shotType) {
      errors.push(`Profile "${registryEntry.profileId}" classification.shot_type ("${classification.shot_type?.id}") does not match its registry entry ("${registryEntry.match.shotType}").`);
    }
    if ((classification.shot_variant?.id || null) !== registryEntry.match.shotVariant) {
      errors.push(`Profile "${registryEntry.profileId}" classification.shot_variant ("${classification.shot_variant?.id}") does not match its registry entry ("${registryEntry.match.shotVariant}").`);
    }
    if (taxonomy && classification.shot_class && !findClassById(taxonomy, classification.shot_class.id)) {
      errors.push(`Profile "${registryEntry.profileId}" references shot_class "${classification.shot_class.id}", which is not in the classification taxonomy.`);
    }
  }

  if (ontology) {
    for (const phase of profile.phases) {
      if (!ontology.phases[phase.id]) {
        errors.push(`Profile "${registryEntry.profileId}" references unknown phase id "${phase.id}".`);
      }
      for (const observationId of phase.observations) {
        if (!ontology.observations[observationId]) {
          errors.push(`Profile "${registryEntry.profileId}" phase "${phase.id}" references unknown observation id "${observationId}".`);
        }
      }
    }
    for (const ratingId of profile.ratings) {
      if (ratingId !== NOT_ASSESSED && !ontology.ratings[ratingId]) {
        errors.push(`Profile "${registryEntry.profileId}" references unknown rating id "${ratingId}".`);
      }
    }
    for (const qualityId of profile.quality_ratings) {
      if (qualityId !== NOT_ASSESSED && !ontology.qualityAssessments[qualityId]) {
        errors.push(`Profile "${registryEntry.profileId}" references unknown quality id "${qualityId}".`);
      }
    }
  }

  if (errors.length > 0) {
    throw new ProfileRegistryValidationError(errors);
  }
  return profile;
}

/**
 * Builds the resolution index profile_resolution.mjs's resolveProfileForShot
 * reads from -- one entry per successfully loaded+validated profile, keyed
 * by its registry entry's own match tuple (not the profile file's
 * classification block, though validateLoadedProfile already required them
 * to agree).
 */
export function buildProfileIndex(loadedEntries) {
  const index = new Map();
  for (const { registryEntry, profile } of loadedEntries) {
    const key = buildProfileIndexKey(registryEntry.match.shotClass, registryEntry.match.shotType, registryEntry.match.shotVariant);
    index.set(key, profile);
  }
  return index;
}

export function getEnabledEntries(registry) {
  return registry ? registry.profiles.filter((entry) => entry.enabled) : [];
}

// ---------------------------------------------------------------------------
// Resource loading
// ---------------------------------------------------------------------------

export function resolveRegistryFileUrl() {
  return new URL(REGISTRY_FILE, import.meta.url).toString();
}

export function resolveProfileFileUrl(relativeFile) {
  return new URL(PROFILES_DIR + relativeFile, import.meta.url).toString();
}

async function loadJson(fetchOrLoadJson, resourceUrl) {
  const result = await fetchOrLoadJson(resourceUrl);
  if (result && typeof result.json === 'function') {
    return result.json();
  }
  return result;
}

export async function loadRegistry(fetchImpl = fetch) {
  const raw = await loadJson(fetchImpl, resolveRegistryFileUrl());
  return normalizeRegistry(raw);
}

/**
 * Loads and validates every enabled registry entry's profile file, in
 * order. A single entry's failure (missing file, invalid JSON, failed
 * validation) is reported via `onError` and that entry is skipped -- one
 * mis-configured profile must not prevent every other classification's
 * profile from loading. Returns `{ profileIndex, loaded, failed }`.
 */
export async function loadRegisteredProfiles(registry, { fetchImpl = fetch, taxonomy = null, ontology = null, onError } = {}) {
  const loaded = [];
  const failed = [];
  for (const registryEntry of getEnabledEntries(registry)) {
    try {
      const profileRaw = await loadJson(fetchImpl, resolveProfileFileUrl(registryEntry.file));
      const profile = validateLoadedProfile({ profileRaw, registryEntry, taxonomy, ontology });
      loaded.push({ registryEntry, profile });
    } catch (error) {
      failed.push({ registryEntry, error });
      if (onError) onError(registryEntry, error);
    }
  }
  return { profileIndex: buildProfileIndex(loaded), loaded, failed };
}
