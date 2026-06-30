/**
 * @typedef {import('./merge-criteria.js').ExclusionRule} ExclusionRule
 * @typedef {import('./merge.js').MergeRecord} MergeRecord
 */

import {
  getExclusionRules,
  hasExclusionType,
} from './merge-criteria.js';
import {
  getMatchPropertyValue,
  getRecordNormalizedPhone,
  isInactiveRecord,
  isOnlyProveedor,
  normalizeForMatch,
} from './merge.js';

/**
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 */
export function usesGenericDomainExclusion(criteria) {
  return hasExclusionType(criteria, 'generic_domains');
}

/**
 * @param {MergeRecord} record
 * @param {string} property
 * @param {'companies' | 'contacts'} entityType
 */
export function getExclusionPropertyValue(record, property, entityType) {
  if (property === 'phone' || property === 'mobilephone') {
    return getRecordNormalizedPhone(record);
  }
  return getMatchPropertyValue(record, property, entityType);
}

/**
 * @param {MergeRecord} record
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 * @param {'companies' | 'contacts'} entityType
 */
export function isRecordExcludedFromMerge(record, criteria, entityType) {
  const props = record.properties || {};

  for (const rule of getExclusionRules(criteria)) {
    switch (rule.type) {
      case 'inactive': {
        const prop = rule.property || 'estado';
        const val = rule.value || 'inactive';
        if (isInactiveRecord(props[prop], val)) return true;
        break;
      }
      case 'only_proveedor':
        if (entityType === 'companies' && isOnlyProveedor(props.tipo_relacion_negocio)) {
          return true;
        }
        break;
      case 'record_property_filled': {
        const prop = rule.property || '';
        if (prop && String(props[prop] ?? '').trim()) return true;
        break;
      }
      case 'record_property_empty': {
        const prop = rule.property || '';
        if (prop && !String(props[prop] ?? '').trim()) return true;
        break;
      }
      case 'record_property_equals': {
        const prop = rule.property || '';
        if (!prop) break;
        const actual = normalizeForMatch(String(props[prop] ?? ''));
        const expected = normalizeForMatch(String(rule.value ?? ''));
        if (expected && actual === expected) return true;
        break;
      }
      default:
        break;
    }
  }

  return false;
}

/**
 * @param {MergeRecord[]} members
 * @param {Array<(record: MergeRecord) => string | null>} valueGetters
 * @returns {MergeRecord[][]}
 */
export function clusterMembersByCompatibleValues(members, valueGetters) {
  if (members.length < 2 || valueGetters.length === 0) return [members];

  const values = members.map((member) =>
    valueGetters.map((getter) => getter(member)),
  );
  const parent = members.map((_, i) => i);

  function find(i) {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let current = i;
    while (parent[current] !== root) {
      const next = parent[current];
      parent[current] = root;
      current = next;
    }
    return root;
  }

  function distinctValuesInComponent(root, getterIndex) {
    const set = new Set();
    for (let i = 0; i < members.length; i++) {
      if (find(i) === root && values[i][getterIndex]) {
        set.add(values[i][getterIndex]);
      }
    }
    return set;
  }

  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;

    for (let g = 0; g < valueGetters.length; g++) {
      const merged = new Set([
        ...distinctValuesInComponent(ra, g),
        ...distinctValuesInComponent(rb, g),
      ]);
      if (merged.size > 1) return;
    }

    parent[rb] = ra;
  }

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      let compatible = true;
      for (let g = 0; g < valueGetters.length; g++) {
        const vi = values[i][g];
        const vj = values[j][g];
        if (vi && vj && vi !== vj) {
          compatible = false;
          break;
        }
      }
      if (compatible) union(i, j);
    }
  }

  /** @type {Map<number, MergeRecord[]>} */
  const clusters = new Map();
  for (let i = 0; i < members.length; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(members[i]);
  }

  return [...clusters.values()].filter((cluster) => cluster.length >= 2);
}

/**
 * @param {MergeRecord[]} members
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 * @param {'companies' | 'contacts'} entityType
 * @param {string[]} matchProperties
 */
export function splitMembersByGroupExclusions(members, criteria, entityType, matchProperties) {
  /** @type {Array<(record: MergeRecord) => string | null>} */
  const getters = [];

  for (const rule of getExclusionRules(criteria)) {
    const needsName = rule.requiresNameMatch !== false && rule.type === 'different_phones';
    if (needsName && !matchProperties.includes('name')) continue;

    if (rule.type === 'different_phones' && entityType === 'contacts') {
      getters.push((m) => getRecordNormalizedPhone(m));
      continue;
    }

    if (rule.type === 'different_property' && rule.property) {
      const prop = rule.property;
      getters.push((m) => getExclusionPropertyValue(m, prop, entityType));
    }
  }

  if (getters.length === 0) return { clusters: [members], splitCount: 0 };

  const clusters = clusterMembersByCompatibleValues(members, getters);
  const splitCount = clusters.length > 1 ? 1 : 0;
  if (clusters.length === 0) return { clusters: [], splitCount: 0 };
  return { clusters, splitCount };
}
