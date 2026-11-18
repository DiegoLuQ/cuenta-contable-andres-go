import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import contabilidadRoutes from './routes/contabilidadRoutes.js';
import authRoutes from './routes/authRoutes.js';
import { requireAuth, requireRole, getUsuarioDeRequest } from './services/authService.js';
import { requireAuthOrApiKey } from './services/apiKeyService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '8000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Modo heredado: consulta directa a Softland, sincronización desde la web y correos.
// En la nube queda DESACTIVADO: los datos los sube el extractor Python (extractor/sincronizar_cuentas.bat)
// que corre en el servidor Softland. Para reactivarlo en una máquina con acceso a Softland: MODO_LEGACY_SOFTLAND=true
const MODO_LEGACY = String(process.env.MODO_LEGACY_SOFTLAND || 'false').toLowerCase() === 'true';

// Detrás de nginx-proxy: confiar en X-Forwarded-* (HTTPS, IP real del cliente)
app.set('trust proxy', 1);

// Middlewares
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Autenticación (login/logout/usuarios)
app.use('/api/auth', authRoutes);

// La página principal exige sesión; sin sesión -> login
app.get(['/', '/index.html'], (req, res, next) => {
  getUsuarioDeRequest(req)
    .then(u => (u ? next() : res.redirect('/login.html')))
    .catch(next);
});

// Página de API Keys: solo superadmin
app.get('/api-keys.html', (req, res, next) => {
  getUsuarioDeRequest(req)
    .then(u => {
      if (!u) return res.redirect('/login.html');
      if (u.rol !== 'superadmin') return res.redirect('/');
      next();
    })
    .catch(next);
});

// Servir frontend estático
app.use(express.static(path.join(__dirname, 'public')));

// API principal: solo MySQL (db_central, tablas con_c_*).
// Requiere sesión (viewer o superadmin) o API key de solo lectura (header X-API-Key).
app.use('/api/contabilidad', requireAuthOrApiKey, contabilidadRoutes);

if (MODO_LEGACY) {
  const [{ default: softlandRoutes }, { default: cuentasRoutes }, { default: syncRoutes }, { default: schedulerRoutes }] =
    await Promise.all([
      import('./routes/softlandRoutes.js'),
      import('./routes/cuentasRoutes.js'),
      import('./routes/syncRoutes.js'),
      import('./routes/schedulerRoutes.js')
    ]);
  const soloAdmin = [requireAuth, requireRole('superadmin')];
  app.use('/api/softland', soloAdmin, softlandRoutes);
  app.use('/api/cuentas', soloAdmin, cuentasRoutes);
  app.use('/api/sync', soloAdmin, syncRoutes);
  app.use('/api/scheduler', soloAdmin, schedulerRoutes);
}

// Endpoint de salud
app.get('/api/health', (req, res) => {
  // Público (lo usa el HEALTHCHECK de Docker): no expone datos de conexión
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  res.status(500).json({
    status: 'error',
    message: err.message || 'Error interno del servidor'
  });
});

app.listen(PORT, HOST, async () => {
  console.log('========================================================');
  console.log(`🚀 Servidor ejecutándose en: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`🌐 Interfaz Web: http://localhost:${PORT}`);
  console.log(`🔌 Web Service: http://localhost:${PORT}/api/contabilidad/movimientos`);
  console.log(`☁️  MySQL: ${process.env.MYSQL_HOST || '186.64.120.228'}:${process.env.MYSQL_PORT || 3306}/${process.env.MYSQL_DATABASE || 'db_central'}`);

  if (MODO_LEGACY) {
    console.log('⚠️  MODO_LEGACY_SOFTLAND activo: rutas /api/softland, /api/cuentas, /api/sync, /api/scheduler habilitadas');
    try {
      const { reloadScheduler } = await import('./services/schedulerService.js');
      await reloadScheduler();
    } catch (schErr) {
      console.error('Error iniciando scheduler:', schErr.message);
    }
  }

  console.log('========================================================');
});
