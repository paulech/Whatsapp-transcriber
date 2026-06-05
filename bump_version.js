/**
 * Script de automatización de versiones para WhatsApp Groq Transcriber.
 * 
 * Uso:
 *   node bump_version.js <nueva_versión> [descripción]
 * 
 * Ejemplo:
 *   node bump_version.js 4.1.0 "Auditoría y actualización a v4.1.0"
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const MANIFEST_PATH = path.join(ROOT_DIR, 'extension', 'manifest.json');
const USERSCRIPT_PATH = path.join(ROOT_DIR, 'whatsapp_groq_transcriber.user.js');
const CONTENT_MAIN_PATH = path.join(ROOT_DIR, 'extension', 'content_main.js');
const POPUP_HTML_PATH = path.join(ROOT_DIR, 'extension', 'popup.html');
const METADATA_PATH = path.join(ROOT_DIR, 'whatsapp_groq_transcriber.meta.js');
const HISTORY_PATH = path.join(ROOT_DIR, 'version_history.json');

// Documentación
const DOC_FILES = [
    path.join(ROOT_DIR, 'README.md'),
    path.join(ROOT_DIR, 'INSTRUCCIONES_USO.md')
];

// 1. Obtener argumentos
const args = process.argv.slice(2);
const newVersion = args[0];
const description = args[1] || `Actualización automática de versión a ${newVersion}`;

if (!newVersion) {
    console.error('Error: Debes proporcionar la nueva versión.');
    console.error('Uso: node bump_version.js <nueva_versión> [descripción]');
    process.exit(1);
}

// Validar formato semver (ej. 4.1.0)
const semverRegex = /^\d+\.\d+\.\d+$/;
if (!semverRegex.test(newVersion)) {
    console.error('Error: El formato de versión debe ser semver (ej: 4.1.0 o 4.1.1).');
    process.exit(1);
}

console.log(`Iniciando actualización a la versión: ${newVersion}...`);

// 2. Obtener versión actual de manifest.json (fuente de verdad)
let currentVersion = '';
try {
    const manifestContent = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const manifest = JSON.parse(manifestContent);
    currentVersion = manifest.version;
    console.log(`Versión actual detectada: ${currentVersion}`);
} catch (error) {
    console.error('Error al leer manifest.json:', error.message);
    process.exit(1);
}

if (currentVersion === newVersion) {
    console.log('La versión actual es igual a la nueva versión especificada. No se requieren cambios.');
    process.exit(0);
}

// Función auxiliar para reemplazar version
function replaceInFile(filePath, searchVal, newVal) {
    if (!fs.existsSync(filePath)) {
        console.warn(`Advertencia: El archivo no existe: ${filePath}`);
        return false;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    // Reemplazo global del string de versión
    const updatedContent = content.split(searchVal).join(newVal);
    
    if (content === updatedContent) {
        console.warn(`Advertencia: No se encontraron coincidencias de "${searchVal}" en: ${filePath}`);
        return false;
    }
    
    fs.writeFileSync(filePath, updatedContent, 'utf8');
    console.log(`Actualizado: ${path.basename(filePath)}`);
    return true;
}

// 3. Actualizar manifest.json de forma estructurada
try {
    const manifestContent = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const manifest = JSON.parse(manifestContent);
    manifest.version = newVersion;
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log('Actualizado: manifest.json (JSON)');
} catch (error) {
    console.error('Error al escribir manifest.json:', error.message);
    process.exit(1);
}

// 4. Actualizar content_main.js
replaceInFile(CONTENT_MAIN_PATH, `const VERSION = "${currentVersion}";`, `const VERSION = "${newVersion}";`);

// 5. Actualizar popup.html
replaceInFile(POPUP_HTML_PATH, `v${currentVersion}`, `v${newVersion}`);

// 6. Actualizar Userscript
replaceInFile(USERSCRIPT_PATH, `@version      ${currentVersion}`, `@version      ${newVersion}`);
replaceInFile(USERSCRIPT_PATH, `const VERSION = "${currentVersion}";`, `const VERSION = "${newVersion}";`);

// 7. Actualizar archivos de documentación
DOC_FILES.forEach(docFile => {
    // Para documentación hacemos un reemplazo más general del string de versión vX.Y.Z o X.Y.Z
    if (fs.existsSync(docFile)) {
        let content = fs.readFileSync(docFile, 'utf8');
        
        // Reemplazar ocurrencias con prefijo 'v' o 'V' o solo número
        content = content.split(`v${currentVersion}`).join(`v${newVersion}`);
        content = content.split(`V${currentVersion}`).join(`V${newVersion}`);
        content = content.split(currentVersion).join(newVersion);
        
        fs.writeFileSync(docFile, content, 'utf8');
        console.log(`Actualizado documentación: ${path.basename(docFile)}`);
    }
});

// 8. Generar archivo .meta.js para Tampermonkey
try {
    const userScriptContent = fs.readFileSync(USERSCRIPT_PATH, 'utf8');
    const metaMatch = userScriptContent.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
    if (metaMatch) {
        fs.writeFileSync(METADATA_PATH, metaMatch[0] + '\n', 'utf8');
        console.log(`Generado archivo de metadatos de actualización: ${path.basename(METADATA_PATH)}`);
    } else {
        console.warn('Advertencia: No se encontró el bloque de metadatos UserScript en el script principal.');
    }
} catch (error) {
    console.error('Error al generar .meta.js:', error.message);
}

// 9. Actualizar historial de versiones (version_history.json)
try {
    let history = [];
    if (fs.existsSync(HISTORY_PATH)) {
        const historyContent = fs.readFileSync(HISTORY_PATH, 'utf8');
        try {
            history = JSON.parse(historyContent);
            if (!Array.isArray(history)) {
                history = [];
            }
        } catch (e) {
            console.warn('Advertencia: history_history.json corrupto, reiniciando historial.');
            history = [];
        }
    }
    
    // Obtener fecha local formateada
    const now = new Date();
    const offset = -now.getTimezoneOffset();
    const diff = offset >= 0 ? '+' : '-';
    const pad = (num) => String(num).padStart(2, '0');
    const formattedOffset = diff + pad(Math.floor(Math.abs(offset) / 60)) + ':' + pad(Math.abs(offset) % 60);
    const dateStr = now.getFullYear() +
        '-' + pad(now.getMonth() + 1) +
        '-' + pad(now.getDate()) +
        'T' + pad(now.getHours()) +
        ':' + pad(now.getMinutes()) +
        ':' + pad(now.getSeconds()) +
        formattedOffset;

    history.unshift({
        version: newVersion,
        date: dateStr,
        description: description
    });

    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n', 'utf8');
    console.log('Actualizado: version_history.json');
} catch (error) {
    console.error('Error al actualizar el historial de versiones:', error.message);
}

console.log('¡Actualización de versión finalizada con éxito!');
