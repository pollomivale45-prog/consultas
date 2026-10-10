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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(400).json({ ok: false, error: 'POST requerido' });

    try {
        const url = new URL(req.url, 'http://localhost');
        const txid = url.pathname.split('/').pop();
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { accion } = body;

        const data = await new Promise((resolve, reject) => {
            s3.getObject({ Bucket: BUCKET, Key: 'acciones.txt' }, (err, data) => {
                if (err) resolve('');
                else resolve(data.Body.toString());
            });
        });

        let lineas = data.split('\n').filter(l => l.trim());
        lineas = lineas.filter(l => !l.startsWith(txid + '|'));
        lineas.push(`${txid}|${accion}|${new Date().toISOString()}`);

        const newContent = lineas.join('\n');

        await new Promise((resolve, reject) => {
            s3.putObject({ Bucket: BUCKET, Key: 'acciones.txt', Body: newContent }, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        return res.status(200).json({ ok: true, accion });
    } catch (error) {
        return res.status(400).json({ ok: false, error: error.message });
    }
};
