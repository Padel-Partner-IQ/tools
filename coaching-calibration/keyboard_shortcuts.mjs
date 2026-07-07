export function isEditableTarget(target) {
  if (!target || typeof target !== 'object') {
    return false;
  }

  const tagName = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
    return true;
  }

  const contentEditable = target.isContentEditable || target.contentEditable === 'true' || target.contentEditable === '';
  if (contentEditable) {
    return true;
  }

  return false;
}
