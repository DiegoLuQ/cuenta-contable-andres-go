// API Keys de solo lectura (rol viewer) para otras aplicaciones. Sin vencimiento.
// En BD solo se guarda el SHA-256; la clave completa se entrega una única vez al crearla.
import crypto from 'crypto';
import { getMysqlPool } from '../config/mysql.js';
import { getUsuarioDeRequest } from './authService.js';

const PREFIJO = 'ccsk_'; // "cuentas contables secret key"
const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');

// URL pública para los JSON de entrega. PUBLIC_URL (ej. https://central.dpmc.cl) tiene prioridad;
// si no está definida se usa el host de la petición (en local sería http://localhost:8000).
export function getBaseUrl(req) {
  const pub = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return pub || `${req.protocol}://${req.get('host')}`;
}

export function getConfigPublica(req) {
  const baseUrl = getBaseUrl(req);
  return {
    baseUrl,
    apiUrl: `${baseUrl}/api/contabilidad`,
    publicUrlConfigurada: Boolean(String(process.env.PUBLIC_URL || '').trim()),
    esLocal: /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(baseUrl)
  };
}

const publico = r => ({
  id: r.id,
  nombre: r.nombre,
  prefijo: r.prefijo,
  activo: Boolean(r.activo),
  creadoPor: r.creado_por_nombre || null,
  createdAt: r.created_at,
  ultimoUso: r.ultimo_uso,
  usos: Number(r.usos || 0)
});

// JSON de entrega. Con apiKey = null se genera la "ficha" (misma info, sin la clave secreta).
function construirEntrega({ nombre, apiKey, prefijo, creada, creadaPor, baseUrl }) {
  const ws = `${baseUrl}/api/contabilidad`;
  const ano = new Date().getFullYear();
  const clave = apiKey || `${prefijo}…  (la clave completa solo se entregó al crearla)`;
  return {
    nombre,
    api_key: clave,
    tipo: 'solo_lectura',
    vencimiento: 'sin_vencimiento',
    creada,
    creada_por: creadaPor,
    base_url: ws,
    autenticacion: {
      header: 'X-API-Key',
      alternativa: 'Authorization: Bearer <api_key>'
    },
    endpoints: {
      completo: `${ws}/completo?colegio=AMBAS&ano=${ano}`,
      movimientos: `${ws}/movimientos?colegio=AMBAS&ano=${ano}`,
      resumen: `${ws}/resumen?colegio=AMBAS&ano=${ano}`,
      cuentas: `${ws}/cuentas`,
      colegios: `${ws}/colegios`,
      anos: `${ws}/anos`,
      sync_log: `${ws}/sync-log?limit=20`,
      estado: `${ws}/estado`
    },
    filtros: {
      colegio: 'AMBAS | FUNDACIONMACAYA | FUNDACIONPTONUEV (por defecto AMBAS)',
      ano: 'AAAA (por defecto el año actual)',
      mes: '1-12 (opcional; en completo y movimientos)',
      cuentas: 'códigos separados por coma, ej. 5-1-06-40,5-1-06-38 (opcional; por defecto las cuentas activas)'
    },
    ejemplo_curl: `curl -H "X-API-Key: ${apiKey || '<api_key>'}" "${ws}/completo?colegio=AMBAS&ano=${ano}"`,
    importante: 'Guarde esta clave en un lugar seguro. No se vuelve a mostrar: si se pierde, cree una nueva y desactive esta.'
  };
}

export async function listarApiKeys() {
  const [rows] = await getMysqlPool().query(
    `SELECT k.*, u.usuario AS creado_por_nombre
       FROM con_c_api_keys k LEFT JOIN con_c_usuarios u ON u.id = k.creado_por
      ORDER BY k.activo DESC, k.id DESC`
  );
  return rows.map(publico);
}

// Crea la clave y devuelve el JSON de entrega (la clave en texto plano solo existe aquí)
export async function crearApiKey(nombre, usuario, baseUrl) {
  const n = String(nombre || '').trim();
  if (n.length < 3 || n.length > 120) throw new Error('El nombre debe tener entre 3 y 120 caracteres');

  const apiKey = PREFIJO + crypto.randomBytes(30).toString('base64url');
  const prefijo = apiKey.slice(0, 12);
  const [r] = await getMysqlPool().query(
    'INSERT INTO con_c_api_keys (nombre, prefijo, key_hash, creado_por) VALUES (?, ?, ?, ?)',
    [n, prefijo, sha256(apiKey), usuario.id]
  );

  return {
    id: r.insertId,
    entrega: construirEntrega({
      nombre: n, apiKey, prefijo, creada: new Date().toISOString(), creadaPor: usuario.usuario, baseUrl
    })
  };
}

// Ficha descargable en cualquier momento: misma información que la entrega, sin la clave secreta
export async function fichaApiKey(id, baseUrl) {
  const [rows] = await getMysqlPool().query(
    `SELECT k.*, u.usuario AS creado_por_nombre
       FROM con_c_api_keys k LEFT JOIN con_c_usuarios u ON u.id = k.creado_por WHERE k.id = ?`, [id]
  );
  const k = rows[0];
  if (!k) throw Object.assign(new Error('API key no encontrada'), { status: 404 });
  const ficha = construirEntrega({
    nombre: k.nombre, apiKey: null, prefijo: k.prefijo,
    creada: k.created_at, creadaPor: k.creado_por_nombre, baseUrl
  });
  ficha.estado = k.activo ? 'activa' : 'desactivada';
  ficha.ultimo_uso = k.ultimo_uso;
  ficha.usos = Number(k.usos || 0);
  delete ficha.importante;
  return ficha;
}

export async function setApiKeyActiva(id, activo) {
  if (typeof activo !== 'boolean') throw new Error('activo es obligatorio (true/false)');
  const [r] = await getMysqlPool().query('UPDATE con_c_api_keys SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]);
  if (r.affectedRows === 0) throw Object.assign(new Error('API key no encontrada'), { status: 404 });
}

function leerApiKey(req) {
  const h = req.headers['x-api-key'];
  if (h) return String(h).trim();
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

async function validarApiKey(apiKey) {
  if (!apiKey || !apiKey.startsWith(PREFIJO) || apiKey.length > 100) return null;
  const [rows] = await getMysqlPool().query(
    'SELECT id, nombre FROM con_c_api_keys WHERE key_hash = ? AND activo = 1', [sha256(apiKey)]
  );
  const k = rows[0];
  if (!k) return null;
  // Registro de uso (no bloquea la respuesta)
  getMysqlPool()
    .query('UPDATE con_c_api_keys SET usos = usos + 1, ultimo_uso = UTC_TIMESTAMP() WHERE id = ?', [k.id])
    .catch(err => console.warn('[api-key] no se pudo registrar uso:', err.message));
  return k;
}

// Acepta sesión de usuario (cookie) o API key. Una API key entra siempre como viewer (solo lectura).
export function requireAuthOrApiKey(req, res, next) {
  const apiKey = leerApiKey(req);
  const validar = apiKey
    ? validarApiKey(apiKey).then(k => k && { id: null, usuario: `api:${k.id}`, nombre: `API: ${k.nombre}`, rol: 'viewer', apiKeyId: k.id })
    : getUsuarioDeRequest(req);

  validar
    .then(u => {
      if (!u) {
        return res.status(401).json({
          status: 'error',
          error: apiKey ? 'API key no válida o desactivada' : 'Sesión no válida o expirada'
        });
      }
      req.user = u;
      next();
    })
    .catch(next);
}
