import { Router } from 'express';
import { syncMovimientosToMysql } from '../services/syncService.js';
import { testMysqlConnection, initMysqlTables } from '../config/mysql.js';

const router = Router();

// Probar conexión a MySQL remoto
router.get('/test', async (req, res) => {
  try {
    const testResult = await testMysqlConnection();
    res.status(testResult.success ? 200 : 503).json(testResult);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Inicializar tabla si no existe
router.post('/init-table', async (req, res) => {
  try {
    const r = await initMysqlTables();
    res.json(r);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sincronizar hacia MySQL remoto
router.post('/subir', async (req, res) => {
  try {
    const { empresa, ano, mes, pctCods, registros } = req.body;

    const resultado = await syncMovimientosToMysql({
      empresa,
      ano: ano ? parseInt(ano, 10) : undefined,
      mes: mes ? parseInt(mes, 10) : undefined,
      pctCods,
      registrosDirectos: registros
    });

    res.json(resultado);
  } catch (err) {
    console.error('Error en sincronización a MySQL:', err);
    res.status(500).json({
      success: false,
      mensaje: 'Fallo al sincronizar a MySQL remoto',
      error: err.message
    });
  }
});

export default router;
