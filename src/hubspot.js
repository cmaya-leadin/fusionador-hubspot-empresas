const BASE_URL = 'https://api.hubapi.com';

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
  'hs_lastmodifieddate',
  'lastmodifieddate',
];

export const MERGE_CONTACT_PROPERTIES = [
  'firstname',
  'lastname',
  'email',
  'phone',
  'mobilephone',
  'hs_calculated_phone_number',
  'hs_searchable_calculated_international_phone_number',
  'hs_whatsapp_phone_number',
  'company',
  'jobtitle',
  'address',
  'city',
  'state',
  'country',
  'lifecyclestage',
  'hs_lead_status',
  'createdate',
  'hs_lastmodifieddate',
  'lastmodifieddate',
  'num_associated_deals',
];

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
   * @param {{ maxAttempts?: number, retryBaseMs?: number }} [retryOpts]
   */
  async function request(path, init = {}, retryOpts = {}) {
    const maxAttempts = retryOpts.maxAttempts ?? 4;
    const retryBaseMs = retryOpts.retryBaseMs ?? 2000;
    const url = `${BASE_URL}${path}`;
    let attempt = 0;

    while (true) {
      const response = await fetch(url, {
        ...init,
        headers: { ...headers, ...init.headers },
      });

      if (response.status === 429 && attempt < maxAttempts) {
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

      const isRetryable =
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504;

      if (isRetryable && attempt < maxAttempts) {
        const delayMs = (attempt + 1) * retryBaseMs;
        await sleep(delayMs);
        attempt += 1;
        continue;
      }

      if (!response.ok) {
        throw formatHubSpotError(response.status, body, text || response.statusText);
      }

      return body;
    }
  }

  /**
   * @param {'companies' | 'contacts'} objectType
   * @param {string} id
   */
  async function getObject(objectType, id) {
    try {
      return await request(`/crm/v3/objects/${objectType}/${id}?properties=firstname,lastname,email,name`);
    } catch (error) {
      const status =
        error instanceof Error && 'hubspotStatus' in error
          ? Number(/** @type {{ hubspotStatus?: number }} */ (error).hubspotStatus)
          : 0;
      if (status === 404) return null;
      throw error;
    }
  }

  /**
   * @param {'companies' | 'contacts'} objectType
   * @param {string[]} properties
   * @param {(info: { fetched: number, page: number }) => void} [onPage]
   */
  async function fetchAllObjects(objectType, properties, onPage) {
    const objects = [];
    let after;
    let page = 0;

    do {
      const params = new URLSearchParams({
        limit: '100',
        properties: properties.join(','),
      });
      if (after) params.set('after', after);

      const data = await request(`/crm/v3/objects/${objectType}?${params}`);
      if (data.results?.length) {
        objects.push(...data.results);
      }
      page += 1;
      after = data.paging?.next?.after;
      onPage?.({ fetched: objects.length, page });
    } while (after);

    return objects;
  }

  return {
    async testConnection() {
      await request('/crm/v3/objects/companies?limit=1');
      return { ok: true };
    },

    async listSchemas() {
      return request('/crm/v3/schemas');
    },

    /**
     * @param {string} objectType
     */
    async listProperties(objectType) {
      // HubSpot v3 properties endpoint. En la práctica suele devolver todo sin paginación.
      return request(`/crm/v3/properties/${encodeURIComponent(objectType)}`);
    },

    /**
     * @param {string} objectType
     */
    async listPropertyGroups(objectType) {
      return request(`/crm/v3/properties/${encodeURIComponent(objectType)}/groups`);
    },

    /**
     * @param {string} objectType
     * @param {{ name: string, label: string, displayOrder?: number }} payload
     */
    async createPropertyGroup(objectType, payload) {
      return request(`/crm/v3/properties/${encodeURIComponent(objectType)}/groups`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    /**
     * @param {string} objectType
     * @param {Record<string, unknown>} payload
     */
    async createProperty(objectType, payload) {
      return request(`/crm/v3/properties/${encodeURIComponent(objectType)}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async fetchAllCompanies(properties = MERGE_COMPANY_PROPERTIES, onPage) {
      return fetchAllObjects('companies', properties, onPage);
    },

    async fetchAllContacts(properties = MERGE_CONTACT_PROPERTIES, onPage) {
      return fetchAllObjects('contacts', properties, onPage);
    },

    /**
     * @param {'companies' | 'contacts'} objectType
     * @param {string} primaryId
     * @param {string} mergeId
     */
    async mergeObjects(objectType, primaryId, mergeId) {
      return request(
        `/crm/v3/objects/${objectType}/merge`,
        {
          method: 'POST',
          body: JSON.stringify({
            primaryObjectId: String(primaryId),
            objectIdToMerge: String(mergeId),
          }),
        },
        { maxAttempts: 1 },
      );
    },

    async getContact(id) {
      return getObject('contacts', id);
    },

    async getCompany(id) {
      return getObject('companies', id);
    },

    async mergeCompanies(primaryId, mergeId) {
      return this.mergeObjects('companies', primaryId, mergeId);
    },

    async mergeContacts(primaryId, mergeId) {
      return this.mergeObjects('contacts', primaryId, mergeId);
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {number} status
 * @param {unknown} body
 * @param {string} fallbackText
 */
function formatHubSpotError(status, body, fallbackText) {
  if (body && typeof body === 'object') {
    const b = /** @type {Record<string, unknown>} */ (body);
    const parts = [String(b.message || 'Error desconocido')];
    if (b.category) parts.push(`[${b.category}]`);
    if (b.correlationId) parts.push(`correlationId: ${b.correlationId}`);
    const err = new Error(`HubSpot ${status}: ${parts.join(' · ')}`);
    if (b.correlationId) err.correlationId = String(b.correlationId);
    err.hubspotStatus = status;
    err.hubspotCategory = b.category ? String(b.category) : undefined;
    return err;
  }
  return new Error(`HubSpot ${status}: ${fallbackText}`);
}
