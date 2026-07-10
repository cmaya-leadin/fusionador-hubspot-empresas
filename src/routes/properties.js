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
  resolveHubSpotObjectType,
} from '../properties-import.js';
import { createPropertiesProgress } from '../properties-progress.js';
import { executePropertiesCreate } from '../properties-create.js';
import { initSse, writeSse } from '../merge-progress.js';

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
    apiObjectType: 'contacts',
    name: 'contacts',
    labels: { singular: 'Contacto', plural: 'Contactos' },
    primaryDisplayProperty: 'firstname',
  },
  {
    objectTypeId: 'companies',
    apiObjectType: 'companies',
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
        apiObjectType: resolveHubSpotObjectType(s.name || s.objectTypeId),
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

    const hsObjectType = resolveHubSpotObjectType(req.body?.hsObjectType || '');
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

function wantsStream(req) {
  return req.query.stream === '1' || req.body?.stream === true;
}

router.post('/:id/create', async (req, res) => {
  const stream = wantsStream(req);
  let sseOpen = false;

  try {
    const project = getProjectById(Number(req.params.id));
    if (!canAccessProject(project, req)) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const token = getProjectToken(project);
    if (!token) return res.status(400).json({ error: 'Token de HubSpot no configurado' });

    const hsObjectType = resolveHubSpotObjectType(req.body?.hsObjectType || project.hs_object_type || '');
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

    /** @type {ReturnType<typeof createPropertiesProgress> | null} */
    let progress = null;

    if (stream) {
      initSse(res);
      sseOpen = true;
      progress = createPropertiesProgress((payload) => {
        if (payload.type === 'log') writeSse(res, 'log', payload);
        else if (payload.type === 'progress') writeSse(res, 'progress', payload);
      });
      progress.log('Conexión establecida. Preparando creación en HubSpot…');
    }

    addLog({
      userId: req.session.userId,
      projectId: project.id,
      action: 'PROPERTIES_CREATE',
      status: 'INFO',
      message: `Iniciando creación de ${names.length} propiedades en ${hsObjectType}`,
    });

    const client = createHubSpotClient(token);
    const result = await executePropertiesCreate(client, {
      hsObjectType,
      names,
      importedRows,
      progress,
    });

    updateProject(project.id, {
      propertiesImport: {
        ...importObj,
        rows: importedRows,
      },
    });

    const { summary } = result;
    addLog({
      userId: req.session.userId,
      projectId: project.id,
      action: 'PROPERTIES_CREATE',
      status: summary.errors > 0 ? (summary.created > 0 ? 'WARNING' : 'ERROR') : 'SUCCESS',
      message: `Creación de propiedades en ${hsObjectType}: ${summary.created} creadas${summary.errors ? `, ${summary.errors} con error` : ''}`,
    });

    if (stream) {
      writeSse(res, 'complete', result);
      res.end();
      sseOpen = false;
      return;
    }

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      addLog({
        userId: req.session.userId,
        projectId: Number(req.params.id),
        action: 'PROPERTIES_CREATE',
        status: 'ERROR',
        message: `Error al crear propiedades: ${message}`,
      });
    } catch {
      // ignore logging failures
    }

    if (stream && sseOpen) {
      writeSse(res, 'error', { message });
      res.end();
      sseOpen = false;
      return;
    }

    res.status(500).json({ error: message });
  }
});

export default router;

