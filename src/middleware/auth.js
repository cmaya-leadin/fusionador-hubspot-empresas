/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireAdmin(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
}

/**
 * @param {{ id: number, user_id: number }} project
 * @param {import('express').Request} req
 */
export function canAccessProject(project, req) {
  if (!project) return false;
  if (req.session.role === 'admin') return true;
  return project.user_id === req.session.userId;
}
