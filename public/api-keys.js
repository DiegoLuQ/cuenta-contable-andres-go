// Página de administración de API Keys (solo superadmin)
const state = {
  user: null,
  keys: [],
  config: { baseUrl: window.location.origin, apiUrl: `${window.location.origin}/api/contabilidad` },
  entrega: null,
  lang: 'curl'
};

const ENDPOINTS = [
  { path: 'completo', query: 'colegio=AMBAS&ano={ano}', desc: '<strong>Todo en uno:</strong> colegios, cuentas, última sincronización, totales, resumen mensual y movimientos' },
  { path: 'movimientos', query: 'colegio=AMBAS&ano={ano}', desc: 'Movimientos contables + totales' },
  { path: 'resumen', query: 'colegio=AMBAS&ano={ano}', desc: 'Totales por colegio, cuenta y mes' },
  { path: 'cuentas', query: '', desc: 'Catálogo de cuentas' },
  { path: 'colegios', query: '', desc: 'Colegios disponibles' },
  { path: 'anos', query: '', desc: 'Años con datos' },
  { path: 'sync-log', query: 'limit=20', desc: 'Historial de sincronizaciones' },
  { path: 'estado', query: '', desc: 'Estado y última sincronización' }
];

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const { data } = await request('GET', '/api/auth/me');
    if (data.rol !== 'superadmin') return window.location.replace('/');
    state.user = data;
    document.getElementById('user-name').textContent = data.nombre;
  } catch {
    return;
  }
  await cargar();
});

window.addEventListener('beforeunload', e => {
  if (state.entrega) { e.preventDefault(); e.returnValue = ''; }
});

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    window.location.replace('/login.html');
    throw new Error('Sesión expirada');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status !== 'success') throw new Error(json.error || `Error HTTP ${res.status}`);
  return json;
}

