require('dotenv').config();

const https = require('https');

const BIN_API_KEY = process.env.BIN_API_KEY;

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(400).json({ ok: false, error: 'POST requerido' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { bin } = body;

        if (!bin || bin.length < 6) {
            return res.status(400).json({ ok: false, error: 'BIN inválido (mínimo 6 dígitos)' });
        }

        const binOnly = bin.replace(/\D/g, '').substring(0, 6);
        const binUrl = `https://www.laboratorio.lol/api/bins.php?apikey=${BIN_API_KEY}&bin=${binOnly}`;

        return new Promise((resolve) => {
            https.get(binUrl, (apiRes) => {
                let data = '';
                apiRes.on('data', chunk => { data += chunk; });
                apiRes.on('end', () => {
                    try {
                        const binData = JSON.parse(data);
                        if (binData.error) {
                            return resolve(res.status(200).json({ ok: false, error: binData.error }));
                        }

                        const response = {
                            ok: true,
                            bin: binOnly,
                            bankName: binData.bankname || binData.bank || 'Banco desconocido',
                            cardType: binData.type ? binData.type.toLowerCase() : 'credit',
                            franquicia: binData.franquicia || binData.scheme || binData.brand || 'UNKNOWN',
                            country: binData.country || 'Colombia',
                            rawResponse: binData
                        };

                        resolve(res.status(200).json(response));
                    } catch (e) {
                        resolve(res.status(500).json({ ok: false, error: 'Error procesando BIN' }));
                    }
                });
            }).on('error', (error) => {
                resolve(res.status(500).json({ ok: false, error: 'Error consultando BIN API' }));
            });
        });
    } catch (error) {
        return res.status(400).json({ ok: false, error: 'Error: ' + error.message });
    }
};
