import { confidenceForSource, hubspotProps, reviewStatus } from './config.js';

/**
 * @param {import('./grouping.js').CompanyGroup[]} groups
 * @param {string} runId
 */
export function buildApplyAuditRows(groups, runId) {
  const appliedAt = new Date().toISOString();
  /** @type {Record<string, unknown>[]} */
  const rows = [];

  for (const group of groups) {
    for (const company of group.companies) {
      const isHub = company.id === group.hubId;
      const perteneceAntes =
        company.properties[hubspotProps.pertenece] || '';

      rows.push({
        run_id: runId,
        applied_at: appliedAt,
        group_key: group.groupKey,
        hub_id: group.hubId,
        company_id: company.id,
        company_name: company.name,
        domain: company.properties.domain || '',
        raw_domain: company.rawDomain || company.properties.domain || '',
        email_de_empresa: company.properties.email_de_empresa || '',
        key_source: company.source,
        corporate_family: group.familyId || company.familyId || '',
        group_size: group.memberIds.length,
        is_hub: isHub ? 'yes' : 'no',
        association_from: group.hubId,
        association_to: isHub ? '' : company.id,
        pertenece_antes: perteneceAntes,
        group_key_antes: company.properties[hubspotProps.groupKey] || '',
        hub_id_antes: company.properties[hubspotProps.hubCompanyId] || '',
        review_status_antes:
          company.properties[hubspotProps.groupReviewStatus] || '',
        group_confidence: confidenceForSource(
          /** @type {'domain' | 'email_de_empresa' | 'manual' | 'corporate' | 'brand_multi_tld' | 'root_domain' | 'sin_clave'} */ (
            company.source
          ),
        ),
        review_status_nuevo: reviewStatus.applied,
        pertenece_nuevo: 'true',
      });
    }
  }

  return rows;
}

export const APPLY_AUDIT_HEADERS = [
  'run_id',
  'applied_at',
  'group_key',
  'hub_id',
  'company_id',
  'company_name',
  'domain',
  'raw_domain',
  'email_de_empresa',
  'key_source',
  'corporate_family',
  'group_size',
  'is_hub',
  'association_from',
  'association_to',
  'pertenece_antes',
  'group_key_antes',
  'hub_id_antes',
  'review_status_antes',
  'group_confidence',
  'review_status_nuevo',
  'pertenece_nuevo',
];

/**
 * @param {Record<string, string>[]} auditRows
 */
export function associationPairsFromAudit(auditRows) {
  const seen = new Set();
  /** @type {Array<{ fromId: string, toId: string }>} */
  const pairs = [];

  for (const row of auditRows) {
    const fromId = row.association_from || row.hub_id;
    let toId = row.association_to;
    if (!toId && row.is_hub === 'no' && row.company_id) {
      toId = row.company_id;
    }
    if (!fromId || !toId || fromId === toId) continue;

    const key = `${fromId}->${toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ fromId, toId });
  }

  return pairs;
}

/**
 * @param {Record<string, string>[]} auditRows
 */
export function companyUpdatesFromAuditForRevert(auditRows) {
  /** @type {Map<string, Record<string, string>>} */
  const byId = new Map();

  for (const row of auditRows) {
    const id = row.company_id;
    if (!id || byId.has(id)) continue;

    const perteneceAntes = (row.pertenece_antes || row.current_pertenece || '').trim();
    /** @type {Record<string, string>} */
    const properties = {
      [hubspotProps.pertenece]:
        perteneceAntes !== '' && perteneceAntes != null
          ? perteneceAntes
          : 'false',
      [hubspotProps.groupReviewStatus]: reviewStatus.reverted,
    };

    if (process.env.HS_REVERT_CLEAR_GROUP_PROPS !== 'false') {
      properties[hubspotProps.groupKey] = row.group_key_antes || '';
      properties[hubspotProps.hubCompanyId] = row.hub_id_antes || '';
      properties[hubspotProps.groupConfidence] = '';
    }

    byId.set(id, properties);
  }

  return [...byId.entries()].map(([id, properties]) => ({ id, properties }));
}
