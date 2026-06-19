import { normalizeDomain, isGenericEmailDomain } from './domain.js';

/** @typedef {{ id: string, name: string, properties: Record<string, string> }} MergeCompany */

/**
 * @typedef {Object} MergeGroup
 * @property {string} matchKey
 * @property {'name' | 'domain'} matchType
 * @property {string} primaryId
 * @property {string} primaryName
 * @property {string[]} mergeIds
 * @property {MergeCompany[]} companies
 */

/**
 * @typedef {Object} MergeOptions
 * @property {boolean} [dryRun]
 * @property {string | null} [dominio]
 * @property {string | null} [nombre]
 * @property {string[]} [companyIds]
 * @property {number | null} [maxGroups]
 * @property {boolean} [confirmFullRun]
 */

/**
 * @typedef {Object} MergeStats
 * @property {number} totalCompanies
 * @property {number} eligibleCompanies
 * @property {number} skippedInactive
 * @property {number} skippedOnlyProveedor
 * @property {number} skippedNoName
 * @property {number} mergeGroups
 * @property {number} mergesPlanned
 * @property {number} mergesApplied
 * @property {number} mergesSkipped
 * @property {number} mergesFailed
 */

/**
 * @param {string | null | undefined} name
 * @returns {string | null}
 */
export function normalizeCompanyName(name) {
  if (!name || typeof name !== 'string') return null;

  const value = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value || value === '(sin nombre)') return null;

  return value;
}

/**
 * @param {string | null | undefined} estado
 */
export function isInactiveCompany(estado) {
  return (estado || '').trim().toLowerCase() === 'inactive';
}

/**
 * Descarta empresas cuyo tipo de relación sea únicamente "proveedor".
 * @param {string | null | undefined} tipoRelacion
 */
