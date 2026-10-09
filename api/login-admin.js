require('dotenv').config();
const crypto = require('crypto');

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Tigocash2026';
const SECRET_KEY = process.env.JWT_SECRET || 'tigocash-secret-2026-key';

// Generar JWT simple
function generarJWT(usuario) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const payload = Buffer.from(JSON.stringify({
        user: usuario,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (30 * 60)
    })).toString('base64');

    const signature = crypto
        .createHmac('sha256', SECRET_KEY)
        .update(`${header}.${payload}`)
        .digest('base64');

    return `${header}.${payload}.${signature}`;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(400).json({ ok: false, error: 'POST requerido' });

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { usuario, clave } = body;

        if (usuario === ADMIN_USER && clave === ADMIN_PASS) {
            const token = generarJWT(usuario);
            return res.status(200).json({ ok: true, token });
        } else {
            return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
        }
    } catch (error) {
        return res.status(400).json({ ok: false, error: 'Error: ' + error.message });
    }
};

// Exportar función para validar JWT
module.exports.validarToken = (token) => {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return false;

        const [header, payload, signature] = parts;
        const expectedSignature = crypto
            .createHmac('sha256', SECRET_KEY)
            .update(`${header}.${payload}`)
            .digest('base64');

        if (signature !== expectedSignature) return false;

        const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
        if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return false;

        return true;
    } catch (error) {
        return false;
    }
};
