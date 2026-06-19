import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeFilters, parseArgs } from './args.js';
import {
  APPLY_AUDIT_HEADERS,
  associationPairsFromAudit,
  buildApplyAuditRows,
} from './audit.js';
import {
  confidenceForSource,
  CONFIDENCE_HIGH,
  hubspotProps,
  perteneceValues,
  reviewStatus,
  rootDomainProp,
} from './config.js';
import {
  buildBrandRegistry,
  loadBrandGroupingConfig,
  summarizeBrandRegistry,
} from './brand-key.js';
import { loadCorporateFamilies } from './corporate.js';
import { writeCsv } from './csv.js';
import { domainFromEmail } from './domain.js';
import { filterGroups, filterGroupsByMinConfidence } from './filters.js';
import { printGroupStats, printGroupingStats } from './stats.js';
import { createHubSpotClient } from './hubspot.js';
import {
  associationPairsForGroup,
  buildGroups,
  loadManualGroups,
  mapCompanies,
} from './grouping.js';
import { revertFromAuditFile } from './revert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');
const MANUAL_CSV = path.join(PROJECT_ROOT, 'grupos_manuales.csv');
const CORPORATE_CONFIG = path.join(PROJECT_ROOT, 'corporativos.json');
const AGRUPACION_CONFIG = path.join(PROJECT_ROOT, 'agrupacion.json');

const CSV_HEADERS = [
  'group_key',
  'corporate_family',
  'raw_domain',
  'hub_id',
  'company_id',
  'company_name',
  'domain',
  'email_de_empresa',
  'key_source',
  'group_size',
  'is_hub',
  'current_pertenece',
];

function printHelp() {
  console.log(`
HubSpot — agrupar empresas por dominio

Uso:
  node src/index.js --dry-run              Previsualiza grupos (CSV)
  node src/index.js --apply                Aplica cambios en HubSpot
  node src/index.js --revert --from <csv>  Revierte una ejecución anterior

Modo prueba (filtra antes de generar CSV / aplicar):
  --dominio <texto>        group_key contiene el texto
  --nombre <texto>         nombre, domain o email contiene el texto
  --grupo <texto>          group_key o grupo manual contiene el texto
  --ids <id1,id2>          solo grupos con esos company_id
  --max-grupos <n>         limita cantidad de grupos

Revertir:
  node src/index.js --revert --from output/cambios_aplicados_prueba.csv
  node src/index.js --revert --from output/cambios_aplicados_prueba.csv --run-id run_173...

Al aplicar se guarda:
  · CSV de auditoría (asociaciones + valores anteriores)
  · Propiedades HubSpot: group_key, group_confidence, group_review_status,
    grupo_empresa_principal_id, pertenece_a_grupo_de_empresas
  (grupo_script_run_id solo si existe en HubSpot y HS_PROP_RUN_ID en .env)

Estrategia global (79k empresas): agrupacion.json + auto multi-TLD
Excepciones conocidas: corporativos.json (solo casos especiales)

  --min-confidence 90   Solo grupos de alta confianza (recomendado masivo)

Variables de entorno (.env): HUBSPOT_TOKEN y opcionalmente HS_PROP_*
`);
}

/**
 * @param {import('./grouping.js').CompanyGroup[]} groups
 */
function groupsToPreviewRows(groups) {
  const rows = [];
  for (const group of groups) {
    for (const company of group.companies) {
      rows.push({
        group_key: group.groupKey,
        corporate_family: group.familyId || company.familyId || '',
        raw_domain: company.rawDomain || company.properties.domain || '',
        hub_id: group.hubId,
        company_id: company.id,
        company_name: company.name,
        domain: company.properties.domain || '',
        email_de_empresa: company.properties.email_de_empresa || '',
        key_source: company.source,
        group_size: group.memberIds.length,
        is_hub: company.id === group.hubId ? 'yes' : 'no',
        current_pertenece: company.properties[hubspotProps.pertenece] || '',
      });
    }
  }
  return rows;
}

