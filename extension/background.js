const DEFAULT_MODEL = "whisper-large-v3";
const API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

const CONFIG = {
    LIMITS: {
        requestsPerMinute: 20,
        requestsPerDay: 2000,
        audioSecondsPerHour: 7200,
        audioSecondsPerDay: 28800
    },
    MAX_BACKOFF_RETRIES: 3,
    BACKOFF_BASE_MS: 3000,
    DEBUG: false
};

function log(...args) {
    if (CONFIG.DEBUG) {
        console.log('[Groq Background]', ...args);
    }
}

// ─── RateLimiter Class ─────────────────────────────

class RateLimiter {
    constructor() {
        this.requestsThisMinute = 0;
        this.requestsToday = 0;
        this.audioSecondsThisHour = 0;
        this.audioSecondsToday = 0;
        this.minuteResetTime = Date.now() + 60000;
        this.hourResetTime = Date.now() + 3600000;
        this.dayResetTime = Date.now() + 86400000;
        this.loaded = this._loadPersistedState();
    }

    async _loadPersistedState() {
        const result = await chrome.storage.local.get('groq_rate_state');
        const saved = result.groq_rate_state;
        if (saved) {
            try {
                const state = JSON.parse(saved);
                const now = Date.now();
                if (state.minuteResetTime > now) {
                    this.requestsThisMinute = state.requestsThisMinute || 0;
                    this.minuteResetTime = state.minuteResetTime;
                }
                if (state.hourResetTime > now) {
                    this.audioSecondsThisHour = state.audioSecondsThisHour || 0;
                    this.hourResetTime = state.hourResetTime;
                }
                if (state.dayResetTime > now) {
                    this.requestsToday = state.requestsToday || 0;
                    this.audioSecondsToday = state.audioSecondsToday || 0;
                    this.dayResetTime = state.dayResetTime;
                }
            } catch (_) { /* ignore */ }
        }
    }

    async _persistState() {
        await chrome.storage.local.set({
            groq_rate_state: JSON.stringify({
                requestsThisMinute: this.requestsThisMinute,
                requestsToday: this.requestsToday,
                audioSecondsThisHour: this.audioSecondsThisHour,
                audioSecondsToday: this.audioSecondsToday,
                minuteResetTime: this.minuteResetTime,
                hourResetTime: this.hourResetTime,
                dayResetTime: this.dayResetTime
            })
        });
    }

    resetIfNeeded() {
        const now = Date.now();
        let changed = false;
        if (now >= this.minuteResetTime) {
            this.requestsThisMinute = 0;
            this.minuteResetTime = now + 60000;
            changed = true;
        }
        if (now >= this.hourResetTime) {
            this.audioSecondsThisHour = 0;
            this.hourResetTime = now + 3600000;
            changed = true;
        }
        if (now >= this.dayResetTime) {
            this.requestsToday = 0;
            this.audioSecondsToday = 0;
            this.dayResetTime = now + 86400000;
            changed = true;
        }
        if (changed) this._persistState();
    }

    async canSend(audioDurationSeconds) {
        await this.loaded;
        this.resetIfNeeded();
        const limits = CONFIG.LIMITS;
        if (this.requestsThisMinute >= limits.requestsPerMinute) {
            return { allowed: false, reason: 'Límite de peticiones por minuto alcanzado', retryIn: this.minuteResetTime - Date.now() };
        }
        if (this.requestsToday >= limits.requestsPerDay) {
            return { allowed: false, reason: 'Límite diario de peticiones alcanzado', retryIn: this.dayResetTime - Date.now() };
        }
        if (this.audioSecondsThisHour + audioDurationSeconds > limits.audioSecondsPerHour) {
            return { allowed: false, reason: 'Límite de segundos de audio por hora alcanzado', retryIn: this.hourResetTime - Date.now() };
        }
        if (this.audioSecondsToday + audioDurationSeconds > limits.audioSecondsPerDay) {
            return { allowed: false, reason: 'Límite diario de segundos de audio alcanzado', retryIn: this.dayResetTime - Date.now() };
        }
        return { allowed: true };
    }

    async recordRequest(audioDurationSeconds) {
        await this.loaded;
        this.requestsThisMinute++;
        this.requestsToday++;
        this.audioSecondsThisHour += audioDurationSeconds;
        this.audioSecondsToday += audioDurationSeconds;
        await this._persistState();
    }

