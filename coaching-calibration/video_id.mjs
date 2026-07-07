export function deriveVideoId(filename) {
  if (typeof filename !== 'string') {
    return '';
  }

  const trimmed = filename.trim();
  if (!trimmed) {
    return '';
  }

  const lastDotIndex = trimmed.lastIndexOf('.');
  if (lastDotIndex <= 0) {
    return trimmed;
  }

  return trimmed.slice(0, lastDotIndex);
}
