import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMovimientosSoftland } from './softlandService.js';
import { syncMovimientosToMysql } from './syncService.js';
import { sendSyncNotificationEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'scheduler_config.json');

let scheduledTask = null;
let isRunningCycle = false;

export async function getSchedulerConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    const defaultConfig = {
      activo: true,
      cronExpression: '0 */4 * * *',
      frecuencia: 'cada_4_horas',
      empresa: 'AMBAS',
      ano: 2026,
      destinatarios: [
        'juan.luque@colegiomacaya.cl',
        'andres.angulo@colegiodiegoportales.cl'
      ],
      cc: [],
      asuntoPrefijo: 'TIC - ',
      ultimoEjecutado: null,
      historial: []
    };
    await saveSchedulerConfig(defaultConfig);
    return defaultConfig;
  }
}

export async function saveSchedulerConfig(config) {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function ejecutarCicloCompleto({ ano = 2026, empresa = 'AMBAS' } = {}) {
  if (isRunningCycle) {
    return { success: false, message: 'Ya hay un ciclo de sincronización ejecutándose actualmente' };
  }

  isRunningCycle = true;
  const config = await getSchedulerConfig();
  const startTime = Date.now();
  const empresasATratar = [];

  const targetEmpresa = empresa || config.empresa || 'AMBAS';
  if (targetEmpresa === 'AMBAS') {
    empresasATratar.push('FUNDACIONMACAYA');
    empresasATratar.push('FUNDACIONPTONUEV');
  } else {
    empresasATratar.push(targetEmpresa);
  }

  const resultados = [];

  try {
    for (const emp of empresasATratar) {
      console.log(`[SCHEDULER] Iniciando ciclo para ${emp} (${ano})...`);
      const empStartTime = Date.now();

      // 1. Consultar Softland
      const movSoftland = await getMovimientosSoftland({
        empresa: emp,
        ano: parseInt(ano, 10)
      });

      // 2. Subir a MySQL Remoto
      const syncResult = await syncMovimientosToMysql({
        empresa: emp,
        ano: parseInt(ano, 10),
        registrosDirectos: movSoftland.datos
      });

      const duracionEmpMs = Date.now() - empStartTime;

      // 3. Enviar correo de notificación
      let emailResult = null;
      try {
        emailResult = await sendSyncNotificationEmail({
          empresa: emp,
          ano: parseInt(ano, 10),
          totalRegistros: movSoftland.totalRegistros,
          totalDebe: movSoftland.totalDebe,
          totalHaber: movSoftland.totalHaber,
          tiempoMs: duracionEmpMs,
          destinatarios: config.destinatarios,
          cc: config.cc,
          cuentasConsultadas: movSoftland.cuentasConsultadas
        });
      } catch (mailErr) {
        console.error(`[SCHEDULER] Error al enviar correo para ${emp}:`, mailErr.message);
        emailResult = { success: false, error: mailErr.message };
      }

      resultados.push({
        empresa: emp,
        totalRegistros: movSoftland.totalRegistros,
        totalDebe: movSoftland.totalDebe,
        totalHaber: movSoftland.totalHaber,
        saldo: Math.round((movSoftland.totalDebe - movSoftland.totalHaber) * 100) / 100,
        tiempoMs: duracionEmpMs,
        sync: syncResult,
        email: emailResult
      });
    }

    // Actualizar historial y timestamp
    config.ultimoEjecutado = new Date().toISOString();
    if (!config.historial) config.historial = [];
    config.historial.unshift({
      fecha: config.ultimoEjecutado,
      duracionTotalMs: Date.now() - startTime,
      resultados
    });
    // Conservar solo últimas 20 entradas
    config.historial = config.historial.slice(0, 20);
    await saveSchedulerConfig(config);

    return {
      success: true,
      mensaje: `Ciclo completado exitosamente para: ${empresasATratar.join(', ')}`,
      duracionTotalMs: Date.now() - startTime,
      resultados
    };
  } catch (err) {
    console.error('[SCHEDULER] Error en ciclo completo:', err);
    return {
      success: false,
      mensaje: `Error en el ciclo: ${err.message}`,
      error: err.toString()
    };
  } finally {
    isRunningCycle = false;
  }
}

// Iniciar o recargar el programador según la configuración
export async function reloadScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  const config = await getSchedulerConfig();

  if (!config.activo) {
    console.log('⏰ [SCHEDULER] Tareas automáticas en segundo plano: DESACTIVADAS');
    return { activo: false, cronExpression: config.cronExpression };
  }

  // Mapear frecuencia amigable a cron expression si es necesario
  let expression = config.cronExpression || '0 8 * * 3';
  if (config.frecuencia === 'cada_miercoles') expression = '0 8 * * 3'; // Miércoles 08:00 AM
  else if (config.frecuencia === 'todos_los_2') expression = '0 8 2 * *'; // Día 2 de cada mes 08:00 AM
  else if (config.frecuencia === 'todos_los_15') expression = '0 8 15 * *'; // Día 15 de cada mes 08:00 AM
  else if (config.frecuencia === 'todos_los_29') expression = '0 8 29 * *'; // Día 29 de cada mes 08:00 AM
  else if (config.frecuencia === 'dias_2_15_29') expression = '0 8 2,15,29 * *'; // Días 2, 15 y 29
  else if (config.frecuencia === 'cada_30_min') expression = '*/30 * * * *';
  else if (config.frecuencia === 'cada_1_hora') expression = '0 * * * *';
  else if (config.frecuencia === 'cada_2_horas') expression = '0 */2 * * *';
  else if (config.frecuencia === 'cada_4_horas') expression = '0 */4 * * *';
  else if (config.frecuencia === 'diario_08am') expression = '0 8 * * *';

  if (!cron.validate(expression)) {
    console.warn(`[SCHEDULER] Expresión cron no válida: "${expression}". Usando por defecto: '0 8 * * 3'`);
    expression = '0 8 * * 3';
  }

  console.log(`⏰ [SCHEDULER] Tarea automática activa con cron: "${expression}" (${config.frecuencia || 'personalizado'})`);

  scheduledTask = cron.schedule(expression, async () => {
    console.log(`⏰ [SCHEDULER] Disparando ejecución automática programada (${new Date().toISOString()})...`);
    await ejecutarCicloCompleto();
  });

  return { activo: true, cronExpression: expression, frecuencia: config.frecuencia };
}
