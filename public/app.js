// ============================================================================
// Cuentas Contables Softland — Interfaz de consulta (solo MySQL db_central)
// Los datos los carga el extractor Python (sincronizar_cuentas.bat) en el servidor Softland.
// ============================================================================
const API = '/api/contabilidad';
const REFRESCO_MS = 60000; // revisa cada 60 s si hubo una sincronización nueva

const state = {
  user: null,
  usuarios: [],
  cuentas: [],
  colegios: [],
  movimientos: [],
  ultimoResultado: null,
  ultimoSyncId: null,
  filtrosActuales: { colegio: 'AMBAS', ano: new Date().getFullYear(), mes: '' }
};

const currencyFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0
});

const NOMBRES_CORTOS = {
  FUNDACIONMACAYA: 'Macaya',
  FUNDACIONPTONUEV: 'Diego Portales'
};

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
  if (!await loadMe()) return;
  await Promise.all([loadColegios(), loadAnos(), loadCuentas()]);
  await Promise.all([loadEstado(), loadSyncLog()]);
  await handleConsultar();
  setInterval(verificarNuevaSincronizacion, REFRESCO_MS);
});

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    window.location.replace('/login.html'); // sesión expirada o revocada
    throw new Error('Sesión expirada');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status !== 'success') throw new Error(json.error || `Error HTTP ${res.status}`);
  return json;
}

const apiGet = path => request('GET', `${API}${path}`);
const apiSend = (method, path, body) => request(method, `${API}${path}`, body);
const authApi = (method, path, body) => request(method, `/api/auth${path}`, body);
const esAdmin = () => state.user?.rol === 'superadmin';

// ============================================================================
// SESIÓN Y USUARIOS
// ============================================================================
async function loadMe() {
  try {
    const { data } = await authApi('GET', '/me');
    state.user = data;
    document.body.classList.remove('rol-viewer', 'rol-superadmin');
    document.body.classList.add(`rol-${data.rol}`);
    document.getElementById('user-name').textContent = data.nombre;
    const roleEl = document.getElementById('user-role');
    roleEl.textContent = data.rol;
    roleEl.className = `user-role ${data.rol}`;
    return true;
  } catch {
    return false;
  }
}

async function logout() {
  try { await authApi('POST', '/logout'); } catch { /* igual salimos */ }
  window.location.replace('/login.html');
}

function openPasswordModal() {
  document.getElementById('modal-password').classList.add('open');
  document.getElementById('pw-actual').focus();
}

function closePasswordModal() {
  document.getElementById('modal-password').classList.remove('open');
  document.getElementById('form-password').reset();
}

