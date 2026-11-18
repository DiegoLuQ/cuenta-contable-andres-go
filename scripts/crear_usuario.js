// Crea un usuario de la web en con_c_usuarios (útil para el primer superadmin).
//
//   node scripts/crear_usuario.js <usuario> <superadmin|viewer> "<Nombre completo>"
//
// La contraseña se pide por consola (no queda en el historial).
// Con --generar se crea una contraseña aleatoria y se muestra una sola vez.
import crypto from 'crypto';
import readline from 'readline';
import { crearUsuario, ROLES } from '../services/authService.js';
import { getMysqlPool } from '../config/mysql.js';

const args = process.argv.slice(2).filter(a => a !== '--generar');
const generar = process.argv.includes('--generar');
const [usuario, rol, nombre] = args;

if (!usuario || !ROLES.includes(rol) || !nombre) {
  console.log('Uso: node scripts/crear_usuario.js <usuario> <superadmin|viewer> "<Nombre completo>" [--generar]');
  process.exit(1);
}

function preguntarOculto(texto) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (!rl.stdoutMuted) rl.output.write(s); };
    rl.question(texto, resp => { rl.close(); process.stdout.write('\n'); resolve(resp); });
    rl.stdoutMuted = true;
    rl.output.write(texto);
  });
}

try {
  let password;
  if (generar) {
    password = crypto.randomBytes(12).toString('base64url');
  } else {
    password = await preguntarOculto('Contraseña (mín. 8 caracteres): ');
    const confirmar = await preguntarOculto('Repite la contraseña: ');
    if (password !== confirmar) throw new Error('Las contraseñas no coinciden');
  }

  const u = await crearUsuario({ usuario, nombre, password, rol });
  console.log(`✓ Usuario creado: ${u.usuario} (${u.rol}) — ${u.nombre}`);
  if (generar) console.log(`  Contraseña generada: ${password}\n  Cámbiala al ingresar (menú de usuario → Cambiar contraseña).`);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
} finally {
  await getMysqlPool().end();
}
