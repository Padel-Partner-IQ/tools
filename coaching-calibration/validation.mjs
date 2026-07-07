export function getRequiredLabelIds(labels) {
  return (labels || []).map((label) => label.id);
}

export function getMissingLabelEntries(labels, capturedEntries) {
  const capturedIds = new Set((capturedEntries || []).map((entry) => entry.label_id));
  return (labels || []).filter((label) => !capturedIds.has(label.id));
}

// A quality selection is valid when it is a concrete, assessed rating (not
// blank and not the "not_assessed" sentinel).
export function isQualitySelected(quality) {
  return typeof quality === 'string' && quality.trim().length > 0 && quality !== 'not_assessed';
}

export function canExportCalibration({ annotator, labels, capturedEntries, overallQuality }) {
  const trimmedAnnotator = typeof annotator === 'string' ? annotator.trim() : '';
  const missingLabels = getMissingLabelEntries(labels, capturedEntries);
  return trimmedAnnotator.length > 0
    && missingLabels.length === 0
    && isQualitySelected(overallQuality);
}
