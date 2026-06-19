import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHubSpotClient } from './hubspot.js';
import { executeMergeRun } from './merge-run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');
const PORT = Number(process.env.MERGE_PORT || 3000);
const API_KEY = process.env.MERGE_API_KEY?.trim() || '';

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Cuerpo JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * @param {import('node:http').IncomingMessage} req
 */
function isAuthorized(req) {
  if (!API_KEY) return true;

  const header = req.headers.authorization || '';
  if (header === `Bearer ${API_KEY}`) return true;

  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader === API_KEY) {
    return true;
  }

  return false;
}

/**
 * @param {Record<string, unknown>} body
 */
function parseMergeOptions(body) {
  return {
    dryRun: body.dryRun !== false,
    dominio:
      typeof body.dominio === 'string' && body.dominio.trim()
        ? body.dominio.trim()
        : null,
    nombre:
      typeof body.nombre === 'string' && body.nombre.trim()
        ? body.nombre.trim()
        : null,
    companyIds: Array.isArray(body.companyIds)
      ? body.companyIds.map(String).filter(Boolean)
      : typeof body.ids === 'string'
        ? body.ids
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
    maxGroups:
      body.maxGroups != null && Number.isFinite(Number(body.maxGroups))
        ? Number(body.maxGroups)
        : null,
    confirmFullRun: body.confirmFullRun === true,
  };
}

/**
 * @param {import('./merge.js').MergeGroup[]} groups
 */
function serializeGroups(groups) {
  return groups.map((group) => ({
    matchKey: group.matchKey,
    matchType: group.matchType,
    primaryId: group.primaryId,
    primaryName: group.primaryName,
    mergeIds: group.mergeIds,
    companies: group.companies.map((company) => ({
      id: company.id,
      name: company.name,
      domain: company.properties.domain || '',
      estado: company.properties.estado || '',
      tipo_relacion_negocio: company.properties.tipo_relacion_negocio || '',
      codigo_cuenta_nav: company.properties.codigo_cuenta_nav || '',
      num_associated_contacts:
        company.properties.num_associated_contacts || '0',
    })),
  }));
}

async function handleMergeCompanies(req, res) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'No autorizado' });
    return;
  }

  const token = process.env.HUBSPOT_TOKEN?.trim();
  if (!token) {
    sendJson(res, 500, { error: 'HUBSPOT_TOKEN no configurado en .env' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const options = parseMergeOptions(body);
  const client = createHubSpotClient(token);

  console.log(
    `[merge] Iniciando ${options.dryRun ? 'dry-run' : 'apply'} ` +
      `(filtros: dominio=${options.dominio || '-'}, nombre=${options.nombre || '-'})`,
  );

  const result = await executeMergeRun(client, options, OUTPUT_DIR);

  sendJson(res, 200, {
    dryRun: result.dryRun,
    stats: result.stats,
    csvPath: result.csvPath,
    resultsCsvPath: result.resultsCsvPath,
    groups: serializeGroups(result.groups),
    results: result.results,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/merge/companies') {
      await handleMergeCompanies(req, res);
      return;
    }

    sendJson(res, 404, {
      error: 'Ruta no encontrada',
      routes: ['GET /health', 'POST /api/merge/companies'],
    });
  } catch (error) {
    console.error('[merge] Error:', error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, () => {
  console.log(`Servidor de fusión escuchando en http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /health');
  console.log('  POST /api/merge/companies');
  if (!API_KEY) {
    console.warn('Aviso: MERGE_API_KEY no definido; el endpoint acepta peticiones sin autenticación.');
  }
});
