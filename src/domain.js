export const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'msn.com',
  'aol.com',
]);

/**
 * @param {string | null | undefined} domain
 */
export function isGenericEmailDomain(domain) {
  if (!domain) return false;
  return GENERIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * Normaliza un dominio o URL a host en minúsculas (sin www).
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function normalizeDomain(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let value = raw.trim().toLowerCase();
  if (!value) return null;

  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/^www\./, '');
  value = value.split('/')[0];
  value = value.split('?')[0];
  value = value.split('#')[0];
  value = value.split(':')[0];
  value = value.replace(/\.$/, '');

  if (!value || !value.includes('.')) return null;
  return value;
}

/**
 * @param {string | null | undefined} email
 * @returns {string | null}
 */
export function domainFromEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 0) return null;
  return normalizeDomain(email.slice(at + 1));
}
