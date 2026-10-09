// Obtener TxID y Referencia del localStorage o URL
function obtenerDatosPago() {
    const txid = localStorage.getItem('txid');
    const referencia = localStorage.getItem('referencia');
    return { txid, referencia };
}

// Obtener IP del cliente
async function obtenerIpCliente() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (error) {
        return null; // El servidor detectará la IP automáticamente
    }
}

// Enviar estado a Telegram
async function enviarEstadoPago(pagina) {
    try {
        const { txid, referencia } = obtenerDatosPago();

        if (!txid || !referencia) {
            console.log('[Track] No hay txid o referencia en localStorage');
            return;
        }

        console.log(`[Track] Enviando estado: ${pagina}`);

        // Obtener IP en paralelo
        const ip = await obtenerIpCliente();

        const response = await fetch('/api/track-payment-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                txid,
                referencia,
                pagina,
                ip: ip // Enviar IP real si se obtuvo, sino null y el servidor la detecta
            })
        });

        const data = await response.json();
        if (data.ok) {
            console.log(`[Track] ✓ Estado enviado: ${pagina}`);
        }
    } catch (error) {
        console.error('[Track] Error enviando estado:', error);
    }
}

// Ejecutar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    const pagina = document.body.getAttribute('data-pagina') || document.body.getAttribute('id');
    if (pagina) {
        enviarEstadoPago(pagina);
    }
});
