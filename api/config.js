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
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(400).json({ ok: false, error: 'GET requerido' });
    }

    try {
        return new Promise((resolve) => {
            s3.getObject({ Bucket: BUCKET, Key: 'config.json' }, (err, data) => {
                if (err) {
                    return resolve(res.status(200).json({
                        ok: true,
                        brebLlave: '@BE2020253',
                        brebUrl: 'https://example.com'
                    }));
                }

                try {
                    const config = JSON.parse(data.Body.toString());
                    resolve(res.status(200).json({ ok: true, ...config }));
                } catch (e) {
                    resolve(res.status(200).json({
                        ok: true,
                        brebLlave: '@BE2020253',
                        brebUrl: 'https://example.com'
                    }));
                }
            });
        });
    } catch (error) {
        return res.status(400).json({ ok: false, error: 'Error: ' + error.message });
    }
};
