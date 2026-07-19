// Tracked, deterministic build-metadata loader/fallback for the Annotation
// Workbench. This file itself is NEVER rewritten by any script -- it
// contains no timestamp and no volatile content, so a clean checkout stays
// clean no matter how many times tests or builds run.
//
// The real, volatile provenance (version/buildId/isDirty/source/
// generatedAt) is written by scripts/generate-build-metadata.mjs into the
// gitignored src/generated/build_metadata.mjs (see platform/.gitignore).
// This module's only job is to load that generated module when it exists,
// and fall back to an honest, static placeholder when it doesn't (e.g. src/
// served directly with no build/test script run first, before generation
// has ever happened).
//
// Consumers (app.js, tests) import `BUILD_METADATA` from here exactly as
// before -- this module's use of top-level await is transparent to
// importers; nothing else needs to change to consume either the generated
// or the fallback value. See
// docs/tooling/annotation-workbench-development.md#build-metadata.

/**
 * Static, non-volatile fallback -- used only when generation hasn't run yet.
 * `isDirty: null` because this fallback carries no real Git information at
 * all (distinct from a generated `isDirty: false`/`true`, which reflects an
 * actual `git status` reading).
 */
const FALLBACK_BUILD_METADATA = Object.freeze({
  version: '0.3.0',
  buildId: 'development',
  isDirty: null,
  source: 'unavailable',
  generatedAt: null,
});

async function loadBuildMetadata() {
  try {
    const generated = await import('./generated/build_metadata.mjs');
    return generated.BUILD_METADATA;
  } catch {
    return FALLBACK_BUILD_METADATA;
  }
}

export const BUILD_METADATA = await loadBuildMetadata();
