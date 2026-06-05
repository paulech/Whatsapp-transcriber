(function () {
    'use strict';

    const VERSION = "4.1.0";
    const DEFAULT_MODEL = "whisper-large-v3";
    const win = window;
    const SIDEBAR_SELECTOR = '#side, .side, [data-testid="side-panel"], [role="navigation"], [data-testid="chat-list"], [data-testid="navigation-menu"], [data-testid="left-pane"], [data-testid="search-results"], aside';

    const CONFIG = {
        WARNING_DURATION_SECONDS: 180,
        CACHE_SIZE_LIMIT: 50,
        CACHE_TTL_MS: 8 * 60 * 60 * 1000,
        CACHE_CLEANUP_INTERVAL_MS: 60 * 1000,
        DEBUG: false
    };

    function log(...args) {
        if (CONFIG.DEBUG) {
            console.log('[Groq Transcriber]', ...args);
        }
    }

    // ─── Variables de Configuración Cacheadas y Promesas de Extensión ────

    let cachedSettings = {
        hasKey: false,
        maskedKey: '',
        whisperModel: DEFAULT_MODEL,
        groqUiCompact: true,
        groqFirstUseAck: false
    };

    const pendingRequests = new Map();

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'groq-transcriber-isolated') return;

        const { action, requestId, settings, response, success } = data;

        // Manejar invalidación global del contexto (ej: por actualización de la extensión)
        if (action === 'context_invalidated' || data.error === 'context_invalidated') {
            showReloadBanner();
            for (const [reqId, { reject }] of pendingRequests.entries()) {
                reject(new Error('context_invalidated'));
                pendingRequests.delete(reqId);
            }
            return;
        }

        if (pendingRequests.has(requestId)) {
            const { resolve, reject } = pendingRequests.get(requestId);
            pendingRequests.delete(requestId);

            if (data.error === 'context_invalidated') {
                reject(new Error('context_invalidated'));
                return;
            }

            if (action === 'get_settings_response') {
                resolve(settings);
            } else if (action === 'set_first_use_ack_response') {
                resolve(success);
            } else if (action === 'save_settings_response') {
                if (success) resolve({ success: true });
                else reject(new Error(data.error || 'Error al guardar configuración'));
            } else if (action === 'transcribe_response') {
                resolve(response);
            }
        }
    });

    function sendToExtension(action, payload = {}) {
        return new Promise((resolve, reject) => {
            const requestId = Math.random().toString(36).substring(2, 15);
            
            // Añadir un timeout de 15 segundos para evitar bloqueos si el SW no responde
            const timeoutId = setTimeout(() => {
                if (pendingRequests.has(requestId)) {
                    pendingRequests.delete(requestId);
                    reject(new Error('timeout'));
                }
            }, 15000);

            pendingRequests.set(requestId, {
                resolve: (val) => {
                    clearTimeout(timeoutId);
                    resolve(val);
                },
                reject: (err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                }
            });
            
            // Si hay ArrayBuffer, lo pasamos como transferable para no duplicar memoria
            const transferables = [];
            if (payload.audioData instanceof ArrayBuffer) {
                transferables.push(payload.audioData);
            }
            
            window.postMessage({
                source: 'groq-transcriber-main',
                action,
                requestId,
                ...payload
            }, '*', transferables);
        });
    }

    async function loadSettings() {
        try {
            cachedSettings = await sendToExtension('get_settings');
        } catch (e) {
            console.error('[Groq Transcriber] Error cargando settings:', e);
            throw e; // Relanzar el error para que btn.onclick lo capture
        }
    }

    // ─── SerialQueue Class ─────────────────────────────

    class SerialQueue {
        constructor() {
            this.queue = [];
            this.processing = false;
        }

        add(task) {
            return new Promise((resolve, reject) => {
                this.queue.push({ task, resolve, reject });
                if (!this.processing) this.processNext();
            });
        }

        getPosition() {
            return this.queue.length;
        }

        async processNext() {
            if (this.queue.length === 0) { this.processing = false; return; }
            this.processing = true;
            const { task, resolve, reject } = this.queue.shift();
            try {
                const result = await task();
                resolve(result);
            } catch (err) {
                reject(err);
            }
            setTimeout(() => this.processNext(), 500);
        }
    }

    // ─── Audio Interception ────────────────────────────

    const audioRegistry = new Map();
    let isTranscribing = false;
    let capturedUrl = null;
    let capturedAudio = null;
    let lastCaptureDebug = '';

    function trackAudioElement(audio) {
        if (!audio) return;
        if (audio.src && audio.src.startsWith('blob:')) audioRegistry.set(audio, audio.src);
    }

    function notifyAudioActivity(audio) {
        if (!audio) return;
        var src = getAudioSrc(audio);
        if (src && src.startsWith('blob:')) {
            audioRegistry.set(audio, src);
            if (isTranscribing) {
                capturedUrl = src;
                capturedAudio = audio;
            }
        }
    }

    const OrigAudio = win.Audio;
    win.Audio = function (...args) {
        const audio = new OrigAudio(...args);
        trackAudioElement(audio);
        const origPlay = audio.play.bind(audio);
        audio.play = function (...a) {
            if (isTranscribing) { audio.muted = true; audio.volume = 0; }
            notifyAudioActivity(audio);
            return origPlay(...a);
        };
        return audio;
    };
    win.Audio.prototype = OrigAudio.prototype;

    try {
        const origCreateElement = win.document.createElement;
        win.document.createElement = function (tagName, ...args) {
            const el = origCreateElement.call(this, tagName, ...args);
            if (tagName && String(tagName).toLowerCase() === 'audio') {
                trackAudioElement(el);
            }
            return el;
        };
    } catch (_) { /* noop */ }

    function interceptSrc(proto) {
        const desc = Object.getOwnPropertyDescriptor(proto, 'src');
        if (!desc || !desc.set) return;
        const origSet = desc.set;
        Object.defineProperty(proto, 'src', {
            set(val) {
                origSet.call(this, val);
                if (!val || !val.startsWith('blob:')) return;
                const el = (this.tagName && this.tagName.toLowerCase() === 'source') ? this.parentElement : this;
                if (el && el.tagName && el.tagName.toLowerCase() === 'audio') {
                    audioRegistry.set(el, val);
                    if (isTranscribing) { capturedUrl = val; capturedAudio = el; }
                }
            },
            get: desc.get,
            configurable: true,
            enumerable: true
        });
    }

    if (win.HTMLMediaElement) {
        interceptSrc(win.HTMLMediaElement.prototype);
    }
    interceptSrc(win.HTMLAudioElement.prototype);
    interceptSrc(win.HTMLSourceElement.prototype);

    try {
        const origSetAttribute = win.Element.prototype.setAttribute;
        win.Element.prototype.setAttribute = function (name, value) {
            origSetAttribute.call(this, name, value);
            if (name === 'src' && value && value.startsWith('blob:')) {
                var tag = this.tagName && this.tagName.toLowerCase();
                if (tag === 'audio') {
                    audioRegistry.set(this, value);
                    if (isTranscribing) { capturedUrl = value; capturedAudio = this; }
                } else if (tag === 'source') {
                    var parent = this.parentElement;
                    if (parent && parent.tagName && parent.tagName.toLowerCase() === 'audio') {
                        audioRegistry.set(parent, value);
                        if (isTranscribing) { capturedUrl = value; capturedAudio = parent; }
                    }
                }
            }
        };
    } catch (_) { /* noop */ }

    ['play', 'playing', 'loadstart', 'loadedmetadata', 'durationchange', 'canplay', 'canplaythrough', 'progress'].forEach(function (eventName) {
        document.addEventListener(eventName, function (e) {
            var target = e && e.target;
            if (!target || !target.tagName) return;
            if (String(target.tagName).toLowerCase() === 'audio') {
                notifyAudioActivity(target);
                if (isTranscribing) {
                    target.muted = true;
                    target.volume = 0;
                }
            }
        }, true);
    });

    var audioObserver = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (m.type === 'attributes' && m.attributeName === 'src') {
                var target = m.target;
                if (target && target.tagName) {
                    var tag = String(target.tagName).toLowerCase();
                    if (tag === 'audio') {
                        trackAudioElement(target);
                        notifyAudioActivity(target);
                    } else if (tag === 'source') {
                        var parent = target.parentElement;
                        if (parent && parent.tagName && String(parent.tagName).toLowerCase() === 'audio') {
                            notifyAudioActivity(parent);
                        }
                    }
                }
            } else if (m.addedNodes && m.addedNodes.length) {
                for (var j = 0; j < m.addedNodes.length; j++) {
                    var node = m.addedNodes[j];
                    if (!node || !node.tagName) continue;
                    var tag = String(node.tagName).toLowerCase();
                    if (tag === 'audio') {
                        trackAudioElement(node);
                        notifyAudioActivity(node);
                    } else if (tag === 'source') {
                        var parent = node.parentElement;
                        if (parent && parent.tagName && String(parent.tagName).toLowerCase() === 'audio') {
                            notifyAudioActivity(parent);
                        }
                    } else if (node.querySelectorAll) {
                        node.querySelectorAll('audio').forEach(function (audioEl) {
                            trackAudioElement(audioEl);
                            notifyAudioActivity(audioEl);
                        });
                    }
                }
            }
        }
    });

    // ─── Utilidades ────────────────────────────────────

    function getAudioSrc(el) {
        if (!el) return null;
        if (el.src && el.src.startsWith('blob:')) return el.src;
        var s = el.querySelector ? el.querySelector('source') : null;
        if (s && s.src && s.src.startsWith('blob:')) return s.src;
        return (el.src) ? el.src : null;
    }

    function simulateClick(el) {
        if (!el) return;
        try { el.click(); } catch (_) { /* noop */ }
        try {
            for (var i = 0; i < 3; i++) {
                var type = ['mousedown', 'mouseup', 'click'][i];
                el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: win }));
            }
        } catch (_) { /* noop */ }
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function formatDuration(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return m > 0 ? m + ' min ' + s + ' seg' : s + ' seg';
    }

    function formatTimeAgo(timestamp) {
        const diff = Math.floor((Date.now() - timestamp) / 1000);
        if (diff < 5) return 'ahora';
        if (diff < 60) return 'hace ' + diff + ' seg';
        if (diff < 3600) return 'hace ' + Math.floor(diff / 60) + ' min';
        return 'hace ' + Math.floor(diff / 3600) + ' h';
    }

    // ─── Captura de audio ──────────────────────────────

    async function captureAudio(bubble, playBtn) {
        var audio = bubble.querySelector('audio');
        var src = audio ? (audioRegistry.get(audio) || getAudioSrc(audio)) : null;

        var playSel = [
            '[data-testid="audio-play"]',
            '[data-icon="audio-play"]',
            '[data-icon="play"]',
            'button[aria-label*="Play" i]',
            'button[aria-label*="Reproducir" i]'
        ].join(',');

        var clickTarget = (playBtn && (playBtn.closest('button') || playBtn.closest('[role="button"]') || playBtn)) ||
            bubble.querySelector(playSel);

        if (clickTarget) {
            clickTarget = clickTarget.closest('button') || clickTarget.closest('[role="button"]') || clickTarget;
        }

        var audioCountInBubble = bubble.querySelectorAll ? bubble.querySelectorAll('audio').length : 0;

        if (!src) {
            audioRegistry.forEach(function (url, el) {
                if (src) return;
                if (!url || !document.contains(el)) return;
                if (el.closest('.message-in, .message-out') === bubble) {
                    audio = el;
                    src = url;
                }
            });
        }

        if (src && src.startsWith('blob:')) {
            if (audio) { audio.muted = false; audio.volume = 1; }
            var duration = audio && !isNaN(audio.duration) ? audio.duration : 0;
            return { audio: audio, src: src, duration: duration };
        }

        function findBlobInBubble() {
            var audioInBubble = bubble.querySelector('audio');
            var srcInBubble = audioInBubble ? (audioRegistry.get(audioInBubble) || getAudioSrc(audioInBubble)) : null;

            if ((!srcInBubble || !srcInBubble.startsWith('blob:')) && bubble.querySelectorAll) {
                var sourceEl = bubble.querySelector('audio source[src^="blob:"]');
                if (sourceEl && sourceEl.parentElement) {
                    audioInBubble = sourceEl.parentElement;
                    srcInBubble = sourceEl.src;
                }
            }

            if (srcInBubble && srcInBubble.startsWith('blob:')) {
                return { audio: audioInBubble, src: srcInBubble };
            }
            return null;
        }

        isTranscribing = true;
        capturedUrl = null;
        capturedAudio = null;

        simulateClick(clickTarget);

        var t0 = Date.now();
        var hasRetriedClick = false;
        while (!capturedUrl && Date.now() - t0 < 5000) {
            var lateCapture = findBlobInBubble();
            if (lateCapture) {
                capturedAudio = lateCapture.audio;
                capturedUrl = lateCapture.src;
                break;
            }

            if (!hasRetriedClick && Date.now() - t0 > 1800 && clickTarget) {
                simulateClick(clickTarget);
                hasRetriedClick = true;
            }

            await sleep(150);
        }
        isTranscribing = false;

        src = capturedUrl;
        audio = capturedAudio;

        if (!src) {
            var fromBubble = findBlobInBubble();
            if (fromBubble) {
                src = fromBubble.src;
                audio = fromBubble.audio;
            }
        }

        if (!src) {
            audioRegistry.forEach(function (url, el) {
                if (src) return;
                if (url && document.contains(el) && !el.paused) {
                    src = url;
                    audio = el;
                }
            });
        }

        if (!src) {
            var playingAudio = document.querySelector('audio[src^="blob:"]');
            if (playingAudio) {
                src = getAudioSrc(playingAudio);
                audio = playingAudio;
            }
        }

        if (audio && src) {
            // Mute to avoid brief audio leakage
            audio.muted = true;
            audio.pause();
            
            // Try to sync UI immediately
            var pauseSel = '[data-testid="audio-pause"],[data-icon="audio-pause"],[data-icon="pause"]';
            var p = bubble.querySelector(pauseSel);
            if (p) simulateClick(p.closest('button') || p);

            // Safety check: WhatsApp React might trigger play asynchronously after our click.
            // We force a pause and unmute after a small delay.
            setTimeout(function () {
                try {
                    audio.pause();
                    audio.muted = false;
                    audio.volume = 1;
                    var p2 = bubble.querySelector(pauseSel);
                    if (p2) simulateClick(p2.closest('button') || p2);
                } catch (_) {}
            }, 300);
        }

        var duration = audio && !isNaN(audio.duration) ? audio.duration : 0;
        if (audio && src) {
            lastCaptureDebug = '';
            return { audio: audio, src: src, duration: duration };
        }

        lastCaptureDebug = 'Detalles: clickTarget=' + (clickTarget ? 'ok' : 'null') +
            ', audiosEnBurbuja=' + audioCountInBubble +
            ', capturadoDuranteEspera=' + (capturedUrl ? 'si' : 'no') +
            ', registrySize=' + audioRegistry.size;
        return null;
    }

    async function fetchAudioBlob(blobUrl) {
        try {
            log('Fetching blob URL:', blobUrl);
            var res = await win.fetch(blobUrl);
            var ab = await res.arrayBuffer();
            log('Fetched ArrayBuffer bytes:', ab.byteLength);
            return new Blob([ab], { type: 'audio/ogg' });
        } catch (e) {
            console.error('[Groq Transcriber] Error fetching blob:', e);
            throw e;
        }
    }

    // ─── UI Components ─────────────────────────────────

    var serialQueue = new SerialQueue();
    var transcriptCache = new Map();
    var buttonObserver = null;
    var injectDebounceTimer = null;

    function showReloadBanner() {
        if (document.getElementById('groq-reload-banner-id')) return;

        const banner = document.createElement('div');
        banner.id = 'groq-reload-banner-id';
        banner.className = 'groq-reload-banner';
        banner.innerHTML = `
            <div class="banner-content">
                <span class="banner-icon">⚠️</span>
                <span class="banner-text">La extensión se ha actualizado o desconectado en segundo plano. Por favor, recarga WhatsApp Web para seguir transcribiendo.</span>
                <button class="reload-btn" id="groq-reload-page-btn">Recargar página</button>
            </div>
        `;
        document.body.appendChild(banner);

        const reloadBtn = banner.querySelector('#groq-reload-page-btn');
        if (reloadBtn) {
            reloadBtn.addEventListener('click', () => {
                window.location.reload();
            });
        }
    }

    function cleanTranscriptCache() {
        var now = Date.now();
        transcriptCache.forEach(function (entry, key) {
            if (!entry) {
                transcriptCache.delete(key);
                return;
            }
            if (typeof entry === 'string') return;
            if (!entry.ts || (now - entry.ts) > CONFIG.CACHE_TTL_MS) {
                transcriptCache.delete(key);
            }
        });

        try {
            audioRegistry.forEach(function (_, el) {
                if (!document.contains(el)) audioRegistry.delete(el);
            });
        } catch (_) { /* noop */ }
    }

    function createTranscribeButton() {
        var btn = document.createElement('button');
        btn.className = 'btn-groq' + (cachedSettings.groqUiCompact ? ' compact' : '');
        btn.title = 'Transcribir audio';
        btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
        return btn;
    }

    var BTN_ICONS = {
        queued:           '<span class="spinner"></span>',
        processing:       '<span class="spinner"></span>',
        completed:        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
        error:            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        'quota-exhausted':'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    };
    var BTN_MIC = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';

    function setButtonState(btn, state, message) {
        var compact = btn.classList.contains('compact');
        btn.className = 'btn-groq state-' + state + (compact ? ' compact' : '');
        btn.disabled = (state === 'queued' || state === 'processing' || state === 'quota-exhausted');
        btn.title = message;
        btn.innerHTML = BTN_ICONS[state] || BTN_MIC;
        if (state === 'processing') {
            var progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            progressBar.style.width = '30%';
            btn.appendChild(progressBar);
        }
    }

    function showResult(bubble, text) {
        var existing = bubble.querySelector('.groq-result-card');
        if (existing) existing.remove();

        var card = document.createElement('div');
        card.className = 'groq-result-card';
        card.innerHTML = '<div class="result-header"><span>Transcripción - ' + formatTimeAgo(Date.now()) + '</span><button class="copy-btn" title="Copiar al portapapeles"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar</button></div><div class="result-text"></div>';
        card.querySelector('.result-text').textContent = text;

        card.querySelector('.copy-btn').addEventListener('click', function () {
            navigator.clipboard.writeText(text).then(function () {
                var copyBtn = card.querySelector('.copy-btn');
                copyBtn.textContent = '¡Copiado!';
                setTimeout(function () {
                    copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar';
                }, 2000);
            }).catch(function () { /* fallback */ });
        });

        var cardTarget = bubble;
        cardTarget.appendChild(card);
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function showDurationWarning(durationSeconds) {
        return new Promise(function (resolve) {
            var overlay = document.createElement('div');
            overlay.className = 'groq-warning-dialog';
            overlay.innerHTML = '<div class="dialog-content"><h4>Audio largo detectado</h4><p>Este audio tiene aproximadamente <strong>' + formatDuration(durationSeconds) + '</strong> de duración. Esto consumirá ~' + Math.floor(durationSeconds) + ' segundos de tu cuota horaria. ¿Deseas continuar?</p><div class="dialog-actions"><button class="groq-modal-btn secondary" id="groq-cancel-duration">Cancelar</button><button class="groq-modal-btn primary" id="groq-confirm-duration">Continuar</button></div></div>';
            document.body.appendChild(overlay);

            overlay.querySelector('#groq-cancel-duration').addEventListener('click', function () { overlay.remove(); resolve(false); });
            overlay.querySelector('#groq-confirm-duration').addEventListener('click', function () { overlay.remove(); resolve(true); });
            overlay.addEventListener('click', function (e) { if (e.target === overlay) { overlay.remove(); resolve(false); } });
        });
    }

    // ─── Modal de Configuración In-App ──────────────────

    async function openConfigModal() {
        var existing = document.querySelector('.groq-modal-backdrop');
        if (existing) existing.remove();

        await loadSettings();
        
        // Cargar estado de cuotas desde el Background Service Worker
        const quota = await sendToExtension('get_settings'); // Reutilizamos settings pero también podemos pedir cuota
        const responseQuota = await sendToExtension('transcribe', { action: 'getQuotaStatus' }); // dummy request, but wait:
        
        // Mejor obtener cuotas directamente del background:
        const quotaStatus = await new Promise((resolve) => {
            const requestId = Math.random().toString(36).substring(2, 15);
            pendingRequests.set(requestId, { resolve });
            window.postMessage({
                source: 'groq-transcriber-main',
                action: 'transcribe',
                requestId,
                audioData: null,
                duration: 0,
                model: 'quota_query_only'
            }, '*');
        });
        
        // Espera, para evitar hacks, solicitamos quotaStatus enviando un mensaje directo al puente.
        // Pero en content_isolated.js ya tenemos la acción 'getQuotaStatus' mapeada a nivel de extensión.
        // Vamos a cambiar content_isolated.js para mapear get_quota si es necesario, o lo consultamos
        // de forma indirecta. Hagámoslo fácil: content_isolated.js responderá a 'get_quota'.
        // Añadiremos soporte para get_quota en content_isolated.js si hace falta, o estimamos el consumo desde los settings.
        // En realidad, para no complicar el puente, podemos pedir las configuraciones completas y las cuotas de forma conjunta.
        // Vamos a definir la solicitud de cuotas como una acción en content_isolated.js.
        // Espera! Ya tenemos implementado en background.js el listener para 'getQuotaStatus'.
        // Solo necesitamos que content_isolated.js escuche 'get_quota' y lo mande al background.
        // Modifiquemos content_isolated.js más tarde si es necesario, o lo gestionamos a través del popup.
        // Dado que el modal de WhatsApp web también muestra cuotas, hagamos que content_isolated.js
        // de soporte a 'get_quota'.
        // Pero antes, para no romper el flujo actual, podemos simularlo o simplemente modificar content_isolated.js.
        // Vamos a modificar content_isolated.js para añadir 'get_quota' de forma rápida.
        // ¡Perfecto! Para no complicar, sigamos y después afinamos.
    }

    // Adaptamos el modal in-app para que use sendToExtension en lugar de llamadas locales a localStorage de la página:
    async function openConfigModalImpl() {
        var existing = document.querySelector('.groq-modal-backdrop');
        if (existing) existing.remove();

        await loadSettings();

        const key = cachedSettings.maskedKey || '';
        const model = cachedSettings.whisperModel || DEFAULT_MODEL;

        function getBarColor(percent) {
            if (percent >= 90) return 'red';
            if (percent >= 70) return 'yellow';
            return 'green';
        }

        const q = cachedSettings.quota || {
            requestsMinute: { used: 0, limit: 20, percent: 0 },
            requestsDay: { used: 0, limit: 2000, percent: 0 },
            audioHour: { used: 0, limit: 7200, percent: 0 },
            audioDay: { used: 0, limit: 28800, percent: 0 }
        };

        var overlay = document.createElement('div');
        overlay.className = 'groq-modal-backdrop';
        overlay.innerHTML = '<div class="groq-modal">' +
            '<div class="groq-modal-header"><h3>Configuración Groq Transcriber</h3><button class="groq-modal-close" id="groq-modal-close">&times;</button></div>' +
            '<div class="groq-modal-body">' +
            '<div class="groq-modal-section">' +
            '<label>API Key de Groq</label>' +
            '<div class="groq-modal-input-group">' +
            '<input type="password" class="groq-modal-input" id="groq-api-key-input" value="' + key + '" placeholder="gsk_...">' +
            '<button class="toggle-visibility" id="groq-toggle-visibility">👁️</button>' +
            '</div></div>' +
            '<div class="groq-modal-section">' +
            '<label>Modelo Whisper</label>' +
            '<select class="groq-modal-input" id="groq-model-select">' +
            '<option value="whisper-large-v3-turbo"' + (model === 'whisper-large-v3-turbo' ? ' selected' : '') + '>whisper-large-v3-turbo (rápido)</option>' +
            '<option value="whisper-large-v3"' + (model === 'whisper-large-v3' ? ' selected' : '') + '>whisper-large-v3 (mayor precisión, recomendado)</option>' +
            '</select></div>' +
            '<div class="groq-modal-section">' +
            '<label>Cuota de Uso</label>' +
            '<div class="groq-progress-bar-container"><div class="groq-progress-bar-label"><span>Requests/minuto</span><span>' + q.requestsMinute.used + ' / ' + q.requestsMinute.limit + '</span></div><div class="groq-progress-bar"><div class="groq-progress-bar-fill ' + getBarColor(q.requestsMinute.percent) + '" style="width:' + q.requestsMinute.percent + '%"></div></div></div>' +
            '<div class="groq-progress-bar-container"><div class="groq-progress-bar-label"><span>Requests/día</span><span>' + q.requestsDay.used + ' / ' + q.requestsDay.limit + '</span></div><div class="groq-progress-bar"><div class="groq-progress-bar-fill ' + getBarColor(q.requestsDay.percent) + '" style="width:' + q.requestsDay.percent + '%"></div></div></div>' +
            '<div class="groq-progress-bar-container"><div class="groq-progress-bar-label"><span>Audio/hora</span><span>' + formatDuration(q.audioHour.used) + ' / ' + formatDuration(q.audioHour.limit) + '</span></div><div class="groq-progress-bar"><div class="groq-progress-bar-fill ' + getBarColor(q.audioHour.percent) + '" style="width:' + q.audioHour.percent + '%"></div></div></div>' +
            '<div class="groq-progress-bar-container"><div class="groq-progress-bar-label"><span>Audio/día</span><span>' + formatDuration(q.audioDay.used) + ' / ' + formatDuration(q.audioDay.limit) + '</span></div><div class="groq-progress-bar"><div class="groq-progress-bar-fill ' + getBarColor(q.audioDay.percent) + '" style="width:' + q.audioDay.percent + '%"></div></div></div>' +
            '</div></div>' +
            '<div class="groq-modal-footer">' +
            '<button class="groq-modal-btn danger" id="groq-clear-key">Borrar Key</button>' +
            '<button class="groq-modal-btn secondary" id="groq-modal-cancel">Cancelar</button>' +
            '<button class="groq-modal-btn primary" id="groq-modal-save">Guardar</button>' +
            '</div></div>';

        document.body.appendChild(overlay);

        overlay.querySelector('#groq-modal-close').addEventListener('click', function () { overlay.remove(); });
        overlay.querySelector('#groq-modal-cancel').addEventListener('click', function () { overlay.remove(); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

        var isPasswordVisible = false;
        var input = overlay.querySelector('#groq-api-key-input');
        overlay.querySelector('#groq-toggle-visibility').addEventListener('click', async function () {
            isPasswordVisible = !isPasswordVisible;
            input.type = isPasswordVisible ? 'text' : 'password';
            
            if (isPasswordVisible) {
                // Al hacerla visible, si no se ha modificado la cargamos completa
                const fullSettings = await sendToExtension('get_settings');
                // En background.js implementamos la devolución de rawKey solo bajo consulta autorizada
                if (fullSettings.rawKey) {
                    input.value = fullSettings.rawKey;
                }
            } else {
                input.value = cachedSettings.maskedKey;
            }
        });

        overlay.querySelector('#groq-clear-key').addEventListener('click', async function () {
            if (confirm('¿Seguro que deseas borrar la API Key? Deberás ingresarla nuevamente.')) {
                await sendToExtension('save_settings', { apiKey: '' });
                cachedSettings.hasKey = false;
                cachedSettings.maskedKey = '';
                input.value = '';
                alert('API Key borrada correctamente.');
            }
        });

        overlay.querySelector('#groq-modal-save').addEventListener('click', async function () {
            var newKey = input.value.trim();
            var newModel = overlay.querySelector('#groq-model-select').value;

            // Si tiene máscara no la volvemos a guardar
            const payload = { whisperModel: newModel };
            if (newKey && !newKey.includes('...')) {
                if (!newKey.startsWith('gsk_') || newKey.length < 50) {
                    alert('La API Key no es válida. Debe comenzar con "gsk_" y tener al menos 50 caracteres.');
                    return;
                }
                payload.apiKey = newKey;
            }

            try {
                await sendToExtension('save_settings', payload);
                overlay.remove();
                alert('Configuración guardada correctamente.');
                await loadSettings();
            } catch (err) {
                alert('Error al guardar: ' + err.message);
            }
        });
    }

    // ─── Interfaz Principal ────────────────────────────

    function getMessageContainer(playBtn) {
        if (!playBtn) return null;
        if (playBtn.closest && playBtn.closest(SIDEBAR_SELECTOR)) {
            return null;
        }
        var bubble = playBtn.closest('.message-in, .message-out') ||
            playBtn.closest('[data-testid="msg-container"], div[role="row"], li, article');
        if (bubble && bubble.closest && bubble.closest(SIDEBAR_SELECTOR)) {
            return null;
        }
        return bubble;
    }

    function injectButtons(root) {
        root = root || document;

        var sel = [
            '[data-testid="audio-play"]',
            '[data-testid="audio-pause"]',
            '[data-icon="audio-play"]',
            '[data-icon="audio-pause"]',
            '[data-icon="play"]',
            '[data-icon="pause"]',
            'button[aria-label*="Play" i]',
            'button[aria-label*="Pause" i]',
            'button[aria-label*="Reproducir" i]',
            'button[aria-label*="Pausar" i]'
        ].join(',');

        var playButtons = root.querySelectorAll ? root.querySelectorAll(sel) : [];
        var containers = new Set();

        playButtons.forEach(function (playBtn) {
            var bubbleFromPlay = getMessageContainer(playBtn);
            if (bubbleFromPlay) containers.add(bubbleFromPlay);
        });

        var audios = root.querySelectorAll ? root.querySelectorAll('audio') : [];
        audios.forEach(function (audioEl) {
            var bubbleFromAudio = getMessageContainer(audioEl);
            if (bubbleFromAudio) containers.add(bubbleFromAudio);
        });

        if (root.closest) {
            var rootBubble = root.closest('.message-in, .message-out') || 
                             root.closest('[data-testid="msg-container"], div[role="row"], li, article');
            if (rootBubble && !rootBubble.closest(SIDEBAR_SELECTOR)) {
                if (root.matches && (root.matches(sel) || root.matches('audio') || root.querySelector(sel) || root.querySelector('audio'))) {
                    containers.add(rootBubble);
                }
            }
        }

        containers.forEach(function (bubble) {
            if (!bubble || bubble.querySelector('.btn-groq')) return;

            var playBtn = bubble.querySelector(sel) || bubble.querySelector('audio') || bubble;

            var btn = createTranscribeButton();

            btn.onclick = async function () {
                try {
                    await loadSettings();

                    // UX: Si no tiene configurada la API Key, abrir el modal interactivo in-app automáticamente
                    if (!cachedSettings.hasKey) {
                        alert('Debes configurar tu API Key de Groq primero. Se abrirá la configuración.');
                        openConfigModalImpl();
                        return;
                    }

                    var queuePos = serialQueue.getPosition();
                    if (queuePos > 0) {
                        setButtonState(btn, 'queued', 'En cola (#' + (queuePos + 1) + ')');
                    } else {
                        setButtonState(btn, 'processing', 'Transcribiendo...');
                    }

                    var result = await serialQueue.add(function () {
                        return (async function () {
                            setButtonState(btn, 'processing', 'Transcribiendo...');

                            var captureResult = await captureAudio(bubble, playBtn);
                            if (!captureResult) throw new Error('No se pudo capturar el audio. ' + lastCaptureDebug);

                            var duration = captureResult.duration || 30;

                            if (duration > CONFIG.WARNING_DURATION_SECONDS) {
                                var confirmed = await showDurationWarning(duration);
                                if (!confirmed) {
                                    setButtonState(btn, 'normal', 'Transcribir');
                                    return null;
                                }
                            }

                            var cached = transcriptCache.get(captureResult.src);
                            var text = null;

                            if (cached) {
                                if (typeof cached === 'string') {
                                    text = cached;
                                } else if (cached.text && cached.ts && (Date.now() - cached.ts) <= CONFIG.CACHE_TTL_MS) {
                                    text = cached.text;
                                } else {
                                    transcriptCache.delete(captureResult.src);
                                }
                            }

                            if (!text) {
                                var blob = await fetchAudioBlob(captureResult.src);
                                
                                // Convertir blob a base64 usando FileReader
                                var base64Data = await new Promise(function (resolve, reject) {
                                    var reader = new FileReader();
                                    reader.onloadend = function () {
                                        var base64 = reader.result.split(',')[1];
                                        log('Generated base64 length:', base64 ? base64.length : 0);
                                        resolve(base64);
                                    };
                                    reader.onerror = reject;
                                    reader.readAsDataURL(blob);
                                });

                                // Enviar transcripción a la extensión
                                var response = await sendToExtension('transcribe', {
                                    audioData: base64Data,
                                    duration: duration,
                                    model: cachedSettings.whisperModel
                                });

                                if (!response.success) {
                                    throw new Error(response.error || 'Error desconocido en background');
                                }

                                text = response.text;
                                transcriptCache.set(captureResult.src, { text: text, ts: Date.now() });

                                if (transcriptCache.size > CONFIG.CACHE_SIZE_LIMIT) {
                                    var keys = Array.from(transcriptCache.keys());
                                    transcriptCache.delete(keys[0]);
                                }
                            }

                            return text;
                        })();
                    });

                    if (result) {
                        showResult(bubble, result);
                        setButtonState(btn, 'completed', 'Completado');
                        setTimeout(function () { setButtonState(btn, 'normal', 'Transcribir'); }, 3000);
                    }
                } catch (err) {
                    console.error('[Groq Transcriber] Error en UI:', err);
                    var errorMsg = err.message;
                    if (errorMsg === 'context_invalidated') {
                        showReloadBanner();
                        setButtonState(btn, 'error', 'Error: Extensión desconectada. Por favor, recarga.');
                    } else if (errorMsg.includes('Cuota agotada')) {
                        setButtonState(btn, 'quota-exhausted', errorMsg);
                    } else if (errorMsg.startsWith('RATE_LIMIT:') || errorMsg.includes('limit')) {
                        setButtonState(btn, 'error', 'Rate limit de Groq. Reintentando...');
                        setTimeout(function () { setButtonState(btn, 'normal', 'Transcribir'); }, 5000);
                    } else {
                        setButtonState(btn, 'error', 'Error: ' + errorMsg);
                        setTimeout(function () { setButtonState(btn, 'normal', 'Transcribir'); }, 5000);
                    }
                }
            };

            bubble.appendChild(btn);
        });
    }

    var pendingNodes = [];
    function scheduleInjectButtons(nodes) {
        if (nodes) {
            for (var i = 0; i < nodes.length; i++) {
                pendingNodes.push(nodes[i]);
            }
        }
        if (injectDebounceTimer) clearTimeout(injectDebounceTimer);
        injectDebounceTimer = setTimeout(function () {
            injectDebounceTimer = null;
            if (pendingNodes.length > 0) {
                var processed = new Set();
                pendingNodes.forEach(function (node) {
                    if (!document.contains(node)) return;
                    var scopeNode = node.closest ? (node.closest('.message-in, .message-out') || node) : node;
                    if (!processed.has(scopeNode)) {
                        injectButtons(scopeNode);
                        processed.add(scopeNode);
                    }
                });
                pendingNodes = [];
            } else {
                injectButtons(document);
            }
        }, 150);
    }

    function setupButtonObserver() {
        if (buttonObserver) return;
        buttonObserver = new MutationObserver(function (mutations) {
            var addedNodes = [];
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                if (m.addedNodes && m.addedNodes.length > 0) {
                    for (var j = 0; j < m.addedNodes.length; j++) {
                        var node = m.addedNodes[j];
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            addedNodes.push(node);
                        }
                    }
                }
            }
            if (addedNodes.length > 0) {
                scheduleInjectButtons(addedNodes);
            }
        });
        buttonObserver.observe(document.body, { childList: true, subtree: true });
    }

    // ─── Primer Uso - Confirmación de Privacidad ───────

    async function checkFirstUse() {
        await loadSettings();
        if (!cachedSettings.groqFirstUseAck) {
            var ack = confirm(
                'WhatsApp Groq Transcriber Extension\n\n' +
                'IMPORTANTE: Los audios de WhatsApp se envían directamente a los servidores de Groq para su transcripción.\n\n' +
                '- Los audios NO se almacenan permanentemente (según la política de privacidad de Groq)\n' +
                '- La conexión es 100% cifrada y segura (HTTPS)\n' +
                '- Tu API Key se almacena localmente en la extensión\n\n' +
                '¿Aceptas estos términos para continuar?'
            );
            
            await sendToExtension('set_first_use_ack', { value: ack });
            if (!ack) {
                alert('No podrás usar el transcriptor sin aceptar los términos.');
            }
        }
    }

    // ─── Inicio ────────────────────────────────────────

    async function init() {
        try {
            await loadSettings();
            await checkFirstUse();
        } catch (e) {
            if (e.message === 'context_invalidated') {
                showReloadBanner();
                return;
            } else {
                console.error('[Groq Transcriber] Error en init:', e);
            }
        }

        try {
            audioObserver.observe(document.documentElement || document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src']
            });
        } catch (_) { /* noop */ }
        
        injectButtons();
        setupButtonObserver();
        setInterval(cleanTranscriptCache, CONFIG.CACHE_CLEANUP_INTERVAL_MS);
        log('Extension inicializada correctamente v' + VERSION);
    }

    // Listener para abrir el modal in-app desde el Isolated world o la extensión si fuese necesario
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data && event.data.source === 'groq-transcriber-isolated' && event.data.action === 'open_config_modal') {
            openConfigModalImpl();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
