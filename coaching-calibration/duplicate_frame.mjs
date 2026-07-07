function normalizeFrameValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function findFrameConflicts(entries, frame) {
  const normalizedFrame = normalizeFrameValue(frame);
  if (normalizedFrame === null) {
    return [];
  }

  return (entries || []).filter((entry) => normalizeFrameValue(entry?.frame) === normalizedFrame);
}

export function resolveCaptureFrame({ videoTime, currentFrame, displayedFrame } = {}) {
  const parsedDisplayedFrame = Number.parseInt(displayedFrame, 10);
  if (Number.isFinite(parsedDisplayedFrame) && parsedDisplayedFrame >= 0) {
    return parsedDisplayedFrame;
  }

  if (Number.isFinite(videoTime) && videoTime > 0) {
    return Math.round(videoTime * 30);
  }

  return Number.isFinite(currentFrame) ? currentFrame : 0;
}

export function buildDuplicateWarningMessage(frame, conflicts, newLabelName) {
  const existingLabels = conflicts.map((entry) => entry.label_name).filter(Boolean);
  const title = `Frame ${frame} has already been labelled as:`;
  const bulletList = existingLabels.length > 0
    ? existingLabels.map((label) => `• ${label}`).join('\n')
    : '• Unknown label';
  const prompt = `Do you also want to label this frame as:\n• ${newLabelName}?`;
  return `${title}\n\n${bulletList}\n\n${prompt}`;
}

// Frame-level ownership. A single video frame may be used by at most one phase
// assessment, regardless of which phase is active. Returns the entry that
// currently owns the frame, or null if the frame is free. The entry being
// edited is excluded so an in-place edit does not conflict with itself.
export function findFrameOwner(entries, frame, excludeId = null) {
  const normalizedFrame = normalizeFrameValue(frame);
  if (normalizedFrame === null) {
    return null;
  }

  return (entries || []).find((entry) => {
    if (!entry) {
      return false;
    }
    if (excludeId !== null && entry.id === excludeId) {
      return false;
    }
    return normalizeFrameValue(entry.frame) === normalizedFrame;
  }) || null;
}

// Error message shown when a phase assessment is blocked because the frame is
// already used by another phase assessment.
export function buildFrameInUseErrorMessage(frame, phaseLabel) {
  return `Frame ${frame} is already used by ${phaseLabel}. `
    + 'Choose a different frame, or edit/delete the existing assessment.';
}
