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
├── app.js            # UI + lógica + persistencia
├── styles.css        # tema oscuro, responsive
├── vendor/
│   ├── puter.js      # SDK de Puter (descargado o CDN)
│   └── fuse.min.js   # búsqueda fuzzy
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

1. Subir carpeta a Puter (drag & drop en `puter.hosting` o `puter.fs.writeFile`).
2. Crear subdomain (ej: `promptvault.puter.site`).
3. Listo. Cada visitante entra con su cuenta Puter y ve sus datos.

## Modelo de datos

- Un archivo por prompt: `~/prompts/<uuid>.json`
- Índice: `~/prompts/index.json` (lista resumida: id, título, tags, favorito, fecha)
- Respaldo automático: `~/Backups/prompts-<timestamp>.json`
- Descarga local: botón en la UI exporta un JSON portable

## Estado

v0.1 — scaffold inicial. Persistencia y UI completa en propuestas siguientes.
