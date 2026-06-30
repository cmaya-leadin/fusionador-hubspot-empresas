/**
 * @typedef {{ properties: string[], label?: string }} MatchRule
 * @typedef {{ type: string, property?: string }} PrimaryRule
 * @typedef {{ type: string, property?: string, value?: string, minWords?: number, label?: string, requiresNameMatch?: boolean }} ExclusionRule
 *
 * @typedef {Object} MergeCriteria
 * @property {MatchRule[]} matchRules
 * @property {PrimaryRule[]} primaryRules
 * @property {ExclusionRule[]} exclusionRules
 * @property {boolean} [skipInactive] @deprecated usar exclusionRules
 * @property {boolean} [skipOnlyProveedor] @deprecated
 * @property {boolean} [excludeGenericDomains] @deprecated
 * @property {number} [minNameWords] @deprecated
 * @property {boolean} [skipDifferentPhones] @deprecated
 * @property {string | null} [navProperty]
 * @property {string | null} [inactiveProperty]
 * @property {string | null} [inactiveValue]
 * @property {boolean} [matchByName] @deprecated
 * @property {boolean} [matchByDomain] @deprecated
 * @property {boolean} [matchByEmail] @deprecated
 */

export const EXCLUSION_RULE_OPTIONS = [
  {
    type: 'inactive',
    label: 'Omitir registro inactivo',
    needsProperty: true,
    needsValue: true,
    defaultProperty: 'estado',
    defaultValue: 'inactive',
    entityTypes: ['companies'],
  },
  {
    type: 'only_proveedor',
    label: 'Omitir solo proveedor',
    entityTypes: ['companies'],
  },
  {
    type: 'generic_domains',
    label: 'Ignorar dominios genéricos al emparejar',
    entityTypes: ['companies', 'contacts'],
  },
  {
    type: 'min_name_words',
    label: 'Nombre con mínimo de palabras',
    needsMinWords: true,
    defaultMinWords: 2,
    entityTypes: ['contacts'],
  },
  {
    type: 'different_phones',
    label: 'No fusionar teléfonos distintos en el grupo',
    entityTypes: ['contacts'],
    requiresNameMatch: true,
  },
  {
    type: 'different_property',
    label: 'No fusionar si propiedad distinta en el grupo',
    needsProperty: true,
    entityTypes: ['companies', 'contacts'],
  },
  {
    type: 'record_property_filled',
    label: 'Omitir registro con propiedad informada',
    needsProperty: true,
    entityTypes: ['companies', 'contacts'],
  },
  {
    type: 'record_property_empty',
    label: 'Omitir registro con propiedad vacía',
    needsProperty: true,
    entityTypes: ['companies', 'contacts'],
  },
  {
    type: 'record_property_equals',
    label: 'Omitir registro si propiedad = valor',
    needsProperty: true,
    needsValue: true,
    entityTypes: ['companies', 'contacts'],
  },
];

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
  exclusionRules: [
    { type: 'inactive', property: 'estado', value: 'inactive' },
    { type: 'only_proveedor' },
    { type: 'generic_domains' },
  ],
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
  exclusionRules: [{ type: 'generic_domains' }],
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
    exclusionRules: normalizeExclusionRules(parsed, defaults, entityType),
    navProperty: parsed.navProperty ?? defaults.navProperty,
    inactiveProperty: parsed.inactiveProperty ?? defaults.inactiveProperty,
    inactiveValue: parsed.inactiveValue ?? defaults.inactiveValue,
  };
}

/**
 * @param {unknown} raw
 * @returns {ExclusionRule[]}
 */
