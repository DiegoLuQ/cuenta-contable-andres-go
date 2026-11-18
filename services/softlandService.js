import sql from 'mssql';
import { getSoftlandPool } from '../config/softland.js';
import { getCuentasActivas, getCuentas } from './cuentasService.js';

export async function getMovimientosSoftland({
  empresa = process.env.DB_SOFTLAND_MC || 'FUNDACIONMACAYA',
  ano = 2026,
  mes = null,
  pctCods = null // Opcional: array de cuentas a filtrar expresamente
}) {
  // 1. Obtener catálogo para armar el CASE dinámico
  const allCuentas = await getCuentas();
  const catalogoMap = new Map();
  allCuentas.forEach(c => catalogoMap.set(c.pctCod.trim(), c.servicio.trim()));

  // 2. Determinar qué cuentas filtrar
  let cuentasTarget = [];
  if (Array.isArray(pctCods) && pctCods.length > 0) {
    cuentasTarget = pctCods.map(c => c.trim()).filter(Boolean);
  } else {
    const activas = await getCuentasActivas();
    cuentasTarget = activas.map(c => c.pctCod.trim());
  }

  if (cuentasTarget.length === 0) {
    return {
      empresa,
      ano: parseInt(ano, 10),
      mes: mes ? parseInt(mes, 10) : null,
      totalRegistros: 0,
      totalDebe: 0,
      totalHaber: 0,
      cuentasConsultadas: [],
      datos: []
    };
  }

  // 3. Sanitizar nombre de base de datos
  const safeDbName = empresa.replace(/[^a-zA-Z0-9_]/g, '');

  // 4. Construir CASE dinámico para el alias [Servicio]
  const caseBranches = cuentasTarget
    .map(cod => {
      const servicio = catalogoMap.get(cod) || 'Otro';
      // Escapar comillas simples
      const escapedServicio = servicio.replace(/'/g, "''");
      const escapedCod = cod.replace(/'/g, "''");
      return `        WHEN '${escapedCod}' THEN '${escapedServicio}'`;
    })
    .join('\n');

  // 5. Construir parámetros para la cláusula IN (...)
  const inPlaceholders = cuentasTarget.map((_, i) => `@pctCod${i}`).join(', ');

  let whereExtra = '';
  if (mes !== null && mes !== undefined && mes !== '') {
    whereExtra += '  AND [CpbMes] = @cpbMes\n';
  }

  const querySql = `
    SELECT 
        CASE [PctCod]
${caseBranches}
            ELSE 'Otro'
        END AS [Servicio]
        ,[PctCod]
        ,[CpbAno]
        ,[CpbMes]
        ,[CpbFec]
        ,[CpbNum]
        ,[MovNum]
        ,[CcCod]
        ,[TipDocCb]
        ,[NumDocCb]
        ,ISNULL([MovDebe], 0) AS [MovDebe]
        ,ISNULL([MovHaber], 0) AS [MovHaber]
        ,[MovGlosa]
        ,[MonCod]
        ,ISNULL([MovEquiv], 0) AS [MovEquiv]
        ,ISNULL([MovDebeMa], 0) AS [MovDebeMa]
    FROM [${safeDbName}].[softland].[cwmovim] WITH (NOLOCK)
    WHERE [CpbAno] = @cpbAno
      AND [PctCod] IN (${inPlaceholders})
${whereExtra}
    ORDER BY [PctCod], [CpbMes], [CpbFec];
  `;

  const pool = await getSoftlandPool();
  const request = pool.request();

  request.input('cpbAno', sql.Int, parseInt(ano, 10));
  if (mes !== null && mes !== undefined && mes !== '') {
    request.input('cpbMes', sql.Int, parseInt(mes, 10));
  }

  cuentasTarget.forEach((cod, idx) => {
    request.input(`pctCod${idx}`, sql.VarChar(50), cod);
  });

  const result = await request.query(querySql);
  const rows = result.recordset || [];

  let totalDebe = 0;
  let totalHaber = 0;

  const datosFormateados = rows.map(r => {
    const debe = Number(r.MovDebe) || 0;
    const haber = Number(r.MovHaber) || 0;
    totalDebe += debe;
    totalHaber += haber;

    return {
      empresa: safeDbName,
      servicio: r.Servicio || catalogoMap.get(r.PctCod) || 'Otro',
      pctCod: (r.PctCod || '').trim(),
      cpbAno: r.CpbAno,
      cpbMes: r.CpbMes,
      cpbFec: r.CpbFec,
      cpbNum: r.CpbNum,
      movNum: r.MovNum,
      ccCod: (r.CcCod || '').trim(),
      tipDocCb: (r.TipDocCb || '').trim(),
      numDocCb: (r.NumDocCb || '').trim(),
      movDebe: debe,
      movHaber: haber,
      movGlosa: (r.MovGlosa || '').trim(),
      monCod: (r.MonCod || '').trim(),
      movEquiv: Number(r.MovEquiv) || 0,
      movDebeMa: Number(r.MovDebeMa) || 0
    };
  });

  return {
    empresa: safeDbName,
    ano: parseInt(ano, 10),
    mes: mes ? parseInt(mes, 10) : null,
    totalRegistros: datosFormateados.length,
    totalDebe: Math.round(totalDebe * 100) / 100,
    totalHaber: Math.round(totalHaber * 100) / 100,
    cuentasConsultadas: cuentasTarget,
    datos: datosFormateados
  };
}
