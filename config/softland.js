import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();

let poolPromise = null;
let currentConfig = null;

export function parseServerAddress(rawServer) {
  if (!rawServer) return { server: 'localhost', instanceName: undefined };
  
  // Normalizar barras invertidas dobles o simples
  const clean = rawServer.replace(/\\\\/g, '\\');
  if (clean.includes('\\')) {
    const [srv, inst] = clean.split('\\');
    return { server: srv.trim(), instanceName: inst.trim() };
  }
  return { server: clean.trim(), instanceName: undefined };
}

export function buildSoftlandConfig(databaseOverride = null) {
  const rawServer = process.env.SOFTLAND_SERVER || '172.54.0.5\\SQLEXPRESS';
  const { server, instanceName } = parseServerAddress(rawServer);
  const defaultDb = databaseOverride || process.env.DB_SOFTLAND_MC || 'FUNDACIONMACAYA';

  const config = {
    user: process.env.DB_USER || 'lectura',
    password: process.env.DB_PASSWORD || '9bjs*ZX2sL',
    server: server,
    database: defaultDb,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      connectTimeout: 8000,
      requestTimeout: 30000
    },
    pool: {
      max: 10,
      min: 1,
      idleTimeoutMillis: 30000
    }
  };

  if (instanceName) {
    config.options.instanceName = instanceName;
    // Con instancia con nombre, el puerto no se fija para permitir SQL Browser resolverlo
  } else if (process.env.SOFTLAND_PORT) {
    config.port = parseInt(process.env.SOFTLAND_PORT, 10);
  }

  return config;
}

export async function getSoftlandPool() {
  if (!poolPromise) {
    currentConfig = buildSoftlandConfig();
    poolPromise = sql.connect(currentConfig).catch(err => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

export async function testSoftlandConnection() {
  try {
    const pool = await getSoftlandPool();
    const result = await pool.request().query('SELECT @@VERSION AS version, DB_NAME() AS currentDb');
    return {
      success: true,
      message: 'Conexión a Softland SQL Server exitosa',
      data: result.recordset[0]
    };
  } catch (err) {
    // Si falló el pool existente, resetearlo para permitir reintento
    poolPromise = null;
    return {
      success: false,
      message: `Error al conectar a Softland: ${err.message}`,
      error: err.toString()
    };
  }
}
