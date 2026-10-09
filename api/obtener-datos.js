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
        const parts = req.url.split('/');
        const tipo = parts[3].replace('obtener-datos-', '');
        const txid = parts[4];

        const archivo = `datos_${tipo}.txt`;

        const data = await new Promise((resolve, reject) => {
            s3.getObject({ Bucket: BUCKET, Key: archivo }, (err, data) => {
                if (err) resolve(null);
                else resolve(data);
            });
        });

        if (!data) {
            return res.status(200).json({ ok: true, datos: [] });
        }

        const lineas = data.Body.toString().split('\n').filter(l => l.trim());
        const registros = lineas
            .filter(l => l.includes(txid))
            .map(l => {
                try {
                    return JSON.parse(l);
                } catch (e) {
                    return null;
                }
            })
            .filter(r => r !== null);

        return res.status(200).json({ ok: true, datos: registros });
    } catch (error) {
        return res.status(200).json({ ok: true, datos: [] });
    }
};
