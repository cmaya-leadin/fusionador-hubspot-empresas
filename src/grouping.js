import { readFile } from 'node:fs/promises';
import {
  familyByCanonicalKey,
  resolveGroupKey,
  resolveManualGroupKey,
} from './corporate.js';
import { rootDomainProp } from './config.js';
import { normalizeDomain } from './domain.js';

/**
 * @typedef {{ id: string, name: string, groupKey: string | null, source: string, familyId?: string, preferHubDomain?: string, rawDomain?: string | null, properties: Record<string, string> }} CompanyRecord
 * @typedef {{ groupKey: string, hubId: string, memberIds: string[], companies: CompanyRecord[], familyId?: string }} CompanyGroup
 */

/**
 * @param {Array<{ id: string, properties: Record<string, string> }>} rawCompanies
 * @param {import('./corporate.js').CorporateFamily[]} [families]
 * @param {Map<string, import('./brand-key.js').BrandRegistryEntry>} [brandRegistry]
 * @returns {CompanyRecord[]}
 */
export function mapCompanies(rawCompanies, families = [], brandRegistry = new Map()) {
  return rawCompanies.map((c) => {
    const props = c.properties || {};
    const resolved = resolveGroupKey(
      {
        domain: props.domain,
        email_de_empresa: props.email_de_empresa,
        dominio_raiz: props[rootDomainProp],
        name: props.name,
      },
      families,
      brandRegistry,
    );

    return {
      id: String(c.id),
      name: props.name || '(sin nombre)',
      groupKey: resolved?.groupKey ?? null,
      source: resolved?.source ?? 'sin_clave',
      familyId: resolved?.familyId,
      preferHubDomain: resolved?.preferHubDomain,
      rawDomain: resolved?.rawDomain ?? normalizeDomain(props.domain),
      properties: props,
    };
  });
}

/**
 * @param {CompanyRecord[]} companies
 * @param {Map<string, string>} [manualGroupByCompanyId]
 * @param {import('./corporate.js').CorporateFamily[]} [families]
 * @returns {CompanyGroup[]}
 */
export function buildGroups(
  companies,
  manualGroupByCompanyId = new Map(),
  families = [],
) {
  /** @type {Map<string, CompanyRecord[]>} */
  const buckets = new Map();

  for (const company of companies) {
    const manualKey = manualGroupByCompanyId.get(company.id);
    const key = manualKey
      ? resolveManualGroupKey(manualKey, families)
      : company.groupKey;
    if (!key) continue;

    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(company);
  }

  /** @type {CompanyGroup[]} */
  const groups = [];

  for (const [groupKey, members] of buckets) {
    if (members.length < 2) continue;

    const family = familyByCanonicalKey(families, groupKey);
    const preferHub =
      family?.preferHubDomain ||
      members.find((m) => m.preferHubDomain)?.preferHubDomain;

    const hub = pickHubCompany(members, preferHub);
    const memberIds = members.map((m) => m.id);

    groups.push({
      groupKey,
      hubId: hub.id,
      memberIds,
      companies: members,
      familyId: family?.id || members.find((m) => m.familyId)?.familyId,
    });
  }

  groups.sort((a, b) => b.memberIds.length - a.memberIds.length);
  return groups;
}

/**
 * Hub: 1) dominio preferido (ej. ravago.com), 2) más antigua por createdate.
 * @param {CompanyRecord[]} members
 * @param {string | undefined} preferHubDomain
 */
function pickHubCompany(members, preferHubDomain) {
  if (preferHubDomain) {
    const prefer = preferHubDomain.toLowerCase();
    const byDomain = members.find((m) => {
      const d = normalizeDomain(m.properties.domain);
      const root = normalizeDomain(m.properties[rootDomainProp]);
      return (
        d === prefer ||
        root === prefer ||
        d?.endsWith(`.${prefer}`) ||
        (d?.includes('ravago') && d.endsWith('.com') && prefer === 'ravago.com')
      );
    });
    if (byDomain) return byDomain;

    const byName = members.find((m) => {
      const d = normalizeDomain(m.properties.domain);
      const n = (m.name || '').toLowerCase();
      return (
        d === prefer ||
        (n.includes('ravago') &&
          (n.includes('coordination') ||
            n.includes('centro') ||
            n.includes('distribution') ||
            d === prefer))
      );
    });
    if (byName) return byName;
  }

  return [...members].sort((a, b) => {
    const da =
      Date.parse(a.properties.createdate || '') || Number.MAX_SAFE_INTEGER;
    const db =
      Date.parse(b.properties.createdate || '') || Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * @param {CompanyGroup} group
 * @returns {Array<{ fromId: string, toId: string }>}
 */
export function associationPairsForGroup(group) {
  const pairs = [];
  const hubId = group.hubId;

  for (const memberId of group.memberIds) {
    if (memberId === hubId) continue;
    pairs.push({ fromId: hubId, toId: memberId });
  }

  return pairs;
}

/**
 * @param {string} filePath
 * @returns {Promise<Map<string, string>>}
 */
export async function loadManualGroups(filePath) {
  const map = new Map();
  let content;

  try {
    content = await readFile(filePath, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return map;
    }
    throw err;
  }

  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0]?.toLowerCase();
  const start = header?.includes('company_id') ? 1 : 0;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const [companyId, grupoId] = line.split(',').map((s) => s.trim());
    if (!companyId || !grupoId) continue;
    map.set(companyId, grupoId);
  }

  return map;
}
