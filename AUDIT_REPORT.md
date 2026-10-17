# Auditoría general — twinpane-commander
**Enfoque:** Calidad de código y rendimiento  
**Estado base:** `npm run lint` (tsc) ✅ sin errores · `npm audit` ✅ 0 vulnerabilidades · `npm run build` ❌ falla en este entorno por binding nativo de Vite/Rolldown (`@rolldown/binding-win32-x64-msvc` no cargable / Node 24), no por error TypeScript.

## 1. Resumen ejecutivo

- La aplicación es funcional y type-safe, pero **App.tsx es monolítico (2.003 líneas)** y concentra estado global, navegación, modales, teclado, drag & drop y vistas.
- La UI no memoiza resultados derivados: `getPanelItems()` recalcula filtros/orden y arrays nuevos **en cada render**, y `FileList` vuelve a re-renderizar paneles completos por cambios de estado poco relacionados.
- Hay un cuello de botella claro en interacción: **el movimiento del ratón sobre filas dispara `setHoveredItem`/`setHoverPos` en cada `mousemove`**, lo que fuerza re-render de todo `App` y del tooltip en cada píxel.
- El motor de archivos sincroniza directorios reales desde un **getter (`getFiles`)** y persiste todo el estado con `JSON.stringify` completo en cada operación, lo que escala mal y puede producir escrituras sincronas costosas.
- No hay tests ni herramientas de calidad más allá de TypeScript; `lint` realmente solo ejecuta `tsc --noEmit`.

## 2. Hallazgos de rendimiento

### P1 — Hover/mousemove genera re-renders globales (Alto)
- `FileList.tsx` llama `onItemHover` tanto en `onMouseEnter` como en **`onMouseMove`** para cada fila.
- En `App.tsx`, el callback hace:
  - `setHoveredItem(item)` en cada evento.
  - `setHoverPos({ x: e.clientX, y: e.clientY })` en cada evento si hay item.
- Efecto: todo el árbol de App (dos paneles, barras, modales) se re-renderiza continuamente durante el desplazamiento del puntero.

**Recomendación:** actualizar `hoveredItem` solo cuando cambie el item (comparar por `id`); actualizar `hoverPos` con throttling o solo en `mouseenter`, no en cada `mousemove`.  
**Impacto esperado:** reducción drástica de renders en exploración de carpetas.

### P2 — Derived data no memoizada (Alto)
- `App.tsx`:
  - `currentActiveTab`, `currentInactiveTab`, `currentActiveDrive`, etc. se recalculan cada render.
  - `leftItems` / `rightItems` llaman `getPanelItems()` en cada render.
  - `getPanelItems` filtra dos veces, crea `RegExp`, ordena con `localeCompare`; devuelve nuevo array cada vez.
- `FileList.tsx`:
  - `totalFiles`, `totalDirs`, `selectedItems`, `selectedBytes`, `totalBytes` se recalculan en cada render.
  - `selectedIds.includes(item.id)` dentro de `items.map(...)` es O(n), convirtiendo el render en O(n²) para carpetas grandes.
  - `items.find(i => i.id === dragOverFolderId)` en el HUD es O(n) en cada render.

**Recomendación:** usar `useMemo` para `items`, stats y filas seleccionadas; convertir `selectedIds` a `Set` antes del render; mantener un mapa `id -> item` para búsquedas O(1).

### P3 — Re-render de FileList por props inestables (Alto)
- `App.tsx` pasa muchos callbacks creados inline (`onSort`, `onSelectIndex`, `onToggleSelect`, `onClick`, etc.), lo que invalida memoización aunque los handlers sean semánticamente iguales.
- `FileList` no está envuelto en `React.memo` y no recibe handlers estables.

**Recomendación:** envolver callbacks relevantes en `useCallback` y `FileList` con `React.memo` (con comparar props relevantes). Priorizar handlers de cambios de foco, selección y hover.

