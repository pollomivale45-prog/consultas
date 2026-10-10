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
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const url = new URL(req.url, 'http://localhost');
        const txid = url.pathname.split('/').pop();

        const data = await new Promise((resolve, reject) => {
            s3.getObject({ Bucket: BUCKET, Key: 'acciones.txt' }, (err, data) => {
                if (err) resolve(null);
                else resolve(data);
            });
        });

        if (!data) {
            return res.status(200).json({ ok: true, accion: 'STANDBY' });
        }

        const lineas = data.Body.toString().split('\n').filter(l => l.trim());
        const linea = lineas.find(l => l.startsWith(txid + '|'));

        if (linea) {
            const parts = linea.split('|');
            const accion = parts[1];
            return res.status(200).json({ ok: true, accion });
        } else {
            return res.status(200).json({ ok: true, accion: 'STANDBY' });
        }
    } catch (error) {
        return res.status(200).json({ ok: true, accion: 'STANDBY' });
    }
};
