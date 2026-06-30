import { Router } from 'express';
import { listLogs } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const projectId = req.query.projectId ? Number(req.query.projectId) : null;

  const logs = listLogs({
    limit,
    projectId,
    userId: req.session.role === 'admin' ? null : req.session.userId,
  });

  res.json({ logs });
});

export default router;
