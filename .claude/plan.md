# Plan de Mejora de UX Móvil — PromptVault

## Contexto
La app ya tiene una base sólida de responsive design (vista única `data-view`, FAB, safe-area, teclado virtual). El objetivo es llevar la experiencia móvil de **funcional** a **nativa**, sin añadir dependencias ni frameworks.

---

## Mejoras propuestas (priorizadas por impacto)

### 1. Swipe-to-go-back desde el editor (Alto impacto)
**Problema:** En móvil, los usuarios esperan deslizar desde el borde izquierdo para volver. Actualmente solo hay un botón `<` en la topbar, que es difícil de alcanzar con una sola mano.

**Solución:** Añadir un detector de gestos horizontales en `.editor` que, al detectar un swipe desde el borde izquierdo (`touchstart.clientX < 40`) con velocidad suficiente, ejecute `clearEditor()`.

- Archivos: `app.js`, `styles.css`
- Añadir clase `.is-swipe-back` durante el gesto para feedback visual (desplazar `.editor` ligeramente).
- Debounce/gate para evitar triggers accidentales.

### 2. Swipe actions en items de lista (Alto impacto)
**Problema:** Para marcar favorito o eliminar un prompt, el usuario debe: entrar al editor → interactuar → volver a la lista. Son 3 toques.

**Solución:** Deslizar un item de la lista hacia la izquierda revela acciones rápidas: ⭐ Favorito y 🗑️ Eliminar. Al deslizar hacia la derecha revela 📋 Copiar.

- Archivos: `app.js`, `styles.css`
- Implementar con `touchstart/touchmove/touchend` en cada `<li>`, transformando `translateX`.
- Al tocar una acción, ejecutarla inmediatamente y cerrar con animación.
- Al tocar fuera del item expandido, colapsar.

