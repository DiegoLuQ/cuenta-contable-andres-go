// Módulo Contabilidad: SOLO lee/escribe MySQL (db_central, tablas con_c_*).
// Los datos los carga el extractor Python que corre en el servidor Softland.
import { getMysqlPool } from '../config/mysql.js';

const toNum = v => (v === null || v === undefined ? 0 : Number(v));

// ---------------------------------------------------------------------------
// Colegios y años
// ---------------------------------------------------------------------------
export async function getColegios() {
  const [rows] = await getMysqlPool().query(
    `SELECT c.id, c.codigo, c.nombre
       FROM core_colegios c
      WHERE c.codigo IN ('FUNDACIONMACAYA', 'FUNDACIONPTONUEV')
      ORDER BY c.id`
  );
  return rows;
}

export async function getAnosDisponibles() {
  const [rows] = await getMysqlPool().query(
    'SELECT DISTINCT cpb_ano AS ano FROM con_c_movimientos ORDER BY cpb_ano DESC'
  );
  return rows.map(r => r.ano);
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------
export async function getMovimientos({ colegio = 'AMBAS', ano, mes = null, cuentas = null }) {
  const where = ['m.cpb_ano = ?'];
  const params = [ano];

  if (colegio && colegio !== 'AMBAS') {
    where.push('c.codigo = ?');
    params.push(colegio);
  }
  if (mes) {
    where.push('m.cpb_mes = ?');
    params.push(mes);
  }
  if (Array.isArray(cuentas) && cuentas.length > 0) {
    where.push(`m.pct_cod IN (${cuentas.map(() => '?').join(', ')})`);
    params.push(...cuentas);
  } else {
    // Por defecto: solo cuentas activas del catálogo
    where.push('m.pct_cod IN (SELECT pct_cod FROM con_c_cuentas_catalogo WHERE activo = 1)');
  }

  const [rows] = await getMysqlPool().query(
    `SELECT c.codigo AS empresa, c.nombre AS colegio,
            COALESCE(cat.servicio, m.servicio) AS servicio, cat.categoria,
            m.pct_cod, m.cpb_ano, m.cpb_mes, m.cpb_fec, m.cpb_num, m.mov_num, m.cc_cod,
            m.tip_doc_cb, m.num_doc_cb, m.mov_debe, m.mov_haber, m.mov_glosa, m.mon_cod,
            m.mov_equiv, m.mov_debe_ma, m.updated_at
       FROM con_c_movimientos m
       JOIN core_colegios c ON c.id = m.id_colegio
       LEFT JOIN con_c_cuentas_catalogo cat ON cat.pct_cod = m.pct_cod
      WHERE ${where.join(' AND ')}
      ORDER BY c.id, m.pct_cod, m.cpb_mes, m.cpb_fec, m.cpb_num, m.mov_num`,
    params
  );

  let totalDebe = 0;
  let totalHaber = 0;
  const datos = rows.map(r => {
    const debe = toNum(r.mov_debe);
    const haber = toNum(r.mov_haber);
    totalDebe += debe;
    totalHaber += haber;
    return {
      empresa: r.empresa,
      colegio: r.colegio,
      servicio: r.servicio || 'Otro',
      categoria: r.categoria || null,
      pctCod: r.pct_cod,
      cpbAno: r.cpb_ano,
      cpbMes: r.cpb_mes,
      cpbFec: r.cpb_fec,
      cpbNum: r.cpb_num,
      movNum: r.mov_num,
      ccCod: r.cc_cod,
      tipDocCb: r.tip_doc_cb,
      numDocCb: r.num_doc_cb,
      movDebe: debe,
      movHaber: haber,
      movGlosa: r.mov_glosa,
      monCod: r.mon_cod,
      movEquiv: toNum(r.mov_equiv),
      movDebeMa: toNum(r.mov_debe_ma)
    };
  });

  totalDebe = Math.round(totalDebe * 100) / 100;
  totalHaber = Math.round(totalHaber * 100) / 100;

  return {
    totalRegistros: datos.length,
    totalDebe,
    totalHaber,
    saldo: Math.round((totalDebe - totalHaber) * 100) / 100,
    datos
  };
}

// Resumen agregado: colegio x servicio x mes
export async function getResumen({ colegio = 'AMBAS', ano }) {
  const where = ['m.cpb_ano = ?', 'm.pct_cod IN (SELECT pct_cod FROM con_c_cuentas_catalogo WHERE activo = 1)'];
  const params = [ano];
  if (colegio && colegio !== 'AMBAS') {
    where.push('c.codigo = ?');
    params.push(colegio);
  }
  const [rows] = await getMysqlPool().query(
    `SELECT c.codigo AS empresa, m.pct_cod AS pctCod,
            COALESCE(cat.servicio, m.servicio) AS servicio, m.cpb_mes AS mes,
            COUNT(*) AS registros, SUM(m.mov_debe) AS debe, SUM(m.mov_haber) AS haber
       FROM con_c_movimientos m
       JOIN core_colegios c ON c.id = m.id_colegio
       LEFT JOIN con_c_cuentas_catalogo cat ON cat.pct_cod = m.pct_cod
      WHERE ${where.join(' AND ')}
      GROUP BY c.codigo, m.pct_cod, servicio, m.cpb_mes
      ORDER BY c.codigo, m.pct_cod, m.cpb_mes`,
    params
  );
  return rows.map(r => ({ ...r, debe: toNum(r.debe), haber: toNum(r.haber), saldo: toNum(r.debe) - toNum(r.haber) }));
}

// Todo en un solo JSON: colegios, cuentas activas, última sincronización, resumen mensual y movimientos
export async function getCompleto({ colegio = 'AMBAS', ano, mes = null, cuentas = null }) {
  const [colegios, catalogo, estado, mov, resumenMensual] = await Promise.all([
    getColegios(),
    getCuentas(),
    getEstado(),
    getMovimientos({ colegio, ano, mes, cuentas }),
    getResumen({ colegio, ano })
  ]);
  const filtrarCuentas = Array.isArray(cuentas) && cuentas.length > 0 ? new Set(cuentas) : null;
  return {
    colegios,
    cuentas: catalogo.filter(c => (filtrarCuentas ? filtrarCuentas.has(c.pctCod) : c.activo)),
    ultimaSincronizacion: estado.ultimaSync,
    resumen: {
      totalRegistros: mov.totalRegistros,
      totalDebe: mov.totalDebe,
      totalHaber: mov.totalHaber,
      saldo: mov.saldo
    },
    resumenMensual: resumenMensual.filter(r =>
      (!mes || r.mes === mes) && (!filtrarCuentas || filtrarCuentas.has(r.pctCod))),
    movimientos: mov.datos
  };
}

// ---------------------------------------------------------------------------
// Catálogo de cuentas (define qué extrae el .bat en el servidor Softland)
// ---------------------------------------------------------------------------
const mapCuenta = r => ({
  pctCod: r.pct_cod,
  servicio: r.servicio,
  categoria: r.categoria,
  activo: Boolean(r.activo),
  updatedAt: r.updated_at
});

export async function getCuentas() {
  const [rows] = await getMysqlPool().query(
    'SELECT pct_cod, servicio, categoria, activo, updated_at FROM con_c_cuentas_catalogo ORDER BY pct_cod'
  );
  return rows.map(mapCuenta);
}

export async function upsertCuenta({ pctCod, servicio, categoria, activo = true }) {
  const cod = String(pctCod || '').trim();
  const serv = String(servicio || '').trim();
  if (!cod || !serv) throw new Error('pctCod y servicio son obligatorios');
  if (!/^[0-9-]+$/.test(cod)) throw new Error('pctCod solo admite números y guiones (ej: 5-1-06-40)');

  await getMysqlPool().query(
    `INSERT INTO con_c_cuentas_catalogo (pct_cod, servicio, categoria, activo)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE servicio = VALUES(servicio), categoria = VALUES(categoria), activo = VALUES(activo)`,
    [cod, serv, String(categoria || 'Otros').trim() || 'Otros', activo ? 1 : 0]
  );
  return getCuentas();
}

export async function setCuentaActiva(pctCod, activo) {
  const [res] = await getMysqlPool().query(
    'UPDATE con_c_cuentas_catalogo SET activo = ? WHERE pct_cod = ?',
    [activo ? 1 : 0, pctCod]
  );
  if (res.affectedRows === 0) throw new Error(`Cuenta ${pctCod} no encontrada`);
  const [rows] = await getMysqlPool().query(
    'SELECT pct_cod, servicio, categoria, activo, updated_at FROM con_c_cuentas_catalogo WHERE pct_cod = ?',
    [pctCod]
  );
  return mapCuenta(rows[0]);
}

// Quita la cuenta del catálogo. Los movimientos ya sincronizados se conservan en con_c_movimientos.
export async function deleteCuenta(pctCod) {
  await getMysqlPool().query('DELETE FROM con_c_cuentas_catalogo WHERE pct_cod = ?', [pctCod]);
  return getCuentas();
}

// ---------------------------------------------------------------------------
// Bitácora de sincronizaciones (escrita por el extractor Python)
// ---------------------------------------------------------------------------
export async function getSyncLog(limit = 20) {
  const [rows] = await getMysqlPool().query(
    `SELECT l.id, c.codigo AS empresa, c.nombre AS colegio, l.cpb_ano AS ano, l.cpb_mes AS mes,
            l.origen, l.estado, l.registros, l.total_debe AS totalDebe, l.total_haber AS totalHaber,
            l.duracion_ms AS duracionMs, l.mensaje, l.inicio, l.fin
       FROM con_c_sync_log l
       LEFT JOIN core_colegios c ON c.id = l.id_colegio
      ORDER BY l.id DESC
      LIMIT ?`,
    [Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200)]
  );
  return rows.map(r => ({ ...r, totalDebe: toNum(r.totalDebe), totalHaber: toNum(r.totalHaber) }));
}

export async function getEstado() {
  const pool = getMysqlPool();
  const [[db]] = await pool.query('SELECT DATABASE() AS db');
  const [[mov]] = await pool.query('SELECT COUNT(*) AS total, MAX(updated_at) AS ultimaCarga FROM con_c_movimientos');
  const [ultimo] = await pool.query(
    `SELECT l.id, l.estado, l.fin, l.inicio, c.codigo AS empresa
       FROM con_c_sync_log l LEFT JOIN core_colegios c ON c.id = l.id_colegio
      ORDER BY l.id DESC LIMIT 1`
  );
  return {
    db: db.db,
    totalMovimientos: mov.total,
    ultimaCarga: mov.ultimaCarga,
    ultimaSync: ultimo[0] || null
  };
}