export function isOnlyProveedor(tipoRelacion) {
  if (!tipoRelacion || typeof tipoRelacion !== 'string') return false;

  const normalized = tipoRelacion.trim().toLowerCase();
  if (!normalized) return false;

  const parts = normalized
    .split(/[,;\/|]+|\s+y\s+|\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return false;

  const proveedorValues = new Set(['proveedor', 'supplier']);
  return parts.length === 1 && proveedorValues.has(parts[0]);
}

/**
 * @param {MergeCompany} company
 */
export function isEligibleForMerge(company) {
  const props = company.properties || {};

  if (isInactiveCompany(props.estado)) return false;
  if (isOnlyProveedor(props.tipo_relacion_negocio)) return false;

  return true;
}

/**
 * @param {Record<string, string>} properties
 */
export function hasNavAccountCode(properties) {
  return Boolean(properties.codigo_cuenta_nav?.trim());
}

/**
 * @param {Record<string, string>} properties
 */
export function countAssociatedContacts(properties) {
  const value = Number(properties.num_associated_contacts);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * @param {Record<string, string>} properties
 */
export function countFilledProperties(properties) {
  return Object.values(properties).filter((value) => {
    if (value == null) return false;
    return String(value).trim() !== '';
  }).length;
}

/**
 * @param {MergeCompany} a
 * @param {MergeCompany} b
 * @returns {number}
 */
export function comparePrimaryCompany(a, b) {
  const navA = hasNavAccountCode(a.properties);
  const navB = hasNavAccountCode(b.properties);
  if (navA !== navB) return navB ? 1 : -1;

  const contactsA = countAssociatedContacts(a.properties);
  const contactsB = countAssociatedContacts(b.properties);
  if (contactsA !== contactsB) return contactsB - contactsA;

  const infoA = countFilledProperties(a.properties);
  const infoB = countFilledProperties(b.properties);
  if (infoA !== infoB) return infoB - infoA;

  const createdA =
    Date.parse(a.properties.createdate || '') || Number.MAX_SAFE_INTEGER;
  const createdB =
    Date.parse(b.properties.createdate || '') || Number.MAX_SAFE_INTEGER;
  if (createdA !== createdB) return createdA - createdB;

  return a.id.localeCompare(b.id);
}

/**
 * @param {MergeCompany[]} companies
 * @returns {MergeCompany}
 */
export function pickPrimaryCompany(companies) {
  return [...companies].sort(comparePrimaryCompany)[0];
}

/**
 * @param {MergeCompany[]} members
 * @returns {string}
 */
function groupMemberSignature(members) {
  return members
    .map((company) => company.id)
    .sort()
    .join('|');
}

/**
 * @param {string} matchKey
 * @param {'name' | 'domain'} matchType
 * @param {MergeCompany[]} members
 * @returns {MergeGroup}
 */
function buildDirectMergeGroup(matchKey, matchType, members) {
  const primary = pickPrimaryCompany(members);
  const mergeIds = members
    .map((company) => company.id)
    .filter((id) => id !== primary.id);

  return {
    matchKey,
    matchType,
    primaryId: primary.id,
    primaryName: primary.name,
    mergeIds,
    companies: members,
  };
}

/**
 * @param {string | null | undefined} haystack
 * @param {string} needle
 */
function containsIgnoreCase(haystack, needle) {
  if (!haystack || !needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * @param {MergeGroup[]} groups
 * @param {MergeOptions} options
 */
export function filterMergeGroups(groups, options) {
  let filtered = groups;

  if (options.dominio) {
    filtered = filtered.filter((group) =>
      group.companies.some((company) =>
        containsIgnoreCase(company.properties.domain, options.dominio),
      ),
    );
  }

  if (options.nombre) {
    filtered = filtered.filter((group) =>
      group.companies.some((company) =>
        containsIgnoreCase(company.name, options.nombre) ||
        containsIgnoreCase(company.properties.domain, options.nombre),
      ),
    );
  }

  if (options.companyIds?.length) {
    const idSet = new Set(options.companyIds.map(String));
    filtered = filtered.filter((group) =>
      group.companies.some((company) => idSet.has(company.id)),
    );
  }

  if (options.maxGroups != null && filtered.length > options.maxGroups) {
    filtered = filtered.slice(0, options.maxGroups);
  }

  return filtered;
}

/**
 * Agrupa solo por coincidencia directa de nombre o dominio (sin union-find).
 * @param {MergeCompany[]} companies
 */
export function buildMergeGroups(companies) {
  let skippedInactive = 0;
  let skippedOnlyProveedor = 0;
  let skippedNoName = 0;

  /** @type {MergeCompany[]} */
  const eligible = [];

  for (const company of companies) {
    const props = company.properties || {};

    if (isInactiveCompany(props.estado)) {
      skippedInactive += 1;
      continue;
    }

    if (isOnlyProveedor(props.tipo_relacion_negocio)) {
      skippedOnlyProveedor += 1;
      continue;
    }

    if (!normalizeCompanyName(company.name)) {
      skippedNoName += 1;
    }

    eligible.push(company);
  }

  /** @type {Map<string, MergeCompany[]>} */
  const byName = new Map();
  /** @type {Map<string, MergeCompany[]>} */
  const byDomain = new Map();

  for (const company of eligible) {
    const normalizedName = normalizeCompanyName(company.name);
    if (normalizedName) {
      if (!byName.has(normalizedName)) byName.set(normalizedName, []);
      byName.get(normalizedName).push(company);
    }

    const normalizedDomain = normalizeDomain(company.properties.domain);
    if (normalizedDomain && !isGenericEmailDomain(normalizedDomain)) {
      if (!byDomain.has(normalizedDomain)) byDomain.set(normalizedDomain, []);
      byDomain.get(normalizedDomain).push(company);
    }
  }

  /** @type {MergeGroup[]} */
  const groups = [];
  /** @type {Set<string>} */
  const seenMemberSets = new Set();

  for (const [name, members] of byName) {
    if (members.length < 2) continue;

    const signature = groupMemberSignature(members);
    if (seenMemberSets.has(signature)) continue;
    seenMemberSets.add(signature);

    groups.push(buildDirectMergeGroup(name, 'name', members));
  }

  for (const [domain, members] of byDomain) {
    if (members.length < 2) continue;

    const signature = groupMemberSignature(members);
    if (seenMemberSets.has(signature)) continue;
    seenMemberSets.add(signature);

    groups.push(buildDirectMergeGroup(domain, 'domain', members));
  }

  groups.sort(
    (a, b) =>
      b.companies.length - a.companies.length ||
      a.matchKey.localeCompare(b.matchKey),
  );

  return {
    groups,
    stats: {
      eligibleCompanies: eligible.length,
      skippedInactive,
      skippedOnlyProveedor,
      skippedNoName,
    },
  };
}

/**
 * @param {MergeGroup[]} groups
 */
export function mergeOperationsFromGroups(groups) {
  /** @type {Array<{ primaryId: string, mergeId: string, groupKey: string, matchType: 'name' | 'domain' }>} */
  const operations = [];

  for (const group of groups) {
    for (const mergeId of group.mergeIds) {
      operations.push({
        primaryId: group.primaryId,
        mergeId,
        groupKey: group.matchKey,
        matchType: group.matchType,
      });
    }
  }

  return operations;
}

/**
 * @param {string} message
 * @returns {string | null}
 */
export function extractForwardReferenceId(message) {
  const match = message.match(/forward reference to (\d+)/i);
  return match ? match[1] : null;
}

/**
 * @param {import('./hubspot.js').HubSpotClient} client
 * @param {string} primaryId
 * @param {string} mergeId
 */
export async function mergeIntoPrimary(client, primaryId, mergeId) {
  if (mergeId === primaryId) {
    return {
      status: 'skipped',
      mergeId,
      error: 'El ID coincide con el registro principal',
    };
  }

  try {
    await client.mergeCompanies(primaryId, mergeId);
    return { status: 'merged', mergeId, canonicalId: mergeId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const canonicalId = extractForwardReferenceId(message);

    if (canonicalId === primaryId) {
      return {
        status: 'skipped',
        mergeId,
        canonicalId,
        error: 'Ya fusionado en el registro principal',
      };
    }

    if (canonicalId && canonicalId !== mergeId) {
      try {
        await client.mergeCompanies(primaryId, canonicalId);
        return {
          status: 'merged',
          mergeId,
          canonicalId,
          viaCanonical: true,
        };
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : String(retryError);
        return {
          status: 'failed',
          mergeId,
          canonicalId,
          error: retryMessage,
        };
      }
    }

    return { status: 'failed', mergeId, error: message };
  }
}

/**
 * @param {MergeGroup[]} groups
 */
export function groupsToCsvRows(groups) {
  /** @type {Record<string, string>[]} */
  const rows = [];

  for (const group of groups) {
    for (const company of group.companies) {
      rows.push({
        match_key: group.matchKey,
        match_type: group.matchType,
        group_size: String(group.companies.length),
        is_primary: company.id === group.primaryId ? 'yes' : 'no',
        company_id: company.id,
        company_name: company.name || '(sin nombre)',
        domain: company.properties.domain || '',
        estado: company.properties.estado || '',
        tipo_relacion_negocio: company.properties.tipo_relacion_negocio || '',
        codigo_cuenta_nav: company.properties.codigo_cuenta_nav || '',
        num_associated_contacts:
          company.properties.num_associated_contacts || '0',
      });
    }
  }

  return rows;
}

/**
 * @param {Array<{ primaryId: string, mergeId: string, groupKey: string, matchType?: string, status: string, error?: string, canonicalId?: string, viaCanonical?: boolean }>} results
 */
export function resultsToCsvRows(results) {
  return results.map((result) => ({
    group_key: result.groupKey,
    match_type: result.matchType || '',
    primary_id: result.primaryId,
    merge_id: result.mergeId,
    canonical_id: result.canonicalId || '',
    status: result.status,
    via_canonical: result.viaCanonical ? 'yes' : 'no',
    error: result.error || '',
  }));
}

export const MERGE_CSV_HEADERS = [
  'match_key',
  'match_type',
  'group_size',
  'is_primary',
  'company_id',
  'company_name',
  'domain',
  'estado',
  'tipo_relacion_negocio',
  'codigo_cuenta_nav',
  'num_associated_contacts',
];

export const MERGE_RESULTS_CSV_HEADERS = [
  'group_key',
  'match_type',
  'primary_id',
  'merge_id',
  'canonical_id',
  'status',
  'via_canonical',
  'error',
];

/**
 * @param {import('./hubspot.js').HubSpotClient} client
 * @param {MergeCompany[]} companies
 * @param {MergeOptions} options
 */
export async function runCompanyMerge(client, companies, options = {}) {
  const dryRun = options.dryRun !== false;
  const hasFilters = Boolean(
    options.dominio ||
      options.nombre ||
      (options.companyIds && options.companyIds.length > 0) ||
      options.maxGroups,
  );

  if (!dryRun && !hasFilters && !options.confirmFullRun) {
    throw new Error(
      'Fusión masiva bloqueada por seguridad. Usa dryRun=true, filtros o confirmFullRun=true.',
    );
  }

  const { groups, stats: buildStats } = buildMergeGroups(companies);
  const filteredGroups = filterMergeGroups(groups, options);
  const operations = mergeOperationsFromGroups(filteredGroups);

  /** @type {MergeStats} */
  const stats = {
    totalCompanies: companies.length,
    eligibleCompanies: buildStats.eligibleCompanies,
    skippedInactive: buildStats.skippedInactive,
    skippedOnlyProveedor: buildStats.skippedOnlyProveedor,
    skippedNoName: buildStats.skippedNoName,
    mergeGroups: filteredGroups.length,
    mergesPlanned: operations.length,
    mergesApplied: 0,
    mergesSkipped: 0,
    mergesFailed: 0,
  };

  /** @type {Array<{ primaryId: string, mergeId: string, groupKey: string, matchType: 'name' | 'domain', status: string, error?: string, canonicalId?: string, viaCanonical?: boolean }>} */
  const results = [];

  if (dryRun) {
    for (const operation of operations) {
      results.push({ ...operation, status: 'planned' });
    }
    return { dryRun: true, stats, groups: filteredGroups, results };
  }

  for (const group of filteredGroups) {
    const primaryId = group.primaryId;

    for (const mergeId of group.mergeIds) {
      const outcome = await mergeIntoPrimary(client, primaryId, mergeId);

      results.push({
        primaryId,
        mergeId,
        groupKey: group.matchKey,
        matchType: group.matchType,
        status: outcome.status,
        error: outcome.error,
        canonicalId: outcome.canonicalId,
        viaCanonical: outcome.viaCanonical,
      });

      if (outcome.status === 'merged') stats.mergesApplied += 1;
      else if (outcome.status === 'skipped') stats.mergesSkipped += 1;
      else stats.mergesFailed += 1;
    }
  }

  return { dryRun: false, stats, groups: filteredGroups, results };
}