### 3. Bottom sheet para menú "…" (Alto impacto)
**Problema:** El menú desplegable actual (`.more-menu`) aparece debajo del botón en la esquina superior derecha. En pantallas grandes de móvil (>6.5") es difícil de alcanzar con el pulgar.

**Solución:** En `@media (max-width: 720px)`, reemplazar el dropdown por un bottom sheet que suba desde `bottom: 0` con backdrop oscuro (`opacity` transition). En desktop se mantiene el dropdown actual.

- Archivos: `app.js`, `styles.css`
- Añadir `.bottom-sheet` y `.bottom-sheet-backdrop` al DOM dinámicamente.
- Cerrar al tocar el backdrop, al hacer swipe hacia abajo, o con Escape.

### 4. Textarea auto-expandible (Alto impacto)
**Problema:** El textarea tiene `min-height: 160px` (180px en móvil). En prompts largos, el usuario debe scrollear dentro del textarea, lo cual es frustrante en táctil.

**Solución:** Hacer que el textarea crezca automáticamente según su contenido (`scrollHeight`), hasta un `max-height` que sea el espacio visible restante (calculado dinámicamente restando topbar, header del editor, footer y safe-area). En móvil esto elimina la necesidad de scrollear dentro del textarea en la mayoría de los casos.

- Archivos: `app.js`, `styles.css`
- Listener `input` que ajuste `style.height = 'auto'` luego `style.height = scrollHeight + 'px'`.
- Recalcular `max-height` en `resize` y al abrir/cerrar el teclado virtual (`visualViewport`).

### 5. Optimización agresiva de espacio con teclado abierto (Medio impacto)
**Problema:** Cuando el teclado virtual está abierto, el área útil es muy pequeña. Actualmente solo se ocultan la topbar y el sidebar-footer.

**Solución:** Cuando `.is-keyboard-open` está activo:
- Ocultar el footer del editor (botones Copiar/Eliminar/hint) → el textarea gana toda la altura restante.
- Reducir el padding de `.editor-form` de 16px a 8px.
- Ocultar la label "Cuerpo del prompt" (`.field-label`) para ahorrar una línea.
- Estos elementos se restauran al cerrar el teclado.

- Archivos: `styles.css`
- Aprovechar la clase `.is-keyboard-open` que ya existe en `app.js`.

### 6. Mejor empty state con CTA prominente (Medio impacto)
**Problema:** Cuando no hay prompts, el sidebar muestra "Aún no tienes prompts. Pulsa 'Nuevo' para empezar." en texto pequeño. En móvil es fácil pasarlo por alto.

**Solución:** Diseñar un empty state centrado con un icono grande (📦 o ilustración SVG inline), texto más grande, y un botón primario "Crear mi primer prompt" que llame a `createPrompt()`.

- Archivos: `styles.css`, `app.js` (en `renderList` cuando `state.items.length === 0`)

### 7. Tag chips en el editor (Medio impacto)
**Problema:** Los tags se escriben en un input de texto plano separados por comas. En móvil es fácil olvidar la coma, no ver qué tags ya existen, y es difícil eliminar un tag del medio.

**Solución:** Convertir el input de tags en un sistema de chips:
- Al escribir y pulsar Enter, Coma o Espacio, se crea un chip.
- Cada chip es una "pill" con una `×` para eliminarla.
- El input queda debajo de los chips para seguir añadiendo.
- Mantiene compatibilidad: al `selectPrompt`, los chips se generan desde `item.tags`; al `collectForm`, los chips se convierten al array de tags.

- Archivos: `index.html` (cambiar estructura del campo tags), `styles.css`, `app.js`
- **Nota:** Este es el cambio más grande; se puede hacer como paso opcional o hacer primero una versión híbrida (input + chips visuales superpuestos).

### 8. Touch feedback mejorado (Bajo impacto, alta satisfacción)
**Problema:** El feedback táctil actual es solo un cambio de `background` en `:active`. Se siente "web" en vez de "app".

**Solución:** Añadir un efecto de ripple circular al tocar `.prompt-item`, `.btn`, y `.new-fab`. Implementado en CSS puro usando `:active::after` o un pequeño helper JS con `requestAnimationFrame`.

- Archivos: `styles.css`
- Añadir `.ripple` class y keyframes.

### 9. Haptic feedback en acciones clave (Bajo impacto)
**Problema:** No hay feedback táctil físico. Los usuarios de móvil no saben si su toque fue registrado.

**Solución:** Usar `navigator.vibrate([50])` (si está disponible) en:
- Crear nuevo prompt
- Eliminar prompt (con confirmación)
- Guardado exitoso
- Copiar al portapapeles

- Archivos: `app.js` (en funciones `createPrompt`, `deleteSelected`, `persistAll`, `copyBodyToClipboard`)
- Respetar `prefers-reduced-motion`.

### 10. Sticky search bar con toggle de filtros (Bajo impacto)
**Problema:** En móvil, el área de filtros (buscador + select + checkbox) ocupa ~120px de altura fija, reduciendo la lista visible.

**Solución:** Añadir un botón 🔍/✕ junto al buscador que colapse/expanda los filtros avanzados (select de tags y checkbox favoritos). El buscador siempre visible; los demás filtros se ocultan. Estado persistente en `localStorage`.

- Archivos: `index.html`, `styles.css`, `app.js`

---

## Plan de implementación

### Fase 1 — Gestos y navegación nativa
| Tarea | Archivo | Descripción |
|-------|---------|-------------|
| 1.1 | `app.js` + `styles.css` | Swipe-to-go-back desde `.editor` (detección de touch desde borde izquierdo). |
| 1.2 | `app.js` + `styles.css` | Swipe actions en `.prompt-item` (izquierda: favorito + eliminar; derecha: copiar). |
| 1.3 | `app.js` + `styles.css` | Bottom sheet para menú "…" en móvil (mantener dropdown en desktop). |

### Fase 2 — Editor optimizado para móvil
| Tarea | Archivo | Descripción |
|-------|---------|-------------|
| 2.1 | `app.js` + `styles.css` | Textarea auto-expandible con `max-height` dinámico. |
| 2.2 | `styles.css` | Ocultar footer del editor, reducir padding y ocultar labels cuando teclado está abierto. |
| 2.3 | `index.html` + `styles.css` + `app.js` | Tag chips: input híbrido que genera chips al separar por coma/enter/espacio. |

### Fase 3 — Pulido y feedback táctil
| Tarea | Archivo | Descripción |
|-------|---------|-------------|
| 3.1 | `styles.css` + `app.js` | Empty state visual con CTA grande. |
| 3.2 | `styles.css` | Efecto ripple en items de lista y botones. |
| 3.3 | `app.js` | Haptic feedback en acciones principales (crear, eliminar, guardar, copiar). |
| 3.4 | `index.html` + `styles.css` + `app.js` | Toggle para colapsar filtros avanzados en móvil. |

---

## Criterios de aceptación

- [ ] En móvil, deslizar desde el borde izquierdo del editor vuelve a la lista sin errores.
- [ ] En móvil, deslizar un prompt de la lista hacia la izquierdo revela acciones rápidas; al tocarlas funcionan.
- [ ] En móvil, el menú "…" aparece como bottom sheet; en desktop como dropdown.
- [ ] El textarea crece automáticamente al escribir y nunca supera el espacio visible disponible.
- [ ] Con teclado abierto en móvil, el editor oculta el footer y gana al menos 80px extra de altura.
- [ ] Los tags se muestran como chips eliminables en el editor; `collectForm()` sigue devolviendo el array correcto.
- [ ] El empty state muestra un botón grande y centrado cuando no hay prompts.
- [ ] El ripple aparece al tocar un item de lista o un botón.
- [ ] En dispositivos con vibración, crear/eliminar/guardar/copiar producen una vibración breve.
- [ ] Los filtros avanzados se pueden colapsar/expandir y el estado persiste en localStorage.
- [ ] Todo sigue funcionando perfectamente en desktop (sin regresiones).

---

*Plan generado el 2026-07-20.*
