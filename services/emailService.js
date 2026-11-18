import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

function getTransporter(empresa = 'FUNDACIONMACAYA') {
  const isDP = empresa.toUpperCase().includes('PTONUEV') || empresa.toUpperCase().includes('DP') || empresa.toUpperCase().includes('PORTALES');

  const senderEmail = isDP
    ? process.env.DP_SENDER_EMAIL || 'procesos.automaticos@colegiodiegoportales.cl'
    : process.env.MC_SENDER_EMAIL || 'procesos.automaticos@colegiomacaya.cl';

  let rawPassword = isDP
    ? process.env.DP_SENDER_PASSWORD || ''
    : process.env.MC_SENDER_PASSWORD || '';

  // Limpiar espacios si viene como "qbuk ftjs ojcc dudo"
  const cleanPassword = rawPassword.replace(/\s+/g, '');

  const senderName = isDP
    ? 'TIC Procesos Automáticos - Colegio Diego Portales'
    : 'TIC Procesos Automáticos - Colegio Macaya';

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: senderEmail,
      pass: cleanPassword
    }
  });

  return { transporter, senderEmail, senderName };
}

export async function sendSyncNotificationEmail({
  empresa,
  ano,
  mes,
  totalRegistros,
  totalDebe = 0,
  totalHaber = 0,
  tiempoMs = 0,
  destinatarios = [],
  cc = [],
  cuentasConsultadas = [],
  error = null
}) {
  const { transporter, senderEmail, senderName } = getTransporter(empresa);

  if (!destinatarios || destinatarios.length === 0) {
    destinatarios = [
      'juan.luque@colegiomacaya.cl',
      'andres.angulo@colegiodiegoportales.cl'
    ];
  }

  const formatoMoneda = new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0
  });

  const fechaChile = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });
  const saldo = totalDebe - totalHaber;
  const periodoTexto = mes ? `Mes ${mes} / ${ano}` : `Año ${ano} Completo`;

  // Asunto obligatorio que comience con TIC -
  const asunto = `TIC - Sincronización Softland ⇄ MySQL [${empresa}] - ${periodoTexto}`;

  const cuentasHtml = cuentasConsultadas && cuentasConsultadas.length > 0
    ? cuentasConsultadas.map(c => `<span style="display:inline-block; background:#e0e7ff; color:#3730a3; padding:3px 8px; border-radius:4px; font-size:12px; font-family:monospace; margin:2px;">${c}</span>`).join(' ')
    : '<em>Cuentas activas del catálogo general</em>';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f6f9; color: #333; margin:0; padding:20px; }
        .container { max-width: 650px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08); margin:0 auto; border:1px solid #e5e7eb; }
        .header { background: linear-gradient(135deg, #1e3a8a, #2563eb); color:#ffffff; padding:24px 28px; }
        .header h1 { margin:0; font-size:20px; font-weight:700; letter-spacing:-0.5px; }
        .header p { margin:6px 0 0 0; font-size:13px; opacity:0.9; }
        .body-content { padding:28px; }
        .badge-status { display:inline-block; padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; ${error ? 'background:#fee2e2; color:#991b1b;' : 'background:#dcfce7; color:#166534;'} }
        .kpi-row { display:flex; gap:12px; margin:20px 0; }
        .kpi-box { flex:1; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px; text-align:center; }
        .kpi-title { font-size:11px; text-transform:uppercase; color:#64748b; font-weight:600; }
        .kpi-value { font-size:18px; font-weight:700; color:#0f172a; margin-top:4px; font-family:'Consolas', monospace; }
        .table-meta { width:100%; border-collapse:collapse; margin-top:16px; font-size:13px; }
        .table-meta td { padding:10px 12px; border-bottom:1px solid #f1f5f9; }
        .table-meta td.bold { font-weight:600; color:#475569; width:35%; }
        .footer { background:#f8fafc; border-top:1px solid #e2e8f0; padding:16px 28px; font-size:12px; color:#64748b; text-align:center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>TIC • Reporte de Sincronización Automática</h1>
          <p>Extracción Softland ERP ⇄ Servidor MySQL Central (186.64.120.228)</p>
        </div>
        <div class="body-content">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <span class="badge-status">${error ? '❌ Falló Sincronización' : '✓ Sincronización Exitosa'}</span>
            <span style="font-size:12px; color:#64748b;">${fechaChile}</span>
          </div>

          <p style="font-size:14px; line-height:1.6; margin-top:0;">
            Se ha completado el ciclo automático de consulta a <strong>Softland (${empresa})</strong> y persistencia en la base de datos central en la nube.
          </p>

          <table class="kpi-row" style="width:100%; border-spacing:10px; border-collapse:separate; margin:16px 0;">
            <tr>
              <td class="kpi-box" style="width:33%;">
                <div class="kpi-title">Registros</div>
                <div class="kpi-value" style="color:#2563eb;">${totalRegistros.toLocaleString()}</div>
              </td>
              <td class="kpi-box" style="width:33%;">
                <div class="kpi-title">Total Debe</div>
                <div class="kpi-value" style="color:#b45309;">${formatoMoneda.format(totalDebe)}</div>
              </td>
              <td class="kpi-box" style="width:33%;">
                <div class="kpi-title">Total Haber</div>
                <div class="kpi-value" style="color:#7c3aed;">${formatoMoneda.format(totalHaber)}</div>
              </td>
            </tr>
          </table>

          <table class="table-meta">
            <tr>
              <td class="bold">Empresa / Base:</td>
              <td><strong>${empresa}</strong></td>
            </tr>
            <tr>
              <td class="bold">Periodo Contable:</td>
              <td>${periodoTexto}</td>
            </tr>
            <tr>
              <td class="bold">Saldo Neto (Debe - Haber):</td>
              <td><strong style="color:${saldo >= 0 ? '#15803d' : '#b91c1c'}">${formatoMoneda.format(saldo)}</strong></td>
            </tr>
            <tr>
              <td class="bold">Servidor Destino:</td>
              <td>MySQL Remoto <code>186.64.120.228:3306</code> / Tabla <code>cuentas_contables</code></td>
            </tr>
            <tr>
              <td class="bold">Tiempo de Ejecución:</td>
              <td>${tiempoMs} ms</td>
            </tr>
            <tr>
              <td class="bold">Cuentas Involucradas:</td>
              <td>${cuentasHtml}</td>
            </tr>
          </table>

          ${error ? `
            <div style="margin-top:16px; padding:12px; background:#fef2f2; border-left:4px solid #ef4444; border-radius:4px; font-size:13px; color:#991b1b;">
              <strong>Detalle del Error:</strong> ${error}
            </div>
          ` : ''}
        </div>
        <div class="footer">
          Mensaje generado automáticamente por el servicio <strong>TIC - Cuentas Contables</strong>.<br>
          Emisor configurado: <code>${senderEmail}</code>
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"${senderName}" <${senderEmail}>`,
    to: destinatarios.join(', '),
    subject: asunto,
    html: htmlContent
  };

  if (cc && cc.length > 0) {
    mailOptions.cc = cc.join(', ');
  }

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    messageId: info.messageId,
    asunto,
    destinatarios,
    cc,
    senderEmail
  };
}

export async function testEmailConnection(empresa = 'FUNDACIONMACAYA') {
  try {
    const { transporter, senderEmail } = getTransporter(empresa);
    await transporter.verify();
    return {
      success: true,
      message: `Conexión SMTP exitosa con el emisor: ${senderEmail}`,
      senderEmail
    };
  } catch (err) {
    return {
      success: false,
      message: `Error al conectar al servidor SMTP: ${err.message}`,
      error: err.toString()
    };
  }
}
