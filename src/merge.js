import { normalizeDomain, isGenericEmailDomain } from './domain.js';
import { parseMergeCriteria, getMinNameWords } from './merge-criteria.js';
import {
  MERGE_CONCURRENCY,
  MERGE_DELAY_MS,
  MERGE_MAX_ATTEMPTS,
  MERGE_RETRY_BASE_MS,
  MERGE_RETRY_MAX_MS,
  MERGE_SETTLE_MS,
  MERGE_SAME_PRIMARY_SETTLE_MS,
  MERGE_SKIP_PREFLIGHT,
} from './merge-config.js';
import {
  isRecordExcludedFromMerge,
  splitMembersByGroupExclusions,
  usesGenericDomainExclusion,
} from './merge-exclusions.js';

/** @typedef {{ id: string, name: string, properties: Record<string, string> }} MergeRecord */

/**
 * @typedef {Object} MergeGroup
 * @property {string} matchKey
 * @property {string} matchType
 * @property {string} [matchLabel]
 * @property {string} primaryId
 * @property {string} primaryName
 * @property {string[]} mergeIds
 * @property {MergeRecord[]} records
 */

/**
 * @typedef {Object} MergeOptions
 * @property {boolean} [dryRun]
 * @property {string | null} [dominio]
 * @property {string | null} [nombre]
 * @property {string[]} [recordIds]
 * @property {number | null} [maxGroups]
 * @property {boolean} [confirmFullRun]
 * @property {import('./merge-criteria.js').MergeCriteria} [criteria]
 * @property {'companies' | 'contacts'} [entityType]
 * @property {ReturnType<import('./merge-progress.js').createMergeProgress> | null} [onProgress]
 */

/**
 * @typedef {Object} MergeStats
 * @property {number} totalRecords
 * @property {number} eligibleRecords
 * @property {number} skippedInactive
 * @property {number} skippedOnlyProveedor
 * @property {number} skippedNoName
 * @property {number} mergeGroups
 * @property {number} mergesPlanned
 * @property {number} [mergesConsolidated]
 * @property {number} mergesApplied
 * @property {number} mergesSkipped
 * @property {number} mergesFailed
 */

/**
 * Texto para comparar: minúsculas, sin acentos y espacios unificados (no distingue MAYÚSCULAS/minúsculas).
 * @param {string | null | undefined} text
 */
export function normalizeForMatch(text) {
  if (!text || typeof text !== 'string') return null;
  let value = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value || value === '(sin nombre)') return null;
  value = value.normalize('NFD').replace(/\p{M}/gu, '');
  return value || null;
}

/**
 * @param {string | null | undefined} name
 */
export function normalizeCompanyName(name) {
  return normalizeForMatch(name);
}

/**
 * Normaliza nombre de contacto: tokens ordenados (tolera "Marchal Sandrine" vs "Sandrine Marchal").
 * @param {string | null | undefined} name
 */
export function normalizeContactName(name) {
  const base = normalizeForMatch(name);
  if (!base) return null;
  const tokens = base.split(' ').filter(Boolean).sort();
  return tokens.length ? tokens.join(' ') : null;
}

/**
 * Cuenta palabras del nombre visible (sin ordenar tokens).
 * @param {MergeRecord} record
 * @param {'companies' | 'contacts'} [entityType]
 */
export function countDisplayNameWords(record, entityType = 'contacts') {
  const display = getRecordDisplayName(record);
  const base = normalizeForMatch(display);
  if (!base) return 0;
  return base.split(' ').filter(Boolean).length;
}

/**
 * Extrae el mejor valor de teléfono disponible en un contacto HubSpot.
 * @param {Record<string, string>} properties
 */
