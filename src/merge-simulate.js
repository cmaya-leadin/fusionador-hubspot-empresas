import { pickPrimaryRecord } from './merge.js';

/**
 * Simula el objeto fusionado tomando el principal y rellenando huecos con secundarios.
 * @param {import('./merge.js').MergeRecord[]} companies
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 */
export function simulateMergedObject(records, criteria) {
  if (!records?.length) return null;

  const primary = pickPrimaryRecord(records, criteria);
  const merged = {
    id: primary.id,
    name: primary.name,
    properties: { ...primary.properties },
    sources: {
      primaryId: primary.id,
      mergedFromIds: records.filter((r) => r.id !== primary.id).map((r) => r.id),
    },
  };

  const others = records.filter((r) => r.id !== primary.id);

  for (const key of Object.keys(merged.properties)) {
    const current = merged.properties[key];
    if (current != null && String(current).trim() !== '') continue;

    for (const other of others) {
      const value = other.properties?.[key];
      if (value != null && String(value).trim() !== '') {
        merged.properties[key] = value;
        merged.sources[key] = other.id;
        break;
      }
    }
  }

  for (const other of others) {
    for (const [key, value] of Object.entries(other.properties || {})) {
      if (key in merged.properties) continue;
      if (value != null && String(value).trim() !== '') {
        merged.properties[key] = value;
        merged.sources[key] = other.id;
      }
    }
  }

  return merged;
}

/**
 * @param {import('./merge.js').MergeGroup[]} groups
 * @param {import('./merge-criteria.js').MergeCriteria} criteria
 */
export function simulateAllGroups(groups, criteria) {
  return groups.map((group) => ({
    matchKey: group.matchKey,
    matchType: group.matchType,
    primaryId: group.primaryId,
    primaryName: group.primaryName,
    recordCount: group.records.length,
    simulated: simulateMergedObject(group.records, criteria),
    records: group.records.map((r) => ({
      id: r.id,
      name: r.name,
      properties: r.properties,
    })),
  }));
}
