function deriveProfileToken(profileFileName) {
  if (typeof profileFileName !== 'string') {
    return 'calibration';
  }

  const trimmed = profileFileName.trim();
  if (!trimmed) {
    return 'calibration';
  }

  const normalized = trimmed.toLowerCase().replace(/\.json$/i, '');
  const meaningfulParts = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const firstMeaningfulPart = meaningfulParts[0];

  if (!firstMeaningfulPart) {
    return 'calibration';
  }

  if (firstMeaningfulPart === 'forehand' || firstMeaningfulPart === 'forehand_phase' || firstMeaningfulPart === 'forehand_phase_calibration') {
    return 'forehand';
  }

  if (firstMeaningfulPart === 'backhand' || firstMeaningfulPart === 'backhand_phase' || firstMeaningfulPart === 'backhand_phase_calibration') {
    return 'backhand';
  }

  return 'calibration';
}

export function buildExportFilename(videoFileName, profileFileName) {
  if (typeof videoFileName !== 'string') {
    return `phase_labels_${deriveProfileToken(profileFileName)}.csv`;
  }

  const trimmed = videoFileName.trim();
  if (!trimmed) {
    return `phase_labels_${deriveProfileToken(profileFileName)}.csv`;
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === 'untitled video' || normalized === 'untitled') {
    return `video_${deriveProfileToken(profileFileName)}.csv`;
  }

  const lastDotIndex = trimmed.lastIndexOf('.');
  const baseName = lastDotIndex > 0 ? trimmed.slice(0, lastDotIndex) : trimmed;
  const profileToken = deriveProfileToken(profileFileName);
  return baseName ? `${baseName.toLowerCase()}_${profileToken}.csv` : `${profileToken}.csv`;
}
