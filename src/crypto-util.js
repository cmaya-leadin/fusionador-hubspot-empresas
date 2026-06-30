import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = crypto
  .createHash('sha256')
  .update(process.env.SESSION_SECRET || 'fusionador-dev-secret-change-me')
  .digest();

/**
 * @param {string} plainText
 */
export function encryptToken(plainText) {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * @param {string} encrypted
 */
export function decryptToken(encrypted) {
  if (!encrypted) return '';
  try {
    const data = Buffer.from(encrypted, 'base64');
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const text = data.subarray(28);
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(text), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return '';
  }
}
