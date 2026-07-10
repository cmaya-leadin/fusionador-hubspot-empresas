const TEMPLATE_HEADERS = [
  'OBJETO',
  'Etiqueta del campo',
  'Tipo de campo',
  'Nombre interno',
  'Opciones',
  'Grupo de propiedades',
];

/**
 * @typedef {{
 *   row: number,
 *   object?: string,
 *   label?: string,
 *   type?: string,
 *   name?: string,
 *   optionsRaw?: string,
 *   group?: string,
 *   exists?: boolean,
 *   valid?: boolean,
 *   error?: string,
 * }} ImportedPropertyRow
 */

function normalizeCell(v) {
  if (v == null) return '';
  return String(v).trim();
}

function normalizeInternalName(name) {
  const raw = normalizeCell(name);
  if (!raw) return '';
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

/**
 * Convierte ids de schema (p. ej. 0-1) al slug de API de propiedades.
 * @param {string} raw
 */
export function resolveHubSpotObjectType(raw) {
  const original = String(raw || '').trim();
  const t = original.toLowerCase();
  const map = {
    '0-1': 'contacts',
    '0-2': 'companies',
    contact: 'contacts',
    contacts: 'contacts',
    contacto: 'contacts',
    contactos: 'contacts',
    company: 'companies',
    companies: 'companies',
    empresa: 'companies',
    empresas: 'companies',
  };
  return map[t] || original;
}

/**
 * Nombre interno del grupo de propiedades en HubSpot (groupName).
 * @param {string} displayLabel
 */
export function normalizeGroupInternalName(displayLabel) {
  const raw = normalizeCell(displayLabel);
  if (!raw) return '';
  let name = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  if (/^\d/.test(name)) name = `g_${name}`;
  return name;
}

/**
 * @param {'contacts' | 'companies' | string} [objectType]
 */
export function defaultPropertyGroupName(objectType) {
  if (objectType === 'companies') return 'companyinformation';
  return 'contactinformation';
}

/**
 * @param {string} raw
 */
function normalizeTypeKey(raw) {
  return normalizeCell(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Mapea el "Tipo de campo" del Excel al payload de HubSpot.
 * Esto puede ajustarse si aparecen más tipos en clientes.
 * @param {string} rawType
 */
export function mapExcelTypeToHubSpot(rawType) {
  const t = normalizeTypeKey(rawType);
  if (!t) return null;

  // Valores típicos (dependen del origen del Excel).
  if (t.includes('texto') || t === 'text' || t === 'string') {
    return { type: 'string', fieldType: 'text' };
  }
  if (t.includes('multilinea') || t.includes('multilínea') || t.includes('textarea') || t.includes('varias líneas') || t.includes('varias lineas')) {
    return { type: 'string', fieldType: 'textarea' };
  }
  if (t.includes('numero') || t.includes('número') || t === 'number') {
    return { type: 'number', fieldType: 'number' };
  }
  if (t.includes('fecha') || t === 'date') {
    return { type: 'date', fieldType: 'date' };
  }
  if (t.includes('datetime') || t.includes('fecha y hora')) {
    return { type: 'datetime', fieldType: 'date' };
  }
  // Multiselección: varias casillas con opciones (HubSpot: enumeration + checkbox).
  if (
    t.includes('multiples casillas')
    || (t.includes('multiple') && t.includes('casilla'))
    || t.includes('seleccion multiple')
    || t.includes('multi select')
    || t.includes('multichoice')
    || t.includes('multi choice')
  ) {
    return { type: 'enumeration', fieldType: 'checkbox' };
  }
  // Casilla individual sí/no.
  if (
    t.includes('boolean')
    || t.includes('si/no')
    || t.includes('sí/no')
    || t.includes('casilla de comprobación individual')
    || t.includes('casilla de comprobacion individual')
    || (t.includes('casilla') && t.includes('individual'))
    || (t.includes('comprobación') && !t.includes('múltiples') && !t.includes('multiples'))
    || (t.includes('comprobacion') && !t.includes('multiples'))
  ) {
    return { type: 'bool', fieldType: 'booleancheckbox' };
  }
  if (t.includes('enumer') || t.includes('seleccion') || t.includes('selección') || t.includes('dropdown') || t.includes('desplegable') || t.includes('lista')) {
    return { type: 'enumeration', fieldType: 'select' };
  }

  return null;
}

/**
 * @param {string} rawType
 */
export function excelTypeHasOptions(rawType) {
  const mapped = mapExcelTypeToHubSpot(rawType);
  return mapped?.type === 'enumeration';
}

/**
 * Parsea la columna Opciones de la plantilla.
 * Formato Enfoka: opciones separadas por |  (ej. "Lead | MQL | SQL")
 * También admite saltos de línea o ; como separadores alternativos.
 * @param {string} raw
 */
export function parseOptions(raw) {
  const text = normalizeCell(raw);
  if (!text) return [];

  let parts;
  if (text.includes('|')) {
    parts = text.split(/\s*\|\s*/g).map((s) => s.trim()).filter(Boolean);
  } else {
    parts = text.split(/[\n;]+/g).map((s) => s.trim()).filter(Boolean);
  }

  return parts.map((p, index) => {
    const label = p;
    return {
      label,
      value: normalizeInternalName(label),
      displayOrder: index,
      hidden: false,
    };
  });
}

/**
 * @param {ImportedPropertyRow} row
 */
export function getRowOptions(row) {
  const fromRaw = parseOptions(row?.optionsRaw || '');
  if (fromRaw.length) return fromRaw;
  if (!Array.isArray(row?.options) || !row.options.length) return [];
  return row.options.map((opt, index) => ({
    label: String(opt?.label || '').trim(),
    value: String(opt?.value || normalizeInternalName(opt?.label || '')).trim(),
    displayOrder: Number.isFinite(opt?.displayOrder) ? opt.displayOrder : index,
    hidden: Boolean(opt?.hidden),
  })).filter((opt) => opt.label && opt.value);
}

/**
 * @param {Record<string, unknown>} rowObj
 * @param {number} rowNumber 1-based row index in file (data rows)
 */
function parseRowObject(rowObj, rowNumber) {
  const object = normalizeCell(rowObj['OBJETO']);
  const label = normalizeCell(rowObj['Etiqueta del campo']);
  const type = normalizeCell(rowObj['Tipo de campo']);
  const name = normalizeInternalName(rowObj['Nombre interno']);
  const optionsRaw = normalizeCell(rowObj['Opciones']);
  const group = normalizeCell(rowObj['Grupo de propiedades'] || rowObj.Grupo);

  /** @type {ImportedPropertyRow} */
  const parsed = {
    row: rowNumber,
    object,
    label,
    type,
    name,
    optionsRaw,
    group,
    valid: true,
  };

  if (!label) {
    parsed.valid = false;
    parsed.error = 'Falta "Etiqueta del campo"';
  } else if (!name) {
    parsed.valid = false;
    parsed.error = 'Falta "Nombre interno"';
  } else if (!type) {
    parsed.valid = false;
    parsed.error = 'Falta "Tipo de campo"';
  }

  const mapped = mapExcelTypeToHubSpot(type);
  if (mapped?.type === 'enumeration') {
    parsed.options = parseOptions(optionsRaw);
  }

  return parsed;
}

/**
 * @param {string[]} headers
 */
export function validateTemplateHeaders(headers) {
  const normalized = headers.map((h) => normalizeCell(h));
  const required = TEMPLATE_HEADERS.filter((h) => h !== 'Grupo de propiedades');
  for (const req of required) {
    if (!normalized.includes(req)) {
      return { ok: false, error: `Plantilla inválida: falta la columna "${req}"` };
    }
  }
  const hasGroup = normalized.includes('Grupo de propiedades') || normalized.includes('Grupo');
  if (!hasGroup) {
    return { ok: false, error: 'Plantilla inválida: falta la columna "Grupo de propiedades" (o "Grupo")' };
  }
  return { ok: true };
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
export function parseImportedRows(rows) {
  /** @type {ImportedPropertyRow[]} */
  const parsed = [];
  let i = 0;
  for (const r of rows) {
    i += 1;
    // Ignorar filas totalmente vacías
    const any = Object.values(r || {}).some((v) => normalizeCell(v));
    if (!any) continue;
    parsed.push(parseRowObject(r, i));
  }
  return parsed;
}

/**
 * Construye el payload de creación para HubSpot, o error si no se puede.
 * @param {ImportedPropertyRow} row
 * @param {string} [objectType]
 * @param {{ groupNameByLabel?: Record<string, string> }} [opts]
 */
export function buildHubSpotPropertyPayload(row, objectType, opts = {}) {
  if (!row.valid) {
    return { ok: false, error: row.error || 'Fila inválida' };
  }
  const mapped = mapExcelTypeToHubSpot(row.type || '');
  if (!mapped) {
    return { ok: false, error: `Tipo de campo no soportado: "${row.type}"` };
  }

  const { groupNameByLabel = {} } = opts;
  const groupLabel = normalizeCell(row.group);
  const groupName = groupLabel
    ? resolveGroupNameFromMap(groupLabel, groupNameByLabel)
    : defaultPropertyGroupName(objectType);

  if (groupLabel && !isValidHubSpotGroupInternalName(groupName)) {
    return {
      ok: false,
      error: `No se pudo resolver el nombre interno del grupo "${groupLabel}" para HubSpot`,
    };
  }

  const payload = {
    name: row.name,
    label: row.label,
    groupName: isValidHubSpotGroupInternalName(groupName)
      ? groupName
      : normalizeGroupInternalName(groupLabel || groupName),
    type: mapped.type,
    fieldType: mapped.fieldType,
    formField: false,
  };

  if (mapped.type === 'enumeration') {
    const options = getRowOptions(row);
    if (!options.length) {
      return { ok: false, error: 'Faltan "Opciones" para un campo de tipo enumeración' };
    }
    payload.options = options.map((opt, index) => ({
      label: opt.label,
      value: opt.value,
      displayOrder: opt.displayOrder ?? index,
      hidden: opt.hidden ?? false,
    }));
  }

  return { ok: true, payload };
}

/**
 * @param {string} groupLabel
 * @param {Record<string, string>} groupNameByLabel
 */
export function resolveGroupNameFromMap(groupLabel, groupNameByLabel = {}) {
  const label = normalizeCell(groupLabel);
  if (!label) return '';

  let candidate = groupNameByLabel[label] || '';
  if (!candidate) {
    const lower = label.toLowerCase();
    const matchedKey = Object.keys(groupNameByLabel).find((k) => k.toLowerCase() === lower);
    if (matchedKey) candidate = groupNameByLabel[matchedKey];
  }

  if (isValidHubSpotGroupInternalName(candidate)) return candidate;
  return normalizeGroupInternalName(label);
}

/**
 * @param {string} name
 */
export function isValidHubSpotGroupInternalName(name) {
  return /^[a-z][a-z0-9_]*$/.test(String(name || ''));
}

/**
 * @param {Array<{ name?: string, label?: string }>} groups
 */
export function buildGroupNameByLabel(groups) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const g of groups || []) {
    const lbl = String(g.label || '').trim();
    const name = String(g.name || '').trim();
    if (!lbl || !name) continue;
    map[lbl] = isValidHubSpotGroupInternalName(name) ? name : normalizeGroupInternalName(lbl);
  }
  return map;
}

/**
 * Crea en HubSpot los grupos de propiedades que falten antes de crear campos.
 * @param {import('./hubspot.js').HubSpotClient} client
 * @param {string} objectType
 * @param {string[]} displayLabels
 */
export async function ensurePropertyGroups(client, objectType, displayLabels) {
  const uniqueLabels = [...new Set(
    displayLabels.map((l) => String(l || '').trim()).filter(Boolean),
  )];

  const created = [];
  const skipped = [];
  const errors = [];
  /** @type {Record<string, string>} */
  const groupNameByLabel = {};

  if (!uniqueLabels.length) {
    return { created, skipped, errors, groupNameByLabel, groupNames: new Set() };
  }

  const data = await client.listPropertyGroups(objectType);
  const existing = data?.results || [];
  const byName = new Map(existing.map((g) => [String(g.name || '').toLowerCase(), g]));
  const byLabel = new Map(existing.map((g) => [String(g.label || '').trim().toLowerCase(), g]));

  for (const g of existing) {
    const lbl = String(g.label || '').trim();
    const apiName = String(g.name || '').trim();
    if (!lbl || !apiName) continue;
    groupNameByLabel[lbl] = isValidHubSpotGroupInternalName(apiName)
      ? apiName
      : normalizeGroupInternalName(lbl);
  }

  for (const label of uniqueLabels) {
    const name = normalizeGroupInternalName(label);
    if (!name) {
      errors.push({ label, error: 'Nombre de grupo inválido' });
      continue;
    }

    if (byName.has(name.toLowerCase())) {
      groupNameByLabel[label] = byName.get(name.toLowerCase()).name;
      skipped.push({ name, label, reason: 'exists_by_name' });
      continue;
    }

    const labelMatch = byLabel.get(label.toLowerCase());
    if (labelMatch) {
      const resolvedName = isValidHubSpotGroupInternalName(labelMatch.name)
        ? labelMatch.name
        : name;
      if (byName.has(resolvedName.toLowerCase())) {
        groupNameByLabel[label] = resolvedName;
        skipped.push({ name: resolvedName, label, reason: 'exists_by_label' });
        continue;
      }
    }

    try {
      await client.createPropertyGroup(objectType, {
        name,
        label,
        displayOrder: 1,
      });
      created.push({ name, label });
      groupNameByLabel[label] = name;
      byName.set(name.toLowerCase(), { name, label });
      byLabel.set(label.toLowerCase(), { name, label });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Si otro proceso lo creó en paralelo, tratarlo como existente.
      if (/already exists|duplicate|conflict|409/i.test(message)) {
        const refreshed = await client.listPropertyGroups(objectType);
        const match = (refreshed?.results || []).find(
          (g) => String(g.label || '').trim().toLowerCase() === label.toLowerCase()
            || String(g.name || '').toLowerCase() === name.toLowerCase(),
        );
        if (match?.name) {
          groupNameByLabel[label] = match.name;
          skipped.push({ name: match.name, label, reason: 'exists_conflict' });
        } else {
          errors.push({ name, label, error: message });
        }
      } else {
        errors.push({ name, label, error: message });
      }
    }
  }

  const refreshed = await client.listPropertyGroups(objectType);
  const refreshedMap = buildGroupNameByLabel(refreshed?.results || []);
  for (const [label, name] of Object.entries(refreshedMap)) {
    groupNameByLabel[label] = name;
  }

  const groupNames = new Set(
    Object.values(groupNameByLabel).filter((n) => isValidHubSpotGroupInternalName(n)),
  );

  return { created, skipped, errors, groupNameByLabel, groupNames };
}

