import path from 'node:path';
import { writeCsv } from './csv.js';
import {
  createHubSpotClient,
  MERGE_COMPANY_PROPERTIES,
  MERGE_CONTACT_PROPERTIES,
} from './hubspot.js';
import { parseMergeCriteria, collectCriteriaProperties } from './merge-criteria.js';
import { simulateAllGroups } from './merge-simulate.js';
import {
  groupsToCsvRows,
  MERGE_CSV_HEADERS,
  MERGE_RESULTS_CSV_HEADERS,
  resultsToCsvRows,
  runEntityMerge,
} from './merge.js';

/**
 * @param {Array<{ id: string, properties?: Record<string, string> }>} rawRecords
 * @param {'companies' | 'contacts'} entityType
 */
export function mapRawMergeRecords(rawRecords, entityType = 'companies') {
  return rawRecords.map((record) => {
    const props = record.properties || {};
    let name = props.name?.trim() || '';

    if (entityType === 'contacts') {
      const first = props.firstname?.trim() || '';
      const last = props.lastname?.trim() || '';
      name = `${first} ${last}`.trim() || props.email?.trim() || '';
    }

    return {
      id: String(record.id),
      name,
      properties: props,
    };
  });
}

/**
 * @param {import('./merge.js').MergeStats} stats
 */
export function printMergeStats(stats) {
  console.log(`Total registros en portal:    ${stats.totalRecords}`);
  console.log(`Elegibles para fusión:       ${stats.eligibleRecords}`);
  console.log(`Omitidos (inactive):         ${stats.skippedInactive}`);
  console.log(`Omitidos (solo proveedor):   ${stats.skippedOnlyProveedor}`);
  if (stats.skippedNoName != null) {
    console.log(`Sin nombre (no agrupan):     ${stats.skippedNoName}`);
  }
  console.log(`Grupos de fusión detectados: ${stats.mergeGroups}`);
  console.log(`Fusiones planificadas:       ${stats.mergesPlanned}`);

  if (stats.mergesApplied || stats.mergesFailed || stats.mergesSkipped) {
    console.log(`Fusiones aplicadas:          ${stats.mergesApplied}`);
    console.log(`Fusiones omitidas:           ${stats.mergesSkipped || 0}`);
    console.log(`Fusiones fallidas:           ${stats.mergesFailed}`);
  }
}

/**
 * @param {import('./merge.js').MergeOptions} options
 */
function resolveFetchProperties(options) {
  const entityType = options.entityType || 'companies';
  const criteria = parseMergeCriteria(options.criteria, entityType);
  const base =
    entityType === 'contacts' ? MERGE_CONTACT_PROPERTIES : MERGE_COMPANY_PROPERTIES;
  const extra = collectCriteriaProperties(criteria, entityType);
  return [...new Set([...base, ...extra])];
}

/**
 * @param {import('./hubspot.js').HubSpotClient} client
 * @param {import('./merge.js').MergeOptions} options
 * @param {string} outputDir
 * @param {ReturnType<import('./merge-progress.js').createMergeProgress> | null} [progress]
 */
export async function executeMergeRun(client, options, outputDir, progress = null) {
  const entityType = options.entityType || 'companies';
  const properties = resolveFetchProperties(options);
  const entityLabel = entityType === 'contacts' ? 'contactos' : 'empresas';

  progress?.start(entityType, options.dryRun !== false);
  progress?.log(`Leyendo ${entityLabel} desde HubSpot…`);

  const onPage = ({ fetched }) => {
    progress?.fetchPage(fetched);
    if (fetched % 1000 === 0 && fetched > 0) {
      progress?.log(`… ${fetched.toLocaleString('es-ES')} ${entityLabel} leídos`);
    }
  };

  const rawRecords =
    entityType === 'contacts'
      ? await client.fetchAllContacts(properties, onPage)
      : await client.fetchAllCompanies(properties, onPage);

  progress?.fetchDone(rawRecords.length);
  progress?.log(`Analizando duplicados en ${rawRecords.length.toLocaleString('es-ES')} registros…`);

  const records = mapRawMergeRecords(rawRecords, entityType);
  const result = await runEntityMerge(client, records, {
    ...options,
    onProgress: progress,
  });

  progress?.analyzeDone(result.stats);

  const criteria = parseMergeCriteria(result.criteria || options.criteria, entityType);

  if (options.dryRun !== false) {
    progress?.log('Generando vista previa de fusiones…');
  }

  const simulations = simulateAllGroups(result.groups, criteria);
  progress?.simulateDone();

  const suffix = result.dryRun ? '_propuestas' : '_aplicadas';
  const testSuffix =
    options.maxGroups || options.dominio || options.nombre ? '_prueba' : '';

  progress?.exportDone();
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

  progress?.done(result.stats, result.dryRun !== false);

  return { ...result, simulations, csvPath, resultsCsvPath };
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
