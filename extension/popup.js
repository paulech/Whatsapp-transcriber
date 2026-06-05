document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const toggleVisibilityBtn = document.getElementById('toggleVisibility');
  const modelSelect = document.getElementById('modelSelect');
  const uiCompactCheckbox = document.getElementById('uiCompact');
  
  const healthStatus = document.getElementById('healthStatus');
  
  const reqMinText = document.getElementById('reqMinText');
  const reqMinFill = document.getElementById('reqMinFill');
  
  const reqDayText = document.getElementById('reqDayText');
  const reqDayFill = document.getElementById('reqDayFill');
  
  const audHourText = document.getElementById('audHourText');
  const audHourFill = document.getElementById('audHourFill');
  
  const audDayText = document.getElementById('audDayText');
  const audDayFill = document.getElementById('audDayFill');
  
  const clearBtn = document.getElementById('clearBtn');
  const saveBtn = document.getElementById('saveBtn');
  const privacyPolicyLink = document.getElementById('privacyPolicyLink');

  // URL pública de la Política de Privacidad (actualizar con la URL real de GitHub Pages/Gist)
  const PRIVACY_POLICY_URL = 'https://github.com/tu-usuario/whatsapp-groq-transcriber/blob/main/PRIVACY_POLICY.md';

  let cachedSettings = null;
  let isPasswordVisible = false;

  // ─── Funciones Auxiliares ──────────────────────────

  function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function getFillClass(percent) {
    if (percent >= 90) return 'progress-fill fill-red';
    if (percent >= 70) return 'progress-fill fill-yellow';
    return 'progress-fill fill-green';
  }

  // ─── Carga de Datos Iniciales ──────────────────────

  async function loadState() {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (settings) => {
      if (!settings) return;
      cachedSettings = settings;

      // Cargar inputs
      apiKeyInput.value = settings.maskedKey || '';
      modelSelect.value = settings.whisperModel;
      uiCompactCheckbox.checked = settings.groqUiCompact;
      
      isPasswordVisible = false;
      apiKeyInput.type = 'password';
    });

    // Cargar cuotas
    chrome.runtime.sendMessage({ action: 'getQuotaStatus' }, (quota) => {
      if (!quota) return;

      // Minuto
      reqMinText.textContent = `${quota.requestsMinute.used} / ${quota.requestsMinute.limit}`;
      reqMinFill.style.width = `${quota.requestsMinute.percent}%`;
      reqMinFill.className = getFillClass(quota.requestsMinute.percent);

      // Día
      reqDayText.textContent = `${quota.requestsDay.used} / ${quota.requestsDay.limit}`;
      reqDayFill.style.width = `${quota.requestsDay.percent}%`;
      reqDayFill.className = getFillClass(quota.requestsDay.percent);

      // Hora Audio
      audHourText.textContent = `${formatDuration(quota.audioHour.used)} / ${formatDuration(quota.audioHour.limit)}`;
      audHourFill.style.width = `${quota.audioHour.percent}%`;
      audHourFill.className = getFillClass(quota.audioHour.percent);

      // Día Audio
      audDayText.textContent = `${formatDuration(quota.audioDay.used)} / ${formatDuration(quota.audioDay.limit)}`;
      audDayFill.style.width = `${quota.audioDay.percent}%`;
      audDayFill.className = getFillClass(quota.audioDay.percent);
    });

    // Cargar Salud General
    chrome.runtime.sendMessage({ action: 'getOverallHealth' }, (result) => {
      if (!result) return;
      healthStatus.textContent = result.health.toUpperCase();
      healthStatus.className = `health-indicator status-${result.health}`;
    });
  }

  loadState();

  // ─── Visibilidad de Contraseña ─────────────────────

  toggleVisibilityBtn.addEventListener('click', () => {
    isPasswordVisible = !isPasswordVisible;
    apiKeyInput.type = isPasswordVisible ? 'text' : 'password';

    if (isPasswordVisible && cachedSettings && cachedSettings.rawKey) {
      apiKeyInput.value = cachedSettings.rawKey;
    } else if (!isPasswordVisible && cachedSettings) {
      apiKeyInput.value = cachedSettings.maskedKey;
    }
  });

  // ─── Borrado de Credenciales ───────────────────────

  clearBtn.addEventListener('click', () => {
    if (confirm('¿Seguro que deseas borrar la API Key? Tendrás que configurarla de nuevo para poder transcribir.')) {
      chrome.runtime.sendMessage({ action: 'clearApiKey' }, (response) => {
        if (response && response.success) {
          alert('API Key eliminada.');
          loadState();
        } else {
          alert('Error al borrar la clave.');
        }
      });
    }
  });

  // ─── Guardado de Configuración ──────────────────────

  saveBtn.addEventListener('click', () => {
    const inputVal = apiKeyInput.value.trim();
    const whisperModel = modelSelect.value;
    const groqUiCompact = uiCompactCheckbox.checked;

    const payload = {
      whisperModel,
      groqUiCompact
    };

    // Validar si la API Key cambió (y no es la enmascarada que cargó por defecto)
    if (inputVal && cachedSettings && inputVal !== cachedSettings.maskedKey) {
      if (!inputVal.startsWith('gsk_') || inputVal.length < 50) {
        alert('La API Key no es válida. Debe empezar por "gsk_" y tener al menos 50 caracteres.');
        return;
      }
      payload.apiKey = inputVal;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    chrome.runtime.sendMessage({ action: 'saveSettings', ...payload }, (response) => {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar Cambios';

      if (response && response.success) {
        alert('Configuración guardada correctamente.');
        loadState();
      } else {
        alert('Error al guardar la configuración: ' + (response ? response.error : 'Desconocido'));
      }
    });
  });

  // ─── Enlace Política de Privacidad ────────────────────
  if (privacyPolicyLink) {
    privacyPolicyLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: PRIVACY_POLICY_URL });
    });
  }
});
