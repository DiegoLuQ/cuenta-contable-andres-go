import { Router } from 'express';
import {
  getSchedulerConfig,
  saveSchedulerConfig,
  ejecutarCicloCompleto,
  reloadScheduler
} from '../services/schedulerService.js';
import { sendSyncNotificationEmail, testEmailConnection } from '../services/emailService.js';

const router = Router();

// Obtener configuración del scheduler y lista de correos
router.get('/config', async (req, res) => {
  try {
    const config = await getSchedulerConfig();
    res.json({ status: 'success', data: config });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Actualizar configuración del scheduler y lista de correos
router.post('/config', async (req, res) => {
  try {
    const { activo, frecuencia, cronExpression, destinatarios, cc, empresa, ano } = req.body;
    const current = await getSchedulerConfig();

    if (typeof activo === 'boolean') current.activo = activo;
    if (frecuencia) current.frecuencia = frecuencia;
    if (cronExpression) current.cronExpression = cronExpression;
    if (Array.isArray(destinatarios)) current.destinatarios = destinatarios.map(e => e.trim().toLowerCase()).filter(Boolean);
    if (Array.isArray(cc)) current.cc = cc.map(e => e.trim().toLowerCase()).filter(Boolean);
    if (empresa) current.empresa = empresa;
    if (ano) current.ano = parseInt(ano, 10);

    await saveSchedulerConfig(current);
    const schedulerState = await reloadScheduler();

    res.json({
      status: 'success',
      mensaje: 'Configuración de tareas y correos actualizada correctamente',
      data: current,
      scheduler: schedulerState
    });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

// Ejecutar ciclo completo ahora (Softland -> MySQL Nube -> Correo)
router.post('/ejecutar-ahora', async (req, res) => {
  try {
    const { ano, empresa } = req.body;
    const resultado = await ejecutarCicloCompleto({ ano, empresa });
    res.json(resultado);
  } catch (err) {
    res.status(500).json({
      success: false,
      mensaje: 'Fallo al ejecutar ciclo completo',
      error: err.message
    });
  }
});

// Probar conexión SMTP
router.get('/test-smtp', async (req, res) => {
  try {
    const { empresa = 'FUNDACIONMACAYA' } = req.query;
    const r = await testEmailConnection(empresa);
    res.status(r.success ? 200 : 503).json(r);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Probar envío de correo de prueba
router.post('/probar-correo', async (req, res) => {
  try {
    const { empresa = 'FUNDACIONMACAYA', destinatarios, cc } = req.body;
    const config = await getSchedulerConfig();

    const targetDest = (Array.isArray(destinatarios) && destinatarios.length > 0)
      ? destinatarios
      : config.destinatarios;

    const targetCc = (Array.isArray(cc)) ? cc : config.cc;

    const info = await sendSyncNotificationEmail({
      empresa,
      ano: 2026,
      totalRegistros: 105,
      totalDebe: 14250000,
      totalHaber: 0,
      tiempoMs: 250,
      destinatarios: targetDest,
      cc: targetCc,
      cuentasConsultadas: ['5-1-06-40', '5-1-11-40', '5-1-06-38', '5-1-06-37']
    });

    res.json({
      success: true,
      mensaje: 'Correo de prueba enviado exitosamente con prefijo TIC',
      data: info
    });
  } catch (err) {
    console.error('Error al enviar correo de prueba:', err);
    res.status(500).json({
      success: false,
      mensaje: 'Error al enviar correo',
      error: err.message
    });
  }
});

export default router;
