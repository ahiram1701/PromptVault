// PromptVault — metadatos de la app de Puter, versionados en git.
//
// Los consume register-app.html, que llama a puter.apps.create() / update().
// Registrar la app NO cambia cómo se despliega el código: indexURL apunta al
// mismo sitio que publica deploy.ps1, así que el ciclo sigue siendo
// './deploy.ps1' y la app registrada sirve siempre la última versión.
//
// El icono no está aquí a propósito: Puter lo quiere como data URI y meter
// ~4 KB de base64 en el repo no aporta nada, así que register-app.html lo
// genera desde apple-touch-icon.png en tiempo de ejecución.
(function (global) {
  'use strict';

  global.PromptVaultAppManifest = {
    // Único dentro de la cuenta; es el que manda en https://puter.com/app/<name>.
    name: 'promptvault',
    // Debe ser http(s) y accesible por el usuario: Puter la carga en un iframe.
    indexURL: 'https://witty-meerkat-9381.puter.site',
    title: 'PromptVault',
    description: 'Guarda, etiqueta y busca tus prompts personales. Búsqueda fuzzy, favoritos, tags, respaldos automáticos e importación y exportación en Excel.',
    maximizeOnStart: false,
    feedbackEnabled: true,
    // Hace que PromptVault aparezca como opción al abrir un .xlsx de la cuenta
    // y lo enrute al importador que ya existe (puter.ui.onLaunchedWithItems).
    // Si molesta ver PromptVault en el menú de cada hoja de cálculo, basta con
    // vaciar este array y volver a ejecutar register-app.html.
    filetypeAssociations: ['.xlsx']
  };

  // App desechable del Paso 0: misma cuenta, pero apuntando a debug.html, para
  // poder leer puter.env y la ruta absoluta desde dentro de una app registrada.
  global.PromptVaultProbeManifest = {
    name: 'promptvault-debug',
    indexURL: 'https://witty-meerkat-9381.puter.site/debug.html',
    title: 'PromptVault (sonda)',
    description: 'Herramienta temporal para comprobar dónde resuelve puter.fs los paths relativos.',
    maximizeOnStart: false
  };
})(window);
