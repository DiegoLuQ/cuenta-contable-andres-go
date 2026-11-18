import { Router } from 'express';
import {
  login,
  requireAuth,
  requireRole,
  setSessionCookie,
  clearSessionCookie,
  listarUsuarios,
  crearUsuario,
  actualizarUsuario,
  cambiarPasswordPropia,
  usuarioPublico
} from '../services/authService.js';
import {
  listarApiKeys,
  crearApiKey,
  setApiKeyActiva,
  fichaApiKey,
  getBaseUrl,
  getConfigPublica
} from '../services/apiKeyService.js';

const router = Router();

const wrap = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status = err.status || (err.code ? 500 : 400);
    if (status === 500) console.error(`[auth] ${req.method} ${req.originalUrl}:`, err);
    res.status(status).json({ status: 'error', error: status === 500 ? 'Error interno' : err.message });
  }
};

router.post('/login', wrap(async (req, res) => {
  const { usuario, password } = req.body || {};
  const u = await login(usuario, password, req.ip);
  setSessionCookie(req, res, u);
  res.json({ status: 'success', data: usuarioPublico(u) });
}));

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ status: 'success' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ status: 'success', data: usuarioPublico(req.user) });
});

router.post('/cambiar-password', requireAuth, wrap(async (req, res) => {
  const { actual, nueva } = req.body || {};
  const u = await cambiarPasswordPropia(req.user.id, actual, nueva);
  setSessionCookie(req, res, u); // renueva la sesión actual; cierra las demás
  res.json({ status: 'success', mensaje: 'Contraseña actualizada' });
}));

// --- Administración de usuarios (solo superadmin) ---
router.get('/usuarios', requireAuth, requireRole('superadmin'), wrap(async (req, res) => {
  res.json({ status: 'success', data: await listarUsuarios() });
}));

router.post('/usuarios', requireAuth, requireRole('superadmin'), wrap(async (req, res) => {
  res.json({ status: 'success', data: await crearUsuario(req.body || {}) });
}));

// Editar nombre / rol / activo / restablecer contraseña. No se eliminan usuarios: se desactivan.
router.patch('/usuarios/:id', requireAuth, requireRole('superadmin'), wrap(async (req, res) => {
  const { nombre, rol, activo, password } = req.body || {};
  res.json({ status: 'success', data: await actualizarUsuario(req.params.id, { nombre, rol, activo, password }, req.user.id) });
}));

// --- API Keys de solo lectura para otras aplicaciones (solo superadmin) ---
router.get('/api-keys', requireAuth, requireRole('superadmin'), wrap(async (req, res) => {
  res.json({ status: 'success', data: await listarApiKeys(), config: getConfigPublica(req) });
}));

// Ficha JSON de una clave (sin la clave secreta): se puede descargar en cualquier momento
router.get('/api-keys/:id/ficha', requireAuth, requireRole('superadmin'), wrap(async (req, res) => {
  res.json({ status: 'success', data: await fichaApiKey(req.params.id, getBaseUrl(req)) });
}));

// Devuelve el JSON de entrega con la clave en texto plano. Es la única vez que se muestra.
router.post('/api-keys', requireAuth, requireRole('superadmin'), wrap(async (req, res) => {
  const r = await crearApiKey(req.body?.nombre, req.user, getBaseUrl(req));
  res.json({ status: 'success', id: r.id, data: r.entrega });
}));

// Activar / desactivar (las claves no vencen ni se borran)
router.patch('/api-keys/:id', requireAuth, requireRole('superadmin'), wrap(async (req, res) => {
  await setApiKeyActiva(req.params.id, req.body?.activo);
  res.json({ status: 'success' });
}));

export default router;
