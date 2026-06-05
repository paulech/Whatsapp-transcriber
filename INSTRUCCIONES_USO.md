# Guía de Instalación y Uso 🎙️🚀
## WhatsApp Web Groq Transcriber (v4.2.0 - Edición Optimizada)

Esta guía te guiará paso a paso para instalar, configurar y utilizar la extensión en tu navegador Google Chrome (o cualquier navegador basado en Chromium como Brave, Edge u Opera).

---

## ⚙️ Métodos de Instalación

### Método 1: Instalación desde Chrome Web Store (Recomendado)
Es la forma más sencilla, automática y segura. No requiere activar el modo desarrollador ni manejar archivos manuales.

1. Ingresa al enlace oficial de la Chrome Web Store:
   👉 **[WhatsApp Web Groq Transcriber en Chrome Web Store](https://chromewebstore.google.com/detail/nadjfcbeppbdlfjdbifeeebhehdfibdp/preview?hl=es-419&authuser=1)**
2. Haz clic en el botón azul **"Añadir a Chrome"** (o *"Add to Chrome"*).
3. Confirma la instalación haciendo clic en **"Añadir extensión"**.

---

### Método 2: Instalación Manual como Desarrollador
Si deseas probar modificaciones locales o instalar la versión de desarrollo directamente desde este repositorio:

1. Descarga el código del repositorio y asegúrate de tener la carpeta `extension` en tu disco local.
2. Abre tu navegador Chrome y ve a la página de extensiones escribiendo en la barra de direcciones:
   ```
   chrome://extensions/
   ```
3. En la esquina superior derecha, activa el interruptor de **"Modo de desarrollador"**.
4. En la esquina superior izquierda, haz clic en el botón **"Cargar descomprimida"** (o *"Load unpacked"*).
5. Selecciona la carpeta `extension` que se encuentra dentro de este repositorio.
6. ¡Listo! La extensión se cargará de forma local.

---

### Método 3: Instalación como Userscript (Tampermonkey)
Si prefieres utilizar un gestor de scripts como Tampermonkey o Violentmonkey:

1. Asegúrate de tener instalada la extensión Tampermonkey en tu navegador.
2. Abre el archivo `whatsapp_groq_transcriber.user.js` de este repositorio.
3. Copia todo su contenido y pégalo en un nuevo script dentro del panel de Tampermonkey, o simplemente abre el archivo directamente en tu navegador con Tampermonkey activo para que te ofrezca instalarlo de forma automática.

---

## 📌 Configuración Inicial

Para poder configurar tus opciones y tu API Key, te recomendamos anclar el icono de la extensión:

1. Haz clic en el icono del rompecabezas (**🧩**) en la barra superior derecha de tu navegador.
2. Busca **WhatsApp Web Groq Transcriber** y haz clic en el icono del **pin / tachuela** para anclarla.
3. Haz clic en el icono del micrófono verde en tu barra de herramientas para abrir el panel de configuración:
   - **API Key**: Pega tu clave de API de Groq (comienza con `gsk_`). *Si no tienes una, lee el Anexo al final de esta guía.*
   - **Modelo**: Selecciona tu modelo de Whisper favorito. Se recomienda `whisper-large-v3-turbo` por su excelente balance entre precisión y velocidad ultra rápida (< 2 segundos).
4. Presiona **"Guardar Cambios"**.

---

## 🎙️ Cómo Usar la Extensión en WhatsApp Web

1. Abre o recarga tu pestaña de **WhatsApp Web** ([https://web.whatsapp.com](https://web.whatsapp.com)).
2. **Consentimiento de Privacidad**: En la primera ejecución, aparecerá una ventana emergente de privacidad en WhatsApp Web. Haz clic en **Aceptar** para activar la extensión (solo aparece una vez).
3. **Transcribir Notas de Voz**:
   - Al lado del botón de reproducir (*Play*) de cada audio, verás un botón verde con un micrófono.
   - Haz clic en él. El estado cambiará a **"Transcribiendo..."**.
   - **Captura Silenciosa (Mute-Lock)**: El audio se silenciará y pausará automáticamente para evitar que suene mientras se captura.
   - En 1 o 2 segundos, se insertará una tarjeta translúcida y moderna debajo del mensaje con la transcripción completa y un botón de **"Copiar"**.
   - Una vez transcrito, el audio queda totalmente liberado para que puedas reproducirlo y escucharlo manualmente cuando lo desees.

---

## 💬 Solución de Problemas y FAQs

**P: Hago clic en el micrófono pero sale un mensaje en rojo "Error de API Key".**
* R: Asegúrate de haber pegado la API Key de Groq completa y de que empiece con `gsk_`. No olvides guardar los cambios en el popup de la extensión.

**P: No me aparecen los botones verdes del micrófono al lado de los audios.**
* R: Refresca la pestaña de WhatsApp Web (F5 o Ctrl+R). Si utilizas la versión de desarrollo manual, asegúrate de que no haya errores en la consola de extensiones.

**P: ¿Aparecen micrófonos verdes en la lista de chats de la barra lateral izquierda?**
* R: No. La extensión cuenta con un filtro estricto que ignora la lista lateral izquierda para evitar inyecciones incorrectas y mantener la interfaz limpia.

**P: ¿La extensión almacena mis audios o conversaciones?**
* R: No. Los audios se procesan localmente en la memoria volátil del navegador y viajan encriptados por HTTPS directamente a la API oficial de Groq. Ningún servidor externo tiene acceso a tu información. Las transcripciones se borran al cerrar la pestaña o tras 8 horas de inactividad (caché inteligente de bajo consumo, < 150 KB de RAM).

---

## 📋 Anexo: Cómo Obtener una API Key de Groq (100% Gratis)

1. Ingresa a la consola oficial de Groq: [https://console.groq.com/](https://console.groq.com/)
2. Regístrate o inicia sesión (puedes usar tu cuenta de Google para agilizar el registro).
3. En el menú lateral izquierdo, haz clic en **"API Keys"**.
4. Presiona el botón verde **"Create API Key"**.
5. Ponle un nombre identificativo (ej: `WhatsApp Transcriber`) y presiona **"Submit"**.
6. **Copia la clave generada de inmediato** (empieza con `gsk_`). Guárdala en un lugar seguro ya que la consola no te la volverá a mostrar completa.
