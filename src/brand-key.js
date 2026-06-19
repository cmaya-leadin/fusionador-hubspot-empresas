import { readFile } from 'node:fs/promises';
import { isGenericEmailDomain, normalizeDomain } from './domain.js';

/**
 * @typedef {Object} BrandGroupingConfig
 * @property {number} minSlugLength
 * @property {number} minDistinctTlds
 * @property {number} minCompaniesWithSlug
 * @property {string} preferCanonicalTld
 * @property {string[]} blockedSlugs
 */

/**
 * @typedef {Object} BrandSlugStats
 * @property {Set<string>} tlds
 * @property {Set<string>} domains
 * @property {number} companyCount
 */

/**
 * @typedef {Object} BrandRegistryEntry
 * @property {boolean} enabled
 * @property {string} canonicalKey
 * @property {string} slug
 * @property {number} distinctTlds
 * @property {number} companyCount
 */

/** @type {BrandGroupingConfig} */
const DEFAULT_CONFIG = {
  minSlugLength: 4,
  minDistinctTlds: 2,
  minCompaniesWithSlug: 2,
  preferCanonicalTld: 'com',
  blockedSlugs: [],
};

const COUNTRY_TLDS = new Set([
  'it', 'es', 'de', 'fr', 'nl', 'be', 'pt', 'pl', 'cz', 'hu', 'ro', 'at', 'ch',
  'uk', 'tr', 'ru', 'br', 'mx', 'ar', 'cl', 'co', 'pe', 'us', 'ca', 'au', 'nz',
  'in', 'cn', 'jp', 'kr', 'sg', 'hk', 'tw', 'ie', 'se', 'no', 'dk', 'fi',
]);

/**
 * @param {string} configPath
 */
export async function loadBrandGroupingConfig(configPath) {
  try {
    const raw = await readFile(configPath, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return DEFAULT_CONFIG;
    }
    throw err;
  }
}

/**
 * @param {string} domain
 * @returns {{ slug: string, tld: string } | null}
 */
export function extractBrandSlug(domain) {
  const norm = normalizeDomain(domain);
  if (!norm || isGenericEmailDomain(norm)) return null;

  const parts = norm.split('.');
  if (parts.length < 2) return null;

  let slug;
  let tld;

  if (parts.length >= 3 && parts[parts.length - 2] === 'co' && parts[parts.length - 1] === 'uk') {
    slug = parts[parts.length - 3];
    tld = 'co.uk';
  } else if (parts.length === 2) {
    [slug, tld] = parts;
  } else if (parts[parts.length - 1] === 'com' || parts[parts.length - 1] === 'net') {
    slug = parts[parts.length - 2];
    tld = parts.slice(-2).join('.');
  } else if (parts.length >= 3 && COUNTRY_TLDS.has(parts[parts.length - 1])) {
    slug = parts[parts.length - 2];
    tld = parts[parts.length - 1];
  } else {
    slug = parts[parts.length - 2];
    tld = parts[parts.length - 1];
  }

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  return { slug, tld };
}

/**
 * @param {string} slug
 * @param {BrandGroupingConfig} config
 */
export function isBlockedSlug(slug, config) {
  if (slug.length < config.minSlugLength) return true;
  if (config.blockedSlugs.includes(slug)) return true;
  if (/^\d+$/.test(slug)) return true;
  return false;
}

/**
 * Analiza todos los dominios del portal y activa unión multi-TLD solo si hay
 * evidencia (≥2 TLDs distintos y ≥2 empresas con ese slug).
 *
 * @param {Iterable<string | null | undefined>} domainList
 * @param {BrandGroupingConfig} config
 * @returns {Map<string, BrandRegistryEntry>}
 */
export function buildBrandRegistry(domainList, config) {
  /** @type {Map<string, BrandSlugStats>} */
  const stats = new Map();

  for (const raw of domainList) {
    const parsed = extractBrandSlug(raw);
    if (!parsed || isBlockedSlug(parsed.slug, config)) continue;

    if (!stats.has(parsed.slug)) {
      stats.set(parsed.slug, {
        tlds: new Set(),
        domains: new Set(),
        companyCount: 0,
      });
    }

    const entry = stats.get(parsed.slug);
    entry.tlds.add(parsed.tld);
    entry.domains.add(normalizeDomain(raw));
    entry.companyCount += 1;
  }

  /** @type {Map<string, BrandRegistryEntry>} */
  const registry = new Map();

  for (const [slug, data] of stats) {
    const enabled =
      data.tlds.size >= config.minDistinctTlds &&
      data.companyCount >= config.minCompaniesWithSlug;

    const preferred = `${slug}.${config.preferCanonicalTld}`;
    const canonicalKey = data.domains.has(preferred)
      ? preferred
      : pickCanonicalDomain([...data.domains], slug, config.preferCanonicalTld);

    registry.set(slug, {
      enabled,
      canonicalKey,
      slug,
      distinctTlds: data.tlds.size,
      companyCount: data.companyCount,
    });
  }

  return registry;
}

/**
 * @param {string[]} domains
 * @param {string} slug
 * @param {string} preferTld
 */
function pickCanonicalDomain(domains, slug, preferTld) {
  const preferred = `${slug}.${preferTld}`;
  if (domains.includes(preferred)) return preferred;

  const com = domains.find((d) => d.endsWith('.com') && d.includes(slug));
  if (com) return com;

  return domains.sort((a, b) => a.length - b.length)[0] || preferred;
}

/**
 * @param {string} domain
 * @param {Map<string, BrandRegistryEntry>} registry
 */
export function resolveAutoBrandKey(domain, registry) {
  const parsed = extractBrandSlug(domain);
  if (!parsed) return null;

  const entry = registry.get(parsed.slug);
  if (!entry?.enabled) return null;

  return {
    groupKey: entry.canonicalKey,
    preferHubDomain: entry.canonicalKey,
    slug: parsed.slug,
    distinctTlds: entry.distinctTlds,
  };
}

/**
 * @param {Map<string, BrandRegistryEntry>} registry
 */
export function summarizeBrandRegistry(registry) {
  let enabled = 0;
  let companiesEstimate = 0;

  for (const entry of registry.values()) {
    if (entry.enabled) {
      enabled += 1;
      companiesEstimate += entry.companyCount;
    }
  }

  return { enabledSlugs: enabled, companiesWithMultiTldSlug: companiesEstimate };
}
