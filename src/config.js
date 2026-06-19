/**
 * Nombres internos de propiedades en HubSpot.
 * Sobrescribibles en .env si en tu portal difieren.
 */
export const rootDomainProp =
  process.env.HS_PROP_ROOT_DOMAIN || 'dominio_raiz';

export const hubspotProps = {
  pertenece:
    process.env.HS_PROP_GRUPO || 'pertenece_a_grupo_de_empresas',
  groupKey: process.env.HS_PROP_GROUP_KEY || 'group_key',
  groupConfidence:
    process.env.HS_PROP_GROUP_CONFIDENCE || 'group_confidence',
  groupReviewStatus:
    process.env.HS_PROP_GROUP_REVIEW_STATUS || 'group_review_status',
  hubCompanyId:
    process.env.HS_PROP_HUB_ID || 'grupo_empresa_principal_id',
  /**
   * Opcional: solo si creaste la propiedad en HubSpot y defines HS_PROP_RUN_ID en .env
   * @type {string | null}
   */
  grupoScriptRunId: process.env.HS_PROP_RUN_ID?.trim() || null,
};

/** Valores internos del select group_review_status */
export const reviewStatus = {
  applied: process.env.HS_REVIEW_APLICADO || 'APROBADO',
  reverted: process.env.HS_REVIEW_REVERTIDO || 'PENDIENTE',
  pending: process.env.HS_REVIEW_PENDIENTE || 'PENDIENTE',
};

export const perteneceValues = {
  si: process.env.HS_PERTENECE_SI || 'true',
  no: process.env.HS_PERTENECE_NO || 'false',
};

/**
 * @param {'domain' | 'email_de_empresa' | 'manual' | 'corporate' | 'brand_multi_tld' | 'root_domain' | 'sin_clave'} source
 */
export function confidenceForSource(source) {
  switch (source) {
    case 'corporate':
      return 95;
    case 'domain':
    case 'root_domain':
      return 100;
    case 'brand_multi_tld':
      return 75;
    case 'email_de_empresa':
      return 80;
    case 'manual':
      return 90;
    default:
      return 50;
  }
}

/** Umbral recomendado para ejecución masiva sin revisión manual */
export const CONFIDENCE_HIGH = Number(process.env.HS_MIN_CONFIDENCE_HIGH || 90);
