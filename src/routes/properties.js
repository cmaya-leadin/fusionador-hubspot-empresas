import { Router } from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { getProjectById, updateProject, addLog } from '../db.js';
import { requireAuth, canAccessProject } from '../middleware/auth.js';
import { getProjectToken } from './projects.js';
import { createHubSpotClient } from '../hubspot.js';
import {
  validateTemplateHeaders,
  parseImportedRows,
  buildHubSpotPropertyPayload,
  ensurePropertyGroups,
} from '../properties-import.js';

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseCsvBuffer(buffer) {
  const text = buffer.toString('utf8');
  const wb = xlsx.read(text, { type: 'string' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json(ws, { defval: '' });
}

function parseXlsxBuffer(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json(ws, { defval: '' });
}

const STANDARD_SCHEMAS = [
  {
    objectTypeId: 'contacts',
    name: 'contacts',
    labels: { singular: 'Contacto', plural: 'Contactos' },
    primaryDisplayProperty: 'firstname',
  },
  {
    objectTypeId: 'companies',
    name: 'companies',
    labels: { singular: 'Empresa', plural: 'Empresas' },
    primaryDisplayProperty: 'name',
  },
];

router.get('/:id/schemas', async (req, res) => {
  try {
    const project = getProjectById(Number(req.params.id));
    if (!canAccessProject(project, req)) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const token = getProjectToken(project);
    if (!token) return res.status(400).json({ error: 'Token de HubSpot no configurado' });

    const client = createHubSpotClient(token);
    let custom = [];
    try {
      const data = await client.listSchemas();
      custom = (data?.results || []).map((s) => ({
        objectTypeId: s.objectTypeId,
        name: s.name,
        labels: s.labels || {},
        primaryDisplayProperty: s.primaryDisplayProperty || null,
      }));
    } catch (schemaErr) {
      console.warn('[properties] No se pudieron cargar schemas personalizados:', schemaErr instanceof Error ? schemaErr.message : schemaErr);
    }

    const seen = new Set(STANDARD_SCHEMAS.map((s) => s.objectTypeId));
    const schemas = [
      ...STANDARD_SCHEMAS,
      ...custom.filter((s) => !seen.has(s.objectTypeId)),
    ];

    res.json({ schemas, schemasWarning: custom.length === 0 ? 'Solo objetos estándar (Contactos/Empresas). El token puede no tener scope para schemas personalizados.' : null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post('/:id/import', upload.single('file'), async (req, res) => {
  try {
    const project = getProjectById(Number(req.params.id));
    if (!canAccessProject(project, req)) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const token = getProjectToken(project);
    if (!token) return res.status(400).json({ error: 'Token de HubSpot no configurado' });

    const hsObjectType = String(req.body?.hsObjectType || '').trim();
    if (!hsObjectType) return res.status(400).json({ error: 'Selecciona un objeto de HubSpot' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Fichero requerido' });

    const isXlsx = (file.originalname || '').toLowerCase().endsWith('.xlsx');
    const isCsv = (file.originalname || '').toLowerCase().endsWith('.csv');
    if (!isXlsx && !isCsv) return res.status(400).json({ error: 'Formato no soportado (usa .xlsx o .csv)' });

    let rows;
    try {
      rows = isXlsx ? parseXlsxBuffer(file.buffer) : parseCsvBuffer(file.buffer);
    } catch {
      return res.status(400).json({ error: 'No se pudo leer el fichero. Revisa que sea un Excel/CSV válido.' });
    }

    const headers = rows.length ? Object.keys(rows[0]) : [];
    const headerCheck = validateTemplateHeaders(headers);
    if (!headerCheck.ok) return res.status(400).json({ error: headerCheck.error });

    const parsedRows = parseImportedRows(rows);

    const client = createHubSpotClient(token);
    const propsData = await client.listProperties(hsObjectType);
    const existing = new Set((propsData?.results || []).map((p) => String(p.name || '').toLowerCase()).filter(Boolean));

    for (const r of parsedRows) {
      if (r.name) r.exists = existing.has(String(r.name).toLowerCase());
    }

    const importPayload = {
      fileName: file.originalname,
      importedAt: new Date().toISOString(),
      hsObjectType,
      rows: parsedRows,
    };

    updateProject(project.id, {
      projectType: project.project_type || 'properties',
      hsObjectType,
      propertiesImport: importPayload,
    });

    addLog({
      userId: req.session.userId,
      projectId: project.id,
      action: 'PROPERTIES_IMPORT',
      status: 'SUCCESS',
      message: `Importación de propiedades: ${file.originalname} (${parsedRows.length} filas)`,
    });

    res.json({ import: importPayload });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post('/:id/create', async (req, res) => {
  try {
    const project = getProjectById(Number(req.params.id));
    if (!canAccessProject(project, req)) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const token = getProjectToken(project);
    if (!token) return res.status(400).json({ error: 'Token de HubSpot no configurado' });

    const hsObjectType = String(req.body?.hsObjectType || project.hs_object_type || '').trim();
    if (!hsObjectType) return res.status(400).json({ error: 'Selecciona un objeto de HubSpot' });

    /** @type {string[]} */
    const names = Array.isArray(req.body?.names) ? req.body.names.map(String) : [];
    if (!names.length) return res.status(400).json({ error: 'Selecciona al menos una propiedad para crear' });

    let importObj = {};
    try {
      importObj = JSON.parse(project.properties_import || '{}');
    } catch {
      importObj = {};
    }
    const importedRows = Array.isArray(importObj.rows) ? importObj.rows : [];
    const rowsByName = new Map(importedRows.map((r) => [String(r.name || ''), r]));

    const client = createHubSpotClient(token);
    const propsData = await client.listProperties(hsObjectType);
    const existing = new Set((propsData?.results || []).map((p) => String(p.name || '').toLowerCase()).filter(Boolean));

    const rowsToCreate = names
      .map((name) => rowsByName.get(name))
      .filter((row) => row && !row.exists && row.valid !== false && !existing.has(String(row.name || '').toLowerCase()));

    const groupLabels = rowsToCreate.map((row) => row.group).filter(Boolean);
    const groupResults = await ensurePropertyGroups(client, hsObjectType, groupLabels);

    const results = [];
    for (const name of names) {
      const row = rowsByName.get(name);
      if (!row) {
        results.push({ name, status: 'skipped', reason: 'No está en la importación actual' });
        continue;
      }
      if (existing.has(String(name).toLowerCase())) {
        results.push({ name, status: 'exists', reason: 'Ya existe en la cuenta' });
        continue;
      }
      const built = buildHubSpotPropertyPayload(row, hsObjectType);
      if (!built.ok) {
        results.push({ name, status: 'error', reason: built.error });
        continue;
      }
      try {
        await client.createProperty(hsObjectType, built.payload);
        results.push({ name, status: 'created', groupName: built.payload.groupName });
        existing.add(String(name).toLowerCase());
        row.exists = true;
      } catch (e) {
        results.push({ name, status: 'error', reason: e instanceof Error ? e.message : String(e) });
      }
    }

    updateProject(project.id, {
      propertiesImport: {
        ...importObj,
        rows: importedRows,
      },
    });

    addLog({
      userId: req.session.userId,
      projectId: project.id,
      action: 'PROPERTIES_CREATE',
      status: results.some((r) => r.status === 'error') ? 'WARNING' : 'SUCCESS',
      message: `Creación de propiedades en ${hsObjectType}: ${results.filter((r) => r.status === 'created').length} creadas`,
    });

    res.json({ hsObjectType, groupResults, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;

