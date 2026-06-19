import path from 'node:path';
import {
  APPLY_AUDIT_HEADERS,
  associationPairsFromAudit,
  companyUpdatesFromAuditForRevert,
} from './audit.js';
import { readCsv, writeCsv } from './csv.js';
import { GRUPO_EMPRESA_ASSOCIATION } from './hubspot.js';

/**
 * @param {ReturnType<import('./hubspot.js').createHubSpotClient>} client
 * @param {string} auditFilePath
 * @param {{ runId?: string | null, outputDir: string }} options
 */
export async function revertFromAuditFile(client, auditFilePath, options) {
  console.log(`Leyendo auditoría: ${auditFilePath}`);
  let rows = await readCsv(auditFilePath);

  if (rows.length === 0) {
    throw new Error('El archivo de auditoría está vacío o no existe.');
  }

  if (options.runId) {
    rows = rows.filter((r) => r.run_id === options.runId);
    if (rows.length === 0) {
      throw new Error(`No hay filas con run_id="${options.runId}"`);
    }
    console.log(`Filtrado por run_id: ${options.runId} (${rows.length} filas)`);
  }

  const runIds = [...new Set(rows.map((r) => r.run_id).filter(Boolean))];
  console.log(`Run(s) a revertir: ${runIds.join(', ') || '(sin run_id)'}`);

  const pairs = associationPairsFromAudit(rows);
  console.log(`Asociaciones a eliminar: ${pairs.length}`);

  if (pairs.length > 0) {
    await client.batchArchiveGrupoEmpresaAssociations(pairs);
    console.log('Asociaciones grupo_empresa archivadas.');
  }

  const updates = companyUpdatesFromAuditForRevert(rows);
  console.log(`Propiedades a restaurar en ${updates.length} empresas…`);
  await client.batchUpdateCompanies(updates);

  const revertedAt = new Date().toISOString();
  const revertRows = rows.map((row) => ({
    ...row,
    reverted_at: revertedAt,
    revert_action: 'association_archived_properties_restored',
  }));

  const revertHeaders = [
    ...new Set([
      ...APPLY_AUDIT_HEADERS.filter((h) => h in (revertRows[0] || {})),
      'reverted_at',
      'revert_action',
    ]),
  ];

  const revertPath = path.join(
    options.outputDir,
    `revertido_${path.basename(auditFilePath, '.csv')}_${Date.now()}.csv`,
  );
  await writeCsv(revertPath, revertHeaders, revertRows);

  console.log(`\nRevertido. Registro: ${revertPath}`);
  return { pairsRemoved: pairs.length, companiesUpdated: updates.length, revertPath };
}
