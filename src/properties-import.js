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
  return raw.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Nombre interno del grupo de propiedades en HubSpot (groupName).
 * @param {string} displayLabel
 */
export function normalizeGroupInternalName(displayLabel) {
  const raw = normalizeCell(displayLabel);
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
 * @param {'contacts' | 'companies' | string} [objectType]
 */
export function defaultPropertyGroupName(objectType) {
  if (objectType === 'companies') return 'companyinformation';
  return 'contactinformation';
}

/**
 * Mapea el "Tipo de campo" del Excel al payload de HubSpot.
 * Esto puede ajustarse si aparecen más tipos en clientes.
 * @param {string} rawType
 */
export function mapExcelTypeToHubSpot(rawType) {
  const t = normalizeCell(rawType).toLowerCase();
  if (!t) return null;

  // Valores típicos (dependen del origen del Excel).
  if (t.includes('texto') || t === 'text' || t === 'string') {
    return { type: 'string', fieldType: 'text' };
  }
  if (t.includes('multilinea') || t.includes('multilínea') || t.includes('textarea')) {
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
  if (t.includes('boolean') || t.includes('si/no') || t.includes('sí/no') || t.includes('casilla') || t.includes('comprobación') || t.includes('comprobacion')) {
    return { type: 'bool', fieldType: 'booleancheckbox' };
  }
  if (t.includes('enumer') || t.includes('seleccion') || t.includes('selección') || t.includes('dropdown') || t.includes('desplegable') || t.includes('lista')) {
    return { type: 'enumeration', fieldType: 'select' };
  }

  return null;
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

  return parts.map((p) => {
    const label = p;
    return { label, value: normalizeInternalName(label) };
  });
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
 */
export function buildHubSpotPropertyPayload(row, objectType) {
  if (!row.valid) {
    return { ok: false, error: row.error || 'Fila inválida' };
  }
  const mapped = mapExcelTypeToHubSpot(row.type || '');
  if (!mapped) {
    return { ok: false, error: `Tipo de campo no soportado: "${row.type}"` };
  }

  const groupLabel = normalizeCell(row.group);
  const groupName = groupLabel
    ? normalizeGroupInternalName(groupLabel)
    : defaultPropertyGroupName(objectType);

  const payload = {
    name: row.name,
    label: row.label,
    groupName,
    type: mapped.type,
    fieldType: mapped.fieldType,
    formField: false,
  };

  if (mapped.type === 'enumeration') {
    const options = parseOptions(row.optionsRaw || '');
    if (!options.length) {
      return { ok: false, error: 'Faltan "Opciones" para un campo de tipo enumeración' };
    }
    payload.options = options;
  }

  return { ok: true, payload };
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

  if (!uniqueLabels.length) {
    return { created, skipped, errors };
  }

  const data = await client.listPropertyGroups(objectType);
  const existing = data?.results || [];
  const byName = new Map(existing.map((g) => [String(g.name || '').toLowerCase(), g]));
  const byLabel = new Map(existing.map((g) => [String(g.label || '').trim().toLowerCase(), g]));

  for (const label of uniqueLabels) {
    const name = normalizeGroupInternalName(label);
    if (!name) {
      errors.push({ label, error: 'Nombre de grupo inválido' });
      continue;
    }

    if (byName.has(name.toLowerCase())) {
      skipped.push({ name, label, reason: 'exists_by_name' });
      continue;
    }

    const labelMatch = byLabel.get(label.toLowerCase());
    if (labelMatch) {
      skipped.push({ name: labelMatch.name, label, reason: 'exists_by_label' });
      continue;
    }

    try {
      await client.createPropertyGroup(objectType, {
        name,
        label,
        displayOrder: -1,
      });
      created.push({ name, label });
      byName.set(name.toLowerCase(), { name, label });
      byLabel.set(label.toLowerCase(), { name, label });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Si otro proceso lo creó en paralelo, tratarlo como existente.
      if (/already exists|duplicate|conflict|409/i.test(message)) {
        skipped.push({ name, label, reason: 'exists_conflict' });
      } else {
        errors.push({ name, label, error: message });
      }
    }
  }

  return { created, skipped, errors };
}

