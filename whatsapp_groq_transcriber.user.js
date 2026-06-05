// ==UserScript==
// @name         WhatsApp Groq Transcriber v4
// @namespace    http://tampermonkey.net/
// @version      4.2.0
// @description  Transcribir audios de WhatsApp Web con Groq Whisper API. UI moderna 2026, rate limiter, cola serial.
// @author       Antigravity
// @match        https://web.whatsapp.com/*
// @icon         https://www.google.com/s2/favicons?domain=whatsapp.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.groq.com
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = "4.2.0";
    const API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
    const DEFAULT_MODEL = "whisper-large-v3";
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const SIDEBAR_SELECTOR = '#side, .side, [data-testid="side-panel"], [role="navigation"], [data-testid="chat-list"], [data-testid="navigation-menu"], [data-testid="left-pane"], [data-testid="search-results"], aside';

    const CONFIG = {
        LIMITS: {
            // Groq free tier (May 2026)
            requestsPerMinute: 20,
            requestsPerDay: 2000,
            audioSecondsPerHour: 7200,
            audioSecondsPerDay: 28800
        },
        WARNING_DURATION_SECONDS: 180,
        MAX_BACKOFF_RETRIES: 3,
        BACKOFF_BASE_MS: 3000,
        CACHE_SIZE_LIMIT: 50,
        CACHE_TTL_MS: 8 * 60 * 60 * 1000,
        CACHE_CLEANUP_INTERVAL_MS: 60 * 1000,
        BUTTON_SCAN_INTERVAL_MS: 3000
    };

    // ─── CSS Styles (Glassmorphism 2026) ───────────────

    function injectStyles() {
        if (document.getElementById('groq-transcriber-styles')) return;
        const style = document.createElement('style');
        style.id = 'groq-transcriber-styles';
        style.textContent = `
            .btn-groq {
                background: linear-gradient(135deg, rgba(0,168,132,0.92), rgba(0,143,114,0.92));
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                color: #fff;
                border: 1px solid rgba(255,255,255,0.15);
                padding: 0;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                cursor: pointer;
                margin: 6px 0 2px 0;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: inherit;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 2px 8px rgba(0,168,132,0.25);
                position: relative;
                overflow: hidden;
            }
            .btn-groq.compact {
                width: 24px;
                height: 24px;
                margin: 4px 0 2px 0;
            }
            .btn-groq:hover:not(:disabled) {
                transform: scale(1.03);
                box-shadow: 0 3px 12px rgba(0,168,132,0.34);
                background: linear-gradient(135deg, rgba(0,188,152,0.95), rgba(0,163,132,0.95));
            }
            .btn-groq:active:not(:disabled) {
                transform: scale(0.98);
            }
            .btn-groq:disabled {
                cursor: not-allowed;
                opacity: 0.85;
            }
            .btn-groq .btn-icon {
                display: inline-flex;
                animation: groq-pulse 2s ease-in-out infinite;
            }
            .btn-groq .spinner {
                width: 14px;
                height: 14px;
                border: 2px solid rgba(255,255,255,0.3);
                border-top-color: #fff;
                border-radius: 50%;
                animation: groq-spin 0.8s linear infinite;
            }
            .btn-groq .progress-bar {
                position: absolute;
                bottom: 0;
                left: 0;
                height: 3px;
                background: rgba(255,255,255,0.8);
                border-radius: 0 0 24px 24px;
                transition: width 0.3s ease;
            }
            .btn-groq.state-queued {
                background: linear-gradient(135deg, rgba(100,120,140,0.9), rgba(80,100,120,0.9));
                box-shadow: 0 2px 8px rgba(100,120,140,0.25);
            }
            .btn-groq.state-processing {
                background: linear-gradient(135deg, rgba(230,160,50,0.9), rgba(210,140,30,0.9));
                box-shadow: 0 2px 8px rgba(230,160,50,0.3);
            }
            .btn-groq.state-completed {
                background: linear-gradient(135deg, rgba(0,168,132,0.95), rgba(0,143,114,0.95));
                box-shadow: 0 2px 8px rgba(0,168,132,0.3);
            }
            .btn-groq.state-error {
                background: linear-gradient(135deg, rgba(220,53,69,0.9), rgba(200,33,49,0.9));
                box-shadow: 0 2px 8px rgba(220,53,69,0.3);
                animation: groq-shake 0.4s ease-in-out;
            }
            .btn-groq.state-quota-exhausted {
                background: linear-gradient(135deg, rgba(220,53,69,0.8), rgba(180,33,49,0.8));
                box-shadow: 0 2px 8px rgba(220,53,69,0.2);
            }
            .btn-groq .quota-badge {
                font-size: 9px;
                opacity: 0.75;
                margin-top: 2px;
                text-align: center;
                width: 100%;
                display: block;
            }
            .groq-result-card {
                background: rgba(240,242,245,0.95);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                padding: 12px 14px;
                border-radius: 12px;
                margin-top: 8px;
                color: #111b21;
                font-size: 14px;
                white-space: pre-wrap;
                border-left: 4px solid #00a884;
                box-shadow: 0 1px 4px rgba(0,0,0,0.08);
                animation: groq-fade-slide 0.3s ease-out;
                position: relative;
                max-width: min(420px, 100%);
                width: fit-content;
                min-width: 160px;
                align-self: flex-start;
            }
            .groq-result-card .result-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
                padding-bottom: 6px;
                border-bottom: 1px solid rgba(0,0,0,0.06);
            }
            .groq-result-card .result-header span {
                font-size: 11px;
                color: #667781;
                font-weight: 500;
            }
            .groq-result-card .copy-btn {
                background: none;
                border: none;
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 8px;
                font-size: 11px;
                color: #667781;
                transition: all 0.15s ease;
            }
            .groq-result-card .copy-btn:hover {
                background: rgba(0,168,132,0.1);
                color: #00a884;
            }
            .groq-result-card .result-text {
                line-height: 1.6;
            }
            .message-out .groq-result-card,
            .message-out .btn-groq {
                margin-left: auto;
            }
            /* Alinear el botón y la tarjeta de transcripción como hermanos del mensaje */
            .message-out ~ .btn-groq,
            .message-out ~ .groq-result-card {
                margin-left: auto;
                align-self: flex-end !important;
            }
            .message-in ~ .btn-groq,
            .message-in ~ .groq-result-card {
                margin-left: 0;
                align-self: flex-start !important;
            }
            .groq-modal-backdrop {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: groq-fade-in 0.2s ease;
            }
            .groq-modal {
                background: #fff;
                border-radius: 16px;
                max-width: 480px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
                box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                animation: groq-slide-up 0.3s ease;
            }
            .groq-modal-header {
                padding: 20px 24px 16px;
                border-bottom: 1px solid #e9edef;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .groq-modal-header h3 {
                margin: 0;
                font-size: 18px;
                color: #111b21;
                font-weight: 600;
            }
            .groq-modal-close {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #667781;
                padding: 4px 8px;
                border-radius: 8px;
                transition: all 0.15s ease;
            }
            .groq-modal-close:hover {
                background: #f0f2f5;
                color: #111b21;
            }
            .groq-modal-body {
                padding: 20px 24px;
            }
            .groq-modal-section {
                margin-bottom: 20px;
            }
            .groq-modal-section label {
                display: block;
                font-size: 13px;
                font-weight: 600;
                color: #111b21;
                margin-bottom: 8px;
            }
            .groq-modal-input {
                width: 100%;
                padding: 10px 12px;
                border: 1px solid #e9edef;
                border-radius: 8px;
                font-size: 14px;
                font-family: inherit;
                transition: border-color 0.15s ease;
                box-sizing: border-box;
            }
            .groq-modal-input:focus {
                outline: none;
                border-color: #00a884;
                box-shadow: 0 0 0 3px rgba(0,168,132,0.1);
            }
            .groq-modal-input-group {
                position: relative;
            }
            .groq-modal-input-group .toggle-visibility {
                position: absolute;
                right: 10px;
                top: 50%;
                transform: translateY(-50%);
                background: none;
                border: none;
                cursor: pointer;
                font-size: 16px;
                color: #667781;
                padding: 4px;
            }
            .groq-modal-input-group .toggle-visibility:hover {
                color: #00a884;
            }
            .groq-progress-bar-container {
                margin-bottom: 12px;
            }
            .groq-progress-bar-label {
                display: flex;
                justify-content: space-between;
                font-size: 12px;
                color: #667781;
                margin-bottom: 4px;
            }
            .groq-progress-bar {
                height: 8px;
                background: #e9edef;
                border-radius: 4px;
                overflow: hidden;
            }
            .groq-progress-bar-fill {
                height: 100%;
                border-radius: 4px;
                transition: width 0.3s ease, background-color 0.3s ease;
            }
            .groq-progress-bar-fill.green { background: #00a884; }
            .groq-progress-bar-fill.yellow { background: #f59e0b; }
            .groq-progress-bar-fill.red { background: #ef4444; }
            .groq-modal-footer {
                padding: 16px 24px;
                border-top: 1px solid #e9edef;
                display: flex;
                justify-content: flex-end;
                gap: 12px;
            }
            .groq-modal-btn {
                padding: 8px 20px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.15s ease;
                border: 1px solid transparent;
            }
            .groq-modal-btn.primary {
                background: #00a884;
                color: #fff;
            }
            .groq-modal-btn.primary:hover {
                background: #008f72;
            }
            .groq-modal-btn.secondary {
                background: #f0f2f5;
                color: #111b21;
                border-color: #e9edef;
            }
            .groq-modal-btn.secondary:hover {
                background: #e9edef;
            }
            .groq-modal-btn.danger {
                background: #ef4444;
                color: #fff;
            }
            .groq-modal-btn.danger:hover {
                background: #dc2626;
            }
            .groq-floating-indicator {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: linear-gradient(135deg, rgba(0,168,132,0.9), rgba(0,143,114,0.9));
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                color: #fff;
                padding: 8px 14px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                z-index: 700;
                box-shadow: 0 2px 12px rgba(0,168,132,0.3);
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .groq-floating-indicator:hover {
                transform: scale(1.05);
                box-shadow: 0 4px 16px rgba(0,168,132,0.4);
            }
            .groq-floating-indicator.warning {
                background: linear-gradient(135deg, rgba(245,158,11,0.9), rgba(225,138,11,0.9));
                box-shadow: 0 2px 12px rgba(245,158,11,0.3);
            }
            .groq-floating-indicator.error {
                background: linear-gradient(135deg, rgba(239,68,68,0.9), rgba(220,38,38,0.9));
                box-shadow: 0 2px 12px rgba(239,68,68,0.3);
            }
            .groq-floating-indicator .tooltip {
                position: absolute;
                bottom: 100%;
                right: 0;
                margin-bottom: 8px;
                background: #fff;
                color: #111b21;
                padding: 12px 16px;
                border-radius: 12px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.15);
                font-size: 11px;
                font-weight: 400;
                white-space: nowrap;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.2s ease;
            }
            .groq-floating-indicator:hover .tooltip {
                opacity: 1;
            }
            .groq-warning-dialog {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: groq-fade-in 0.2s ease;
            }
            .groq-warning-dialog .dialog-content {
                background: #fff;
                border-radius: 16px;
                max-width: 400px;
                width: 90%;
                padding: 24px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                animation: groq-slide-up 0.3s ease;
            }
            .groq-warning-dialog .dialog-content h4 {
                margin: 0 0 12px;
                font-size: 16px;
                color: #111b21;
            }
            .groq-warning-dialog .dialog-content p {
                margin: 0 0 20px;
                font-size: 14px;
                color: #667781;
                line-height: 1.5;
            }
            .groq-warning-dialog .dialog-actions {
                display: flex;
                justify-content: flex-end;
                gap: 12px;
            }

            @keyframes groq-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
            }
            @keyframes groq-spin {
                to { transform: rotate(360deg); }
            }
            @keyframes groq-shake {
                0%, 100% { transform: translateX(0); }
                20% { transform: translateX(-4px); }
                40% { transform: translateX(4px); }
                60% { transform: translateX(-4px); }
                80% { transform: translateX(4px); }
            }
            @keyframes groq-fade-slide {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes groq-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes groq-slide-up {
                from { opacity: 0; transform: translateY(16px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
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
            this._loadPersistedState();
        }

        _loadPersistedState() {
            try {
                const saved = GM_getValue('groq_rate_state', null);
                if (saved) {
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
                }
            } catch (_) { /* ignore */ }
        }

        _persistState() {
            try {
                GM_setValue('groq_rate_state', JSON.stringify({
                    requestsThisMinute: this.requestsThisMinute,
                    requestsToday: this.requestsToday,
                    audioSecondsThisHour: this.audioSecondsThisHour,
                    audioSecondsToday: this.audioSecondsToday,
                    minuteResetTime: this.minuteResetTime,
                    hourResetTime: this.hourResetTime,
                    dayResetTime: this.dayResetTime
                }));
            } catch (_) { /* ignore */ }
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

        canSend(audioDurationSeconds) {
            this.resetIfNeeded();
            const limits = CONFIG.LIMITS;
            if (this.requestsThisMinute >= limits.requestsPerMinute) return { allowed: false, reason: 'Limite de requests por minuto alcanzado', retryIn: this.minuteResetTime - Date.now() };
            if (this.requestsToday >= limits.requestsPerDay) return { allowed: false, reason: 'Limite diario de requests alcanzado', retryIn: this.dayResetTime - Date.now() };
            if (this.audioSecondsThisHour + audioDurationSeconds > limits.audioSecondsPerHour) return { allowed: false, reason: 'Limite de segundos de audio por hora alcanzado', retryIn: this.hourResetTime - Date.now() };
            if (this.audioSecondsToday + audioDurationSeconds > limits.audioSecondsPerDay) return { allowed: false, reason: 'Limite diario de segundos de audio alcanzado', retryIn: this.dayResetTime - Date.now() };
            return { allowed: true };
        }

        recordRequest(audioDurationSeconds) {
            this.requestsThisMinute++;
            this.requestsToday++;
            this.audioSecondsThisHour += audioDurationSeconds;
            this.audioSecondsToday += audioDurationSeconds;
            this._persistState();
        }

        getQuotaStatus() {
            this.resetIfNeeded();
            const limits = CONFIG.LIMITS;
            return {
                requestsMinute: { used: this.requestsThisMinute, limit: limits.requestsPerMinute, percent: Math.min(100, (this.requestsThisMinute / limits.requestsPerMinute) * 100) },
                requestsDay: { used: this.requestsToday, limit: limits.requestsPerDay, percent: Math.min(100, (this.requestsToday / limits.requestsPerDay) * 100) },
                audioHour: { used: this.audioSecondsThisHour, limit: limits.audioSecondsPerHour, percent: Math.min(100, (this.audioSecondsThisHour / limits.audioSecondsPerHour) * 100) },
                audioDay: { used: this.audioSecondsToday, limit: limits.audioSecondsPerDay, percent: Math.min(100, (this.audioSecondsToday / limits.audioSecondsPerDay) * 100) }
            };
        }

        getOverallHealth() {
            const status = this.getQuotaStatus();
            const maxPercent = Math.max(status.requestsMinute.percent, status.requestsDay.percent, status.audioHour.percent, status.audioDay.percent);
            if (maxPercent >= 90) return 'error';
            if (maxPercent >= 70) return 'warning';
            return 'ok';
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

        save(key) {
            if (!this.validate(key)) return false;
            GM_setValue(this.STORAGE_KEY, this.obfuscate(key));
            return true;
        }

        load() {
            const encoded = GM_getValue(this.STORAGE_KEY, null);
            if (!encoded) return null;
            return this.deobfuscate(encoded);
        }

        clear() {
            GM_setValue(this.STORAGE_KEY, null);
        }

        validate(key) {
            return typeof key === 'string' && key.startsWith('gsk_') && key.length >= 50;
        }

        mask(key) {
            if (!key || key.length < 10) return '***';
            return key.substring(0, 8) + '...' + key.substring(key.length - 4);
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

    // ─── Fetch + Groq API ─────────────────────────────

    async function fetchAudioBlob(blobUrl) {
        var res = await win.fetch(blobUrl);
        var ab = await res.arrayBuffer();
        return new Blob([ab], { type: 'audio/ogg' });
    }

    function transcribeWithGroq(blob, audioDuration) {
        var apiKey = apiKeyManager.load();
        if (!apiKey) return Promise.reject(new Error('API Key de Groq no configurada'));
        if (!apiKeyManager.validate(apiKey)) return Promise.reject(new Error('API Key invalida. Reconfigurala desde el menu.'));

        var fd = new FormData();
        fd.append('file', blob, 'audio.ogg');
        fd.append('model', GM_getValue('whisper_model', DEFAULT_MODEL));
        fd.append('language', 'es');
        fd.append('response_format', 'json');

        return new Promise(function (resolve, reject) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: API_URL,
                headers: { 'Authorization': 'Bearer ' + apiKey },
                data: fd,
                responseType: 'json',
                timeout: 60000,
                onload: function (r) {
                    if (r.status === 200) {
                        var d = (typeof r.response === 'string') ? JSON.parse(r.response) : r.response;
                        if (d && d.text !== undefined) {
                            rateLimiter.recordRequest(audioDuration);
                            resolve(d.text.trim());
                        } else {
                            reject(new Error('Respuesta inesperada de Groq API'));
                        }
                    } else if (r.status === 429) {
                        var retryAfter = 3000;
                        try {
                            var retryHeader = r.responseHeaders ? r.responseHeaders.match(/retry-after:\s*(\d+)/i) : null;
                            if (retryHeader) retryAfter = parseInt(retryHeader[1]) * 1000;
                        } catch (_) { /* usar default */ }
                        reject(new Error('RATE_LIMIT:' + retryAfter + ':Groq limito las requests. Reintentando...'));
                    } else {
                        var msg = 'HTTP ' + r.status;
                        try {
                            var errData = (typeof r.response === 'string') ? JSON.parse(r.response) : r.response;
                            if (errData && errData.error && errData.error.message) msg = errData.error.message;
                        } catch (_) { /* usar msg por defecto */ }
                        reject(new Error('Groq: ' + msg));
                    }
                },
                onerror: function () { reject(new Error('Error de conexion con Groq API')); },
                ontimeout: function () { reject(new Error('Timeout: la API tardo demasiado')); }
            });
        });
    }

    async function transcribeWithRetry(blob, audioDuration) {
        var maxRetries = CONFIG.MAX_BACKOFF_RETRIES;
        var lastError = null;
        for (var attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await transcribeWithGroq(blob, audioDuration);
            } catch (err) {
                lastError = err;
                if (err.message.startsWith('RATE_LIMIT:')) {
                    var parts = err.message.split(':');
                    var retryMs = parseInt(parts[1]) || (CONFIG.BACKOFF_BASE_MS * Math.pow(2, attempt));
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
        throw lastError || new Error('Error despues de varios intentos');
    }

    // ─── UI Components ─────────────────────────────────

    var rateLimiter = new RateLimiter();
    var serialQueue = new SerialQueue();
    var apiKeyManager = new APIKeyManager();
    var transcriptCache = new Map();
    var buttonObserver = null;
    var injectDebounceTimer = null;

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
        btn.className = 'btn-groq' + (GM_getValue('groq_ui_compact', true) ? ' compact' : '');
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
        var existing = bubble.parentNode ? bubble.parentNode.querySelector('.groq-result-card') : bubble.querySelector('.groq-result-card');
        if (existing) existing.remove();

        var card = document.createElement('div');
        card.className = 'groq-result-card';
        card.innerHTML = '<div class="result-header"><span>Transcripcion - ' + formatTimeAgo(Date.now()) + '</span><button class="copy-btn" title="Copiar al portapapeles"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar</button></div><div class="result-text"></div>';
        card.querySelector('.result-text').textContent = text;

        card.querySelector('.copy-btn').addEventListener('click', function () {
            navigator.clipboard.writeText(text).then(function () {
                var copyBtn = card.querySelector('.copy-btn');
                copyBtn.textContent = 'Copiado!';
                setTimeout(function () {
                    copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar';
                }, 2000);
            }).catch(function () { /* fallback */ });
        });

        if (bubble.parentNode) {
            var btn = bubble.parentNode.querySelector('.btn-groq');
            if (btn) {
                bubble.parentNode.insertBefore(card, btn.nextSibling);
            } else {
                bubble.parentNode.appendChild(card);
            }
        } else {
            bubble.appendChild(card);
        }
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function showDurationWarning(durationSeconds) {
        return new Promise(function (resolve) {
            var overlay = document.createElement('div');
            overlay.className = 'groq-warning-dialog';
            overlay.innerHTML = '<div class="dialog-content"><h4>Audio largo detectado</h4><p>Este audio tiene aproximadamente <strong>' + formatDuration(durationSeconds) + '</strong> de duracion. Esto consumira ~' + Math.floor(durationSeconds) + ' segundos de tu cuota horaria. Deseas continuar?</p><div class="dialog-actions"><button class="groq-modal-btn secondary" id="groq-cancel-duration">Cancelar</button><button class="groq-modal-btn primary" id="groq-confirm-duration">Continuar</button></div></div>';
            document.body.appendChild(overlay);

            overlay.querySelector('#groq-cancel-duration').addEventListener('click', function () { overlay.remove(); resolve(false); });
            overlay.querySelector('#groq-confirm-duration').addEventListener('click', function () { overlay.remove(); resolve(true); });
            overlay.addEventListener('click', function (e) { if (e.target === overlay) { overlay.remove(); resolve(false); } });
        });
    }

    // ─── Modal de Configuracion ────────────────────────

    function openConfigModal() {
        var existing = document.querySelector('.groq-modal-backdrop');
        if (existing) existing.remove();

        var key = apiKeyManager.load() || '';
        var quota = rateLimiter.getQuotaStatus();
        var model = GM_getValue('whisper_model', DEFAULT_MODEL);

        function getBarColor(percent) {
            if (percent >= 90) return 'red';
            if (percent >= 70) return 'yellow';
            return 'green';
        }

        var overlay = document.createElement('div');
        overlay.className = 'groq-modal-backdrop';
        overlay.innerHTML = '<div class="groq-modal">' +
            '<div class="groq-modal-header"><h3>Configuracion Groq Transcriber</h3><button class="groq-modal-close" id="groq-modal-close">&times;</button></div>' +
            '<div class="groq-modal-body">' +
            '<div class="groq-modal-section">' +
            '<label>API Key de Groq</label>' +
            '<div class="groq-modal-input-group">' +
            '<input type="password" class="groq-modal-input" id="groq-api-key-input" value="' + (key ? apiKeyManager.mask(key) : '') + '" placeholder="gsk_...">' +
            '<button class="toggle-visibility" id="groq-toggle-visibility">👁️</button>' +
            '</div></div>' +
            '<div class="groq-modal-section">' +
            '<label>Modelo Whisper</label>' +
            '<select class="groq-modal-input" id="groq-model-select">' +
            '<option value="whisper-large-v3-turbo"' + (model === 'whisper-large-v3-turbo' ? ' selected' : '') + '>whisper-large-v3-turbo (rapido)</option>' +
            '<option value="whisper-large-v3"' + (model === 'whisper-large-v3' ? ' selected' : '') + '>whisper-large-v3 (mayor precision, recomendado)</option>' +
            '</select></div>' +
            '<div class="groq-modal-section">' +
            '<label>Cuota de Uso</label>' +
            '<div class="groq-progress-bar-container"><div class="groq-progress-bar-label"><span>Requests/minuto</span><span>' + quota.requestsMinute.used + ' / ' + quota.requestsMinute.limit + '</span></div><div class="groq-progress-bar"><div class="groq-progress-bar-fill ' + getBarColor(quota.requestsMinute.percent) + '" style="width:' + quota.requestsMinute.percent + '%"></div></div></div>' +
            '<div class="groq-progress-bar-container"><div class="groq-progress-bar-label"><span>Requests/dia</span><span>' + quota.requestsDay.used + ' / ' + quota.requestsDay.limit + '</span></div><div class="groq-progress-bar"><div class="groq-progress-bar-fill ' + getBarColor(quota.requestsDay.percent) + '" style="width:' + quota.requestsDay.percent + '%"></div></div></div>' +
            '<div class="groq-progress-bar-container"><div class="groq-progress-bar-label"><span>Audio/hora</span><span>' + formatDuration(quota.audioHour.used) + ' / ' + formatDuration(quota.audioHour.limit) + '</span></div><div class="groq-progress-bar"><div class="groq-progress-bar-fill ' + getBarColor(quota.audioHour.percent) + '" style="width:' + quota.audioHour.percent + '%"></div></div></div>' +
            '<div class="groq-progress-bar-container"><div class="groq-progress-bar-label"><span>Audio/dia</span><span>' + formatDuration(quota.audioDay.used) + ' / ' + formatDuration(quota.audioDay.limit) + '</span></div><div class="groq-progress-bar"><div class="groq-progress-bar-fill ' + getBarColor(quota.audioDay.percent) + '" style="width:' + quota.audioDay.percent + '%"></div></div></div>' +
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
        overlay.querySelector('#groq-toggle-visibility').addEventListener('click', function () {
            isPasswordVisible = !isPasswordVisible;
            var input = overlay.querySelector('#groq-api-key-input');
            input.type = isPasswordVisible ? 'text' : 'password';
            if (isPasswordVisible && key) input.value = key;
            else if (!isPasswordVisible && key) input.value = apiKeyManager.mask(key);
        });

        overlay.querySelector('#groq-clear-key').addEventListener('click', function () {
            if (confirm('Seguro que deseas borrar la API Key? Deberas ingresarla nuevamente.')) {
                apiKeyManager.clear();
                key = '';
                overlay.querySelector('#groq-api-key-input').value = '';
                alert('API Key borrada correctamente.');
            }
        });

        overlay.querySelector('#groq-modal-save').addEventListener('click', function () {
            var newKey = overlay.querySelector('#groq-api-key-input').value.trim();
            var newModel = overlay.querySelector('#groq-model-select').value;

            if (newKey && !apiKeyManager.validate(newKey)) {
                alert('La API Key no es valida. Debe comenzar con "gsk_" y tener al menos 50 caracteres.');
                return;
            }
            if (newKey && newKey !== apiKeyManager.mask(key)) {
                apiKeyManager.save(newKey);
            }
            GM_setValue('whisper_model', newModel);
            overlay.remove();
            alert('Configuracion guardada correctamente.');
        });
    }

    // ─── Menu Tampermonkey ─────────────────────────────

    GM_registerMenuCommand('🔑 Configurar API Key', function () {
        var key = prompt('Ingresa tu API Key de Groq (comienza con gsk_):', '');
        if (key) {
            key = key.trim();
            if (apiKeyManager.validate(key)) {
                apiKeyManager.save(key);
                alert('API Key guardada correctamente.');
            } else {
                alert('La API Key no es valida. Debe comenzar con "gsk_" y tener al menos 50 caracteres.');
            }
        }
    });

    GM_registerMenuCommand('📊 Ver Cuota Restante', function () {
        openConfigModal();
    });

    GM_registerMenuCommand('🗑️ Borrar API Key', function () {
        if (confirm('Seguro que deseas borrar la API Key?')) {
            apiKeyManager.clear();
            alert('API Key borrada.');
        }
    });

    GM_registerMenuCommand('🤖 Modelo Whisper', function () {
        var current = GM_getValue('whisper_model', DEFAULT_MODEL);
        var model = prompt('Modelo de Whisper a usar:\n\n• whisper-large-v3-turbo (rapido, recomendado)\n• whisper-large-v3 (mayor precision)', current);
        if (model) GM_setValue('whisper_model', model.trim());
    });

    GM_registerMenuCommand('🧩 UI compacta ON/OFF', function () {
        var current = GM_getValue('groq_ui_compact', true);
        GM_setValue('groq_ui_compact', !current);
        alert('UI compacta: ' + (!current ? 'activada' : 'desactivada') + '. Recarga WhatsApp Web para aplicar.');
    });

    GM_registerMenuCommand('🧹 Limpiar cache de transcripciones', function () {
        var count = transcriptCache.size;
        transcriptCache.clear();
        alert('Cache limpiado. Entradas eliminadas: ' + count + '.');
    });

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

        // Deduplicar contenedores aninados (quedarse solo con el mas especifico)
        var containerList = Array.from(containers);
        var filteredContainers = containerList.filter(function (c1) {
            return !containerList.some(function (c2) {
                return c1 !== c2 && c1.contains(c2);
            });
        });

        filteredContainers.forEach(function (bubble) {
            if (!bubble) return;
            var sibling = bubble.nextSibling;
            var hasBtn = false;
            while (sibling) {
                if (sibling.classList && sibling.classList.contains('btn-groq')) {
                    hasBtn = true;
                    break;
                }
                if (sibling.classList && (sibling.classList.contains('message-in') || sibling.classList.contains('message-out') || sibling.getAttribute?.('data-testid') === 'msg-container')) {
                    break;
                }
                sibling = sibling.nextSibling;
            }
            if (hasBtn) return;

            var playBtn = bubble.querySelector(sel) || bubble.querySelector('audio') || bubble;

            var btn = createTranscribeButton();

            btn.onclick = async function () {
                var queuePos = serialQueue.getPosition();
                if (queuePos > 0) {
                    setButtonState(btn, 'queued', 'En cola (#' + (queuePos + 1) + ')');
                } else {
                    setButtonState(btn, 'processing', 'Transcribiendo...');
                }

                try {
                    var result = await serialQueue.add(function () {
                        return (async function () {
                            setButtonState(btn, 'processing', 'Transcribiendo...');

                            var captureResult = await captureAudio(bubble, playBtn);
                            if (!captureResult) throw new Error('No se pudo capturar el audio. ' + lastCaptureDebug);

                            var duration = captureResult.duration || 30;
                            var quotaCheck = rateLimiter.canSend(duration);
                            if (!quotaCheck.allowed) {
                                var retryIn = Math.ceil(quotaCheck.retryIn / 60000);
                                throw new Error('Cuota agotada. ' + quotaCheck.reason + '. Reintentar en ~' + retryIn + ' min.');
                            }

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
                                text = await transcribeWithRetry(blob, duration);
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
                    console.error('[Groq Transcriber]', err);
                    var errorMsg = err.message;
                    if (errorMsg.startsWith('Cuota agotada')) {
                        setButtonState(btn, 'quota-exhausted', errorMsg);
                    } else if (errorMsg.startsWith('RATE_LIMIT:')) {
                        setButtonState(btn, 'error', 'Rate limit. Reintentando...');
                    } else {
                        setButtonState(btn, 'error', 'Error: ' + errorMsg);
                    }
                    setTimeout(function () { setButtonState(btn, 'normal', 'Transcribir'); }, 5000);
                }
            };

            // Insert button below audio bubble, outside the visual bubble container
            if (bubble.parentNode) {
                bubble.parentNode.insertBefore(btn, bubble.nextSibling);
            } else {
                bubble.appendChild(btn);
            }
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

    // ─── Primer Uso - Confirmacion de Privacidad ───────

    function checkFirstUse() {
        var ackSaved = GM_getValue('groq_first_use_ack', false);
        var accepted = (ackSaved === true || ackSaved === 'true');
        if (!accepted) {
            var ack = confirm(
                'WhatsApp Groq Transcriber v' + VERSION + '\n\n' +
                'IMPORTANTE: Los audios de WhatsApp se envian a los servidores de Groq para transcripcion.\n\n' +
                '- Los audios NO se almacenan segun la politica de Groq\n' +
                '- La conexion es cifrada (HTTPS)\n' +
                '- Tu API Key se almacena de forma segura\n\n' +
                '¿Aceptas estos terminos para continuar?'
            );
            GM_setValue('groq_first_use_ack', ack);
            if (!ack) {
                alert('No podras usar el transcriptor sin aceptar los terminos.');
            }
        }
    }

    // ─── Inicio ────────────────────────────────────────

    function init() {
        injectStyles();
        checkFirstUse();
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
        console.log('[Groq Transcriber] v' + VERSION + ' activo');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();