// Si ya hay sesión, ir directo a la app
fetch('/api/auth/me').then(r => { if (r.ok) window.location.replace('/'); }).catch(() => {});

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('btn-login');
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Ingresando...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: document.getElementById('usuario').value.trim(),
        password: document.getElementById('password').value
      })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'No se pudo iniciar sesión');
    window.location.replace('/');
  } catch (err) {
    errEl.textContent = err.message;
    document.getElementById('password').value = '';
    document.getElementById('password').focus();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
});
