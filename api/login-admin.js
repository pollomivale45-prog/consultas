require('dotenv').config();
const crypto = require('crypto');

// Tokens de sesión (en memoria - se pierden si Vercel reinicia)
const adminTokens = new Map();

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Tigocash2026';

function generarTokenAdmin() {
    return crypto.randomBytes(32).toString('hex');
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
            const token = generarTokenAdmin();
            adminTokens.set(token, { user: usuario, createdAt: Date.now() });

            // Expirar token después de 30 minutos
            setTimeout(() => adminTokens.delete(token), 30 * 60 * 1000);

            return res.status(200).json({ ok: true, token });
        } else {
            return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
        }
    } catch (error) {
        return res.status(400).json({ ok: false, error: 'Error: ' + error.message });
    }
};

// Exportar función para validar token
module.exports.validarToken = (token) => adminTokens.has(token);
