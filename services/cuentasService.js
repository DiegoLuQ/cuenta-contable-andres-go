import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'cuentas_config.json');

const DEFAULT_CUENTAS = [
  { pctCod: '5-1-06-40', servicio: 'Consumo de luz colegio', activo: true, categoria: 'Servicios Básicos' },
  { pctCod: '5-1-11-40', servicio: 'Consumo de luz oficina Iquique', activo: true, categoria: 'Servicios Básicos' },
  { pctCod: '5-1-06-38', servicio: 'Consumo de agua colegio', activo: true, categoria: 'Servicios Básicos' },
  { pctCod: '5-1-11-38', servicio: 'Consumo de agua Iquique', activo: true, categoria: 'Servicios Básicos' },
  { pctCod: '5-1-06-44', servicio: 'DirecTV', activo: true, categoria: 'Comunicaciones' },
  { pctCod: '5-1-06-42', servicio: 'Planes de celulares / Red fija', activo: true, categoria: 'Comunicaciones' },
  { pctCod: '5-1-06-37', servicio: 'Firewall', activo: true, categoria: 'Tecnología e Infraestructura' },
  { pctCod: '5-1-07-47', servicio: 'Internet banda ancha', activo: true, categoria: 'Tecnología e Infraestructura' }
];

export async function getCuentas() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await saveCuentas(DEFAULT_CUENTAS);
      return DEFAULT_CUENTAS;
    }
    throw err;
  }
}

export async function saveCuentas(cuentas) {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cuentas, null, 2), 'utf-8');
}

export async function toggleCuenta(pctCod, activo) {
  const cuentas = await getCuentas();
  const index = cuentas.findIndex(c => c.pctCod === pctCod);
  if (index === -1) {
    throw new Error(`Cuenta ${pctCod} no encontrada`);
  }
  cuentas[index].activo = typeof activo === 'boolean' ? activo : !cuentas[index].activo;
  await saveCuentas(cuentas);
  return cuentas[index];
}

export async function upsertCuenta({ pctCod, servicio, categoria, activo = true }) {
  if (!pctCod || !servicio) {
    throw new Error('pctCod y servicio son obligatorios');
  }
  const cleanPct = pctCod.trim();
  const cuentas = await getCuentas();
  const index = cuentas.findIndex(c => c.pctCod.toLowerCase() === cleanPct.toLowerCase());

  if (index >= 0) {
    cuentas[index].servicio = servicio.trim();
    if (categoria) cuentas[index].categoria = categoria.trim();
    if (typeof activo === 'boolean') cuentas[index].activo = activo;
  } else {
    cuentas.push({
      pctCod: cleanPct,
      servicio: servicio.trim(),
      categoria: (categoria || 'Otros').trim(),
      activo: Boolean(activo)
    });
  }

  await saveCuentas(cuentas);
  return cuentas;
}

export async function deleteCuenta(pctCod) {
  const cuentas = await getCuentas();
  const filtered = cuentas.filter(c => c.pctCod !== pctCod);
  await saveCuentas(filtered);
  return filtered;
}

export async function getCuentasActivas() {
  const cuentas = await getCuentas();
  return cuentas.filter(c => c.activo);
}
