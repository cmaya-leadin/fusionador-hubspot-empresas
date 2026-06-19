import { confidenceForSource } from './config.js';

/**
 * @param {import('./grouping.js').CompanyRecord[]} companies
 */
export function printGroupingStats(companies) {
  /** @type {Record<string, number>} */
  const bySource = {};

  for (const c of companies) {
    bySource[c.source] = (bySource[c.source] || 0) + 1;
  }

  console.log('\nEmpresas por tipo de agrupación:');
  for (const [source, count] of Object.entries(bySource).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(
      `  · ${source}: ${count} (confianza ~${confidenceForSource(/** @type {*} */ (source))})`,
    );
  }
}

/**
 * @param {import('./grouping.js').CompanyGroup[]} groups
 */
export function printGroupStats(groups) {
  /** @type {Record<string, number>} */
  const bySource = {};

  for (const g of groups) {
    for (const c of g.companies) {
      bySource[c.source] = (bySource[c.source] || 0) + 1;
    }
  }

  console.log('\nEmpresas en grupos (≥2) por tipo:');
  for (const [source, count] of Object.entries(bySource).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  · ${source}: ${count}`);
  }
}