export function getContactPhoneRaw(properties) {
  const candidates = [
    properties.phone,
    properties.mobilephone,
    properties.hs_calculated_phone_number,
    properties.hs_searchable_calculated_international_phone_number,
    properties.hs_whatsapp_phone_number,
  ];
  for (const value of candidates) {
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

/**
 * Normaliza teléfono para comparación. Unifica formatos ES (+34 / 0034 / sin prefijo).
 * @param {string | null | undefined} phone
 */
export function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;

  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (digits.length < 6) return null;

  // España: unificar a 9 dígitos nacionales (móvil/fijo)
  if (digits.startsWith('34') && digits.length >= 11) {
    return digits.slice(-9);
  }
  if (digits.length === 9 && /^[6-9]/.test(digits)) {
    return digits;
  }
  if (digits.length === 10 && digits.startsWith('0')) {
    return digits.slice(1);
  }

  // Otros países: si ambos tienen prefijo distinto, conservar últimos 9+ dígitos como fallback
  if (digits.length > 12) {
    return digits.slice(-10);
  }

  return digits;
}

/**
 * @param {MergeRecord} record
 */
export function getRecordDisplayName(record) {
  if (record.name?.trim()) return record.name.trim();
  const p = record.properties || {};
  const first = p.firstname?.trim() || '';
  const last = p.lastname?.trim() || '';
  const full = `${first} ${last}`.trim();
  return full || p.email?.trim() || '(sin nombre)';
}

/**
 * @param {string | null | undefined} email
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const value = email.trim().toLowerCase();
  return value.includes('@') ? value : null;
}

/**
 * @param {string | null | undefined} estado
 * @param {string} inactiveValue
 */
export function isInactiveRecord(estado, inactiveValue = 'inactive') {
  return (estado || '').trim().toLowerCase() === inactiveValue.toLowerCase();
}

/**
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
 * @param {MergeRecord} record
 */
export function getRecordNormalizedPhone(record) {
  return normalizePhone(getContactPhoneRaw(record.properties || {}));
}

/**
 * Agrupa contactos con teléfonos compatibles (atajo sobre clusterMembersByCompatibleValues).
 * @param {MergeRecord[]} members
 * @returns {MergeRecord[][]}
 */
export function clusterMembersByCompatiblePhone(members) {
  return splitMembersByGroupExclusions(
    members,
    { exclusionRules: [{ type: 'different_phones' }] },
    'contacts',
    ['name'],
  ).clusters.filter((c) => c.length >= 2);
}

/**
 * @param {MergeRecord} record
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 * @param {'companies' | 'contacts'} [entityType]
 */
export function isEligibleForMerge(record, criteria, entityType = 'companies') {
  return !isRecordExcludedFromMerge(record, criteria, entityType);
}

/**
 * @param {Record<string, string>} properties
 * @param {string | null} navProperty
 */
export function hasNavAccountCode(properties, navProperty = 'codigo_cuenta_nav') {
  if (!navProperty) return false;
  return Boolean(properties[navProperty]?.trim());
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
 * @param {MergeRecord} record
 * @param {string} prop
 * @param {'companies' | 'contacts'} entityType
 */
export function getMatchPropertyValue(record, prop, entityType = 'companies') {
  const props = record.properties || {};

  switch (prop) {
    case 'name':
      if (entityType === 'contacts') {
        return normalizeContactName(getRecordDisplayName(record));
      }
      return normalizeCompanyName(getRecordDisplayName(record));
    case 'firstname':
      return normalizeForMatch(props.firstname);
    case 'lastname':
      return normalizeForMatch(props.lastname);
    case 'email':
      return normalizeEmail(props.email);
    case 'phone':
      return normalizePhone(getContactPhoneRaw(props));
    case 'mobilephone':
      return normalizePhone(getContactPhoneRaw(props));
    case 'domain': {
      const domain = normalizeDomain(props.domain);
      return domain || null;
    }
    default: {
      const val = props[prop];
      if (val == null || String(val).trim() === '') return null;
      return normalizeForMatch(String(val));
    }
  }
}

/**
 * @param {MergeRecord} record
 * @param {string[]} properties
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 * @param {'companies' | 'contacts'} entityType
 */
export function buildCompositeMatchKey(record, properties, criteria, entityType) {
  const minNameWords = getMinNameWords(criteria);
  if (minNameWords >= 2 && properties.includes('name')) {
    if (countDisplayNameWords(record, entityType) < minNameWords) return null;
  }

  const parts = [];

  for (const prop of properties) {
    let value = getMatchPropertyValue(record, prop, entityType);

    if (prop === 'domain' && value && usesGenericDomainExclusion(criteria)) {
      if (isGenericEmailDomain(value)) return null;
    }

    if (!value) return null;
    parts.push(`${prop}:${value}`);
  }

  return parts.join('|');
}

/**
 * @param {import('./merge-criteria.js').PrimaryRule} rule
 * @param {MergeCriteria} criteria
 */
function resolvePrimaryRule(rule, criteria) {
  if (typeof rule === 'string') {
    switch (rule) {
      case 'nav_code':
        return { type: 'property_filled', property: criteria.navProperty || 'codigo_cuenta_nav' };
      case 'contacts':
        return { type: 'max_associations', property: 'num_associated_contacts' };
      case 'filled_props':
        return { type: 'max_filled_props' };
      case 'createdate':
        return { type: 'oldest', property: 'createdate' };
      case 'id':
        return { type: 'min_id' };
      default:
        return { type: 'property_filled', property: rule };
    }
  }
  return rule;
}

/**
 * @param {Record<string, string>} properties
 * @param {string} property
 */
function getDateValue(properties, property) {
  const raw = properties[property];
  if (!raw) return 0;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * @param {Record<string, string>} properties
 * @param {string} property
 */
function getNumericProperty(properties, property) {
  const value = Number(properties[property]);
  return Number.isFinite(value) ? value : 0;
}

/**
 * @param {MergeRecord} a
 * @param {MergeRecord} b
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 */
export function comparePrimaryRecord(a, b, criteria) {
  const rules = criteria.primaryRules?.length
    ? criteria.primaryRules
    : [{ type: 'max_filled_props' }, { type: 'min_id' }];

  for (const rawRule of rules) {
    const rule = resolvePrimaryRule(rawRule, criteria);
    let cmp = 0;

    switch (rule.type) {
      case 'property_filled': {
        const prop = rule.property || '';
        const filledA = Boolean(a.properties[prop]?.trim());
        const filledB = Boolean(b.properties[prop]?.trim());
        if (filledA !== filledB) cmp = filledB ? 1 : -1;
        break;
      }
      case 'max_associations': {
        const prop = rule.property || 'num_associated_contacts';
        const valA = getNumericProperty(a.properties, prop);
        const valB = getNumericProperty(b.properties, prop);
        if (valA !== valB) cmp = valB - valA;
        break;
      }
      case 'most_recent': {
        const prop = rule.property || 'hs_lastmodifieddate';
        const dateA = getDateValue(a.properties, prop) ||
          getDateValue(a.properties, 'lastmodifieddate') ||
          getDateValue(a.properties, 'createdate');
        const dateB = getDateValue(b.properties, prop) ||
          getDateValue(b.properties, 'lastmodifieddate') ||
          getDateValue(b.properties, 'createdate');
        if (dateA !== dateB) cmp = dateB - dateA;
        break;
      }
      case 'oldest': {
        const prop = rule.property || 'createdate';
        const dateA = getDateValue(a.properties, prop) || Number.MAX_SAFE_INTEGER;
        const dateB = getDateValue(b.properties, prop) || Number.MAX_SAFE_INTEGER;
        if (dateA !== dateB) cmp = dateA - dateB;
        break;
      }
      case 'max_filled_props': {
        const infoA = countFilledProperties(a.properties);
        const infoB = countFilledProperties(b.properties);
        if (infoA !== infoB) cmp = infoB - infoA;
        break;
      }
      case 'min_id':
        cmp = a.id.localeCompare(b.id);
        break;
      // Compatibilidad legacy
      case 'nav_code': {
        const navA = hasNavAccountCode(a.properties, criteria.navProperty);
        const navB = hasNavAccountCode(b.properties, criteria.navProperty);
        if (navA !== navB) cmp = navB ? 1 : -1;
        break;
      }
      case 'contacts': {
        const contactsA = countAssociatedContacts(a.properties);
        const contactsB = countAssociatedContacts(b.properties);
        if (contactsA !== contactsB) cmp = contactsB - contactsA;
        break;
      }
      case 'filled_props': {
        const infoA = countFilledProperties(a.properties);
        const infoB = countFilledProperties(b.properties);
        if (infoA !== infoB) cmp = infoB - infoA;
        break;
      }
      case 'createdate': {
        const createdA =
          Date.parse(a.properties.createdate || '') || Number.MAX_SAFE_INTEGER;
        const createdB =
          Date.parse(b.properties.createdate || '') || Number.MAX_SAFE_INTEGER;
        if (createdA !== createdB) cmp = createdA - createdB;
        break;
      }
      case 'id':
        cmp = a.id.localeCompare(b.id);
        break;
      default:
        break;
    }

    if (cmp !== 0) return cmp;
  }

  return a.id.localeCompare(b.id);
}

/**
 * @param {MergeRecord[]} records
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 */
export function pickPrimaryRecord(records, criteria) {
  return [...records].sort((a, b) => comparePrimaryRecord(a, b, criteria))[0];
}

/**
 * @param {MergeRecord[]} members
 */
function groupMemberSignature(members) {
  return members
    .map((r) => r.id)
    .sort()
    .join('|');
}

/**
 * @param {string} matchKey
 * @param {string} matchType
 * @param {MergeRecord[]} members
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 * @param {string} [matchLabel]
 */
function buildDirectMergeGroup(matchKey, matchType, members, criteria, matchLabel) {
  const primary = pickPrimaryRecord(members, criteria);
  const mergeIds = members.map((r) => r.id).filter((id) => id !== primary.id);

  return {
    matchKey,
    matchType,
    matchLabel: matchLabel || matchType,
    primaryId: primary.id,
    primaryName: getRecordDisplayName(primary),
    mergeIds,
    records: members,
  };
}

/**
 * @param {string | null | undefined} haystack
 * @param {string} needle
 */
function containsIgnoreCase(haystack, needle) {
  if (!needle) return false;
  const h = normalizeForMatch(String(haystack ?? '')) ?? '';
  const n = normalizeForMatch(String(needle)) ?? '';
  if (!n) return false;
  return h.includes(n);
}

/**
 * @param {MergeGroup[]} groups
 * @param {MergeOptions} options
 */
export function filterMergeGroups(groups, options) {
  let filtered = groups;

  if (options.dominio) {
    filtered = filtered.filter((group) =>
      group.records.some((r) =>
        containsIgnoreCase(r.properties.domain, options.dominio) ||
        containsIgnoreCase(r.properties.email, options.dominio),
      ),
    );
  }

  if (options.nombre) {
    filtered = filtered.filter((group) =>
      group.records.some(
        (r) =>
          containsIgnoreCase(r.name, options.nombre) ||
          containsIgnoreCase(getRecordDisplayName(r), options.nombre) ||
          containsIgnoreCase(r.properties.firstname, options.nombre) ||
          containsIgnoreCase(r.properties.lastname, options.nombre) ||
          containsIgnoreCase(r.properties.domain, options.nombre) ||
          containsIgnoreCase(r.properties.email, options.nombre),
      ),
    );
  }

  if (options.recordIds?.length) {
    const idSet = new Set(options.recordIds.map(String));
    filtered = filtered.filter((group) =>
      group.records.some((r) => idSet.has(r.id)),
    );
  }

  if (options.maxGroups != null && filtered.length > options.maxGroups) {
    filtered = filtered.slice(0, options.maxGroups);
  }

  return filtered;
}

/**
 * @param {MergeRecord[]} records
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 * @param {'companies' | 'contacts'} entityType
 */
export function buildMergeGroups(records, criteria, entityType = 'companies') {
  let skippedExcluded = 0;

  /** @type {MergeRecord[]} */
  const eligible = [];

  for (const record of records) {
    if (isRecordExcludedFromMerge(record, criteria, entityType)) {
      skippedExcluded += 1;
      continue;
    }

    eligible.push({
      ...record,
      name: getRecordDisplayName(record),
    });
  }

  /** @type {MergeGroup[]} */
  const groups = [];
  /** @type {Set<string>} */
  const seenMemberSets = new Set();
  let splitByGroupExclusions = 0;

  const matchRules = criteria.matchRules?.length
    ? criteria.matchRules
    : [{ properties: ['name'], label: 'Nombre' }];

  for (const matchRule of matchRules) {
    /** @type {Map<string, MergeRecord[]>} */
    const byCompositeKey = new Map();

    for (const record of eligible) {
      const key = buildCompositeMatchKey(
        record,
        matchRule.properties,
        criteria,
        entityType,
      );
      if (!key) continue;

      if (!byCompositeKey.has(key)) byCompositeKey.set(key, []);
      byCompositeKey.get(key).push(record);
    }

    const matchType = matchRule.properties.join('+');

    for (const [key, members] of byCompositeKey) {
      if (members.length < 2) continue;

      const { clusters: memberClusters, splitCount } = splitMembersByGroupExclusions(
        members,
        criteria,
        entityType,
        matchRule.properties,
      );

      if (splitCount > 0) splitByGroupExclusions += splitCount;

      for (const cluster of memberClusters) {
        if (cluster.length < 2) continue;

        const signature = groupMemberSignature(cluster);
        if (seenMemberSets.has(signature)) continue;
        seenMemberSets.add(signature);

        groups.push(
          buildDirectMergeGroup(
            key,
            matchType,
            cluster,
            criteria,
            matchRule.label || matchType,
          ),
        );
      }
    }
  }

  groups.sort(
    (a, b) =>
      b.records.length - a.records.length || a.matchKey.localeCompare(b.matchKey),
  );

  let recordsWithName = 0;
  let recordsWithPhone = 0;
  let recordsWithNameAndPhone = 0;

  if (entityType === 'contacts') {
    let recordsWithCompoundName = 0;
    let recordsWithSingleName = 0;
    for (const record of eligible) {
      const hasName = Boolean(normalizeContactName(record.name));
      const hasPhone = Boolean(normalizePhone(getContactPhoneRaw(record.properties)));
      if (hasName) recordsWithName += 1;
      if (hasPhone) recordsWithPhone += 1;
      if (hasName && hasPhone) recordsWithNameAndPhone += 1;
      const wordCount = countDisplayNameWords(record, entityType);
      if (wordCount >= 2) recordsWithCompoundName += 1;
      else if (wordCount === 1) recordsWithSingleName += 1;
    }
    return {
      groups,
      stats: {
        eligibleRecords: eligible.length,
        skippedExcluded,
        skippedInactive: skippedExcluded,
        skippedOnlyProveedor: 0,
        skippedNoName: 0,
        recordsWithName,
        recordsWithPhone,
        recordsWithNameAndPhone,
        recordsWithCompoundName,
        recordsWithSingleName,
        splitByGroupExclusions,
        splitByDifferentPhones: splitByGroupExclusions,
      },
    };
  }

  return {
    groups,
    stats: {
      eligibleRecords: eligible.length,
      skippedExcluded,
      skippedInactive: skippedExcluded,
      skippedOnlyProveedor: 0,
      skippedNoName: 0,
      recordsWithName,
      recordsWithPhone,
      recordsWithNameAndPhone,
      splitByGroupExclusions,
      splitByDifferentPhones: splitByGroupExclusions,
    },
  };
}

/**
 * Une grupos solapados (mismo contacto en varias reglas) en un único plan de fusión.
 * @param {MergeGroup[]} groups
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 */
export function consolidateMergeOperations(groups, criteria) {
  /** @type {Map<string, MergeRecord>} */
  const recordsById = new Map();
  /** @type {Map<string, string>} */
  const parent = new Map();

  function find(id) {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let current = id;
    while (parent.get(current) !== root) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  }

  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  for (const group of groups) {
    for (const record of group.records) {
      recordsById.set(record.id, record);
    }
    const ids = group.records.map((r) => r.id);
    for (let i = 1; i < ids.length; i++) {
      union(ids[0], ids[i]);
    }
  }

  /** @type {Map<string, MergeRecord[]>} */
  const components = new Map();
  for (const id of recordsById.keys()) {
    const root = find(id);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(recordsById.get(id));
  }

  /** @type {Array<{ primaryId: string, mergeId: string, groupKey: string, matchType: string, matchLabel?: string }>} */
  const operations = [];

  for (const members of components.values()) {
    if (members.length < 2) continue;

    const primary = pickPrimaryRecord(members, criteria);
    const relatedGroups = groups.filter((g) =>
      g.records.some((r) => members.some((m) => m.id === r.id)),
    );
    const matchKeys = [...new Set(relatedGroups.map((g) => g.matchKey))];
    const matchLabels = [...new Set(relatedGroups.map((g) => g.matchLabel || g.matchType))];
    const groupKey =
      matchKeys.length > 1 ? matchKeys.join(' | ') : matchKeys[0] || 'consolidado';
    const matchLabel =
      matchLabels.length > 1
        ? `Consolidado (${members.length} registros)`
        : matchLabels[0] || 'consolidado';

    for (const member of members) {
      if (member.id === primary.id) continue;
      operations.push({
        primaryId: primary.id,
        mergeId: member.id,
        groupKey,
        matchType: matchKeys.length > 1 ? 'consolidated' : relatedGroups[0]?.matchType || 'consolidated',
        matchLabel,
      });
    }
  }

  return operations;
}

/**
 * @param {MergeGroup[]} groups
 * @param {import('./merge-criteria.js').MergeCriteria} [criteria]
 */
export function mergeOperationsFromGroups(groups, criteria) {
  if (criteria && groups.length > 0) {
    return consolidateMergeOperations(groups, criteria);
  }

  /** @type {Array<{ primaryId: string, mergeId: string, groupKey: string, matchType: string }>} */
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
 */
export function extractForwardReferenceId(message) {
  const patterns = [
    /forward reference to (\d+)/i,
    /redirect(?:ed)? to (\d+)/i,
    /canonical (?:id |object )?(\d+)/i,
    /object (\d+) has been merged/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * @param {unknown} error
 */
function isRetryableHubSpotError(error) {
  if (!(error instanceof Error)) return false;
  const status =
    'hubspotStatus' in error
      ? Number(/** @type {{ hubspotStatus?: number }} */ (error).hubspotStatus)
      : 0;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const msg = error.message.toLowerCase();
  return msg.includes('internal_error') || msg.includes('error processing the request');
}

/**
 * @param {import('./hubspot.js').HubSpotClient} client
 * @param {'companies' | 'contacts'} entityType
 * @param {string} id
 */
async function contactExists(client, entityType, id) {
  if (entityType === 'contacts') {
    return client.getContact(id);
  }
  return client.getCompany(id);
}

/**
 * @param {import('./hubspot.js').HubSpotClient} client
 * @param {'companies' | 'contacts'} entityType
 * @param {string} primaryId
 * @param {string} mergeId
 * @param {{
 *   alreadyMergedIds?: Set<string>,
 *   verifiedPrimaries?: Set<string>,
 *   settleMs?: number,
 *   onLog?: (message: string) => void,
 * }} [opts]
 */
export async function mergeIntoPrimary(
  client,
  entityType,
  primaryId,
  mergeId,
  opts = {},
) {
  const alreadyMergedIds = opts.alreadyMergedIds;
  const verifiedPrimaries = opts.verifiedPrimaries;
  const onLog = opts.onLog;
  const settleAfterMs = opts.settleMs ?? MERGE_SETTLE_MS;

  if (mergeId === primaryId) {
    return {
      status: 'skipped',
      mergeId,
      error: 'El ID coincide con el registro principal',
    };
  }

  if (alreadyMergedIds?.has(mergeId)) {
    return {
      status: 'skipped',
      mergeId,
      error: 'Ya fusionado en una operación anterior de esta ejecución',
    };
  }

  const mergeFn =
    entityType === 'contacts'
      ? (p, m) => client.mergeContacts(p, m)
      : (p, m) => client.mergeCompanies(p, m);

  try {
    if (!MERGE_SKIP_PREFLIGHT) {
      const secondary = await contactExists(client, entityType, mergeId);
      if (!secondary) {
        alreadyMergedIds?.add(mergeId);
        return {
          status: 'skipped',
          mergeId,
          error: 'El contacto secundario ya no existe (probablemente fusionado antes)',
        };
      }
    }

    if (!verifiedPrimaries?.has(primaryId)) {
      if (!MERGE_SKIP_PREFLIGHT) {
        const primary = await contactExists(client, entityType, primaryId);
        if (!primary) {
          return {
            status: 'failed',
            mergeId,
            error: `El contacto principal ${primaryId} no existe en HubSpot`,
          };
        }
      }
      verifiedPrimaries?.add(primaryId);
    }

    let lastError = null;
    for (let attempt = 1; attempt <= MERGE_MAX_ATTEMPTS; attempt++) {
      try {
        await mergeFn(primaryId, mergeId);
        alreadyMergedIds?.add(mergeId);
        if (settleAfterMs > 0) {
          await sleep(settleAfterMs);
        }
        return { status: 'merged', mergeId, canonicalId: mergeId };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const correlationId =
          error instanceof Error && 'correlationId' in error
            ? String(/** @type {{ correlationId?: string }} */ (error).correlationId || '')
            : '';

        if (!isRetryableHubSpotError(error) || attempt >= MERGE_MAX_ATTEMPTS) {
          break;
        }

        const waitMs = Math.min(attempt * MERGE_RETRY_BASE_MS, MERGE_RETRY_MAX_MS);
        const waitSec = Math.max(1, Math.round(waitMs / 1000));
        onLog?.(
          `Reintento ${attempt}/${MERGE_MAX_ATTEMPTS} para ${mergeId} → ${primaryId} en ${waitSec}s` +
            (correlationId ? ` (${correlationId})` : ''),
        );
        await sleep(waitMs);
      }
    }

    const error = lastError;
    const message = error instanceof Error ? error.message : String(lastError);
    const correlationId =
      error instanceof Error && 'correlationId' in error
        ? String(/** @type {{ correlationId?: string }} */ (error).correlationId || '')
        : '';
    const canonicalId = extractForwardReferenceId(message);

    if (canonicalId === primaryId || canonicalId === mergeId) {
      alreadyMergedIds?.add(mergeId);
      return {
        status: 'skipped',
        mergeId,
        canonicalId,
        error: 'El contacto ya estaba fusionado en el principal',
        correlationId: correlationId || undefined,
      };
    }

    if (canonicalId && canonicalId !== mergeId) {
      try {
        await mergeFn(primaryId, canonicalId);
        alreadyMergedIds?.add(mergeId);
        alreadyMergedIds?.add(canonicalId);
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
          correlationId:
            retryError instanceof Error && 'correlationId' in retryError
              ? String(/** @type {{ correlationId?: string }} */ (retryError).correlationId || '')
              : correlationId || undefined,
        };
      }
    }

    const hint = classifyMergeError(message, error);
    return {
      status: 'failed',
      mergeId,
      error: correlationId ? `${message} · ${hint}` : `${message}. ${hint}`,
      correlationId: correlationId || undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed',
      mergeId,
      error: message,
      correlationId:
        error instanceof Error && 'correlationId' in error
          ? String(/** @type {{ correlationId?: string }} */ (error).correlationId || '')
          : undefined,
    };
  }
}

/**
 * @param {string} message
 * @param {unknown} error
 */
function classifyMergeError(message, error) {
  const lower = message.toLowerCase();
  if (lower.includes('500') || lower.includes('502') || lower.includes('503')) {
    return 'Error transitorio de HubSpot (reintenta más tarde o reduce el ritmo con MERGE_DELAY_MS)';
  }
  if (lower.includes('workflow') || lower.includes('enrollment')) {
    return 'Posible bloqueo por workflow activo en el contacto secundario';
  }
  if (lower.includes('not found') || lower.includes('object_not_found')) {
    return 'El contacto ya no existe o fue fusionado previamente';
  }
  if (lower.includes('invalid_merge') || lower.includes('cannot merge')) {
    return 'Conflicto de datos entre contactos (lifecycle stage, asociaciones, etc.)';
  }
  return 'Revisa en HubSpot ambos contactos manualmente o contacta soporte con el correlationId';
}

/**
 * @param {MergeGroup[]} groups
 */
export function groupsToCsvRows(groups) {
  const rows = [];

  for (const group of groups) {
    for (const record of group.records) {
      rows.push({
        match_key: group.matchKey,
        match_type: group.matchType,
        group_size: String(group.records.length),
        is_primary: record.id === group.primaryId ? 'yes' : 'no',
        record_id: record.id,
        record_name: record.name || '(sin nombre)',
        domain: record.properties.domain || '',
        email: record.properties.email || '',
        estado: record.properties.estado || '',
        tipo_relacion_negocio: record.properties.tipo_relacion_negocio || '',
        codigo_cuenta_nav: record.properties.codigo_cuenta_nav || '',
        num_associated_contacts: record.properties.num_associated_contacts || '0',
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
    correlation_id: result.correlationId || '',
  }));
}

export const MERGE_CSV_HEADERS = [
  'match_key',
  'match_type',
  'group_size',
  'is_primary',
  'record_id',
  'record_name',
  'domain',
  'email',
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
  'correlation_id',
];

/**
 * @param {import('./hubspot.js').HubSpotClient} client
 * @param {'companies' | 'contacts'} entityType
 * @param {Array<{ primaryId: string, mergeId: string, groupKey?: string, matchType?: string, matchLabel?: string }>} operations
 * @param {{ onLog?: (msg: string) => void, onStep?: (data: object) => void }} [callbacks]
 */
export async function executeMergeOperations(client, entityType, operations, callbacks = {}) {
  /** @type {Map<string, typeof operations>} */
  const byPrimary = new Map();
  for (const op of operations) {
    if (!byPrimary.has(op.primaryId)) byPrimary.set(op.primaryId, []);
    byPrimary.get(op.primaryId).push(op);
  }

  const primaryIds = [...byPrimary.keys()];
  const total = operations.length;
  const concurrency = Math.min(MERGE_CONCURRENCY, primaryIds.length);

  if (concurrency > 1) {
    callbacks.onLog?.(
      `Modo paralelo: ${concurrency} colas (${primaryIds.length} principales distintos)`,
    );
  }

  /** @type {Set<string>} */
  const alreadyMergedIds = new Set();
  /** @type {Set<string>} */
  const verifiedPrimaries = new Set();

  let progressCounter = 0;
  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  const stats = { mergesApplied: 0, mergesSkipped: 0, mergesFailed: 0 };

  async function processPrimaryQueue(primaryId) {
    const queue = byPrimary.get(primaryId) || [];

    for (let i = 0; i < queue.length; i++) {
      const op = queue[i];
      const nextSamePrimary = i + 1 < queue.length;
      const settleMs = nextSamePrimary ? MERGE_SAME_PRIMARY_SETTLE_MS : MERGE_SETTLE_MS;

      progressCounter += 1;
      const current = progressCounter;
      callbacks.onLog?.(`Fusionando ${current}/${total}: ${op.mergeId} → ${op.primaryId}`);

      const outcome = await mergeIntoPrimary(client, entityType, op.primaryId, op.mergeId, {
        alreadyMergedIds,
        verifiedPrimaries,
        settleMs,
        onLog: callbacks.onLog,
      });

      const status =
        outcome.status === 'merged'
          ? 'merged'
          : outcome.status === 'skipped'
            ? 'skipped'
            : 'failed';

      results.push({
        primaryId: op.primaryId,
        mergeId: op.mergeId,
        groupKey: op.groupKey,
        matchType: op.matchType,
        matchLabel: op.matchLabel,
        status: outcome.status,
        error: outcome.error,
        canonicalId: outcome.canonicalId,
        viaCanonical: outcome.viaCanonical,
        correlationId: outcome.correlationId,
      });

      if (outcome.status === 'merged') stats.mergesApplied += 1;
      else if (outcome.status === 'skipped') stats.mergesSkipped += 1;
      else stats.mergesFailed += 1;

      callbacks.onStep?.({
        current,
        total,
        primaryId: op.primaryId,
        mergeId: op.mergeId,
        status,
        error: outcome.error,
      });

      if (MERGE_DELAY_MS > 0 && i + 1 < queue.length) {
        await sleep(MERGE_DELAY_MS);
      }
    }
  }

  let nextPrimary = 0;

  async function worker() {
    while (true) {
      const idx = nextPrimary;
      nextPrimary += 1;
      if (idx >= primaryIds.length) break;
      await processPrimaryQueue(primaryIds[idx]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return { results, stats };
}

/**
 * @param {import('./hubspot.js').HubSpotClient} client
 * @param {MergeRecord[]} records
 * @param {MergeOptions} options
 */
export async function runEntityMerge(client, records, options = {}) {
  const dryRun = options.dryRun !== false;
  const entityType = options.entityType || 'companies';
  const criteria = parseMergeCriteria(options.criteria, entityType);

  const hasFilters = Boolean(
    options.dominio ||
      options.nombre ||
      (options.recordIds && options.recordIds.length > 0) ||
      options.maxGroups,
  );

  if (!dryRun && !hasFilters && !options.confirmFullRun) {
    throw new Error(
      'Fusión masiva bloqueada por seguridad. Usa simulación, filtros o confirmFullRun=true.',
    );
  }

  const { groups, stats: buildStats } = buildMergeGroups(
    records,
    criteria,
    entityType,
  );
  const filteredGroups = filterMergeGroups(groups, options);
  const rawOperationCount = filteredGroups.reduce(
    (sum, g) => sum + g.mergeIds.length,
    0,
  );
  const operations = mergeOperationsFromGroups(filteredGroups, criteria);
  const consolidatedSaved = Math.max(0, rawOperationCount - operations.length);

  /** @type {MergeStats} */
  const stats = {
    totalRecords: records.length,
    eligibleRecords: buildStats.eligibleRecords,
    skippedExcluded: buildStats.skippedExcluded ?? 0,
    skippedInactive: buildStats.skippedInactive ?? buildStats.skippedExcluded ?? 0,
    skippedOnlyProveedor: buildStats.skippedOnlyProveedor ?? 0,
    skippedNoName: buildStats.skippedNoName,
    recordsWithName: buildStats.recordsWithName ?? 0,
    recordsWithPhone: buildStats.recordsWithPhone ?? 0,
    recordsWithNameAndPhone: buildStats.recordsWithNameAndPhone ?? 0,
    recordsWithCompoundName: buildStats.recordsWithCompoundName ?? 0,
    recordsWithSingleName: buildStats.recordsWithSingleName ?? 0,
    splitByGroupExclusions: buildStats.splitByGroupExclusions ?? buildStats.splitByDifferentPhones ?? 0,
    splitByDifferentPhones: buildStats.splitByDifferentPhones ?? buildStats.splitByGroupExclusions ?? 0,
    mergeGroups: filteredGroups.length,
    mergesPlanned: operations.length,
    mergesConsolidated: consolidatedSaved,
    mergesApplied: 0,
    mergesSkipped: 0,
    mergesFailed: 0,
  };

  const results = [];

  if (dryRun) {
    for (const operation of operations) {
      results.push({ ...operation, status: 'planned' });
    }
    return { dryRun: true, stats, groups: filteredGroups, results, criteria };
  }

  if (consolidatedSaved > 0) {
    options.onProgress?.log(
      `Plan consolidado: ${operations.length} fusiones (${consolidatedSaved} duplicadas entre reglas omitidas)`,
    );
  }

  const { results: mergeResults, stats: mergeStats } = await executeMergeOperations(
    client,
    entityType,
    operations,
    {
      onLog: (msg) => options.onProgress?.log(msg),
      onStep: (data) => options.onProgress?.mergeStep(data),
    },
  );

  results.push(...mergeResults);
  stats.mergesApplied = mergeStats.mergesApplied;
  stats.mergesSkipped = mergeStats.mergesSkipped;
  stats.mergesFailed = mergeStats.mergesFailed;

  return { dryRun: false, stats, groups: filteredGroups, results, criteria };
}

// Alias para compatibilidad
export const pickPrimaryCompany = pickPrimaryRecord;
export const runCompanyMerge = runEntityMerge;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
