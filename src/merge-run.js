import path from 'node:path';
import { writeCsv } from './csv.js';
import {
  createHubSpotClient,
  MERGE_COMPANY_PROPERTIES,
} from './hubspot.js';
import {
  groupsToCsvRows,
  MERGE_CSV_HEADERS,
  MERGE_RESULTS_CSV_HEADERS,
  resultsToCsvRows,
  runCompanyMerge,
} from './merge.js';

/**
 * @param {Array<{ id: string, properties?: Record<string, string> }>} rawCompanies
 */
export function mapRawMergeCompanies(rawCompanies) {
  return rawCompanies.map((company) => ({
    id: String(company.id),
    name: company.properties?.name?.trim() || '',
    properties: company.properties || {},
  }));
}

/**
 * @param {import('./merge.js').MergeStats} stats
 */
export function printMergeStats(stats) {
  console.log(`Total empresas en portal:     ${stats.totalCompanies}`);
  console.log(`Elegibles para fusión:        ${stats.eligibleCompanies}`);
  console.log(`Omitidas (inactive):          ${stats.skippedInactive}`);
  console.log(`Omitidas (solo proveedor):    ${stats.skippedOnlyProveedor}`);
  if (stats.skippedNoName != null) {
    console.log(`Sin nombre (no agrupan):      ${stats.skippedNoName}`);
  }
  console.log(`Grupos de fusión detectados:  ${stats.mergeGroups}`);
  console.log(`Fusiones planificadas:        ${stats.mergesPlanned}`);

  if (stats.mergesApplied || stats.mergesFailed || stats.mergesSkipped) {
    console.log(`Fusiones aplicadas:           ${stats.mergesApplied}`);
    console.log(`Fusiones omitidas:            ${stats.mergesSkipped || 0}`);
    console.log(`Fusiones fallidas:            ${stats.mergesFailed}`);
  }
}

/**
 * @param {import('./hubspot.js').HubSpotClient} client
 * @param {import('./merge.js').MergeOptions} options
 * @param {string} outputDir
 */
export async function executeMergeRun(client, options, outputDir) {
  console.log('Leyendo empresas desde HubSpot…');
  const rawCompanies = await client.fetchAllCompanies(MERGE_COMPANY_PROPERTIES);
  const companies = mapRawMergeCompanies(rawCompanies);

  const result = await runCompanyMerge(client, companies, options);

  const suffix = result.dryRun ? '_propuestas' : '_aplicadas';
  const testSuffix = options.maxGroups || options.dominio || options.nombre ? '_prueba' : '';
  const csvPath = path.join(
    outputDir,
    `fusiones${suffix}${testSuffix}_${Date.now()}.csv`,
  );
  await writeCsv(csvPath, MERGE_CSV_HEADERS, groupsToCsvRows(result.groups));

  let resultsCsvPath = null;
  if (!result.dryRun && result.results.length > 0) {
    resultsCsvPath = path.join(
      outputDir,
      `fusiones_resultados${testSuffix}_${Date.now()}.csv`,
    );
    await writeCsv(
      resultsCsvPath,
      MERGE_RESULTS_CSV_HEADERS,
      resultsToCsvRows(result.results),
    );
  }

  return { ...result, csvPath, resultsCsvPath };
}

/**
 * @param {string} token
 * @param {import('./merge.js').MergeOptions} options
 * @param {string} outputDir
 */
export async function runMergeWithToken(token, options, outputDir) {
  const client = createHubSpotClient(token);
  return executeMergeRun(client, options, outputDir);
}
