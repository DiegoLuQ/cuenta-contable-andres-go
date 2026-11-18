// Autenticación de la web: usuarios en MySQL (con_c_usuarios), roles superadmin | viewer.
// Contraseñas: scrypt (crypto nativo de Node). Sesión: cookie httpOnly firmada con HMAC.
import 'dotenv/config';
import crypto from 'crypto';
import { getMysqlPool } from '../config/mysql.js';

export const ROLES = ['superadmin', 'viewer'];
const COOKIE = 'cc_session';
const SESSION_HOURS = 8;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

let SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ SESSION_SECRET no está definido (mín. 32 caracteres). Configúrelo en el .env de docker-compose.');
    process.exit(1);
  }
  SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('⚠️  SESSION_SECRET no definido en .env: se usa uno temporal (las sesiones se pierden al reiniciar).');
}

// ---------------------------------------------------------------------------
// Contraseñas
// ---------------------------------------------------------------------------
export function hashPassword(plain) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(plain, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

export function verifyPassword(plain, stored) {
  return new Promise(resolve => {
    try {
      const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
      if (alg !== 'scrypt') return resolve(false);
      const expected = Buffer.from(hashB64, 'base64');
      crypto.scrypt(plain, Buffer.from(saltB64, 'base64'), expected.length,
        { N: +N, r: +r, p: +p }, (err, key) => {
          resolve(!err && crypto.timingSafeEqual(key, expected));
        });
    } catch {
      resolve(false);
    }
  });
}

export function validarPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  if (pw.length > 128) throw new Error('La contraseña es demasiado larga');
}

// ---------------------------------------------------------------------------
// Token de sesión
// ---------------------------------------------------------------------------
const b64url = buf => Buffer.from(buf).toString('base64url');
const sign = data => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function crearToken(user) {
  const payload = b64url(JSON.stringify({
    uid: user.id,
    tv: user.token_version,
    exp: Date.now() + SESSION_HOURS * 3600 * 1000
  }));
  return `${payload}.${sign(payload)}`;
}

function leerToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, firma] = token.split('.');
  const esperada = sign(payload);
  if (firma.length !== esperada.length ||
      !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function setSessionCookie(req, res, user) {
  res.cookie(COOKIE, crearToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure, // true detrás de HTTPS (nginx-proxy) gracias a trust proxy
    maxAge: SESSION_HOURS * 3600 * 1000,
    path: '/'
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------
const publico = u => u && ({
  id: u.id,
  usuario: u.usuario,
  nombre: u.nombre,
  rol: u.rol,
  activo: Boolean(u.activo),
  ultimoLogin: u.ultimo_login,
  createdAt: u.created_at
});

async function getUsuarioById(id) {
  const [rows] = await getMysqlPool().query('SELECT * FROM con_c_usuarios WHERE id = ?', [id]);
  return rows[0] || null;
}

// Devuelve el usuario de la sesión (o null). Verifica en BD que siga activo y que la sesión no fue revocada.
export async function getUsuarioDeRequest(req) {
  const data = leerToken(getCookie(req, COOKIE));
  if (!data) return null;
  const u = await getUsuarioById(data.uid);
  if (!u || !u.activo || u.token_version !== data.tv) return null;
  return u;
}

// Bloqueo simple contra fuerza bruta: 5 intentos fallidos -> 15 min
const intentos = new Map();
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

export async function login(usuario, password, ip) {
  const clave = `${ip}|${String(usuario || '').toLowerCase()}`;
  const reg = intentos.get(clave);
  if (reg && reg.hasta > Date.now()) {
    const min = Math.ceil((reg.hasta - Date.now()) / 60000);
    throw Object.assign(new Error(`Demasiados intentos fallidos. Intenta de nuevo en ${min} min.`), { status: 429 });
  }

  const [rows] = await getMysqlPool().query(
    'SELECT * FROM con_c_usuarios WHERE usuario = ?', [String(usuario || '').trim().toLowerCase()]
  );
  const u = rows[0];
  const ok = u && u.activo && await verifyPassword(String(password || ''), u.password_hash);

  if (!ok) {
    const bloqueoVencido = reg && reg.hasta && reg.hasta <= Date.now();
    const n = (bloqueoVencido ? 0 : reg?.n || 0) + 1;
    intentos.set(clave, { n, hasta: n >= MAX_INTENTOS ? Date.now() + BLOQUEO_MS : 0 });
    throw Object.assign(new Error('Usuario o contraseña incorrectos'), { status: 401 });
  }

  intentos.delete(clave);
  await getMysqlPool().query('UPDATE con_c_usuarios SET ultimo_login = UTC_TIMESTAMP() WHERE id = ?', [u.id]);
  return u;
}

export async function listarUsuarios() {
  const [rows] = await getMysqlPool().query('SELECT * FROM con_c_usuarios ORDER BY rol, usuario');
  return rows.map(publico);
}

function validarUsuario(usuario) {
  const v = String(usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,60}$/.test(v)) {
    throw new Error('El usuario debe tener 3-60 caracteres: letras, números, punto, guion o guion bajo');
  }
  return v;
}

function validarRol(rol) {
  if (!ROLES.includes(rol)) throw new Error(`Rol no válido: use ${ROLES.join(' o ')}`);
  return rol;
}

export async function crearUsuario({ usuario, nombre, password, rol = 'viewer' }) {
  const u = validarUsuario(usuario);
  const n = String(nombre || '').trim();
  if (!n) throw new Error('El nombre es obligatorio');
  validarPassword(password);
  validarRol(rol);
  try {
    const [r] = await getMysqlPool().query(
      'INSERT INTO con_c_usuarios (usuario, nombre, password_hash, rol) VALUES (?, ?, ?, ?)',
      [u, n, await hashPassword(password), rol]
    );
    return publico(await getUsuarioById(r.insertId));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new Error(`El usuario "${u}" ya existe`);
    throw err;
  }
}

async function contarSuperadminsActivos(excluirId) {
  const [[r]] = await getMysqlPool().query(
    "SELECT COUNT(*) n FROM con_c_usuarios WHERE rol = 'superadmin' AND activo = 1 AND id <> ?", [excluirId]
  );
  return r.n;
}

// Cambios de un superadmin sobre otro usuario: nombre, rol, activo, nueva contraseña
export async function actualizarUsuario(id, { nombre, rol, activo, password }, actorId) {
  const u = await getUsuarioById(id);
  if (!u) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });

  const sets = [];
  const params = [];
  let revocar = false;

  if (nombre !== undefined) {
    const n = String(nombre).trim();
    if (!n) throw new Error('El nombre es obligatorio');
    sets.push('nombre = ?'); params.push(n);
  }
  if (rol !== undefined && rol !== u.rol) {
    validarRol(rol);
    if (u.rol === 'superadmin' && await contarSuperadminsActivos(u.id) === 0) {
      throw new Error('Debe quedar al menos un superadmin activo');
    }
    sets.push('rol = ?'); params.push(rol); revocar = true;
  }
  if (activo !== undefined && Boolean(activo) !== Boolean(u.activo)) {
    if (!activo && Number(id) === Number(actorId)) throw new Error('No puedes desactivar tu propio usuario');
    if (!activo && u.rol === 'superadmin' && await contarSuperadminsActivos(u.id) === 0) {
      throw new Error('Debe quedar al menos un superadmin activo');
    }
    sets.push('activo = ?'); params.push(activo ? 1 : 0); revocar = true;
  }
  if (password !== undefined && password !== '') {
    validarPassword(password);
    sets.push('password_hash = ?'); params.push(await hashPassword(password)); revocar = true;
  }
  if (sets.length === 0) return publico(u);
  if (revocar) sets.push('token_version = token_version + 1');

  await getMysqlPool().query(`UPDATE con_c_usuarios SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  return publico(await getUsuarioById(id));
}

// Cambio de contraseña propio (requiere la actual). Devuelve el usuario actualizado para renovar la cookie.
export async function cambiarPasswordPropia(id, actual, nueva) {
  const u = await getUsuarioById(id);
  if (!u || !await verifyPassword(String(actual || ''), u.password_hash)) {
    throw Object.assign(new Error('La contraseña actual no es correcta'), { status: 400 });
  }
  validarPassword(nueva);
  await getMysqlPool().query(
    'UPDATE con_c_usuarios SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
    [await hashPassword(nueva), id]
  );
  return getUsuarioById(id);
}

export { publico as usuarioPublico };

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------
export function requireAuth(req, res, next) {
  getUsuarioDeRequest(req)
    .then(u => {
      if (!u) return res.status(401).json({ status: 'error', error: 'Sesión no válida o expirada' });
      req.user = u;
      next();
    })
    .catch(next);
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ status: 'error', error: 'No tienes permisos para esta acción' });
    }
    next();
  };
}
