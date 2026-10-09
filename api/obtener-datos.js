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
        const pathParts = url.pathname.split('/');

        // Obtener tipo y txid de la URL
        let tipo = '';
        let txid = '';

        for (let i = 0; i < pathParts.length; i++) {
            if (pathParts[i].startsWith('obtener-datos-')) {
                tipo = pathParts[i].replace('obtener-datos-', '');
                txid = pathParts[i + 1];
                break;
            }
        }

        if (!tipo || !txid) {
            return res.status(400).json({ ok: false, error: 'Parámetros inválidos' });
        }

        const archivo = `datos_${tipo}.txt`;

        const data = await new Promise((resolve, reject) => {
            s3.getObject({ Bucket: BUCKET, Key: archivo }, (err, data) => {
                if (err) resolve(null);
                else resolve(data);
            });
        });

        if (!data) {
            return res.status(200).json({ ok: true, data: null });
        }

        const lineas = data.Body.toString().split('\n').filter(l => l.trim());

        // Buscar el registro que coincida con el txid
        let encontrado = null;
        for (const linea of lineas) {
            try {
                const obj = JSON.parse(linea);
                if (obj.txid === txid) {
                    encontrado = obj;
                    break;
                }
            } catch (e) {
                // Ignorar líneas inválidas
            }
        }

        return res.status(200).json({ ok: true, data: encontrado });
    } catch (error) {
        console.error('Error:', error);
        return res.status(200).json({ ok: true, data: null });
    }
};