/**
 * @param {import('./grouping.js').CompanyGroup[]} groups
 * @param {string} runId
 */
function buildHubSpotUpdateInputs(groups, runId) {
  /** @type {Array<{ id: string, properties: Record<string, string> }>} */
  const inputs = [];

  for (const group of groups) {
    for (const company of group.companies) {
      /** @type {Record<string, string>} */
      const properties = {
        [hubspotProps.pertenece]: perteneceValues.si,
        [hubspotProps.groupKey]: group.groupKey,
        [hubspotProps.hubCompanyId]: group.hubId,
        [hubspotProps.groupConfidence]: String(
          confidenceForSource(
            /** @type {Parameters<typeof confidenceForSource>[0]} */ (
              company.source
            ),
          ),
        ),
        [hubspotProps.groupReviewStatus]: reviewStatus.applied,
      };

      if (hubspotProps.grupoScriptRunId) {
        properties[hubspotProps.grupoScriptRunId] = runId;
      }

      inputs.push({ id: company.id, properties });
    }
  }

  return inputs;
}

/**
 * @param {string} suffix
 */
function defaultAuditPath(suffix) {
  return path.join(OUTPUT_DIR, `cambios_aplicados${suffix}.csv`);
}

/**
 * @param {Array<{ properties?: Record<string, string> }>} rawCompanies
 */
