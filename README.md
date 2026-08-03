# PromptVault

SPA estática para guardar y organizar prompts personales. Vive 100% en Puter: cada usuario entra con su cuenta y sus datos quedan aislados en su propio FS.

## Stack

- HTML + CSS + JS puros (sin build step)
- [Puter.js v2](https://js.puter.com/v2/) para FS y hosting
- [Fuse.js](https://www.fusejs.io/) para búsqueda fuzzy

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

No requiere build. Para probar con datos reales hace falta abrir la app en Puter (`puter.hosting`) o servir la carpeta y tener un Puter local. Para iterar UI rápido:

```
cd promptvault
python -m http.server 8080
```

Luego abrir `http://localhost:8080`. La app detecta que no está en Puter y entra en modo demo con almacenamiento en `localStorage`.

## Despliegue en Puter

En producción: **https://witty-meerkat-9381.puter.site**

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

Cada visitante entra con su cuenta Puter y ve solo sus datos. Si abres la app sin sesión iniciada, arranca en modo local y aparece un botón de nube en la barra superior para conectar; al conectar te ofrece subir los prompts locales a tu cuenta.

## Modelo de datos

- Un archivo por prompt: `~/prompts/<uuid>.json`
- Índice: `~/prompts/index.json` (lista resumida: id, título, tags, favorito, fecha)
- Respaldo automático: `~/Backups/prompts-<timestamp>.json`
- Descarga local: botón en la UI exporta un JSON portable

## Estado

v0.1 — scaffold inicial. Persistencia y UI completa en propuestas siguientes.
