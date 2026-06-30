/**
 * @typedef {{ properties: string[], label?: string }} MatchRule
 * @typedef {{ type: string, property?: string }} PrimaryRule
 *
 * @typedef {Object} MergeCriteria
 * @property {MatchRule[]} matchRules
 * @property {PrimaryRule[]} primaryRules
 * @property {boolean} skipInactive
 * @property {boolean} skipOnlyProveedor
 * @property {boolean} excludeGenericDomains
 * @property {string | null} [navProperty]
 * @property {string | null} [inactiveProperty]
 * @property {string | null} [inactiveValue]
 * @property {boolean} [matchByName] @deprecated
 * @property {boolean} [matchByDomain] @deprecated
 * @property {boolean} [matchByEmail] @deprecated
 */

export const PRIMARY_RULE_OPTIONS = [
  { type: 'property_filled', label: 'Propiedad informada', needsProperty: true },
  { type: 'max_associations', label: 'Mayor nº de asociaciones', needsProperty: true },
  { type: 'most_recent', label: 'Datos más recientes', needsProperty: true },
  { type: 'oldest', label: 'Registro más antiguo', needsProperty: true },
  { type: 'max_filled_props', label: 'Más propiedades rellenas', needsProperty: false },
  { type: 'min_id', label: 'ID más bajo (desempate)', needsProperty: false },
];

export const MATCH_PROPERTY_PRESETS = {
  companies: [
    { value: 'name', label: 'Nombre' },
    { value: 'domain', label: 'Dominio' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Teléfono' },
    { value: 'vat_number___cif', label: 'CIF/VAT' },
  ],
  contacts: [
    { value: 'name', label: 'Nombre completo' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Teléfono' },
    { value: 'mobilephone', label: 'Móvil' },
    { value: 'company', label: 'Empresa' },
  ],
};

export const DEFAULT_MERGE_CRITERIA = {
  matchRules: [
    { properties: ['name'], label: 'Nombre' },
    { properties: ['domain'], label: 'Dominio' },
    { properties: ['name', 'domain'], label: 'Nombre + Dominio' },
  ],
  primaryRules: [
    { type: 'property_filled', property: 'codigo_cuenta_nav' },
    { type: 'max_associations', property: 'num_associated_contacts' },
    { type: 'max_filled_props' },
    { type: 'most_recent', property: 'hs_lastmodifieddate' },
    { type: 'oldest', property: 'createdate' },
    { type: 'min_id' },
  ],
  skipInactive: true,
  skipOnlyProveedor: true,
  excludeGenericDomains: true,
  navProperty: 'codigo_cuenta_nav',
  inactiveProperty: 'estado',
  inactiveValue: 'inactive',
};

export const DEFAULT_CONTACT_CRITERIA = {
  matchRules: [
    { properties: ['name', 'phone'], label: 'Nombre + Teléfono (modelo HubSpot)' },
    { properties: ['name', 'email'], label: 'Nombre + Email' },
    { properties: ['email'], label: 'Email' },
    { properties: ['phone'], label: 'Teléfono' },
  ],
  primaryRules: [
    { type: 'max_filled_props' },
    { type: 'most_recent', property: 'hs_lastmodifieddate' },
    { type: 'max_associations', property: 'num_associated_deals' },
    { type: 'oldest', property: 'createdate' },
    { type: 'min_id' },
  ],
  skipInactive: false,
  skipOnlyProveedor: false,
  excludeGenericDomains: true,
  navProperty: null,
  inactiveProperty: null,
  inactiveValue: null,
};

/**
 * @param {unknown} raw
 * @returns {MatchRule[]}
 */
function parseMatchRules(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && Array.isArray(r.properties) && r.properties.length > 0)
    .map((r) => ({
      properties: r.properties.map(String).filter(Boolean),
      label: r.label || r.properties.join(' + '),
    }));
}

/**
 * @param {unknown} raw
 * @param {import('./merge-criteria.js').MergeCriteria} defaults
 */
function parsePrimaryRules(raw, defaults) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return defaults.primaryRules.map((r) => ({ ...r }));
  }

  return raw.map((rule) => {
    if (typeof rule === 'string') {
      return legacyPrimaryRule(rule, defaults);
    }
    if (rule && typeof rule === 'object' && rule.type) {
      return {
        type: String(rule.type),
        property: rule.property ? String(rule.property) : undefined,
      };
    }
    return null;
  }).filter(Boolean);
}

/**
 * @param {string} rule
 * @param {MergeCriteria} defaults
 * @returns {PrimaryRule}
 */
