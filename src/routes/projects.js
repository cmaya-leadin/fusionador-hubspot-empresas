import { Router } from 'express';
import {
  listProjectsForUser,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  addLog,
} from '../db.js';
import { encryptToken, decryptToken } from '../crypto-util.js';
import { requireAuth } from '../middleware/auth.js';
import { canAccessProject } from '../middleware/auth.js';
import { parseMergeCriteria } from '../merge-criteria.js';

const router = Router();

function sanitizeProject(project) {
  if (!project) return null;
  return {
    id: project.id,
    userId: project.user_id,
    name: project.name,
    hubspotAccount: project.hubspot_account,
    hasToken: Boolean(project.hubspot_token_enc),
    projectType: project.project_type || 'merge',
    entityType: project.entity_type,
    mergeCriteria: parseMergeCriteria(project.merge_criteria, project.entity_type),
    hsObjectType: project.hs_object_type || '',
    propertiesImport: (() => {
      try {
        return JSON.parse(project.properties_import || '{}');
      } catch {
        return {};
      }
    })(),
    ownerUsername: project.owner_username,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

router.use(requireAuth);

router.get('/', (req, res) => {
  const isAdmin = req.session.role === 'admin';
  const projects = listProjectsForUser(req.session.userId, isAdmin);
  res.json({ projects: projects.map(sanitizeProject) });
});

router.post('/', (req, res) => {
  const { name, hubspotAccount, hubspotToken, entityType, mergeCriteria, projectType } =
    req.body || {};

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Nombre del proyecto requerido' });
  }
  const normalizedType = projectType === 'properties' ? 'properties' : 'merge';

  const project = createProject({
    userId: req.session.userId,
    name: name.trim(),
    hubspotAccount: hubspotAccount?.trim() || '',
    hubspotTokenEnc: hubspotToken ? encryptToken(hubspotToken.trim()) : '',
    projectType: normalizedType,
    entityType: entityType || 'companies',
    mergeCriteria:
      normalizedType === 'merge'
        ? parseMergeCriteria(mergeCriteria || {}, entityType || 'companies')
        : {},
  });

  addLog({
    userId: req.session.userId,
    projectId: project.id,
    action: 'PROJECT_CREATE',
    status: 'SUCCESS',
    message: `Proyecto creado: ${project.name}`,
  });

  res.status(201).json({ project: sanitizeProject(project) });
});

router.get('/:id', (req, res) => {
  const project = getProjectById(Number(req.params.id));
  if (!canAccessProject(project, req)) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }
  res.json({ project: sanitizeProject(project) });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getProjectById(id);
  if (!canAccessProject(existing, req)) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }

  const { name, hubspotAccount, hubspotToken, entityType, mergeCriteria, projectType, hsObjectType } =
    req.body || {};

  const updates = {};
  if (name != null) updates.name = name.trim();
  if (hubspotAccount != null) updates.hubspotAccount = hubspotAccount.trim();
  if (hubspotToken?.trim()) {
    updates.hubspotTokenEnc = encryptToken(hubspotToken.trim());
  }
  if (projectType != null) {
    updates.projectType = projectType === 'properties' ? 'properties' : 'merge';
  }
  if (entityType != null) updates.entityType = entityType;
  if (hsObjectType != null) updates.hsObjectType = String(hsObjectType || '');
  if (mergeCriteria != null) {
    const effectiveType = updates.projectType || existing.project_type || 'merge';
    if (effectiveType !== 'merge') {
      return res.status(400).json({ error: 'mergeCriteria solo aplica a proyectos de fusión' });
    }
    const entity = entityType || existing.entity_type;
    const parsed = parseMergeCriteria(mergeCriteria, entity);
    if (!parsed.matchRules?.length) {
      return res.status(400).json({ error: 'Al menos una regla de coincidencia es requerida' });
    }
    if (!parsed.primaryRules?.length) {
      return res.status(400).json({ error: 'Al menos una regla de predominancia es requerida' });
    }
    updates.mergeCriteria = parsed;
  }

  const project = updateProject(id, updates);

  addLog({
    userId: req.session.userId,
    projectId: id,
    action: 'PROJECT_UPDATE',
    status: 'SUCCESS',
    message: `Proyecto actualizado: ${project.name}`,
  });

  res.json({ project: sanitizeProject(project) });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getProjectById(id);
  if (!canAccessProject(existing, req)) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }

  const projectName = existing.name || `Proyecto #${id}`;
  deleteProject(id);

  addLog({
    userId: req.session.userId,
    projectId: null,
    action: 'PROJECT_DELETE',
    status: 'SUCCESS',
    message: `Proyecto eliminado: ${projectName} (id ${id})`,
  });

  res.json({ ok: true });
});

export function getProjectToken(project) {
  return decryptToken(project.hubspot_token_enc);
}

export default router;
