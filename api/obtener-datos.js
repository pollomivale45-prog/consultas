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

async function obtenerDatos(tipo, txid) {
    const archivo = `datos_${tipo}.txt`;

    const data = await new Promise((resolve) => {
        s3.getObject({ Bucket: BUCKET, Key: archivo }, (err, data) => {
            if (err) resolve(null);
            else resolve(data);
        });
    });

    if (!data) {
        return null;
    }

    const lineas = data.Body.toString().split('\n').filter(l => l.trim());

    for (const linea of lineas) {
        // Intenta primero como JSON
        try {
            const obj = JSON.parse(linea);
            if (obj.txid === txid) {
                return obj;
            }
        } catch (e) {
            // Si no es JSON, intenta formato pipe-separated (txid|valor|timestamp)
            const parts = linea.split('|');
            if (parts.length >= 2 && parts[0] === txid) {
                return {
                    txid: parts[0],
                    valor: parts[1],
                    timestamp: parts[2] || new Date().toISOString()
                };
            }
        }
    }

    return null;
}

async function guardarDatos(tipo, txid, valor) {
    const archivo = `datos_${tipo}.txt`;

    const data = await new Promise((resolve) => {
        s3.getObject({ Bucket: BUCKET, Key: archivo }, (err, data) => {
            if (err) resolve('');
            else resolve(data.Body.toString());
        });
    });

    let lineas = data.split('\n').filter(l => l.trim());
    lineas = lineas.filter(l => {
        try {
            const obj = JSON.parse(l);
            return obj.txid !== txid;
        } catch (e) {
            return true;
        }
    });

    const datosGuardar = { txid, valor, timestamp: new Date().toISOString() };
    lineas.push(JSON.stringify(datosGuardar));
    const newContent = lineas.join('\n');

    await new Promise((resolve, reject) => {
        s3.putObject({ Bucket: BUCKET, Key: archivo, Body: newContent }, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const url = new URL(req.url, 'http://localhost');
        const pathParts = url.pathname.split('/');

        let tipo = '';
        let txid = '';
        let path = '';

        for (let i = 0; i < pathParts.length; i++) {
            if (pathParts[i].startsWith('obtener-datos-') || pathParts[i].startsWith('guardar-datos-')) {
                path = pathParts[i];
                tipo = path.replace('obtener-datos-', '').replace('guardar-datos-', '');
                txid = pathParts[i + 1];
                break;
            }
        }

        if (!tipo || !txid) {
            return res.status(400).json({ ok: false, error: 'Parámetros inválidos' });
        }

        if (req.method === 'GET') {
            const data = await obtenerDatos(tipo, txid);
            return res.status(200).json({ ok: true, data });
        }

        return res.status(400).json({ ok: false, error: 'Solo GET permitido' });
    } catch (error) {
        console.error('Error:', error);
        return res.status(400).json({ ok: false, error: error.message });
    }
};
