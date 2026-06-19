import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cliToMergeOptions,
  describeMergeFilters,
  parseMergeArgs,
} from './merge-args.js';
import { executeMergeRun, printMergeStats } from './merge-run.js';
import { createHubSpotClient } from './hubspot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', 'output');

function printHelp() {
  console.log(`
HubSpot — fusionar empresas duplicadas (nombre o dominio)

Uso:
  npm run merge:dry-run              Previsualiza fusiones (CSV, no modifica HubSpot)
  npm run merge:apply                Aplica fusiones masivas (requiere --confirm-full-run)
  npm run merge:test                 Dry-run acotado (5 grupos)
  npm run merge:apply:test           Aplica prueba acotada (5 grupos)

Opciones CLI (pasar tras --):
  --dry-run                          Solo informe (por defecto en merge:dry-run)
  --apply                            Ejecuta fusiones en HubSpot
  --dominio <texto>                  Filtra por dominio
  --nombre <texto>                   Filtra por nombre o dominio
  --ids <id1,id2>                    Solo grupos con esos company_id
  --max-grupos <n>                   Limita número de grupos
  --confirm-full-run                 Permite apply masivo sin filtros

Reglas de fusión:
  · Agrupa por coincidencia DIRECTA de nombre o dominio (sin enlaces transitivos)
  · Empresas sin nombre no se agrupan por nombre
  · Omite estado=inactive y tipo_relacion_negocio=solo proveedor
  · Principal: codigo_cuenta_nav > num_associated_contacts > más información
  · Apply: fusiona en cadena y reintenta con ID canónico si HubSpot lo indica

Ejemplos:
  npm run merge:dry-run
  npm run merge:dry-run -- --dominio acme --max-grupos 10
  npm run merge:apply:test -- --dominio acme
  node src/merge-cli.js --apply --dominio acme --max-grupos 3

Variables .env: HUBSPOT_TOKEN
`);
}

async function main() {
  const cli = parseMergeArgs(process.argv.slice(2));

  if (cli.help) {
    printHelp();
    process.exit(0);
  }

  if (!cli.dryRun && !cli.apply) {
    cli.dryRun = true;
  }

  const token = process.env.HUBSPOT_TOKEN?.trim();
  if (!token) {
    console.error('Error: define HUBSPOT_TOKEN en el archivo .env');
    process.exit(1);
  }

  if (cli.apply && !cli.testMode && !cli.confirmFullRun) {
    console.error(
      'Error: --apply sin filtros bloqueado por seguridad.\n' +
        'Añade filtros de prueba, usa npm run merge:apply:test o añade --confirm-full-run',
    );
    process.exit(1);
  }

  const options = cliToMergeOptions(cli);
  const modeLabel = options.dryRun ? 'DRY-RUN' : 'APPLY';

  console.log(`═══ FUSIÓN DE EMPRESAS (${modeLabel}) ═══\n`);
  if (cli.testMode) {
    console.log(`Filtros: ${describeMergeFilters(cli)}`);
    console.log('');
  }

  const client = createHubSpotClient(token);
  const result = await executeMergeRun(client, options, OUTPUT_DIR);

  console.log('');
  printMergeStats(result.stats);

  if (result.stats.mergeGroups === 0) {
    console.log('\nNo hay grupos de fusión que coincidan.');
    process.exit(0);
  }

  console.log(`\nInforme CSV: ${result.csvPath}`);
  if (result.resultsCsvPath) {
    console.log(`Resultados CSV: ${result.resultsCsvPath}`);
  }

  if (result.dryRun) {
    console.log('\nDry-run: HubSpot no modificado.');
    console.log('Para aplicar una prueba: npm run merge:apply:test -- --dominio <texto>');
    return;
  }

  const failed = result.results.filter((row) => row.status === 'failed');
  if (failed.length > 0) {
    console.log(
      `\n${failed.length} fusiones fallidas. Revisa: ${result.resultsCsvPath || result.csvPath}`,
    );
    process.exit(1);
  }

  console.log('\nListo. Fusiones aplicadas en HubSpot.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
