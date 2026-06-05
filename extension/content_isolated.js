// Verificar si el contexto de la extensión es válido
function isContextValid() {
    return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
}

// Enviar mensajes al background worker con reintentos para soportar despertado del Service Worker
function sendMessageWithRetry(message, maxRetries = 3, delayMs = 1000) {
    return new Promise((resolve, reject) => {
        let attempt = 0;

        function execute() {
            attempt++;
            if (!isContextValid()) {
                reject(new Error('context_invalidated'));
                return;
            }

            try {
                chrome.runtime.sendMessage(message, (response) => {
                    const err = chrome.runtime.lastError;
                    if (err) {
                        console.warn(`[Groq Isolated] Intento ${attempt} falló:`, err.message);
                        if (err.message.includes('context invalidated') || err.message.includes('inválido')) {
                            reject(new Error('context_invalidated'));
                        } else if (attempt < maxRetries) {
                            setTimeout(execute, delayMs);
                        } else {
                            reject(new Error(err.message));
                        }
                        return;
                    }
                    resolve(response);
                });
            } catch (e) {
                console.warn(`[Groq Isolated] Excepción en intento ${attempt}:`, e.message);
                if (e.message.includes('context invalidated') || e.message.includes('inválido')) {
                    reject(new Error('context_invalidated'));
                } else if (attempt < maxRetries) {
                    setTimeout(execute, delayMs);
                } else {
                    reject(e);
                }
            }
        }

        execute();
    });
}

// Escuchar mensajes provenientes de content_main.js (Mundo Principal/MAIN)
window.addEventListener('message', async (event) => {
    // Seguridad: verificar que el mensaje viene de nuestra propia ventana
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== 'groq-transcriber-main') return;

    const { action, requestId } = data;

    if (!isContextValid()) {
        window.postMessage({
            source: 'groq-transcriber-isolated',
            action: 'context_invalidated_error',
            requestId,
            error: 'context_invalidated'
        }, '*');
        return;
    }

    try {
        if (action === 'get_settings') {
            try {
                const settings = await sendMessageWithRetry({ action: 'getSettings' });
                window.postMessage({
                    source: 'groq-transcriber-isolated',
                    action: 'get_settings_response',
                    requestId,
                    settings: settings || {
                        hasKey: false,
                        maskedKey: '',
                        rawKey: '',
                        whisperModel: 'whisper-large-v3',
                        groqUiCompact: true,
                        groqFirstUseAck: false
                    }
                }, '*');
            } catch (err) {
                if (err.message === 'context_invalidated') throw err;
                // Fallback por defecto si es otro error de comunicación
                window.postMessage({
                    source: 'groq-transcriber-isolated',
                    action: 'get_settings_response',
                    requestId,
                    settings: {
                        hasKey: false,
                        maskedKey: '',
                        rawKey: '',
                        whisperModel: 'whisper-large-v3',
                        groqUiCompact: true,
                        groqFirstUseAck: false
                    }
                }, '*');
            }
        }

        if (action === 'set_first_use_ack') {
            const response = await sendMessageWithRetry({ action: 'setFirstUseAck', value: data.value });
            window.postMessage({
                source: 'groq-transcriber-isolated',
                action: 'set_first_use_ack_response',
                requestId,
                success: response && response.success
            }, '*');
        }

        if (action === 'save_settings') {
            const { apiKey, whisperModel, groqUiCompact } = data;
            const response = await sendMessageWithRetry({
                action: 'saveSettings',
                apiKey,
                whisperModel,
                groqUiCompact
            });
            window.postMessage({
                source: 'groq-transcriber-isolated',
                action: 'save_settings_response',
                requestId,
                success: response && response.success,
                error: response ? response.error : 'Error desconocido'
            }, '*');
        }

        if (action === 'transcribe') {
            const { audioData, duration, model } = data;
            const response = await sendMessageWithRetry({
                action: 'transcribe',
                audioData,
                duration,
                model
            });
            window.postMessage({
                source: 'groq-transcriber-isolated',
                action: 'transcribe_response',
                requestId,
                response: response || { success: false, error: 'No se obtuvo respuesta del Service Worker de la extensión' }
            }, '*');
        }
    } catch (err) {
        if (err.message === 'context_invalidated') {
            window.postMessage({
                source: 'groq-transcriber-isolated',
                action: 'context_invalidated_error',
                requestId,
                error: 'context_invalidated'
            }, '*');
        } else {
            console.error('[Groq Isolated] Error procesando acción:', action, err);
        }
    }
});

// Monitorear de forma proactiva si la extensión se invalida (por actualización en segundo plano)
const contextCheckInterval = setInterval(() => {
    if (!isContextValid()) {
        clearInterval(contextCheckInterval);
        console.warn('[Groq Isolated] Contexto de extensión invalidado detectado.');
        window.postMessage({
            source: 'groq-transcriber-isolated',
            action: 'context_invalidated'
        }, '*');
    }
}, 10000);
