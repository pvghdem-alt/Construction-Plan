const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const MAX_SHARED_EMAILS = 20;

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmailAddress(email: string): boolean {
  const normalized = normalizeEmailAddress(email);
  return normalized.length >= 3 && normalized.length <= 120 && EMAIL_REGEX.test(normalized);
}

export function parseShareEmailsInput(
  rawInput: string,
  ownerEmail?: string | null
): {
  validEmails: string[];
  invalidTokens: string[];
  ignoredSelf: boolean;
} {
  const ownerNorm = ownerEmail ? normalizeEmailAddress(ownerEmail) : '';
  const tokens = rawInput
    .split(/[\s,;，；、]+/)
    .map((t) => normalizeEmailAddress(t))
    .filter(Boolean);

  const validSet = new Set<string>();
  const invalidTokens: string[] = [];
  let ignoredSelf = false;

  for (const token of tokens) {
    if (!isValidEmailAddress(token)) {
      invalidTokens.push(token);
      continue;
    }
    if (ownerNorm && token === ownerNorm) {
      ignoredSelf = true;
      continue;
    }
    if (validSet.size < MAX_SHARED_EMAILS) {
      validSet.add(token);
    }
  }

  return {
    validEmails: Array.from(validSet),
    invalidTokens,
    ignoredSelf,
  };
}

export function mergeShareEmailLists(
  existingEmails: string[],
  emailsToAdd: string[]
): string[] {
  const merged = new Set<string>();
  for (const email of existingEmails) {
    const norm = normalizeEmailAddress(email);
    if (isValidEmailAddress(norm) && merged.size < MAX_SHARED_EMAILS) {
      merged.add(norm);
    }
  }
  for (const email of emailsToAdd) {
    const norm = normalizeEmailAddress(email);
    if (isValidEmailAddress(norm) && merged.size < MAX_SHARED_EMAILS) {
      merged.add(norm);
    }
  }
  return Array.from(merged);
}

export function removeShareEmail(
  existingEmails: string[],
  emailToRemove: string
): string[] {
  const target = normalizeEmailAddress(emailToRemove);
  return existingEmails
    .map((e) => normalizeEmailAddress(e))
    .filter((e) => e !== target && isValidEmailAddress(e));
}

export function buildShareDocId(ownerId: string, sourcePlanId: string): string {
  const cleanOwner = ownerId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanPlan = sourcePlanId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const candidate = `share_${cleanOwner}_${cleanPlan}`;
  if (candidate.length <= 128) {
    return candidate;
  }
  let hash = 2166136261;
  for (let i = 0; i < candidate.length; i += 1) {
    hash ^= candidate.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36);
  return `${candidate.slice(0, 128 - suffix.length - 1)}_${suffix}`;
}