function legacyPrimaryRule(rule, defaults) {
  switch (rule) {
    case 'nav_code':
      return { type: 'property_filled', property: defaults.navProperty || 'codigo_cuenta_nav' };
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

/**
 * @param {Partial<MergeCriteria> | string | null | undefined} raw
 * @param {'companies' | 'contacts'} entityType
 * @returns {MergeCriteria}
 */
export function parseMergeCriteria(raw, entityType = 'companies') {
  const defaults =
    entityType === 'contacts' ? DEFAULT_CONTACT_CRITERIA : DEFAULT_MERGE_CRITERIA;

  if (!raw) return structuredCloneDefaults(defaults);

  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return structuredCloneDefaults(defaults);
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return structuredCloneDefaults(defaults);
  }

  let matchRules = parseMatchRules(parsed.matchRules);

  if (matchRules.length === 0) {
    matchRules = legacyMatchRules(parsed, entityType);
  }

  if (matchRules.length === 0) {
    matchRules = defaults.matchRules.map((r) => ({ ...r, properties: [...r.properties] }));
  }

  return {
    matchRules,
    primaryRules: parsePrimaryRules(parsed.primaryRules, defaults),
    skipInactive: parsed.skipInactive ?? defaults.skipInactive,
    skipOnlyProveedor: parsed.skipOnlyProveedor ?? defaults.skipOnlyProveedor,
    excludeGenericDomains:
      parsed.excludeGenericDomains ?? defaults.excludeGenericDomains,
    navProperty: parsed.navProperty ?? defaults.navProperty,
    inactiveProperty: parsed.inactiveProperty ?? defaults.inactiveProperty,
    inactiveValue: parsed.inactiveValue ?? defaults.inactiveValue,
  };
}

/**
 * @param {MergeCriteria} defaults
 */
function structuredCloneDefaults(defaults) {
  return {
    ...defaults,
    matchRules: defaults.matchRules.map((r) => ({
      ...r,
      properties: [...r.properties],
    })),
    primaryRules: defaults.primaryRules.map((r) => ({ ...r })),
  };
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {'companies' | 'contacts'} entityType
 * @returns {MatchRule[]}
 */
function legacyMatchRules(parsed, entityType) {
  const rules = [];
  if (parsed.matchByName) rules.push({ properties: ['name'], label: 'Nombre' });
  if (parsed.matchByDomain) rules.push({ properties: ['domain'], label: 'Dominio' });
  if (parsed.matchByEmail) rules.push({ properties: ['email'], label: 'Email' });
  if (rules.length === 0 && entityType === 'contacts') {
    return DEFAULT_CONTACT_CRITERIA.matchRules.map((r) => ({
      ...r,
      properties: [...r.properties],
    }));
  }
  return rules;
}

/**
 * @param {MergeCriteria} criteria
 * @param {'companies' | 'contacts'} entityType
 */
export function collectCriteriaProperties(criteria, entityType) {
  const props = new Set();

  for (const rule of criteria.matchRules) {
    for (const p of rule.properties) {
      if (p === 'name') {
        if (entityType === 'contacts') {
          props.add('firstname');
          props.add('lastname');
        } else {
          props.add('name');
        }
      } else if (p === 'phone' || p === 'mobilephone') {
        props.add('phone');
        props.add('mobilephone');
        props.add('hs_calculated_phone_number');
        props.add('hs_searchable_calculated_international_phone_number');
        props.add('hs_whatsapp_phone_number');
      } else {
        props.add(p);
      }
    }
  }

  for (const rule of criteria.primaryRules) {
    if (rule.property) props.add(rule.property);
    if (rule.type === 'max_associations' && !rule.property) {
      props.add(entityType === 'contacts' ? 'num_associated_deals' : 'num_associated_contacts');
    }
    if (rule.type === 'most_recent' && !rule.property) {
      props.add('hs_lastmodifieddate');
    }
  }

  props.add('createdate');
  props.add('hs_lastmodifieddate');
  props.add('lastmodifieddate');

  if (entityType === 'companies') {
    props.add('estado');
    props.add('tipo_relacion_negocio');
  }

  return [...props];
}

/**
 * @param {MergeCriteria} criteria
 */
export function describeMatchRules(criteria) {
  return criteria.matchRules.map((r) => r.label || r.properties.join(' + ')).join(' · ');
}

/**
 * @param {PrimaryRule} rule
 */
export function describePrimaryRule(rule) {
  const opt = PRIMARY_RULE_OPTIONS.find((o) => o.type === rule.type);
  const label = opt?.label || rule.type;
  return rule.property ? `${label} (${rule.property})` : label;
}