    async getQuotaStatus() {
        await this.loaded;
        this.resetIfNeeded();
        const limits = CONFIG.LIMITS;
        return {
            requestsMinute: { used: this.requestsThisMinute, limit: limits.requestsPerMinute, percent: Math.min(100, (this.requestsThisMinute / limits.requestsPerMinute) * 100) },
            requestsDay: { used: this.requestsToday, limit: limits.requestsPerDay, percent: Math.min(100, (this.requestsToday / limits.requestsPerDay) * 100) },
            audioHour: { used: this.audioSecondsThisHour, limit: limits.audioSecondsPerHour, percent: Math.min(100, (this.audioSecondsThisHour / limits.audioSecondsPerHour) * 100) },
            audioDay: { used: this.audioSecondsToday, limit: limits.audioSecondsPerDay, percent: Math.min(100, (this.audioSecondsToday / limits.audioSecondsPerDay) * 100) }
        };
    }

    async getOverallHealth() {
        const status = await this.getQuotaStatus();
        const maxPercent = Math.max(status.requestsMinute.percent, status.requestsDay.percent, status.audioHour.percent, status.audioDay.percent);
        if (maxPercent >= 90) return 'error';
        if (maxPercent >= 70) return 'warning';
        return 'ok';
    }
}

// ─── APIKeyManager Class ───────────────────────────

class APIKeyManager {
    constructor() {
        this.OBFUSCATION_KEY = 'GroqTranscriber2026';
        this.STORAGE_KEY = 'groq_api_key_enc';
    }

    _xor(str, key) {
        let result = '';
        for (let i = 0; i < str.length; i++) {
            result += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    }

    obfuscate(key) {
        return btoa(this._xor(key, this.OBFUSCATION_KEY));
    }

    deobfuscate(encoded) {
        try {
            return this._xor(atob(encoded), this.OBFUSCATION_KEY);
        } catch (_) { return null; }
    }

    async load() {
        const result = await chrome.storage.local.get(this.STORAGE_KEY);
        const encoded = result[this.STORAGE_KEY];
        if (!encoded) return null;
        return this.deobfuscate(encoded);
    }

    async save(key) {
        if (!this.validate(key)) return false;
        await chrome.storage.local.set({ [this.STORAGE_KEY]: this.obfuscate(key) });
        return true;
    }

    async clear() {
        await chrome.storage.local.remove(this.STORAGE_KEY);
    }

    validate(key) {
        return typeof key === 'string' && key.startsWith('gsk_') && key.length >= 50;
    }

    mask(key) {
        if (!key || key.length < 10) return '***';
        return key.substring(0, 8) + '...' + key.substring(key.length - 4);
    }
}

const rateLimiter = new RateLimiter();
const apiKeyManager = new APIKeyManager();

// ─── Helper Functions ──────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function base64ToBlob(base64Str, mimeType = 'audio/ogg') {
    const byteCharacters = atob(base64Str);
    const byteArrays = [];
    const sliceSize = 512;
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        const slice = byteCharacters.slice(offset, offset + sliceSize);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: mimeType });
}

// ─── Groq API Request ──────────────────────────────

async function transcribeWithGroq(audioData, durationSeconds, whisperModel) {
    const apiKey = await apiKeyManager.load();
    if (!apiKey) throw new Error('API Key de Groq no configurada en la extensión');

    let blob;
    if (typeof audioData === 'string') {
        log('Recibido audioData de tipo string (base64), largo:', audioData.length);
        blob = base64ToBlob(audioData, 'audio/ogg');
    } else {
        log('Recibido audioData no-string:', typeof audioData, audioData);
        blob = new Blob([audioData], { type: 'audio/ogg' });
    }
    log('Blob decodificado listo. Tamaño:', blob.size, 'bytes');

    const fd = new FormData();
    fd.append('file', blob, 'audio.ogg');
    fd.append('model', whisperModel || DEFAULT_MODEL);
    fd.append('language', 'es');
    fd.append('response_format', 'json');

    const headers = {
        'Authorization': 'Bearer ' + apiKey
    };

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: headers,
        body: fd
    });

    if (response.status === 200) {
        const data = await response.json();
        if (data && data.text !== undefined) {
            await rateLimiter.recordRequest(durationSeconds);
            return data.text.trim();
        } else {
            throw new Error('Respuesta inesperada de Groq API');
        }
    } else if (response.status === 429) {
        let retryAfter = 3000;
        try {
            const retryHeader = response.headers.get('retry-after');
            if (retryHeader) retryAfter = parseInt(retryHeader) * 1000;
        } catch (_) {}
        throw new Error('RATE_LIMIT:' + retryAfter + ':Groq limitó las peticiones. Reintentando...');
    } else {
        let msg = 'HTTP ' + response.status;
        try {
            const errData = await response.json();
            if (errData && errData.error && errData.error.message) msg = errData.error.message;
        } catch (_) {}
        throw new Error('Groq: ' + msg);
    }
}

