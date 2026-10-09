// Obtener TxID y Referencia del localStorage o URL
function obtenerDatosPago() {
    const txid = localStorage.getItem('txid');
    const referencia = localStorage.getItem('referencia');
    return { txid, referencia };
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

        const response = await fetch('/api/track-payment-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                txid,
                referencia,
                pagina,
                ip: 'auto' // El servidor obtiene la IP automáticamente
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