### P4 — Sin virtualización de listas (Medio/Alto)
- `FileList.tsx` renderiza directamente:
  - modo `full`: todos los items como filas DOM.
  - modos `brief`, `thumbnails`, `gallery`: todos los items como tarjetas.
- Cada fila incluye múltiples handlers, iconos y cálculos.
- Para carpetas con miles de entradas, el costo de DOM/eventos será elevado.

**Recomendación:** añadir virtualización para modo lista (`react-window` / `@tanstack/react-virtual`) o paginación incremental para vistas grid. Los modos thumbnail/gallery pueden mantener lazy rendering fuera de viewport.

### P5 — Side effect síncrono en getter de archivos (Alto)
- `FileSystemEngine.getFiles()` dispara `this.syncRealDirectory()` cada vez que es multiplataforma (si hay handle físico).
- `getFiles` se invoca desde render (`getPanelItems`), por lo que sincronizaciones se disparan en cascada durante renders.
- `syncRealDirectory()` lee archivos de texto hasta 500 KB, muta el array completo, luego `saveToStorage()`.

**Recomendación:** disparar sync únicamente en navegación/montaje de drive, no en el render/selector; usar una cola/flag de “sync pendiente”; evitar escribir contenido grande en localStorage si el archivo es físico.

### P6 — Persistencia completa en cada operación (Medio)
- `saveToStorage()` serializa `drives`, `files` (incluyendo `content`) y `recycleBin` completo, y llama `notify()`.
- El store virtual tiene ~75 items pero con contenido; en unidades reales-mounted la serialización incluirá textos y puede ser costosa.
- `notify()` recalcula ambos paneles (ver P5).

**Recomendación:** debounce de persistencia (por ejemplo 300–500 ms), separar metadatos de contenido, y usar IndexedDB para contenido/archivos grandes; notificar solo cuando el estado visible cambie.

### P7 — Carga inicial de todos los modales y componentes (Medio)
- `App.tsx` importa estáticamente ~40 modales y componentes auxiliares.
- No hay `React.lazy`/`Suspense`, por tanto todo entra en el bundle inicial aunque un modal no se abra nunca.

**Recomendación:** lazy-load modales por demanda (`const ViewerModal = lazy(...)`), manteniendo un fallback mínimo.

### P8 — Build no reproducible en este entorno
- `npm run build` falla por binding nativo de Rolldown/Vite 8.
- Puede ser problema de instalación/Nodo, pero afecta CI/CD y trabajo local.

**Recomendación:** documentar versión de Node compatible (probablemente LTS reciente compatible con Vite 8), limpiar `node_modules` + lock y reinstalar; añadir `engines` en `package.json`; o valorar Vite estable/rolldown-free si el entorno lo exige.

## 3. Hallazgos de calidad de código

### Q1 — App.tsx como god component (Alto)
- 2.003 líneas.
- Mezcla estado de UI, navegación, tabs, modales, teclado, settings, drag & drop y persistencia.
- Solo 2 `useCallback` y 0 `useMemo`.

**Recomendación:** extraer hooks:
- `usePanelTabs` / `usePanelNavigation`
- `useKeyboardShortcuts`
- `useSettings`
- `useFileSystemRefresh`
- `useDragAndDrop`
y dividir el render en subcomponentes (`DualPaneLayout`, `GlobalModals`).

### Q2 — Tipado relajado en puntos clave (Medio)
- `modalData: any` en `App.tsx`.
- `mountedHandles`, `dirHandle`, `rootHandle` tipados como `any`.
- `valA: any`, `valB: any` en sorting.
- Total: 31 ocurrencias de `any` en `src`.

**Recomendación:** introducir tipos para File System Access API (`FileSystemDirectoryHandle`, `FileSystemFileHandle`) y tipos específicos para datos de modales; eliminar `any` en sorting con `unknown` y narrowing.

### Q3 — Configuración TypeScript menos estricta (Medio)
- `tsconfig.json` no activa `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitOverride`.

**Recomendación:** activar `strict: true` incrementalmente, primero en servicios y tipos, luego en componentes.

