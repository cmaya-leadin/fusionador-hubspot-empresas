import { hubspotProps, rootDomainProp } from './config.js';

const BASE_URL = 'https://api.hubapi.com';

const COMPANY_PROPERTIES = [
  'name',
  'domain',
  rootDomainProp,
  'email_de_empresa',
  'vat_number___cif',
  'phone',
  'address',
  hubspotProps.pertenece,
  hubspotProps.groupKey,
  hubspotProps.groupConfidence,
  hubspotProps.groupReviewStatus,
  hubspotProps.hubCompanyId,
  hubspotProps.grupoScriptRunId,
  'createdate',
].filter(Boolean);

export const MERGE_COMPANY_PROPERTIES = [
  'name',
  'domain',
  'estado',
  'tipo_relacion_negocio',
  'codigo_cuenta_nav',
  'num_associated_contacts',
  'email_de_empresa',
  'vat_number___cif',
  'phone',
  'address',
  'city',
  'state',
  'country',
  'industry',
  'website',
  'description',
  'createdate',
];

/** @type {{ associationCategory: string, associationTypeId: number }} */
export const GRUPO_EMPRESA_ASSOCIATION = {
  associationCategory: 'USER_DEFINED',
  associationTypeId: 1,
};

/** @typedef {ReturnType<typeof createHubSpotClient>} HubSpotClient */

/**
 * @param {string} token
 */
export function createHubSpotClient(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  /**
   * @param {string} path
   * @param {RequestInit} [init]
   */
  async function request(path, init = {}) {
    const url = `${BASE_URL}${path}`;
    let attempt = 0;

    while (true) {
      const response = await fetch(url, {
        ...init,
        headers: { ...headers, ...init.headers },
      });

      if (response.status === 429 && attempt < 6) {
        const retryAfter = Number(response.headers.get('retry-after') || 2);
        const delayMs = (retryAfter + attempt) * 1000;
        await sleep(delayMs);
        attempt += 1;
        continue;
      }

      const text = await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }

      if (!response.ok) {
        const detail =
          typeof body === 'object' && body?.message
            ? body.message
            : text || response.statusText;
        throw new Error(`HubSpot ${response.status}: ${detail}`);
      }

      return body;
    }
  }

  return {
    /**
     * @returns {Promise<Array<{ id: string, properties: Record<string, string> }>>}
     */
    async fetchAllCompanies(properties = COMPANY_PROPERTIES) {
      const companies = [];
      let after;

      do {
        const params = new URLSearchParams({
          limit: '100',
          properties: properties.join(','),
        });
        if (after) params.set('after', after);

        const data = await request(`/crm/v3/objects/companies?${params}`);
        if (data.results?.length) {
          companies.push(...data.results);
        }
        after = data.paging?.next?.after;
        if (companies.length % 500 === 0 && companies.length > 0) {
          console.log(`  … ${companies.length} empresas leídas`);
        }
      } while (after);

      return companies;
    },

    /**
     * @param {string} primaryId
     * @param {string} mergeId
     */
    async mergeCompanies(primaryId, mergeId) {
      return request('/crm/v3/objects/companies/merge', {
        method: 'POST',
        body: JSON.stringify({
          primaryObjectId: String(primaryId),
          objectIdToMerge: String(mergeId),
        }),
      });
    },

    /**
     * @param {Array<{ id: string, properties: Record<string, string> }>} inputs
     */
    async batchUpdateCompanies(inputs) {
      const chunkSize = 100;
      for (let i = 0; i < inputs.length; i += chunkSize) {
        const chunk = inputs.slice(i, i + chunkSize);
        await request('/crm/v3/objects/companies/batch/update', {
          method: 'POST',
          body: JSON.stringify({ inputs: chunk }),
        });
      }
    },

    /**
     * @param {Array<{ fromId: string, toId: string }>} pairs
     */
    async batchCreateGrupoEmpresaAssociations(pairs) {
      await batchAssociationRequest(pairs, 'create');
    },

    /**
     * @param {Array<{ fromId: string, toId: string }>} pairs
     */
    async batchArchiveGrupoEmpresaAssociations(pairs) {
      await batchAssociationRequest(pairs, 'archive');
    },
  };

  /**
   * @param {Array<{ fromId: string, toId: string }>} pairs
   * @param {'create' | 'archive'} action
   */
  async function batchAssociationRequest(pairs, action) {
    const chunkSize = 100;
    const endpoint =
      action === 'create'
        ? '/crm/v4/associations/companies/companies/batch/create'
        : '/crm/v4/associations/companies/companies/batch/labels/archive';

    for (let i = 0; i < pairs.length; i += chunkSize) {
      const chunk = pairs.slice(i, i + chunkSize);
      const inputs = chunk.map(({ fromId, toId }) => ({
        types: [GRUPO_EMPRESA_ASSOCIATION],
        from: { id: String(fromId) },
        to: { id: String(toId) },
      }));

      await request(endpoint, {
        method: 'POST',
        body: JSON.stringify({ inputs }),
      });
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
