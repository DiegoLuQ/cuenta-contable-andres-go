import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

let pool = null;

export function getMysqlPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || '186.64.120.228',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE || 'db_central',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 10000,
      charset: 'utf8mb4',
      // El servidor MariaDB trabaja en UTC: leer/escribir DATETIME como UTC
      // (evita desfases de 3 h según la zona horaria de la máquina que corre Node)
      timezone: 'Z',
      // Conexiones remotas: mantener vivas y no guardar ociosas mucho tiempo
      // (la red/servidor puede cortarlas y producir ECONNRESET al reutilizarlas)
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      maxIdle: 3,
      idleTimeout: 60000
    });

    // Reintenta una vez si la conexión tomada del pool estaba cortada
    const RECONECTAR = new Set(['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'EPIPE', 'ETIMEDOUT']);
    const queryOriginal = pool.query.bind(pool);
    pool.query = async (...args) => {
      try {
        return await queryOriginal(...args);
      } catch (err) {
        if (!RECONECTAR.has(err.code)) throw err;
        console.warn(`[mysql] ${err.code}: reintentando consulta con una conexión nueva`);
        return queryOriginal(...args);
      }
    };
  }
  return pool;
}

export async function testMysqlConnection() {
  try {
    const p = getMysqlPool();
    const [rows] = await p.query('SELECT 1 + 1 AS resultado, DATABASE() AS db');
    return {
      success: true,
      message: 'Conexión a MySQL remoto exitosa',
      data: rows[0]
    };
  } catch (err) {
    return {
      success: false,
      message: `Error al conectar a MySQL remoto: ${err.message}`,
      error: err.toString()
    };
  }
}

export async function initMysqlTables() {
  const tableName = process.env.MYSQL_TABLE || 'cuentas_contables';
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS \`${tableName}\` (
      \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
      \`empresa\` VARCHAR(50) NOT NULL,
      \`servicio\` VARCHAR(150) NULL,
      \`pct_cod\` VARCHAR(50) NOT NULL,
      \`cpb_ano\` INT NOT NULL,
      \`cpb_mes\` INT NOT NULL,
      \`cpb_fec\` DATETIME NULL,
      \`cpb_num\` INT NOT NULL,
      \`mov_num\` INT NOT NULL,
      \`cc_cod\` VARCHAR(50) NULL,
      \`tip_doc_cb\` VARCHAR(30) NULL,
      \`num_doc_cb\` VARCHAR(80) NULL,
      \`mov_debe\` DECIMAL(18, 4) DEFAULT 0,
      \`mov_haber\` DECIMAL(18, 4) DEFAULT 0,
      \`mov_glosa\` TEXT NULL,
      \`mon_cod\` VARCHAR(30) NULL,
      \`mov_equiv\` DECIMAL(18, 4) DEFAULT 0,
      \`mov_debe_ma\` DECIMAL(18, 4) DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`uniq_empresa_ano_cpb_mov\` (\`empresa\`, \`cpb_ano\`, \`cpb_num\`, \`mov_num\`),
      INDEX \`idx_pct_cod\` (\`pct_cod\`),
      INDEX \`idx_periodo\` (\`cpb_ano\`, \`cpb_mes\`),
      INDEX \`idx_servicio\` (\`servicio\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  try {
    const p = getMysqlPool();
    await p.query(createTableSql);
    return { success: true, message: `Tabla '${tableName}' verificada/creada exitosamente` };
  } catch (err) {
    console.error('Error al inicializar tabla MySQL:', err.message);
    return { success: false, error: err.message };
  }
}
