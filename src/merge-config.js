/**
 * Ajustes de ritmo para fusiones en HubSpot (variables de entorno).
 *
 * MERGE_CONCURRENCY — colas en paralelo por primaryId distinto (1 = secuencial, 3–5 recomendado).
 * MERGE_DELAY_MS — pausa entre fusiones dentro de la misma cola.
 * MERGE_SETTLE_MS — espera tras fusión exitosa antes de la siguiente (mismo u otro principal).
 * MERGE_SAME_PRIMARY_SETTLE_MS — si la siguiente fusión va al mismo principal, usa este valor (HubSpot 500).
 * MERGE_RETRY_BASE_MS — espera base entre reintentos (intento N × base, con tope).
 * MERGE_RETRY_MAX_MS — tope de espera entre reintentos.
 * MERGE_MAX_ATTEMPTS — intentos por fusión.
 * MERGE_SKIP_PREFLIGHT — si true, no comprueba existencia antes de fusionar (más rápido).
 */

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function envBool(name) {
  return process.env[name] === 'true' || process.env[name] === '1';
}

export const MERGE_CONCURRENCY = Math.max(1, envInt('MERGE_CONCURRENCY', 3));
export const MERGE_DELAY_MS = envInt('MERGE_DELAY_MS', MERGE_CONCURRENCY > 1 ? 0 : 400);
export const MERGE_SETTLE_MS = envInt('MERGE_SETTLE_MS', 600);
export const MERGE_SAME_PRIMARY_SETTLE_MS = envInt(
  'MERGE_SAME_PRIMARY_SETTLE_MS',
  1200,
);
export const MERGE_RETRY_BASE_MS = envInt('MERGE_RETRY_BASE_MS', 2000);
export const MERGE_RETRY_MAX_MS = envInt('MERGE_RETRY_MAX_MS', 12000);
export const MERGE_MAX_ATTEMPTS = Math.max(1, envInt('MERGE_MAX_ATTEMPTS', 5));
export const MERGE_SKIP_PREFLIGHT = envBool('MERGE_SKIP_PREFLIGHT');