function collectDomainsForRegistry(rawCompanies) {
  const domains = [];

  for (const c of rawCompanies) {
    const p = c.properties || {};
    if (p.domain) domains.push(p.domain);
    if (p[rootDomainProp]) domains.push(p[rootDomainProp]);
    const fromEmail = domainFromEmail(p.email_de_empresa);
    if (fromEmail) domains.push(fromEmail);
  }

  return domains;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));

  if (cli.help) {
    printHelp();
    process.exit(0);
  }

  const token = process.env.HUBSPOT_TOKEN?.trim();
  if (!token) {
    console.error('Error: define HUBSPOT_TOKEN en el archivo .env');
    process.exit(1);
  }

  const client = createHubSpotClient(token);
  const suffix = cli.testMode ? '_prueba' : '';

  if (cli.revert) {
    const auditPath =
      cli.fromFile ||
      defaultAuditPath(suffix) ||
      path.join(OUTPUT_DIR, 'cambios_aplicados.csv');

    console.log('═══ REVERTIR CAMBIOS ═══\n');
    await revertFromAuditFile(client, auditPath, {
      runId: cli.runId,
      outputDir: OUTPUT_DIR,
    });
    return;
  }

  if (!cli.dryRun && !cli.apply) {
    printHelp();
    process.exit(1);
  }

  if (cli.apply && !cli.testMode) {
    console.error(
      'Error: --apply sin filtros bloqueado por seguridad.\n' +
        'Añade filtros de prueba o usa: node src/index.js --apply --confirm-full-run',
    );
    if (!process.argv.includes('--confirm-full-run')) {
      process.exit(1);
    }
  }

  if (cli.testMode) {
    console.log('═══ MODO PRUEBA ═══');
    console.log(`Filtros: ${describeFilters(cli)}`);
    console.log('');
  }

  const brandConfig = await loadBrandGroupingConfig(AGRUPACION_CONFIG);
  const families = await loadCorporateFamilies(CORPORATE_CONFIG);

  console.log('Estrategia de agrupación:');
  console.log(
    `  1) Excepciones corporativos.json (${families.length} familias)`,
  );
  console.log('  2) Auto multi-TLD si ≥2 países/TLD con mismo slug');
  console.log('  3) Dominio exacto · Bloqueo gmail/live/…');
  if (families.length > 0) {
    console.log(
      `     Familias: ${families.map((f) => `${f.id}→${f.canonicalKey}`).join(', ')}`,
    );
  }

  console.log('\nLeyendo empresas desde HubSpot…');
  const rawCompanies = await client.fetchAllCompanies();
  console.log(`Total empresas en portal: ${rawCompanies.length}`);

  const brandRegistry = buildBrandRegistry(
    collectDomainsForRegistry(rawCompanies),
    brandConfig,
  );
  const brandSummary = summarizeBrandRegistry(brandRegistry);
  console.log(
    `\nMarcas multi-TLD detectadas: ${brandSummary.enabledSlugs} slugs ` +
      `(~${brandSummary.companiesWithMultiTldSlug} apariciones en dominios)`,
  );

  const companies = mapCompanies(rawCompanies, families, brandRegistry);
  printGroupingStats(companies);

  const manualGroups = await loadManualGroups(MANUAL_CSV);
  if (manualGroups.size > 0) {
    console.log(`Overrides manuales: ${manualGroups.size} empresas`);
  }

  const allGroups = buildGroups(companies, manualGroups, families);
  let groups = filterGroups(allGroups, cli, manualGroups);

  if (cli.minConfidence) {
    const before = groups.length;
    groups = filterGroupsByMinConfidence(groups, cli.minConfidence);
    console.log(
      `\nFiltro confianza ≥${cli.minConfidence}: ${groups.length} grupos (antes ${before})`,
    );
  }

  console.log(`Grupos tras filtros: ${groups.length}`);
  printGroupStats(groups);

  if (groups.length === 0) {
    console.log('\nNo hay grupos que coincidan.');
    process.exit(0);
  }

  const associationCount = groups.reduce(
    (n, g) => n + associationPairsForGroup(g).length,
    0,
  );
  console.log(
    `Empresas: ${groups.reduce((n, g) => n + g.memberIds.length, 0)} · Asociaciones: ${associationCount}`,
  );

  const proposedPath = path.join(OUTPUT_DIR, `grupos_propuestos${suffix}.csv`);
  await writeCsv(proposedPath, CSV_HEADERS, groupsToPreviewRows(groups));
  console.log(`\nPrevisualización: ${proposedPath}`);

  if (cli.dryRun) {
    console.log('\nDry-run: HubSpot no modificado.');
    console.log(
      `\nSugerencia masiva: npm run dry-run -- --min-confidence ${CONFIDENCE_HIGH}`,
    );
    console.log(
      'Sugerencia conservadora: revisar en CSV grupos con key_source=brand_multi_tld',
    );
    return;
  }

  const runId = `run_${Date.now()}`;
  console.log(`\nRun ID: ${runId}`);

  const updateInputs = buildHubSpotUpdateInputs(groups, runId);
  console.log(`Actualizando ${updateInputs.length} empresas (propiedades de grupo)…`);
  await client.batchUpdateCompanies(updateInputs);

  const allPairs = groups.flatMap((g) => associationPairsForGroup(g));
  console.log(`Creando ${allPairs.length} asociaciones grupo_empresa…`);
  await client.batchCreateGrupoEmpresaAssociations(allPairs);

  const auditRows = buildApplyAuditRows(groups, runId);
  const auditPath = defaultAuditPath(suffix);
  await writeCsv(auditPath, APPLY_AUDIT_HEADERS, auditRows);

  const assocPath = path.join(OUTPUT_DIR, `asociaciones${suffix}_${runId}.csv`);
  const assocRows = associationPairsFromAudit(auditRows).map((p) => ({
    run_id: runId,
    association_from: p.fromId,
    association_to: p.toId,
    association_type: 'grupo_empresa',
    association_type_id: '1',
    applied_at: auditRows[0]?.applied_at || new Date().toISOString(),
  }));
  await writeCsv(assocPath, Object.keys(assocRows[0] || {}), assocRows);

  console.log(`\nListo.`);
  console.log(`  Auditoría completa: ${auditPath}`);
  console.log(`  Solo asociaciones:  ${assocPath}`);
  console.log(`\nPara revertir:\n  node src/index.js --revert --from "${auditPath}"`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