### Q4 — Herramientas de calidad insuficientes (Bajo/Medio)
- `package.json`:
  - `"lint": "tsc --noEmit"` no ejecuta lint real.
  - Sin ESLint, Prettier, Vitest/Jest ni scripts de test.
- Nombre/version del proyecto genéricos: `"react-example"`, `"0.0.0"`.
- `metadata.json` y licencias externas no revisadas.

**Recomendación:** añadir ESLint flat config + Prettier, Vitest, script de test, y corregir metadata del paquete.

### Q5 — Generación de IDs no determinista (Bajo/Medio)
- `syncRealDirectory` crea IDs con `Date.now()` por entrada:
  - `real_${driveId}_${entry.name}_..._${Date.now()}`
- En iteración rápida pueden repetirse marcas de tiempo o producir IDs inconsistentes entre syncs.

**Recomendación:** generar IDs estables a partir de `driveId + path + name + kind`, o usar un contador monotónico del motor.

### Q6 — Regex de filtro puede lanzar (Bajo)
- `getPanelItems` hace `new RegExp(...)` a partir de input del usuario sin try/catch.
- Un filtro con sintaxis inválida puede romper el render.

**Recomendación:** envolver en try/catch y caer a filtro literal.

### Q7 — Seguridad de renderizado HTML (Informativo/Bajo en este contexto)
- `dangerouslySetInnerHTML` se usa para SVG en:
  - `HoverPreviewTooltip.tsx:71`
  - `QuickViewPane.tsx:268`
  - `ViewerModal.tsx:338`
- El contenido es virtual/simulado y local, pero si se añade importación de archivos reales o contenido no confiable, hay riesgo XSS.

**Recomendación:** sanitizar con DOMPurify o restringir `dangerouslySetInnerHTML` exclusivamente a SVG validado/sanitizado.

### Q8 — Lógica duplicada y mezcla de idiomas
- Muchos textos mezclan español/inglés; archivos de servicio con nombres genéricos.
- `translations.ts` es muy grande (1.055 líneas) y puede dividirse por idioma.

**Recomendación:** dividir traducciones por locale (`es.ts`, `en.ts`) y cargarlas por código; centralizar labels reutilizables.

## 4. Priorización sugerida

### Fase 1 — Quick wins (1–2 días)
1. Evitar re-renders globales por `mousemove` (P1).
2. Cachear `items`, stats y selected IDs con `useMemo`/Set (P2).
3. Evitar sync de disco desde getter de render (P5).
4. Lazy-load de modales (P7).
5. Corregir `new RegExp` con try/catch (Q6).

### Fase 2 — Refactor de rendimiento (1 semanas)
1. Refactor `App.tsx` en hooks (Q1).
2. Debounce + persistencia optimizada (P6).
3. Virtualización de listas (P4).
4. Callbacks estables + `React.memo` (P3).

### Fase 3 — Calidad base y mantenibilidad (continuo)
1. Activar TS strict incremental (Q2/Q3).
2. ESLint + Prettier + Vitest (Q4).
3. IDs estables (Q5).
4. Sanitización SVG (Q7).

## 5. Verificación

- `npm run lint` finalizó con `EXIT:0`.
- `npm audit --audit-level=moderate` finalizó con `0 vulnerabilities`.
- `npm run build` no pudo ejecutarse correctamente en este entorno por fallo de binding nativo. Si quieres, lo dejo como primer bloque de trabajo: verificar entorno Node/Vite y volver a compilar para obtener tamaño real de bundle/chunks.

## 6. Siguiente acción propuesta

Puedo implementar primero la **Fase 1** (sin cambiar funcionalidad), empezando por:
1. `mousemove` → actualizar hover de forma condicional y throttled.
2. `useMemo`/Set en `FileList` y `App`.
3. lazy modals.
4. mover sync de disco fuera del render.

Si quieres, te presento un plan detallado de Fase 1 antes de tocar código o empiezo directamente con los fixes.