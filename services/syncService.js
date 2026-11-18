import { getMysqlPool, initMysqlTables } from '../config/mysql.js';
import { getMovimientosSoftland } from './softlandService.js';

export async function syncMovimientosToMysql({
  empresa,
  ano,
  mes,
  pctCods,
  registrosDirectos = null
}) {
  const startTime = Date.now();
  await initMysqlTables();

  let filas = registrosDirectos;
  let metadata = null;

  if (!filas) {
    const res = await getMovimientosSoftland({ empresa, ano, mes, pctCods });
    filas = res.datos;
    metadata = {
      empresa: res.empresa,
      ano: res.ano,
      mes: res.mes,
      totalRegistros: res.totalRegistros
    };
  }

  if (!filas || filas.length === 0) {
    return {
      success: true,
      mensaje: 'No hay registros para sincronizar',
      totalProcesados: 0,
      tiempoMs: Date.now() - startTime
    };
  }

  const pool = getMysqlPool();
  const tableName = process.env.MYSQL_TABLE || 'cuentas_contables';

  // Procesar por lotes de 200 para alta eficiencia y no saturar paquetes de MySQL
  const BATCH_SIZE = 200;
  let totalInsertados = 0;

  for (let i = 0; i < filas.length; i += BATCH_SIZE) {
    const batch = filas.slice(i, i + BATCH_SIZE);

    const values = [];
    const placeholders = batch
      .map(r => {
        // Convertir fecha a formato compatible MySQL YYYY-MM-DD HH:mm:ss si viene Date o string
        let fecSql = null;
        if (r.cpbFec) {
          const d = new Date(r.cpbFec);
          if (!isNaN(d.getTime())) {
            fecSql = d.toISOString().slice(0, 19).replace('T', ' ');
          }
        }

        values.push(
          r.empresa || empresa || 'DESCONOCIDA',
          r.servicio || 'Otro',
          r.pctCod,
          r.cpbAno,
          r.cpbMes,
          fecSql,
          r.cpbNum,
          r.movNum,
          r.ccCod || '',
          r.tipDocCb || '',
          r.numDocCb || '',
          r.movDebe || 0,
          r.movHaber || 0,
          (r.movGlosa || '').substring(0, 1000),
          r.monCod || '',
          r.movEquiv || 0,
          r.movDebeMa || 0
        );

        return '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
      })
      .join(', ');

    const sql = `
      INSERT INTO \`${tableName}\` (
        \`empresa\`, \`servicio\`, \`pct_cod\`, \`cpb_ano\`, \`cpb_mes\`, \`cpb_fec\`,
        \`cpb_num\`, \`mov_num\`, \`cc_cod\`, \`tip_doc_cb\`, \`num_doc_cb\`,
        \`mov_debe\`, \`mov_haber\`, \`mov_glosa\`, \`mon_cod\`, \`mov_equiv\`, \`mov_debe_ma\`
      ) VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        \`servicio\` = VALUES(\`servicio\`),
        \`pct_cod\` = VALUES(\`pct_cod\`),
        \`cpb_mes\` = VALUES(\`cpb_mes\`),
        \`cpb_fec\` = VALUES(\`cpb_fec\`),
        \`cc_cod\` = VALUES(\`cc_cod\`),
        \`tip_doc_cb\` = VALUES(\`tip_doc_cb\`),
        \`num_doc_cb\` = VALUES(\`num_doc_cb\`),
        \`mov_debe\` = VALUES(\`mov_debe\`),
        \`mov_haber\` = VALUES(\`mov_haber\`),
        \`mov_glosa\` = VALUES(\`mov_glosa\`),
        \`mon_cod\` = VALUES(\`mon_cod\`),
        \`mov_equiv\` = VALUES(\`mov_equiv\`),
        \`mov_debe_ma\` = VALUES(\`mov_debe_ma\`);
    `;

    await pool.query(sql, values);
    totalInsertados += batch.length;
  }

  const durationMs = Date.now() - startTime;

  return {
    success: true,
    mensaje: `Sincronización exitosa: ${totalInsertados} registros procesados en tabla '${tableName}' de MySQL`,
    tabla: tableName,
    totalProcesados: totalInsertados,
    tiempoMs: durationMs,
    metadata
  };
}
