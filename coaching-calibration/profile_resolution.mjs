// Resolves which coaching profile applies to a given shot, hierarchically:
//
//   1. shot_class + shot_type + shot_variant
//   2. shot_class + shot_type
//   3. shot_class
//   4. no profile
//
// Profiles are discovered from the profile registry (profile_registry.mjs),
// never hardcoded here or in app.js -- `profileIndex` is a Map built once at
// startup (profile_registry.mjs's buildProfileIndex) from every enabled,
// successfully-loaded profile, keyed by buildProfileIndexKey below. A shot's
// own shot_class/shot_type/shot_variant are coach-facing labels (the
// canonical CSV contract); classification_taxonomy.mjs's
// classificationIdsForShot converts them to taxonomy ids first.
//
// A classification with no matching profile at any level is not an error --
// the shot remains labelable, and callers must render this as an explicit
// "no profile configured" state, never a guess.

import { classificationIdsForShot } from './classification_taxonomy.mjs';

/** Canonical index key for a (classId, typeId, variantId) match tuple -- null/absent levels are the empty string, matching profile_registry.mjs's normalized `match` shape. */
export function buildProfileIndexKey(classId, typeId, variantId) {
  return [classId || '', typeId || '', variantId || ''].join('|');
}

/**
 * @param ids `{ classId, typeId, variantId }`, typically from
 *   classificationIdsForShot -- any level may be null.
 * @param profileIndex Map from buildProfileIndexKey(...) to a normalized
 *   profile (see profile_registry.mjs's buildProfileIndex).
 * @returns The most specific matching profile, or null.
 */
export function resolveProfileByIds(ids, profileIndex) {
  if (!ids || !ids.classId || !profileIndex) {
    return null;
  }
  if (ids.typeId && ids.variantId) {
    const exact = profileIndex.get(buildProfileIndexKey(ids.classId, ids.typeId, ids.variantId));
    if (exact) return exact;
  }
  if (ids.typeId) {
    const byType = profileIndex.get(buildProfileIndexKey(ids.classId, ids.typeId, null));
    if (byType) return byType;
  }
  return profileIndex.get(buildProfileIndexKey(ids.classId, null, null)) ?? null;
}

/**
 * @param shot A canonical annotation row (or shot in progress).
 * @param taxonomy Normalized classification taxonomy (classification_taxonomy.mjs).
 * @param profileIndex Map from profile_registry.mjs's buildProfileIndex.
 * @returns The matching profile, or null if the shot's classification is
 *   blank/unrecognized or has no configured profile at any level.
 */
export function resolveProfileForShot(shot, taxonomy, profileIndex) {
  if (!shot || !taxonomy || !profileIndex) {
    return null;
  }
  return resolveProfileByIds(classificationIdsForShot(taxonomy, shot), profileIndex);
}
