# PromptVault

SPA estática para guardar y organizar prompts personales. Cada usuario entra con su cuenta de Puter y sus datos quedan aislados en su propio FS. Sin sesión, funciona igual en modo local sobre `localStorage`.

En producción: **https://witty-meerkat-9381.puter.site**

## Stack

- HTML + CSS + JS puros (sin build step, sin bundler, sin gestor de paquetes)
- [Puter.js v2](https://js.puter.com/v2/) para FS, auth y hosting (vía CDN)
- [Fuse.js](https://www.fusejs.io/) para búsqueda fuzzy (vendorizado)
- [SheetJS](https://sheetjs.com/) para importar/exportar Excel (vendorizado)

No hay tests, linters ni formateadores configurados.

## Funcionalidades

- Prompts con título, cuerpo, tags y favorito; guardado automático con debounce de 600 ms
- Búsqueda fuzzy sobre título, cuerpo y tags
- Filtro por tag y por favoritos
- Tema oscuro/claro persistido
- Importar y exportar en Excel
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

## Modelo de datos

Cada prompt es un objeto JSON:

```js
{ id, title, body, tags: string[], favorite: boolean, createdAt, updatedAt }
```

`storage.js` expone `window.PromptVaultStorage` con dos backends intercambiables, elegidos en tiempo de ejecución según haya sesión de Puter o no.

**En Puter** (`~/PromptVault/`):

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
