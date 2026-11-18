import { Router } from 'express';
import { getMovimientosSoftland } from '../services/softlandService.js';
import { testSoftlandConnection } from '../config/softland.js';

const router = Router();

// Endpoint de prueba de conexión a Softland
router.get('/test', async (req, res) => {
  try {
    const status = await testSoftlandConnection();
    res.status(status.success ? 200 : 503).json(status);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Empresas disponibles según configuración
router.get('/empresas', (req, res) => {
  res.json({
    empresas: [
      { id: process.env.DB_SOFTLAND_MC || 'FUNDACIONMACAYA', nombre: 'Fundación Macaya (MC)', default: true },
      { id: process.env.DB_SOFTLAND_DP || 'FUNDACIONPTONUEV', nombre: 'Fundación Puerto Nuevo (DP)', default: false }
    ]
  });
});

// WEB SERVICE PRINCIPAL: Retorna JSON de movimientos según filtros dinámicos
router.get('/movimientos', async (req, res) => {
  try {
    const {
      empresa = process.env.DB_SOFTLAND_MC || 'FUNDACIONMACAYA',
      ano = 2026,
      mes,
      cuentas
    } = req.query;

    let pctCods = null;
    if (cuentas) {
      pctCods = Array.isArray(cuentas)
        ? cuentas
        : cuentas.split(',').map(s => s.trim()).filter(Boolean);
    }

    const resultado = await getMovimientosSoftland({
      empresa,
      ano: parseInt(ano, 10),
      mes: mes ? parseInt(mes, 10) : null,
      pctCods
    });

    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      filtros: {
        empresa,
        ano: parseInt(ano, 10),
        mes: mes ? parseInt(mes, 10) : null,
        cuentasAplicadas: resultado.cuentasConsultadas
      },
      resumen: {
        totalRegistros: resultado.totalRegistros,
        totalDebe: resultado.totalDebe,
        totalHaber: resultado.totalHaber,
        saldo: Math.round((resultado.totalDebe - resultado.totalHaber) * 100) / 100
      },
      datos: resultado.datos
    });
  } catch (err) {
    console.error('Error en /api/softland/movimientos:', err);
    res.status(500).json({
      status: 'error',
      mensaje: 'Error al consultar movimientos en Softland',
      detalle: err.message
    });
  }
});

export default router;