async function cargar() {
  try {
    const json = await request('GET', '/api/auth/api-keys');
    state.keys = json.data;
    if (json.config) state.config = json.config;
    renderAlerta();
    renderKpis();
    renderTabla();
    renderDocs();
  } catch (err) {
    showToast(`Error cargando API keys: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderAlerta() {
  const el = document.getElementById('ak-alerta');
  if (state.config.publicUrlConfigurada && !state.config.esLocal) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = state.config.esLocal
    ? `⚠️ Las URLs de los JSON se generarán con <code>${escapeHtml(state.config.baseUrl)}</code>, que solo funciona en este equipo. Define <code>PUBLIC_URL</code> (ej. <code>https://central.dpmc.cl</code>) en el <code>.env</code> para que apunten a producción.`
    : `ℹ️ <code>PUBLIC_URL</code> no está definida: las URLs se generan con el dominio actual (<code>${escapeHtml(state.config.baseUrl)}</code>).`;
}

function renderKpis() {
  const activas = state.keys.filter(k => k.activo);
  document.getElementById('kpi-activas').textContent = activas.length;
  document.getElementById('kpi-inactivas').textContent = state.keys.length - activas.length;
  document.getElementById('kpi-usos').textContent = state.keys.reduce((s, k) => s + k.usos, 0).toLocaleString('es-CL');
  const ultima = state.keys.filter(k => k.ultimoUso).sort((a, b) => new Date(b.ultimoUso) - new Date(a.ultimoUso))[0];
  document.getElementById('kpi-ultimo').textContent = ultima ? tiempoRelativo(ultima.ultimoUso) : 'Nunca';
  document.getElementById('kpi-ultimo-sub').textContent = ultima ? ultima.nombre : ' ';
}

function renderTabla() {
  const term = document.getElementById('buscar').value.toLowerCase().trim();
  const estado = document.getElementById('filtro-estado').value;
  const filas = state.keys.filter(k =>
    (estado === 'todas' || (estado === 'activas') === k.activo) &&
    (!term || [k.nombre, k.prefijo, k.creadoPor].some(v => v && v.toLowerCase().includes(term)))
  );

  const tbody = document.getElementById('tabla-body');
  if (filas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${state.keys.length === 0 ? 'Aún no hay API keys. Crea la primera arriba.' : 'Ninguna clave coincide con el filtro.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = filas.map(k => `
    <tr class="${k.activo ? '' : 'ak-inactiva'}">
      <td><strong>${escapeHtml(k.nombre)}</strong></td>
      <td class="font-mono">${escapeHtml(k.prefijo)}…</td>
      <td><span class="badge-pill ${k.activo ? 'online' : 'offline'}">${k.activo ? 'Activa' : 'Desactivada'}</span></td>
      <td>${formatFechaHora(k.createdAt)}${k.creadoPor ? `<br><small class="ak-muted">por ${escapeHtml(k.creadoPor)}</small>` : ''}</td>
      <td title="${escapeHtml(formatFechaHora(k.ultimoUso))}">${k.ultimoUso ? tiempoRelativo(k.ultimoUso) : '<span class="ak-muted">Nunca</span>'}</td>
      <td class="text-right">${k.usos.toLocaleString('es-CL')}</td>
      <td class="acciones">
        <button class="btn btn-ghost btn-sm" onclick="descargarFicha(${k.id})" title="JSON con URLs y endpoints (sin la clave secreta)">Ficha JSON</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleKey(${k.id}, ${!k.activo})">${k.activo ? 'Desactivar' : 'Activar'}</button>
      </td>
    </tr>`).join('');
}

function renderDocs() {
  const ano = new Date().getFullYear();
  document.getElementById('doc-base').textContent = state.config.apiUrl;
  document.getElementById('doc-endpoints').innerHTML = ENDPOINTS.map(e => {
    const url = urlEndpoint(e, ano);
    return `
      <tr>
        <td class="font-mono">/${e.path}${e.query ? `?${escapeHtml(e.query.replace('{ano}', ano))}` : ''}</td>
        <td>${e.desc}</td>
        <td class="text-right"><button class="btn btn-ghost btn-sm" onclick="copiar('${escapeHtml(url)}', 'URL copiada')">Copiar URL</button></td>
      </tr>`;
  }).join('');
  mostrarEjemplo(state.lang);
}

function urlEndpoint(e, ano) {
  return `${state.config.apiUrl}/${e.path}${e.query ? `?${e.query.replace('{ano}', ano)}` : ''}`;
}

function mostrarEjemplo(lang) {
  state.lang = lang;
  document.querySelectorAll('.ak-tab').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  const url = urlEndpoint(ENDPOINTS[0], new Date().getFullYear());
  const ejemplos = {
    curl: `curl -H "X-API-Key: <api_key>" \\\n  "${url}"`,
    js: `const res = await fetch("${url}", {\n  headers: { "X-API-Key": "<api_key>" }\n});\nconst data = await res.json();\nconsole.log(data.resumen, data.movimientos.length);`,
    python: `import requests\n\nr = requests.get(\n    "${url}",\n    headers={"X-API-Key": "<api_key>"},\n    timeout=30,\n)\nr.raise_for_status()\ndata = r.json()\nprint(data["resumen"], len(data["movimientos"]))`,
    php: `<?php\n$ch = curl_init("${url}");\ncurl_setopt_array($ch, [\n    CURLOPT_HTTPHEADER => ["X-API-Key: <api_key>"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\n$data = json_decode(curl_exec($ch), true);\ncurl_close($ch);\nprint_r($data["resumen"]);`
  };
  document.getElementById('doc-ejemplo').textContent = ejemplos[lang];
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------
async function crearApiKey(e) {
  e.preventDefault();
  if (state.entrega && !confirm('Hay una clave recién creada sin cerrar. ¿Continuar? No se volverá a mostrar.')) return;
  const nombre = document.getElementById('ak-nombre').value.trim();
  const btn = document.getElementById('btn-crear');
  btn.disabled = true;
  try {
    const { data } = await request('POST', '/api/auth/api-keys', { nombre });
    state.entrega = data;
    document.getElementById('entrega-clave').textContent = data.api_key;
    document.getElementById('entrega-json').textContent = JSON.stringify(data, null, 2);
    document.getElementById('entrega').hidden = false;
    document.getElementById('form-apikey').reset();
    showToast(`API key "${nombre}" creada. Guárdala ahora.`, 'success');
    await cargar();
    document.getElementById('entrega').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function cerrarEntrega() {
  state.entrega = null;
  document.getElementById('entrega-clave').textContent = '';
  document.getElementById('entrega-json').textContent = '';
  document.getElementById('entrega').hidden = true;
}

async function descargarFicha(id) {
  try {
    const { data } = await request('GET', `/api/auth/api-keys/${id}/ficha`);
    descargarJson(data, 'ficha_api_key');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleKey(id, activo) {
  const k = state.keys.find(x => x.id === id);
  if (!activo && !confirm(`¿Desactivar "${k.nombre}"?\n\nLas aplicaciones que la usen dejarán de tener acceso de inmediato.`)) return;
  try {
    await request('PATCH', `/api/auth/api-keys/${id}`, { activo });
    showToast(`"${k.nombre}" ${activo ? 'activada' : 'desactivada'}`, 'success');
    await cargar();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function logout() {
  if (state.entrega && !confirm('La clave recién creada no se volverá a mostrar. ¿Salir igual?')) return;
  state.entrega = null;
  try { await request('POST', '/api/auth/logout'); } catch { /* igual salimos */ }
  window.location.replace('/login.html');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function descargarJson(obj, prefijo) {
  const slug = String(obj.nombre || 'cuentas_contables').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${prefijo}_${slug}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function copiar(texto, mensaje) {
  navigator.clipboard.writeText(texto)
    .then(() => showToast(mensaje || 'Copiado', 'info'))
    .catch(() => showToast('No se pudo copiar al portapapeles', 'error'));
}

function tiempoRelativo(v) {
  const s = Math.round((Date.now() - new Date(v)) / 1000);
  if (s < 60) return 'hace segundos';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  if (s < 86400 * 30) return `hace ${Math.round(s / 86400)} días`;
  return formatFechaHora(v);
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
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(text) {
  if (text === null || text === undefined || text === '') return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