function parseExclusionRules(raw) {
  if (!Array.isArray(raw)) return [];
  const validTypes = new Set(EXCLUSION_RULE_OPTIONS.map((o) => o.type));

  return raw
    .filter((r) => r && typeof r === 'object' && validTypes.has(String(r.type)))
    .map((r) => {
      /** @type {ExclusionRule} */
      const rule = { type: String(r.type) };
      if (r.property) rule.property = String(r.property);
      if (r.value != null) rule.value = String(r.value);
      if (r.label) rule.label = String(r.label);
      if (r.requiresNameMatch === false) rule.requiresNameMatch = false;
      if (r.type === 'min_name_words') {
        const n = Number(r.minWords);
        rule.minWords = Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
      }
      return rule;
    });
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {MergeCriteria} defaults
 * @param {'companies' | 'contacts'} entityType
 * @returns {ExclusionRule[]}
 */
function normalizeExclusionRules(parsed, defaults, entityType) {
  const fromArray = parseExclusionRules(parsed.exclusionRules);
  if (fromArray.length > 0) return fromArray;

  /** @type {ExclusionRule[]} */
  const rules = [];

  if (parsed.skipInactive ?? defaults.skipInactive) {
    rules.push({
      type: 'inactive',
      property: String(parsed.inactiveProperty ?? defaults.inactiveProperty ?? 'estado'),
      value: String(parsed.inactiveValue ?? defaults.inactiveValue ?? 'inactive'),
    });
  }

  if (parsed.skipOnlyProveedor ?? defaults.skipOnlyProveedor) {
    rules.push({ type: 'only_proveedor' });
  }

  if (parsed.excludeGenericDomains ?? defaults.excludeGenericDomains !== false) {
    rules.push({ type: 'generic_domains' });
  }

  const minWords = parseMinNameWords(parsed.minNameWords, 0);
  if (minWords >= 2 && entityType === 'contacts') {
    rules.push({ type: 'min_name_words', minWords });
  }

  if (parsed.skipDifferentPhones && entityType === 'contacts') {
    rules.push({ type: 'different_phones', requiresNameMatch: true });
  }

  if (rules.length > 0) return rules;

  return (defaults.exclusionRules || []).map((r) => ({ ...r }));
}

/**
 * @param {MergeCriteria} criteria
 * @returns {ExclusionRule[]}
 */
export function getExclusionRules(criteria) {
  return criteria.exclusionRules || [];
}

/**
 * @param {MergeCriteria} criteria
 * @param {string} type
 */
export function hasExclusionType(criteria, type) {
  return getExclusionRules(criteria).some((r) => r.type === type);
}

/**
 * @param {MergeCriteria} criteria
 */
export function getMinNameWords(criteria) {
  const rule = getExclusionRules(criteria).find((r) => r.type === 'min_name_words');
  if (!rule) return 0;
  return rule.minWords ?? 2;
}

/**
 * @param {unknown} raw
 * @param {number | undefined} fallback
 */
function parseMinNameWords(raw, fallback = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback ?? 0;
  return Math.floor(n);
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
    exclusionRules: (defaults.exclusionRules || []).map((r) => ({ ...r })),
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

  for (const rule of getExclusionRules(criteria)) {
    if (rule.property) {
      if (rule.property === 'name' && entityType === 'contacts') {
        props.add('firstname');
        props.add('lastname');
      } else if (rule.property === 'phone' || rule.property === 'mobilephone') {
        props.add('phone');
        props.add('mobilephone');
        props.add('hs_calculated_phone_number');
        props.add('hs_searchable_calculated_international_phone_number');
        props.add('hs_whatsapp_phone_number');
      } else {
        props.add(rule.property);
      }
    }
    if (rule.type === 'inactive' && !rule.property) props.add('estado');
    if (rule.type === 'only_proveedor') props.add('tipo_relacion_negocio');
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
 * @param {ExclusionRule} rule
 */
export function describeExclusionRuleOption(rule) {
  const opt = EXCLUSION_RULE_OPTIONS.find((o) => o.type === rule.type);
  const base = rule.label || opt?.label || rule.type;
  if (rule.type === 'min_name_words') {
    return `${base} (≥ ${rule.minWords ?? 2})`;
  }
  if (rule.type === 'record_property_equals' && rule.property) {
    return `${base}: ${rule.property} = ${rule.value ?? ''}`;
  }
  if (rule.type === 'inactive' && rule.property) {
    return `${base}: ${rule.property} = ${rule.value ?? 'inactive'}`;
  }
  if (rule.property && rule.type !== 'different_phones') {
    return `${base} (${rule.property})`;
  }
  return base;
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