async function handleCambiarPassword(e) {
  e.preventDefault();
  const actual = document.getElementById('pw-actual').value;
  const nueva = document.getElementById('pw-nueva').value;
  if (nueva !== document.getElementById('pw-confirmar').value) {
    showToast('Las contraseñas nuevas no coinciden', 'error');
    return;
  }
  try {
    await authApi('POST', '/cambiar-password', { actual, nueva });
    closePasswordModal();
    showToast('Contraseña actualizada', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openUsuariosModal() {
  if (!esAdmin()) return;
  document.getElementById('modal-usuarios').classList.add('open');
  await loadUsuarios();
}

function closeUsuariosModal() {
  document.getElementById('modal-usuarios').classList.remove('open');
  document.getElementById('form-usuario').reset();
}

async function loadUsuarios() {
  try {
    const { data } = await authApi('GET', '/usuarios');
    state.usuarios = data;
    renderUsuarios();
  } catch (err) {
    showToast(`Error cargando usuarios: ${err.message}`, 'error');
  }
}

function renderUsuarios() {
  const tbody = document.getElementById('usuarios-body');
  tbody.innerHTML = state.usuarios.map(u => {
    const yo = u.id === state.user.id;
    const botonActivo = yo ? '' :
      `<button class="btn btn-ghost btn-sm" onclick="toggleActivoUsuario(${u.id}, ${!u.activo})">${u.activo ? 'Desactivar' : 'Activar'}</button>`;
    return `
      <tr>
        <td class="font-mono">${escapeHtml(u.usuario)}${yo ? ' <small>(tú)</small>' : ''}</td>
        <td>${escapeHtml(u.nombre)}</td>
        <td>
          <select onchange="cambiarRolUsuario(${u.id}, this.value)" ${yo ? 'disabled title="No puedes cambiar tu propio rol"' : ''}>
            <option value="viewer" ${u.rol === 'viewer' ? 'selected' : ''}>viewer</option>
            <option value="superadmin" ${u.rol === 'superadmin' ? 'selected' : ''}>superadmin</option>
          </select>
        </td>
        <td><span class="badge-pill ${u.activo ? 'online' : 'offline'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>${formatFechaHora(u.ultimoLogin)}</td>
        <td class="acciones">
          ${botonActivo}
          <button class="btn btn-ghost btn-sm" onclick="resetPasswordUsuario(${u.id})">Nueva contraseña</button>
        </td>
      </tr>`;
  }).join('');
}

async function actualizarUsuario(id, cambios, mensaje) {
  try {
    await authApi('PATCH', `/usuarios/${id}`, cambios);
    showToast(mensaje, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
  await loadUsuarios();
}

function cambiarRolUsuario(id, rol) {
  const u = state.usuarios.find(x => x.id === id);
  if (!confirm(`¿Cambiar el rol de ${u.usuario} a ${rol}?`)) {
    renderUsuarios();
    return;
  }
  actualizarUsuario(id, { rol }, `${u.usuario} ahora es ${rol}`);
}

function toggleActivoUsuario(id, activo) {
  const u = state.usuarios.find(x => x.id === id);
  if (!activo && !confirm(`¿Desactivar a ${u.usuario}? No podrá ingresar y se cerrarán sus sesiones.`)) return;
  actualizarUsuario(id, { activo }, `${u.usuario} ${activo ? 'activado' : 'desactivado'}`);
}

function resetPasswordUsuario(id) {
  const u = state.usuarios.find(x => x.id === id);
  const password = prompt(`Nueva contraseña para ${u.usuario} (mín. 8 caracteres):`);
  if (!password) return;
  actualizarUsuario(id, { password }, `Contraseña de ${u.usuario} restablecida`);
}

async function handleCrearUsuario(e) {
  e.preventDefault();
  const body = {
    usuario: document.getElementById('nu-usuario').value.trim(),
    nombre: document.getElementById('nu-nombre').value.trim(),
    password: document.getElementById('nu-password').value,
    rol: document.getElementById('nu-rol').value
  };
  try {
    await authApi('POST', '/usuarios', body);
    document.getElementById('form-usuario').reset();
    showToast(`Usuario ${body.usuario} creado (${body.rol})`, 'success');
    await loadUsuarios();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// ESTADO MYSQL Y SINCRONIZACIONES
// ============================================================================
async function loadEstado() {
  const mysqlDot = document.querySelector('#badge-mysql .status-dot');
  const mysqlText = document.getElementById('mysql-status-text');
  const syncDot = document.getElementById('sync-dot');
  const syncText = document.getElementById('sync-status-text');

  mysqlDot.className = 'status-dot loading';
  mysqlText.textContent = 'Verificando...';

  try {
    const { data } = await apiGet('/estado');
    mysqlDot.className = 'status-dot online';
    mysqlText.textContent = `Online (${data.db}) · ${Number(data.totalMovimientos).toLocaleString('es-CL')} mov.`;

    const u = data.ultimaSync;
    if (!u) {
      syncDot.className = 'status-dot offline';
      syncText.textContent = 'Sin sincronizaciones';
    } else {
      syncDot.className = `status-dot ${u.estado === 'OK' ? 'online' : u.estado === 'ERROR' ? 'offline' : 'loading'}`;
      syncText.textContent = `${u.estado} · ${formatFechaHora(u.fin || u.inicio)}`;
    }
    return u;
  } catch (err) {
    mysqlDot.className = 'status-dot offline';
    mysqlText.textContent = 'Error de conexión';
    syncDot.className = 'status-dot offline';
    syncText.textContent = '—';
    console.warn('Estado MySQL:', err);
    return null;
  }
}

async function loadSyncLog() {
  const tbody = document.getElementById('sync-log-body');
  try {
    const { data } = await apiGet('/sync-log?limit=30');
    if (data.length > 0) state.ultimoSyncId = data[0].id;
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Aún no hay sincronizaciones registradas.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(l => {
      const badge = l.estado === 'OK' ? 'online' : l.estado === 'ERROR' ? 'offline' : 'warning';
      const periodo = l.ano ? (l.mes ? `${l.ano}-${String(l.mes).padStart(2, '0')}` : `${l.ano} (año)`) : '-';
      return `
        <tr>
          <td class="font-mono">${formatFechaHora(l.inicio)}</td>
          <td>${escapeHtml(NOMBRES_CORTOS[l.empresa] || l.empresa || '-')}</td>
          <td class="font-mono">${periodo}</td>
          <td><span class="badge-pill ${badge}">${escapeHtml(l.estado)}</span></td>
          <td class="text-right">${Number(l.registros || 0).toLocaleString('es-CL')}</td>
          <td class="text-right">${currencyFormatter.format(l.totalDebe || 0)}</td>
          <td class="text-right">${l.duracionMs != null ? `${l.duracionMs} ms` : '-'}</td>
          <td title="${escapeHtml(l.mensaje || '')}">${escapeHtml(l.mensaje || '-')}</td>
        </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// Si el extractor corrió desde la última revisión, recarga datos automáticamente
async function verificarNuevaSincronizacion() {
  const anterior = state.ultimoSyncId;
  const u = await loadEstado();
  if (u && anterior !== null && u.id !== anterior) {
    await loadSyncLog();
    await loadAnos(true);
    await handleConsultar(null, { silencioso: true });
    showToast('Datos actualizados: se detectó una nueva sincronización', 'success');
  } else if (u && anterior === null) {
    state.ultimoSyncId = u.id;
  }
}

async function refrescarTodo() {
  await Promise.all([loadEstado(), loadSyncLog(), loadCuentas()]);
  await handleConsultar();
}

function toggleSyncLog() {
  const panel = document.getElementById('sync-log-panel');
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  document.getElementById('btn-sync-log-text').textContent = visible ? 'Ver historial' : 'Ocultar historial';
}

// ============================================================================
// FILTROS
// ============================================================================
async function loadColegios() {
  try {
    const { data } = await apiGet('/colegios');
    state.colegios = data;
    const select = document.getElementById('select-empresa');
    select.innerHTML = '<option value="AMBAS" selected>Ambos colegios</option>' +
      data.map(c => `<option value="${escapeHtml(c.codigo)}">${escapeHtml(c.nombre)}</option>`).join('');
  } catch (err) {
    console.error('Error cargando colegios:', err);
  }
}

async function loadAnos(mantenerSeleccion = false) {
  const select = document.getElementById('input-ano');
  const actual = select.value;
  let anos = [];
  try {
    ({ data: anos } = await apiGet('/anos'));
  } catch (err) {
    console.error('Error cargando años:', err);
  }
  const anoHoy = new Date().getFullYear();
  if (!anos.includes(anoHoy)) anos.unshift(anoHoy);
  select.innerHTML = anos.map(a => `<option value="${a}">${a}</option>`).join('');
  select.value = mantenerSeleccion && actual ? actual : String(anos[0]);
}

// ============================================================================
// CATÁLOGO DE CUENTAS
// ============================================================================
async function loadCuentas() {
  try {
    const json = await apiGet('/cuentas');
    state.cuentas = json.data || [];
    renderCuentasChips();
  } catch (err) {
    showToast('Error cargando catálogo de cuentas', 'error');
  }
}

function renderCuentasChips() {
  const container = document.getElementById('cuentas-chips-container');
  document.getElementById('active-cuentas-count').textContent = state.cuentas.filter(c => c.activo).length;

  container.innerHTML = state.cuentas.map(c => `
    <div class="cuenta-chip ${c.activo ? 'active' : 'inactive'}">
      <div class="cuenta-chip-info">
        <span class="cuenta-chip-code">${escapeHtml(c.pctCod)}</span>
        <span class="cuenta-chip-name" title="${escapeHtml(c.servicio)}">${escapeHtml(c.servicio)}</span>
        <span class="cuenta-chip-category">${escapeHtml(c.categoria || 'General')}</span>
      </div>
      <div class="cuenta-chip-ctrls solo-admin">
        <label class="switch" title="${c.activo ? 'Desactivar cuenta' : 'Activar cuenta'}">
          <input type="checkbox" ${c.activo ? 'checked' : ''} onchange="toggleCuentaState('${escapeHtml(c.pctCod)}', this.checked)">
          <span class="slider"></span>
        </label>
        <button class="btn-icon" onclick="deleteCuentaItem('${escapeHtml(c.pctCod)}')" title="Quitar del catálogo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    </div>
  `).join('');
}

async function toggleCuentaState(pctCod, activo) {
  try {
    await apiSend('PATCH', `/cuentas/${encodeURIComponent(pctCod)}/toggle`, { activo });
    const cuenta = state.cuentas.find(c => c.pctCod === pctCod);
    if (cuenta) cuenta.activo = activo;
    renderCuentasChips();
    showToast(`Cuenta ${pctCod} ${activo ? 'activada' : 'desactivada'} (aplica en la próxima sincronización)`, 'info');
    await handleConsultar(null, { silencioso: true });
  } catch (err) {
    showToast(`Fallo al cambiar estado: ${err.message}`, 'error');
    renderCuentasChips();
  }
}

async function setAllCuentas(activo) {
  try {
    for (const c of state.cuentas) {
      if (c.activo !== activo) {
        await apiSend('PATCH', `/cuentas/${encodeURIComponent(c.pctCod)}/toggle`, { activo });
        c.activo = activo;
      }
    }
    showToast(`Todas las cuentas ${activo ? 'activadas' : 'desactivadas'}`, 'info');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
  renderCuentasChips();
  await handleConsultar(null, { silencioso: true });
}

async function deleteCuentaItem(pctCod) {
  if (!confirm(`¿Quitar la cuenta ${pctCod} del catálogo?\n\nLos movimientos ya sincronizados se conservan en MySQL; solo dejará de extraerse y mostrarse.`)) return;
  try {
    const json = await apiSend('DELETE', `/cuentas/${encodeURIComponent(pctCod)}`);
    state.cuentas = json.data;
    renderCuentasChips();
    showToast(`Cuenta ${pctCod} quitada del catálogo`, 'info');
    await handleConsultar(null, { silencioso: true });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function toggleCuentasPanel() {
  const panel = document.getElementById('cuentas-panel');
  panel.style.display = (panel.style.display === 'none' || !panel.style.display) ? 'block' : 'none';
}

function openAddCuentaModal() {
  document.getElementById('modal-cuenta').classList.add('open');
  document.getElementById('modal-pctcod').focus();
}

function closeAddCuentaModal() {
  document.getElementById('modal-cuenta').classList.remove('open');
  document.getElementById('form-cuenta').reset();
}

async function handleSaveCuenta(e) {
  e.preventDefault();
  const pctCod = document.getElementById('modal-pctcod').value.trim();
  const servicio = document.getElementById('modal-servicio').value.trim();
  const categoria = document.getElementById('modal-categoria').value.trim() || 'General';

  try {
    const json = await apiSend('POST', '/cuentas', { pctCod, servicio, categoria, activo: true });
    state.cuentas = json.data;
    renderCuentasChips();
    closeAddCuentaModal();
    showToast(`Cuenta ${pctCod} guardada. Sus movimientos aparecerán tras la próxima sincronización.`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// CONSULTA DE MOVIMIENTOS (MySQL)
// ============================================================================
async function handleConsultar(e, { silencioso = false } = {}) {
  if (e) e.preventDefault();

  const colegio = document.getElementById('select-empresa').value || 'AMBAS';
  const ano = document.getElementById('input-ano').value || new Date().getFullYear();
  const mes = document.getElementById('select-mes').value;
  state.filtrosActuales = { colegio, ano, mes };

  const btn = document.getElementById('btn-consultar');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="status-dot loading" style="display:inline-block; margin-right:6px"></span> Consultando...';

  try {
    const json = await apiGet(`/movimientos?${buildQuery()}`);
    state.ultimoResultado = json;
    state.movimientos = json.datos || [];

    updateKpis(json.resumen, colegio, ano, mes);
    const term = document.getElementById('table-search').value.trim();
    term ? filterTable() : renderTable(state.movimientos);
    if (!silencioso) showToast(`${json.resumen.totalRegistros} movimientos cargados`, 'success');
  } catch (err) {
    showToast(`Error al consultar: ${err.message}`, 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function buildQuery() {
  const { colegio, ano, mes } = state.filtrosActuales;
  const params = new URLSearchParams({ colegio, ano });
  if (mes) params.append('mes', mes);
  return params.toString();
}

function updateKpis(resumen, colegio, ano, mes) {
  document.getElementById('kpi-total-registros').textContent = (resumen.totalRegistros || 0).toLocaleString('es-CL');
  document.getElementById('kpi-total-debe').textContent = currencyFormatter.format(resumen.totalDebe || 0);
  document.getElementById('kpi-total-haber').textContent = currencyFormatter.format(resumen.totalHaber || 0);
  document.getElementById('kpi-saldo-neto').textContent = currencyFormatter.format(resumen.saldo || 0);

  const nombre = colegio === 'AMBAS' ? 'Ambos colegios' : (NOMBRES_CORTOS[colegio] || colegio);
  const mesTxt = mes ? `Mes ${mes} / ${ano}` : `Todo el año ${ano}`;
  document.getElementById('kpi-periodo-sub').textContent = `${nombre} • ${mesTxt}`;
}

function renderTable(filas) {
  const tbody = document.getElementById('table-body');
  document.getElementById('showing-count').textContent = filas.length;
  document.getElementById('total-count').textContent = state.movimientos.length;

  if (!filas || filas.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="empty-state">
          <div class="empty-state-content">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <p class="empty-title">No se encontraron movimientos</p>
            <p class="empty-sub">No hay registros sincronizados para los filtros y cuentas activas seleccionados.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filas.map(r => `
      <tr>
        <td><span class="colegio-tag">${escapeHtml(NOMBRES_CORTOS[r.empresa] || r.empresa)}</span></td>
        <td><span class="tag-service">${escapeHtml(r.servicio || 'Otro')}</span></td>
        <td class="font-mono">${escapeHtml(r.pctCod)}</td>
        <td class="font-mono">${r.cpbAno}-${String(r.cpbMes).padStart(2, '0')}</td>
        <td>${formatFecha(r.cpbFec)}</td>
        <td class="font-mono">#${escapeHtml(r.cpbNum)} / ${r.movNum}</td>
        <td>${escapeHtml(r.tipDocCb || '')} ${escapeHtml(r.numDocCb || '')}</td>
        <td>${escapeHtml(r.ccCod || '-')}</td>
        <td class="text-right amount-debe">${currencyFormatter.format(r.movDebe || 0)}</td>
        <td class="text-right amount-haber">${currencyFormatter.format(r.movHaber || 0)}</td>
        <td title="${escapeHtml(r.movGlosa || '')}">${escapeHtml(r.movGlosa || '-')}</td>
      </tr>`).join('');
}

function filterTable() {
  const term = document.getElementById('table-search').value.toLowerCase().trim();
  if (!term) {
    renderTable(state.movimientos);
    return;
  }
  const filtrados = state.movimientos.filter(m =>
    [m.servicio, m.pctCod, m.movGlosa, m.numDocCb, m.ccCod, m.cpbNum, NOMBRES_CORTOS[m.empresa]]
      .some(v => v && String(v).toLowerCase().includes(term))
  );
  renderTable(filtrados);
}

// ============================================================================
// WEB SERVICE JSON & EXPORT
// ============================================================================
function getWebServiceUrl() {
  return `${window.location.origin}${API}/movimientos?${buildQuery()}`;
}

function copyWebServiceUrl() {
  const url = getWebServiceUrl();
  navigator.clipboard.writeText(url)
    .then(() => showToast('URL del Web Service copiada al portapapeles', 'info'))
    .catch(() => prompt('Copia esta URL del Web Service:', url));
}

function openJsonModal() {
  document.getElementById('json-modal-url').textContent = getWebServiceUrl();
  document.getElementById('json-viewer-code').textContent = state.ultimoResultado
    ? JSON.stringify(state.ultimoResultado, null, 2)
    : JSON.stringify({ mensaje: 'Ejecuta una consulta primero', ejemploUrl: getWebServiceUrl() }, null, 2);
  document.getElementById('modal-json').classList.add('open');
}

function closeJsonModal() {
  document.getElementById('modal-json').classList.remove('open');
}

function copyJsonText() {
  const text = document.getElementById('json-viewer-code').textContent;
  navigator.clipboard.writeText(text).then(() => showToast('JSON copiado al portapapeles', 'info'));
}

function downloadJsonFile() {
  if (!state.ultimoResultado) {
    showToast('No hay datos consultados para exportar', 'error');
    return;
  }
  const blob = new Blob([JSON.stringify(state.ultimoResultado, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cuentas_contables_${state.filtrosActuales.colegio}_${state.filtrosActuales.ano}${state.filtrosActuales.mes ? '_' + state.filtrosActuales.mes : ''}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  showToast('Archivo JSON descargado', 'success');
}

// ============================================================================
// HELPERS
// ============================================================================
function formatFecha(v) {
  if (!v) return '-';
  const d = new Date(v);
  return isNaN(d) ? '-' : d.toLocaleDateString('es-CL', { timeZone: 'UTC' });
}

function formatFechaHora(v) {
  if (!v) return '-';
  const d = new Date(v);
  return isNaN(d) ? '-' : d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(text) {
  if (text === null || text === undefined || text === '') return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
