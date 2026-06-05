# Groq Transcriber for WhatsApp Web (v4.1.0) 🎤🚀🎙️🚀

Esta herramienta te permite transcribir notas de voz directamente en **WhatsApp Web** de forma casi instantánea, utilizando los modelos avanzados de **Whisper** (como `whisper-large-v3-turbo` y `whisper-large-v3`) alojados en la API de **Groq**. 

---

## ✨ Características de la Versión Optimizada

* **Captura 100% Silenciosa (Mute-Lock)**: Olvídate de que los audios se reproduzcan solos al transcribirlos. El script activa un muteo temporal y un retraso de seguridad de 300ms que absorbe la ejecución asíncrona de React, deteniendo la reproducción inmediatamente y restaurando el audio para que puedas escucharlo de forma manual cuando lo desees.
* **Caché Inteligente de Bajo Consumo**: El límite de caché se optimizó a **50 elementos** con un tiempo de vida (TTL) de **8 horas** (perfecto para un día de trabajo) y un recolector de basura que se ejecuta en segundo plano cada 60 segundos. Esto mantiene el consumo de memoria RAM por debajo de los **150 KB** (frente a los ~1 GB de WhatsApp Web).
* **Filtros Estrictos para Barra Lateral**: Se ha implementado un filtro selectivo que ignora la lista lateral de conversaciones, evitando la inyección incorrecta de botones verdes en los chats del panel izquierdo.
* **Captura Reactiva de Lazy Loading**: Intercepta dinámicamente las propiedades de origen del audio hookeando `Element.prototype.setAttribute` y `HTMLMediaElement.prototype.src`, atrapando las URL de tipo `blob:` en el momento exacto en que se cargan sin realizar costosos escaneos globales en todo el DOM.

---

## ⚙️ Guía de Instalación Rápida (Chrome / Chromium)

### Paso 1: Instalación de la Extensión
1. Haz clic en el enlace oficial aprobado de la Chrome Web Store:
   👉 **[WhatsApp Web Groq Transcriber en Chrome Web Store](https://chromewebstore.google.com/detail/nadjfcbeppbdlfjdbifeeebhehdfibdp/preview?hl=es-419&authuser=1)**
2. Presiona el botón azul **"Añadir a Chrome"** (o *"Add to Chrome"*).
3. Confirma la instalación haciendo clic en **"Añadir extensión"**.

### Paso 2: Anclar la Extensión
1. Haz clic en el icono del rompecabezas 🧩 en la barra superior derecha de tu navegador.
2. Busca **WhatsApp Web Groq Transcriber** y haz clic en el pin/tachuela para anclarla.

### Paso 3: Configurar API Key
1. Haz clic en el icono del micrófono verde en tu barra de herramientas.
2. Introduce tu API Key de Groq (si aún no tienes una, consulta el *Anexo Opcional* al final de este documento).
3. Selecciona tu modelo Whisper favorito (se recomienda `whisper-large-v3-turbo`) y presiona **"Guardar Cambios"**.

---

## 🎙️ Cómo Usar la Extensión en WhatsApp Web

1. Abre o recarga tu pestaña de **WhatsApp Web** ([https://web.whatsapp.com](https://web.whatsapp.com)).
2. **Consentimiento de Privacidad**: En la primera ejecución, haz clic en **Aceptar** en la ventana emergente de privacidad (aparece solo una vez).
3. **Transcribir Audios**:
   * Presiona el **micrófono verde** que aparece al lado del botón de Play de cada mensaje de voz.
   * El botón cambiará a **"Transcribiendo..."** de forma silenciosa y sin emitir sonido.
   * En 1 o 2 segundos, se insertará una tarjeta debajo del audio con el texto transcrito y un botón de **"Copiar"**.
   * Una vez completado, el audio queda libre para ser reproducido manualmente cuando desees.

---

## 🔒 Privacidad y Seguridad

* **Sin intermediarios del desarrollador**: Los mensajes de voz se procesan localmente y viajan encriptados por HTTPS directamente a la API oficial de Groq (`https://api.groq.com`). El desarrollador **nunca recibe tus audios ni tus datos**.
* **Caché en memoria**: Las transcripciones se almacenan en caché local temporal y se eliminan automáticamente pasadas las 8 horas o al cerrar la pestaña.
* **API Key segura**: Tu clave de acceso a Groq se almacena localmente en tu navegador (`chrome.storage.local`) de forma ofuscada. Nunca se transmite al desarrollador.
* **Sin telemetría**: No se recopilan datos de navegación, historial, metadatos ni información de contactos. No se usan analytics de ningún tipo.

---

## ⚖️ Aviso Legal / Disclaimer

> **Proyecto independiente de código abierto.**
>
> Esta extensión **no está afiliada, asociada, autorizada, patrocinada ni respaldada** por WhatsApp Inc., Meta Platforms Inc. ni ninguna de sus subsidiarias o filiales.
>
> Los nombres "WhatsApp" y "Meta" son marcas registradas de sus respectivos propietarios. El uso de esta extensión se realiza bajo la exclusiva responsabilidad del usuario y puede estar sujeto a los Términos de Servicio de WhatsApp.
>
> Ver [Política de Privacidad completa](./PRIVACY_POLICY.md).

---

## 📋 Anexo Opcional: Cómo Obtener una API Key de Groq (100% Gratis)

Para realizar las transcripciones utilizando Whisper en la nube, la extensión requiere una clave de API (API Key) provista de forma gratuita por Groq:

1. **Inicia Sesión o Regístrate**:
   * Ingresa a la consola oficial de Groq: [https://console.groq.com/](https://console.groq.com/)
   * Inicia sesión con tu cuenta de Google haciendo clic en **"Continue with Google"** o regístrate con tu correo.
2. **Crea la Clave de API**:
   * En el menú lateral izquierdo, haz clic en **"API Keys"**.
   * Presiona el botón verde **"Create API Key"**.
   * Dale un nombre descriptivo (por ejemplo: `WhatsApp Transcriber`) y haz clic en **"Submit"**.
3. **Copia y Guarda tu Clave**:
   * Copia la clave de inmediato (empieza con `gsk_`). Guárdala en un lugar seguro ya que la consola no te la volverá a mostrar completa por motivos de seguridad.

> [!NOTE]
> **Sobre los límites gratuitos de Groq:**
> El plan gratuito de Groq para Whisper ofrece 20 peticiones por minuto y hasta 8 horas de audio acumuladas al día. Para uso personal, estos límites son sumamente generosos y virtualmente inagotables.
