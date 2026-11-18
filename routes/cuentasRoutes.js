import { Router } from 'express';
import {
  getCuentas,
  toggleCuenta,
  upsertCuenta,
  deleteCuenta
} from '../services/cuentasService.js';

const router = Router();

// Obtener todas las cuentas (activas e inactivas)
router.get('/', async (req, res) => {
  try {
    const cuentas = await getCuentas();
    res.json({
      status: 'success',
      total: cuentas.length,
      activas: cuentas.filter(c => c.activo).length,
      data: cuentas
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Activar o desactivar una cuenta
router.patch('/:pctCod/toggle', async (req, res) => {
  try {
    const { pctCod } = req.params;
    const { activo } = req.body;
    const actualizada = await toggleCuenta(pctCod, activo);
    res.json({ status: 'success', data: actualizada });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

// Crear o editar una cuenta con su alias de servicio
router.post('/', async (req, res) => {
  try {
    const { pctCod, servicio, categoria, activo } = req.body;
    const cuentas = await upsertCuenta({ pctCod, servicio, categoria, activo });
    res.json({ status: 'success', data: cuentas });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

// Eliminar una cuenta del catálogo
router.delete('/:pctCod', async (req, res) => {
  try {
    const { pctCod } = req.params;
    const cuentas = await deleteCuenta(pctCod);
    res.json({ status: 'success', data: cuentas });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

export default router;
