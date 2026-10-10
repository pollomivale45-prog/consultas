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

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(400).json({ ok: false, error: 'POST requerido' });

    try {
        const url = new URL(req.url, 'http://localhost');
        const pathParts = url.pathname.split('/');

        let tipo = '';
        let txid = '';

        for (let i = 0; i < pathParts.length; i++) {
            if (pathParts[i].startsWith('guardar-datos-')) {
                tipo = pathParts[i].replace('guardar-datos-', '');
                txid = pathParts[i + 1];
                break;
            }
        }

        if (!tipo || !txid) {
            return res.status(400).json({ ok: false, error: 'Parámetros inválidos' });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { valor } = body;

        if (!valor) {
            return res.status(400).json({ ok: false, error: 'Valor requerido' });
        }

        const archivo = `datos_${tipo}.txt`;
        const datosGuardar = { txid, valor, timestamp: new Date().toISOString() };

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

        lineas.push(JSON.stringify(datosGuardar));
        const newContent = lineas.join('\n');

        await new Promise((resolve, reject) => {
            s3.putObject({ Bucket: BUCKET, Key: archivo, Body: newContent }, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        return res.status(200).json({ ok: true, message: 'Datos guardados' });
    } catch (error) {
        console.error('Error:', error);
        return res.status(400).json({ ok: false, error: error.message });
    }
};
