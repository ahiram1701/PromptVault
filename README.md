# PromptVault

SPA estática para guardar y organizar prompts personales. Cada usuario entra con su cuenta de Puter y sus datos quedan aislados en su propio FS. Sin sesión, funciona igual en modo local sobre `localStorage`.

En producción: **https://witty-meerkat-9381.puter.site**

## Stack

- HTML + CSS + JS puros (sin build step, sin bundler, sin gestor de paquetes)
- [Puter.js v2](https://js.puter.com/v2/) para FS, auth y hosting (vía CDN)
- [Fuse.js](https://www.fusejs.io/) para búsqueda fuzzy (vendorizado)
- [SheetJS](https://sheetjs.com/) para importar/exportar Excel (vendorizado)

No hay linters ni formateadores. Los tests están en `tests.html`: abre `http://localhost:8080/tests.html` y pulsa **Ejecutar tests**.

## Funcionalidades

- Prompts con título, cuerpo, tags y favorito; guardado automático con debounce de 600 ms
- Búsqueda fuzzy sobre título, cuerpo y tags
- Filtro por tag y por favoritos
- Tema oscuro/claro persistido
- Importar y exportar en Excel; al importar, las filas con un ID ya conocido actualizan ese prompt en vez de duplicarlo
- Respaldos automáticos al cargar, y manuales desde la UI
- Conectar/desconectar de la cuenta de Puter desde la barra superior
- UI móvil: vista única con swipe-to-go-back, swipe actions en la lista y bottom sheet

## Estructura

```
promptvault/
├── index.html        # entry point
├── app.js            # UI + lógica
├── storage.js        # persistencia (backends puter / local)
├── styles.css        # tema oscuro, responsive
├── deploy.ps1        # despliegue a Puter
├── app-manifest.js   # metadatos de la app de Puter (no se despliega)
├── register-app.html # registra/actualiza la app en Puter (no se despliega)
├── vendor/
│   ├── fuse.min.js       # búsqueda fuzzy
│   └── xlsx.full.min.js  # import/export Excel
└── .gitignore
```

## Desarrollo local

No requiere build. Basta servir la carpeta:

```
python -m http.server 8080
```

Luego abrir `http://localhost:8080`. Como Puter.js se carga por CDN, la app funciona igual fuera de Puter: arranca en modo local (`localStorage`) y el botón de nube de la barra superior permite iniciar sesión en tu cuenta de Puter y trabajar con datos reales. No hace falta un Puter local.

## Despliegue en Puter

Preparación (una sola vez):

```
npm install -g @heyputer/cli
puter login
```

Desplegar:

```
./deploy.ps1
```

El script arma un `dist/` limpio con solo lo que la app sirve, lo publica con el CLI oficial y verifica por HTTP que cada archivo desplegado coincida con el local.

> No despliegues copiando y pegando el contenido de los archivos: ese camino reinterpreta los escapes `\uXXXX` del código fuente y ya corrompió `app.js` una vez. El CLI sube bytes desde disco.

El sitio se sirve desde `/Ahiram1701/Public/promptvault`. Ojo: el CLI hace despliegues versionados —cada deploy sube a su propia carpeta y reapunta el subdominio—, así que tras el primer `deploy.ps1` la ruta de origen cambiará. Los datos no se ven afectados: viven en `~/PromptVault/`, fuera del directorio del sitio.

## Como app de Puter

Además de existir como sitio, PromptVault se registra como **app** de Puter: se abre desde el escritorio en una ventana propia, con icono, en `https://puter.com/app/promptvault`.

Registrar la app **no cambia el despliegue**: los metadatos apuntan al mismo `witty-meerkat-9381.puter.site`, así que el ciclo sigue siendo `./deploy.ps1` y la app registrada sirve siempre la última versión. Sólo hay que volver a registrar cuando cambian los metadatos (`app-manifest.js`).

Dos cosas que conviene tener claras:

- **El sitio sigue haciendo falta.** Puter carga `indexURL` en un iframe, no guarda una copia del código: el subdominio `puter.site` *es* la app. Si lo borras, la ventana se abre en blanco.
- **El CLI no puede registrar apps.** `puter app` es de sólo lectura (`list`, `get`); despliega sitios y workers, no apps. El registro se hace siempre desde una página con sesión: `register-app.html`, el Dev Center (`puter.com/app/dev-center`) o `puter.apps.*` a mano.

Para registrarla o actualizarla:

```
python -m http.server 8080
```

y abrir `http://localhost:8080/register-app.html` → **Registrar / actualizar app**. La herramienta pide sesión, solicita el permiso `apps`, convierte `apple-touch-icon.png` en el data URI que Puter espera y hace `create` o `update` según exista ya. Es idempotente. Necesita servirse por http: con `file://` el `fetch` del icono falla.

`app-manifest.js` y `register-app.html` son herramientas de desarrollo y **no se despliegan** a propósito (no están en la lista de `deploy.ps1`).

Dentro de Puter la app cambia de comportamiento:

- La sesión ya viene abierta: no hay botón de nube ni opción de cerrar sesión, y la barra de estado dice «app de Puter».
- Las confirmaciones usan los diálogos nativos de Puter en vez de `window.confirm`.
- Exportar Excel abre el selector de guardado de Puter (el iframe puede bloquear las descargas del navegador) e importar abre el selector de archivos.
- Un `.xlsx` abierto desde el escritorio de Puter se importa directamente (`filetypeAssociations` en el manifiesto). Si molesta ver PromptVault en el menú de cada hoja de cálculo, vacía ese array y vuelve a registrar.
- El título de la ventana sigue al prompt abierto, y al cerrarla se vuelca el guardado pendiente antes de salir.

## Modelo de datos

Cada prompt es un objeto JSON:

```js
{ id, title, body, tags: string[], favorite: boolean, createdAt, updatedAt }
```

`storage.js` expone `window.PromptVaultStorage` con dos backends intercambiables, elegidos en tiempo de ejecución según haya sesión de Puter o no.

**En Puter** (`~/PromptVault/`):

La ruta no se da por supuesta. La documentación de Puter dice que los paths relativos se resuelven contra el «directorio raíz de la app» y que una app registrada vive en su sandbox `~/AppData/<app-id>/`. **Medido, no es lo que pasa aquí:** la app registrada lee la misma carpeta que el sitio. Aun así `storage.js` resuelve la raíz una sola vez —ruta absoluta de `PromptVault` si ya existe, y si no la pide sobre el home del usuario— para que un cambio futuro en cómo Puter asigna raíces no separe en silencio los dos contextos.

- `prompts/<id>.json` — un archivo por prompt
- `prompts/index.json` — `{ ids: [], updatedAt }`
- `Backups/<iso-stamp>/manifest.json` + `items.json`

**En localStorage** (prefijo `promptvault:`):

- `promptvault:prompt:<id>` — un prompt
- `promptvault:index` — `{ ids: [], updatedAt }`
- `promptvault:backup` — último snapshot
- `promptvault:backups` — metadatos de los últimos 5 respaldos

Al conectar una cuenta de Puter teniendo prompts locales, la app ofrece fusionarlos: unión por `id`, y ante colisión gana el `updatedAt` más reciente. Nunca borra nada de `localStorage`.

## Estado

Funcional. Persistencia dual, UI completa (escritorio y móvil), import/export Excel y conexión a Puter desde la interfaz.
