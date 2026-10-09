# Cambios realizados en TIGO - Sistema de Pagos

## Archivos modificados

### 1. pago-tarjeta.html
- Cambié color de botones y elementos de #5b6fd7 a #001eb4
- Card-box: fondo blanco
- Fieldset-custom: fondo blanco
- Títulos (page-title, card-title, card-icon): color #001eb4
- Botón CONTINUAR: color #001eb4
- Quité estilos de hover/focus que ocultaban bordes
- Modal de confirmación de cancelación con botones "NO" y "SÍ"
- Modal de términos y condiciones con X flotante y botón ENTENDIDO flotante

### 2. pago-informacion-bancaria.html
- Cambié color de botones y elementos de #5b6fd7 a #001eb4
- Card-box: fondo blanco
- Fieldset-custom: fondo blanco
- Títulos (page-title, card-title, section-title): color #001eb4
- Botón CONTINUAR: color #001eb4
- Quité estilos de hover/focus que ocultaban bordes
- Modal de confirmación de cancelación con botones "NO" y "SÍ"
- Modal de términos y condiciones con X flotante y botón ENTENDIDO flotante

### 3. pago-llave.html
- Cambié color de botones de #5b6fd7 a #001eb4
- Botones CANCELAR y CONTINUAR inicialmente escondidos
- Se muestran cuando se presiona "He realizado el pago" y se verifica
- Botón "REINTENTAR" esconde los botones nuevamente y reinicia el timer
- Timer de 10 minutos que se reinicia

### 4. pago-nequi.html
- Botón "REINTENTAR" en lugar de "CANCELAR"
- Limpia el input cuando se presiona REINTENTAR
- Requiere exactamente 10 dígitos (minlength y maxlength)
- Input tipo tel con inputmode numeric

### 5. pago-inicio.html
- Cambié "Bancolombia" a "Llave Bre-B" con logo bre-b.svg
- Todos los métodos de pago son clickeables y llevan a sus páginas correspondientes
- Nequi → pago-nequi.html
- Llave Bre-B → pago-llave.html
- PSE/Tarjeta débito → pago-informacion-bancaria.html
- Tarjeta crédito/débito → pago-tarjeta.html

### 6. pago-confirmacion.html
- Nueva página de confirmación de pago
- Mensaje: "¡Su pago está en proceso!"
- Warning icon desde warning.svg
- Botón "CERRAR SESIÓN" que regresa a index.html

### 7. listado.html
- Muestra lista de facturas
- Cardholder icon sin borde
- Badge con fondo #ebf0fb
- Información de factura con monto y fecha

## Cambios de color principales
- Cambio de #5b6fd7 a #001eb4 en botones y elementos principales
- Mantener fondos blancos en formularios
- Mantener colores de texto en gris (#666) en labels y ayuda
- Títulos en azul #001eb4

## Funcionalidades especiales

### pago-tarjeta.html
- Detección automática de tarjeta AMEX (34/37)
- Formato automático: AMEX = 4-6-5 dígitos, otros = 4-4-4-4
- Backspace inteligente en espacios
- CVV: 3-4 dígitos (AMEX = exactamente 4)
- Cambio automático de texto "Búscala al reverso" → "Búscala en el frente" para AMEX

### pago-llave.html
- QR visible con instrucciones
- Llave copiable @BE2020253
- Timer con cuenta regresiva
- Botón flotante "He realizado el pago"
- Spinner de verificación
- Botones aparecen después de verificación

### Modales globales
- Confirmación de cancelación con botones "NO" y "SÍ" separados
- Términos y condiciones con X flotante en esquina
- Botón "ENTENDIDO" flotante en base del modal
- Botón continuar/reintentar deshabilitado hasta verificación

## Colores utilizados
- Azul principal: #001eb4
- Azul secundario: #44c8f5
- Gris: #666, #999, #ccc
- Fondo: blanco (#ffffff), gris claro (#f5f5f5, #ebf0fb)
- Bordes: #9ca3af, #f0f0f0
