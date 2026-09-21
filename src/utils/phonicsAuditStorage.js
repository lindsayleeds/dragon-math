export const PHONICS_AUDIT_STORAGE_KEY = 'dragonmath:phonics-audio-audit:v1';

export function readPhonicsAudit(storage) {
  try {
    const target = storage || localStorage;
    return JSON.parse(target.getItem(PHONICS_AUDIT_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function savePhonicsAuditReview(current, word, status, storage) {
  const reviews = { ...current, [word]: status };
  try {
    const target = storage || localStorage;
    target.setItem(PHONICS_AUDIT_STORAGE_KEY, JSON.stringify(reviews));
    return { reviews, persisted: true };
  } catch {
    return { reviews, persisted: false };
  }
}
