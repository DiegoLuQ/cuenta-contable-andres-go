import { Router } from 'express';
import {
  getColegios,
  getAnosDisponibles,
  getMovimientos,
  getResumen,
  getCuentas,
  upsertCuenta,
  setCuentaActiva,
  deleteCuenta,
  getSyncLog,
  getEstado,
  getCompleto
} from '../services/contabilidadService.js';
import { requireRole } from '../services/authService.js';

const router = Router();
const COLEGIOS_VALIDOS = ['AMBAS', 'FUNDACIONMACAYA', 'FUNDACIONPTONUEV'];

function parseFiltros(q) {
  const colegio = (q.colegio || q.empresa || 'AMBAS').toUpperCase();
  if (!COLEGIOS_VALIDOS.includes(colegio)) throw new Error(`colegio no válido: ${colegio}`);
  const ano = parseInt(q.ano, 10) || new Date().getFullYear();
  const mes = q.mes ? parseInt(q.mes, 10) : null;
  if (mes !== null && (mes < 1 || mes > 12)) throw new Error('mes debe estar entre 1 y 12');
  const cuentas = q.cuentas
    ? String(q.cuentas).split(',').map(s => s.trim()).filter(Boolean)
    : null;
  return { colegio, ano, mes, cuentas };
}

const wrap = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status = /no válido|obligatorio|debe estar|solo admite|no encontrada/.test(err.message) ? 400 : 500;
    if (status === 500) console.error(`[contabilidad] ${req.method} ${req.originalUrl}:`, err);
    res.status(status).json({ status: 'error', error: err.message });
  }
};

// Estado de la conexión MySQL + última sincronización
router.get('/estado', wrap(async (req, res) => {
  res.json({ status: 'success', data: await getEstado() });
}));

router.get('/colegios', wrap(async (req, res) => {
  res.json({ status: 'success', data: await getColegios() });
}));

router.get('/anos', wrap(async (req, res) => {
  res.json({ status: 'success', data: await getAnosDisponibles() });
}));

// WEB SERVICE PRINCIPAL
// GET /api/contabilidad/movimientos?colegio=FUNDACIONMACAYA|FUNDACIONPTONUEV|AMBAS&ano=2026&mes=3&cuentas=5-1-06-40,5-1-06-38
router.get('/movimientos', wrap(async (req, res) => {
  const filtros = parseFiltros(req.query);
  const r = await getMovimientos(filtros);
  res.json({
    status: 'success',
    timestamp: new Date().toISOString(),
    filtros,
    resumen: {
      totalRegistros: r.totalRegistros,
      totalDebe: r.totalDebe,
      totalHaber: r.totalHaber,
      saldo: r.saldo
    },
    datos: r.datos
  });
}));

// TODO EN UNO: GET /api/contabilidad/completo?colegio=AMBAS&ano=2026[&mes=3][&cuentas=...]
// colegios + cuentas + última sincronización + totales + resumen mensual + movimientos
router.get('/completo', wrap(async (req, res) => {
  const filtros = parseFiltros(req.query);
  res.json({
    status: 'success',
    generado: new Date().toISOString(),
    filtros,
    ...(await getCompleto(filtros))
  });
}));

// GET /api/contabilidad/resumen?colegio=AMBAS&ano=2026  -> totales por colegio/cuenta/mes
router.get('/resumen', wrap(async (req, res) => {
  const { colegio, ano } = parseFiltros(req.query);
  res.json({ status: 'success', filtros: { colegio, ano }, data: await getResumen({ colegio, ano }) });
}));

// Catálogo de cuentas
router.get('/cuentas', wrap(async (req, res) => {
  const cuentas = await getCuentas();
  res.json({ status: 'success', total: cuentas.length, activas: cuentas.filter(c => c.activo).length, data: cuentas });
}));

// Escritura del catálogo: solo superadmin
const soloAdmin = requireRole('superadmin');

router.post('/cuentas', soloAdmin, wrap(async (req, res) => {
  res.json({ status: 'success', data: await upsertCuenta(req.body || {}) });
}));

router.patch('/cuentas/:pctCod/toggle', soloAdmin, wrap(async (req, res) => {
  const activo = req.body?.activo;
  if (typeof activo !== 'boolean') throw new Error('activo es obligatorio (true/false)');
  res.json({ status: 'success', data: await setCuentaActiva(req.params.pctCod, activo) });
}));

router.delete('/cuentas/:pctCod', soloAdmin, wrap(async (req, res) => {
  res.json({ status: 'success', data: await deleteCuenta(req.params.pctCod) });
}));

// Historial de sincronizaciones del extractor
router.get('/sync-log', wrap(async (req, res) => {
  res.json({ status: 'success', data: await getSyncLog(req.query.limit) });
}));

export default router;
