import { getObservationMeta, getPhaseMeta, getQualityMeta, getRatingMeta } from './ontology.mjs';

const DEFAULT_STRING = (value, fallback) =>
  (typeof value === 'string' && value.trim() ? value.trim() : fallback);

// Normalize a phase descriptor from either the current rich format
// ({ id, shortcut, observations: [obsId] }) or a legacy label descriptor
// ({ id, label }). Observation references are always ontology IDs.
function normalizePhase(phase) {
  if (!phase || typeof phase !== 'object') {
    return null;
  }
  const id = DEFAULT_STRING(phase.id, '');
  if (!id) {
    return null;
  }
  const observations = Array.isArray(phase.observations)
    ? phase.observations.filter((value) => typeof value === 'string' && value.trim())
    : [];
  return {
    id,
    shortcut: DEFAULT_STRING(phase.shortcut, ''),
    observations,
    // Preserve any inline label from legacy profiles; ontology takes precedence downstream.
    label: DEFAULT_STRING(phase.label, ''),
  };
}

function normalizeIdList(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim())
    : [];
}

export function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return {
      profile_id: 'default_profile',
      profile_name: 'Default Calibration Profile',
      profile_version: 'unknown',
      shot_type: 'Generic',
      ontology_id: '',
      ontology_version: 'unknown',
      phases: [],
      ratings: [],
      quality_ratings: [],
      capture: {},
      export: {},
    };
  }

  const rawPhases = Array.isArray(profile.phases)
    ? profile.phases
    : Array.isArray(profile.labels)
      ? profile.labels
      : [];

  return {
    profile_id: DEFAULT_STRING(profile.profile_id, 'default_profile'),
    profile_name: DEFAULT_STRING(profile.profile_name, 'Default Calibration Profile'),
    profile_version: DEFAULT_STRING(profile.profile_version, 'unknown'),
    shot_type: DEFAULT_STRING(profile.shot_type, 'Generic'),
    ontology_id: DEFAULT_STRING(profile.ontology_id, ''),
    ontology_version: DEFAULT_STRING(profile.ontology_version, 'unknown'),
    phases: rawPhases.map(normalizePhase).filter(Boolean),
    ratings: normalizeIdList(profile.ratings),
    quality_ratings: normalizeIdList(profile.quality_ratings),
    capture: profile.capture && typeof profile.capture === 'object' ? profile.capture : {},
    export: profile.export && typeof profile.export === 'object' ? profile.export : {},
  };
}

export function createProfileBannerState(profile = null) {
  if (!profile || typeof profile !== 'object' || profile.loaded !== true) {
    return {
      title: 'No profile loaded',
      subtitle: 'Open a calibration profile to begin.',
      profileVersion: '',
      ontologyVersion: '',
      loaded: false,
    };
  }

  const normalizedProfile = normalizeProfile(profile);
  return {
    title: normalizedProfile.profile_name,
    subtitle: normalizedProfile.shot_type || 'Generic',
    profileVersion: normalizedProfile.profile_version,
    ontologyVersion: normalizedProfile.ontology_version,
    loaded: true,
  };
}

export function getDefaultProfilePath() {
  return './profiles/forehand_calibration_profile.json';
}

export function resolveDefaultProfilePath() {
  return new URL(getDefaultProfilePath(), import.meta.url).toString();
}

export function getProfilePhases(profile) {
  return normalizeProfile(profile).phases;
}

export function getProfileRatingIds(profile) {
  return normalizeProfile(profile).ratings;
}

export function getProfileQualityIds(profile) {
  return normalizeProfile(profile).quality_ratings;
}

export function getProfileVersion(profile) {
  return normalizeProfile(profile).profile_version;
}

export function getPhaseObservationIds(profile, phaseId) {
  const phase = getProfilePhases(profile).find((entry) => entry.id === phaseId);
  return phase ? phase.observations : [];
}

// Build the per-phase view models the UI renders from. Each view model merges
// the profile phase (order, shortcut, phase-scoped observation ids) with the
// ontology (labels and descriptions). Rating options that are not "not_assessed"
// are resolved for the observation dropdowns.
export function buildPhaseViewModels(profile, ontology) {
  const normalizedProfile = normalizeProfile(profile);
  return normalizedProfile.phases.map((phase) => {
    const phaseMeta = getPhaseMeta(ontology, phase.id);
    return {
      id: phase.id,
      label: phase.label || phaseMeta.label,
      description: phaseMeta.description,
      shortcut: phase.shortcut,
      observations: phase.observations.map((observationId) => {
        const meta = getObservationMeta(ontology, observationId);
        return { id: observationId, label: meta.label, description: meta.description };
      }),
    };
  });
}

// Rating options (excluding not_assessed, which the UI supplies as the default).
export function buildRatingOptions(profile, ontology) {
  return getProfileRatingIds(profile)
    .filter((id) => id !== 'not_assessed')
    .map((id) => {
      const meta = getRatingMeta(ontology, id);
      return { id, label: meta.label, description: meta.description };
    });
}

// Quality options (excluding not_assessed) for phase and overall quality controls.
export function buildQualityOptions(profile, ontology) {
  return getProfileQualityIds(profile)
    .filter((id) => id !== 'not_assessed')
    .map((id) => {
      const meta = getQualityMeta(ontology, id);
      return { id, label: meta.label, description: meta.description };
    });
}
