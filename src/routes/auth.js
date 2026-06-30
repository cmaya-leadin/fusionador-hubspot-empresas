import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  getUserByUsername,
  getUserById,
  addLog,
} from '../db.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  const user = getUserByUsername(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    addLog({
      action: 'LOGIN_FAILED',
      status: 'ERROR',
      message: `Intento fallido: ${username}`,
    });
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;

  addLog({
    userId: user.id,
    action: 'LOGIN',
    status: 'SUCCESS',
    message: `Sesión iniciada: ${user.username}`,
  });

  res.json({
    user: { id: user.id, username: user.username, role: user.role },
  });
});

router.post('/logout', (req, res) => {
  const userId = req.session?.userId;
  if (userId) {
    addLog({
      userId,
      action: 'LOGOUT',
      status: 'INFO',
      message: 'Sesión cerrada',
    });
  }
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  const user = getUserById(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'Usuario no encontrado' });
  }

  res.json({ user });
});

export default router;
