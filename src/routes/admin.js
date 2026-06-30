import { Router } from 'express';
import {
  listUsers,
  createUser,
  updateUserPassword,
  deleteUser,
  getUserById,
  addLog,
} from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAdmin);

router.get('/users', (req, res) => {
  res.json({ users: listUsers() });
});

router.post('/users', (req, res) => {
  const { username, password, role } = req.body || {};

  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    const user = createUser(username.trim(), password, role === 'admin' ? 'admin' : 'user');
    addLog({
      userId: req.session.userId,
      action: 'USER_CREATE',
      status: 'SUCCESS',
      message: `Usuario creado: ${user.username}`,
    });
    res.status(201).json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message.includes('UNIQUE') ? 'El usuario ya existe' : message });
  }
});

router.put('/users/:id/password', (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ error: 'Contraseña requerida' });
  }

  const user = getUserById(id);
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  updateUserPassword(id, password);
  addLog({
    userId: req.session.userId,
    action: 'USER_PASSWORD_UPDATE',
    status: 'SUCCESS',
    message: `Contraseña actualizada: ${user.username}`,
  });
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);

  if (id === req.session.userId) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }

  const user = getUserById(id);
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  deleteUser(id);
  addLog({
    userId: req.session.userId,
    action: 'USER_DELETE',
    status: 'SUCCESS',
    message: `Usuario eliminado: ${user.username}`,
  });
  res.json({ ok: true });
});

export default router;