async function transcribeWithRetry(audioData, durationSeconds, whisperModel) {
    const maxRetries = CONFIG.MAX_BACKOFF_RETRIES;
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await transcribeWithGroq(audioData, durationSeconds, whisperModel);
        } catch (err) {
            lastError = err;
            if (err.message.startsWith('RATE_LIMIT:')) {
                const parts = err.message.split(':');
                const retryMs = parseInt(parts[1]) || (CONFIG.BACKOFF_BASE_MS * Math.pow(2, attempt));
                if (attempt < maxRetries) {
                    await sleep(retryMs);
                    continue;
                }
            } else if (attempt < maxRetries) {
                await sleep(CONFIG.BACKOFF_BASE_MS * Math.pow(2, attempt));
                continue;
            }
        }
    }
    throw lastError || new Error('Error después de varios intentos');
}

// ─── Messaging Listener ────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'transcribe') {
        const { audioData, duration, model } = request;
        
        (async () => {
            try {
                // Chequear cuota antes de iniciar
                const quotaCheck = await rateLimiter.canSend(duration);
                if (!quotaCheck.allowed) {
                    const retryInMin = Math.ceil(quotaCheck.retryIn / 60000);
                    sendResponse({
                        success: false,
                        errorType: 'quota',
                        error: `Cuota agotada. ${quotaCheck.reason}. Reintentar en ~${retryInMin} min.`
                    });
                    return;
                }

                const text = await transcribeWithRetry(audioData, duration, model);
                sendResponse({ success: true, text: text });
            } catch (err) {
                console.error('[Groq Background] Error transcribiendo:', err);
                sendResponse({
                    success: false,
                    error: err.message,
                    errorType: err.message.startsWith('RATE_LIMIT:') ? 'rate_limit' : 'general'
                });
            }
        })();
        
        return true; // Mantener canal abierto para respuesta asíncrona
    }

    if (request.action === 'getQuotaStatus') {
        rateLimiter.getQuotaStatus().then(status => {
            sendResponse(status);
        });
        return true;
    }

    if (request.action === 'getOverallHealth') {
        rateLimiter.getOverallHealth().then(health => {
            sendResponse({ health });
        });
        return true;
    }

    if (request.action === 'saveSettings') {
        const { apiKey, whisperModel, groqUiCompact } = request;
        (async () => {
            try {
                if (apiKey !== undefined) {
                    if (apiKey === '') {
                        await apiKeyManager.clear();
                    } else if (apiKeyManager.validate(apiKey)) {
                        await apiKeyManager.save(apiKey);
                    } else {
                        sendResponse({ success: false, error: 'API Key inválida' });
                        return;
                    }
                }
                if (whisperModel !== undefined) {
                    await chrome.storage.local.set({ whisper_model: whisperModel });
                }
                if (groqUiCompact !== undefined) {
                    await chrome.storage.local.set({ groq_ui_compact: groqUiCompact });
                }
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (request.action === 'getSettings') {
        (async () => {
            const rawKey = await apiKeyManager.load();
            const result = await chrome.storage.local.get(['whisper_model', 'groq_ui_compact', 'groq_first_use_ack']);
            const quota = await rateLimiter.getQuotaStatus();
            
            // SEGURIDAD: No exponer la clave sin enmascarar a scripts de contenido
            const isContentScript = sender && sender.tab;
            
            sendResponse({
                hasKey: typeof rawKey === 'string' && rawKey.length > 0,
                maskedKey: rawKey ? apiKeyManager.mask(rawKey) : '',
                rawKey: isContentScript ? '' : (rawKey || ''), // Solo popup.js lo leerá de forma segura
                whisperModel: result.whisper_model || DEFAULT_MODEL,
                groqUiCompact: result.groq_ui_compact !== false,
                groqFirstUseAck: result.groq_first_use_ack === true,
                quota: quota
            });
        })();
        return true;
    }

    if (request.action === 'clearApiKey') {
        apiKeyManager.clear().then(() => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === 'setFirstUseAck') {
        chrome.storage.local.set({ groq_first_use_ack: request.value }).then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
});
