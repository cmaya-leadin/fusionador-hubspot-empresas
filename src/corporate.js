import { readFile } from 'node:fs/promises';
import { resolveAutoBrandKey } from './brand-key.js';
import {
  domainFromEmail,
  isGenericEmailDomain,
  normalizeDomain,
} from './domain.js';

/**
 * @typedef {Object} CorporateFamily
 * @property {string} id
 * @property {string} [label]
 * @property {string} canonicalKey
 * @property {string} [preferHubDomain]
 * @property {string[]} [domains]
 * @property {string[]} [brandSlugs]
 * @property {string[]} [nameContains]
 */

/**
 * @typedef {Object} GroupKeyResult
 * @property {string} groupKey
 * @property {'corporate' | 'brand_multi_tld' | 'domain' | 'email_de_empresa' | 'root_domain'} source
 * @property {string} [familyId]
 * @property {string} [preferHubDomain]
 * @property {string | null} [rawDomain]
 */

/**
 * @param {string} configPath
 * @returns {Promise<CorporateFamily[]>}
 */
export async function loadCorporateFamilies(configPath) {
  try {
    const raw = await readFile(configPath, 'utf8');
    const data = JSON.parse(raw);
    return /** @type {CorporateFamily[]} */ (data.families || []);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * @param {string} domain
 * @param {CorporateFamily} family
 */
function domainMatchesFamily(domain, family) {
  const norm = normalizeDomain(domain);
  if (!norm || isGenericEmailDomain(norm)) return false;

  if (family.domains?.includes(norm)) return true;

  for (const slug of family.brandSlugs || []) {
    if (norm === slug) return true;
    if (norm === `${slug}.com`) return true;
    if (norm.match(new RegExp(`^${slug}\\.[a-z]{2,3}$`))) return true;
    if (norm.endsWith(`.${slug}.com`) || norm.endsWith(`.${slug}.co.uk`)) {
      return true;
    }
    if (norm.includes(`.${slug}.`) || norm.startsWith(`${slug}.`)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {string | null | undefined} companyName
 * @param {CorporateFamily} family
 */
function nameMatchesFamily(companyName, family) {
  if (!companyName || !family.nameContains?.length) return false;
  const name = companyName.toLowerCase();
  return family.nameContains.some((p) => name.includes(p.toLowerCase()));
}

/**
 * @param {string} domain
 * @param {CorporateFamily[]} families
 * @returns {CorporateFamily | null}
 */
export function findFamilyForDomain(domain, families) {
  for (const family of families) {
    if (domainMatchesFamily(domain, family)) return family;
  }
  return null;
}

/**
 * @param {CorporateFamily[]} families
 * @param {string} canonicalKey
 * @returns {CorporateFamily | undefined}
 */
export function familyByCanonicalKey(families, canonicalKey) {
  return families.find((f) => f.canonicalKey === canonicalKey);
}

/**
 * @param {string} manualKey
 * @param {CorporateFamily[]} families
 */
export function resolveManualGroupKey(manualKey, families) {
  const key = manualKey.trim();
  for (const family of families) {
    if (family.id === key || family.canonicalKey === key) {
      return family.canonicalKey;
    }
  }
  return key;
}

/**
 * Prioridad: corporativo manual → dominio raíz → auto-marca multi-TLD → dominio exacto.
 *
 * @param {{
 *   domain?: string,
 *   email_de_empresa?: string,
 *   dominio_raiz?: string,
 *   name?: string,
 * }} props
 * @param {CorporateFamily[]} families
 * @param {Map<string, import('./brand-key.js').BrandRegistryEntry>} [brandRegistry]
 * @returns {GroupKeyResult | null}
 */
export function resolveGroupKey(props, families, brandRegistry = new Map()) {
  /** @type {Array<{ domain: string, source: GroupKeyResult['source'] }>} */
  const candidates = [];

  const root = normalizeDomain(props.dominio_raiz);
  if (root) candidates.push({ domain: root, source: 'root_domain' });

  const fromDomain = normalizeDomain(props.domain);
  if (fromDomain) candidates.push({ domain: fromDomain, source: 'domain' });

  const fromEmail = domainFromEmail(props.email_de_empresa);
  if (fromEmail) candidates.push({ domain: fromEmail, source: 'email_de_empresa' });

  for (const { domain, source } of candidates) {
    if (isGenericEmailDomain(domain)) continue;

    const family = findFamilyForDomain(domain, families);
    if (family) {
      return {
        groupKey: family.canonicalKey,
        source: 'corporate',
        familyId: family.id,
        preferHubDomain: family.preferHubDomain || family.canonicalKey,
        rawDomain: domain,
      };
    }
  }

  for (const { domain, source } of candidates) {
    if (isGenericEmailDomain(domain)) continue;

    const autoBrand = resolveAutoBrandKey(domain, brandRegistry);
    if (autoBrand) {
      return {
        groupKey: autoBrand.groupKey,
        source: 'brand_multi_tld',
        preferHubDomain: autoBrand.preferHubDomain,
        rawDomain: domain,
      };
    }
  }

  for (const { domain, source } of candidates) {
    if (isGenericEmailDomain(domain)) continue;
    return {
      groupKey: domain,
      source,
      rawDomain: domain,
    };
  }

  if (props.name && families.length > 0) {
    const hasDomain = candidates.some(
      (c) => c.domain && !isGenericEmailDomain(c.domain),
    );
    if (!hasDomain) {
      for (const family of families) {
        if (nameMatchesFamily(props.name, family)) {
          return {
            groupKey: family.canonicalKey,
            source: 'corporate',
            familyId: family.id,
            preferHubDomain: family.preferHubDomain || family.canonicalKey,
            rawDomain: null,
          };
        }
      }
    }
  }

  return null;
}
