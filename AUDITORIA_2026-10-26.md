# Auditoría general — OmniCommander Pro

**Fecha:** 26-oct-2026 · **Commit auditado:** `d3b113e` (master, árbol limpio) · **Versión:** 1.0.4
**Alcance:** compuertas de calidad, seguridad (API loopback, Electron, archivos), correctitud funcional, rendimiento, tests, CI y empaquetado.
**Método:** ejecución de las compuertas reales + lectura de código + prueba de ejecución aislada para el fallo de TreeSize.

---

## 1. Resumen ejecutivo

La base es sólida: 195 tests pasan, el build de producción funciona, el endurecimiento de seguridad de la API local está bien pensado (token de sesión, rechazo de `Origin: null` sin token, copias a archivo temporal + `rename`, validación anti zip-slip, virtualización de listas, Electron con `sandbox` + `contextIsolation`).

Pero **el HEAD no está en estado publicable**:

1. `npm run lint` (`tsc --noEmit`) **falla con 9 errores**; se publicó el `.exe` 1.0.4 cuatro minutos después de ese commit.
2. La herramienta **TreeSize / Uso de disco revienta con `TypeError`** (verificado en ejecución) y el `ErrorBoundary` global sustituye toda la aplicación por la pantalla de error.
3. Las funciones de **ZIP con contraseña, RAR, 7Z y TAR no están implementadas**: hay UI y mensajes que las anuncian, un modal con símbolos inexistentes que ni compila, y una dependencia declarada que no se usa.
4. `npm audit` reporta **4 vulnerabilidades (2 altas)**, una de ellas en una dependencia de producción (`body-parser`).
5. **El CI no ejecuta ninguna compuerta** (ni tipos, ni lint, ni tests): solo compila al crear un tag. Por eso los puntos 1–3 llegaron a un release.

## 2. Estado de las compuertas (medido)

| Compuerta | Comando | Resultado |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | ❌ **exit 2** — 9 errores |
| ESLint | `npx eslint src` | ❌ exit 1 — 2 errores, 51 warnings |
| Tests | `npx vitest run --maxWorkers=2` | ✅ 30 archivos / 195 tests (90,8 s) |
| Build | `npx vite build` | ✅ 1,5 MB en `dist`; chunk principal **943 kB** (293 kB gzip) |
| Auditoría de deps | `npm audit` | ❌ 4 vulnerabilidades: 2 altas, 1 moderada, 1 baja |
| Auditoría solo producción | `npm audit --omit=dev` | ❌ 1 alta (`body-parser`) |
| Empaquetado | `app.asar` 41,3 MB | ✅ incluye `server.cjs`, `express`, `body-parser`, `jszip`; `dist` y `server.cjs` en `app.asar.unpacked` |
| E2E | `npm run test:e2e` | No ejecutado en esta auditoría (4 tests definidos) |

Errores de `tsc`:

```
src/components/AppModals.tsx(485): Cannot find name 'ZipPasswordModal'
src/components/AppModals.tsx(488): Cannot find name 'archivePwdFileName'
src/components/AppModals.tsx(489): Cannot find name 'archivePwdInvalid'
src/components/AppModals.tsx(490): Cannot find name 'handleArchivePasswordSubmit'
src/components/AppModals.tsx(491): Cannot find name 'handleArchivePasswordClose'
src/services/fileSystem.ts(1527): Expected 2 arguments, but got 1
src/services/fileSystem.ts(1527): Property 'getActiveDriveId' does not exist
src/services/fileSystem.ts(1543): Property 'getActiveDriveId' does not exist
src/services/zipArchive.ts(18): 'password' does not exist in type 'JSZipLoadOptions'
```

Los tests no detectan esto porque Vitest transpila sin comprobar tipos; `tsc` es la única compuerta que los ve, y el CI no la ejecuta.

---

## 3. Hallazgos P0 — bloquean un release

### P0-1 · La app se cae al abrir TreeSize / Uso de disco (confirmado)
- `src/components/modals/DiskUsageModal.tsx:87` llama `fsEngine.getFolderSizes('C:\\')` sin `driveId`.
- `src/services/fileSystem.ts:1527` evalúa `this.getActiveDriveId()`, **método que no existe** en la clase; además llama `getFiles()` con un solo argumento cuando requiere dos.
- Reproducido de forma aislada: `TypeError: this.getActiveDriveId is not a function`.
- El modal se abre desde dos botones de la barra (`src/components/Toolbar.tsx:82` y `:85`) y el `ErrorBoundary` de `src/main.tsx` envuelve toda la app, así que el resultado visible es la pantalla de error completa.
- **Arreglo:** implementar `getActiveDriveId()` (o recibir el panel activo), pasar `driveId` y `path` reales, y añadir un test que invoque `getFolderSizes` sin `driveId`. También conviene sacar el cálculo fuera del render (ver P2-2).

### P0-2 · "ZIP con contraseña" roto y no implementado
- `src/components/AppModals.tsx:484-493` referencia `ZipPasswordModal` y cuatro variables que **no existen ni como import ni como props**: el archivo no compila y, si esa rama se evaluara, lanzaría `ReferenceError` en render (app completa al ErrorBoundary).
- `src/services/zipArchive.ts:18` pasa `password` a `JSZip.loadAsync`; **JSZip no soporta cifrado**, la opción no hace nada (de ahí el error de tipos).
- `loadArchive` captura cualquier error y lo convierte en "archivo corrupto", por lo que **nunca se lanza `ArchivePasswordError`** (`src/services/fileSystem.ts:8`), el flujo de `src/hooks/usePanels.ts:517-533` es inalcanzable y `requestArchivePassword` (`src/App.tsx:154-160`) es un stub que resuelve `null` sin esperar al modal.
- `src/services/zipPasswordHandler.ts` es un esqueleto de comentarios.
- **Decisión necesaria:** implementar de verdad (una librería que soporte AES: `libarchive.js`, 7-Zip nativo o `@zip.js/zip.js`) o retirar el flujo y mostrar un mensaje claro de "ZIP cifrados no soportados". Hoy es una función anunciada que no existe.

### P0-3 · RAR / 7Z / TAR anunciados, no soportados
- `src/hooks/usePanels.ts:514` incluye `RAR,7Z,TAR,GZ,TGZ` en "abrir como archivo", pero todo pasa por `loadArchive` → **JSZip**, que solo lee ZIP.
- El "fallback" de `usePanels.ts:528-531` vuelve a llamar `openZipArchive(item)` sin contraseña: mismo fallo, no cambia nada.
- `package.json` declara `libarchive.js`, `node-unrar-js` y `@zip.js/zip.js`, **sin ningún uso en `src/`, `electron/` ni `server.cjs`** (solo existe `src/types/libarchive.d.ts`).
- Los iconos, el tipo "Archive" y el commit `d3b113e` ("RAR/7Z/TAR open") prometen algo que el usuario no obtiene: al abrir un `.rar` verá "no es un ZIP válido".
- **Arreglo:** integrar una librería real (server-side con Node es lo más robusto en Windows) o eliminar esos formatos del flujo de apertura y de las etiquetas hasta implementarlos.

### P0-4 · Release 1.0.4 construido desde un árbol que no compila
- `release/OmniCommander Pro 1.0.4.exe` (19:25) es posterior al commit `d3b113e` (19:20) que introduce P0-1 y los errores de tipos de `fileSystem.ts`.
- Vite no comprueba tipos, así que el binario se genera igual. No hay compuerta que lo impida (ver P1-3).

## 4. Hallazgos P1 — importantes

### P1-1 · Vulnerabilidades de dependencias
- **`body-parser` < 1.20.9 (alta, producción)** — DoS por bytes finales tras un cuerpo comprimido (GHSA-27r3-jxmh-p828). Llega por `express@4.22.3`; hay fix disponible (`npm audit fix`).
- **`electron` 44.7.2 (alta)** — aviso de compromiso de firma eMudhra; actualizar al parche de la misma major.
- `fast-uri` (moderada) y `serialize-javascript` (baja) vienen de la cadena de build/Storybook; menor prioridad pero conviene actualizar.
- No hay `engines` en `package.json` pese a la sensibilidad del entorno (iones/Electron/Vite 8 ya rompieron builds antes).

### P1-2 · Archivos grandes sin límite de memoria
- `server.cjs:1462-1469` (`POST /api/fs/read-bytes`) hace `fs.promises.readFile` del archivo completo y lo envía: sin tope de tamaño, tanto el proceso servidor como el renderer cargan el archivo entero en RAM. Un vídeo/ISO de varios GB puede tumbar la app.
- `openZipArchive` (`fileSystem.ts:1360-1376`) **descomprime cada entrada** (`await entry.async('uint8array')`) solo para calcular el tamaño: abrir un ZIP grande con miles de entradas bloquea el hilo y multiplica el uso de memoria; además el ZIP completo ya se cargó como `Uint8Array`.
- **Arreglo:** `stat` previo con límite y respuesta 413; streaming para el visor; usar el tamaño declarado de la entrada ZIP (p. ej. `uncompressedSize`) en lugar de descomprimir; límite de entradas/tiempo al montar un archivo.

### P1-3 · CI sin compuertas de calidad
- `.github/workflows/release.yml` solo se dispara con tags `v*` y ejecuta `npm ci` → `build:electron` → `electron-builder`. **No ejecuta `tsc`, ESLint, tests ni E2E.**
- Consecuencia directa: los P0 llegaron al release. Añadir un job en `push`/`pull_request` con `tsc --noEmit`, `eslint src`, `vitest run` y `vite build`, y hacer que el job de release dependa de él.

### P1-4 · Cualquier origen `localhost` puede leer la API sin token
- `server.cjs:23-38` acepta cualquier `Origin` cuyo host sea `localhost`/`127.0.0.1`/`::1`, en **cualquier puerto**.
- El token de sesión solo se exige para métodos mutantes (`server.cjs:64-70`). Los GET `/api/list`, `/api/fs/hash` y `/api/fs/jobs` quedan legibles por cualquier aplicación web local (otro dev server, una extensión, un servicio comprometido) y devuelven nombres/rutas/tamaños de cualquier unidad.
- No hay fuga de contenido (leer bytes es POST), pero sí de estructura del disco.
- **Arreglo:** exigir token también en `/api/fs/*` (o al menos en `list`, `hash`, `jobs`), y limitar el origen al puerto de desarrollo exacto en vez de "cualquier localhost".

### P1-5 · Endurecimiento de Electron incompleto
- `electron/main.cjs:266-277`: la allowlist usa `target.startsWith('http://localhost:3000')`. Una URL como `http://localhost:3000@evil.com` (usuario `localhost:3000`, host `evil.com`) **pasa el filtro**; el `window.open` permitido cargaría contenido remoto en la ventana privilegiada, con el preload activo y `window.electronAPI.apiToken` accesible. El servidor seguiría rechazando peticiones por `Origin`, pero es una capa que no debería depender de la otra.
- No hay **CSP** en `index.html` ni cabecera equivalente: no hay defensa en profundidad si algún día se renderiza contenido no confiable.
- El token vive en un global del renderer (`window.electronAPI.apiToken`), decisión razonable para IPC pero que convierte cualquier XSS en acceso total al disco. Conviene documentarlo y añadir CSP + validación estricta de URL.
- **Arreglo:** comparar `new URL(target).origin` con una lista exacta de orígenes; CSP `default-src 'self'` con excepciones mínimas; mantener `nodeIntegration:false`, `sandbox:true` y `contextIsolation:true` (ya correctos).

## 5. Hallazgos P2 — calidad, rendimiento y mantenibilidad

1. **Pre-flight de espacio sin cota** (`server.cjs:1540-1590`): hasta 100 planes × 5000 fuentes, midiendo árboles secuencialmente en una sola petición; puede tardar minutos y consume el hilo. Reutilizar la medición del job o limitar el total.
2. **`getFolderSizes` algorítmicamente pobre** (`fileSystem.ts:1525-1550`): recursión que filtra todo el índice por carpeta (O(n²) en árboles grandes), variable `fullPath` sin usar, acceso a `(fsEngine as any).files` desde el modal (evita la versión de datos y no se re-renderiza). Rehacerlo con el índice por carpeta y memoización, o en servidor.
3. **i18n incompleta:** `DiskUsageModal` incluye textos fijos en inglés ("TreeSize — Folder Hierarchy", "No data", "Method not available") y `server.cjs` genera etiquetas de trabajo en español ("Eliminar…", "Copiar…", "Mover…"), en una app con 8 idiomas.
4. **Tipado:** `modalData: any` y 57 usos de `any` en `src`; `tsconfig.json` no activa `strict` (existe `tsconfig.strict.json`, pero no está en ninguna compuerta). Activar strict por capas (servicios primero).
5. **Restos de O(n·m) en render:** `FileList.tsx:323` sigue usando `selectedIds.includes` dentro de un `filter` (existe ya un `Set` en `:480`; usarlo también ahí).
6. **Filtro de panel:** `usePanels.ts:171-181` transforma el texto en regex escapando solo `.`, `*` y `?`; otros metacaracteres (`+`, `(`, `[`) alteran el resultado aunque el `try/catch` evite el crash. Escapar todo o hacer coincidencia literal con comodines.
7. **Protección de carpetas:** `App.tsx:946-957` guarda la contraseña **en claro** en `protectedFolders` (localStorage) y solo se comprueba en `handleNavigate`. Ya existe PBKDF2 en `appLock.ts`: reutilizarlo o presentarlo explícitamente como "conveniencia", no como seguridad.
8. **Metadatos y documentación obsoletos:** `README.md` sigue siendo la plantilla de AI Studio (habla de `GEMINI_API_KEY`, que la app no usa); `metadata.json` dice "Norton Commander Pro" y declara `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`; no hay `engines`. El script `lint` ejecuta `tsc`, lo que oculta que ESLint está en rojo.
9. **Dependencias sin uso:** `@zip.js/zip.js`, `libarchive.js`, `node-unrar-js` (añaden peso de instalación y empaquetado; `libarchive.js` además trae WASM).
10. **Higiene local:** `release/` acumula ~450 MB de artefactos 1.0.3/1.0.4, y la raíz tiene decenas de `.txt` de depuración (`ebuild*.txt`, `main.txt`, `pkg.txt`…). Están ignorados por git, pero ensucian el proyecto y confunden búsquedas.
11. **`server.cjs` es monolítico** (1.771 líneas con 6 responsabilidades: middleware, WMI/drives, jobs, copia, reciclaje, rutas). Funciona y está bien comentado, pero merece división en módulos para poder testear por separado.
12. **Tests:** buena cobertura de seguridad (403 por origen/token en `fileSystemCrypto.test.ts`), zip-slip, LRU, virtualización y a11y de modales. Faltan tests de: `getFolderSizes`, apertura de archivos grandes, flujo de contraseña de ZIP, y no hay script de cobertura ni umbral.

## 6. Lo que está bien (no tocar sin motivo)

- **Seguridad de la API loopback:** token por lanzamiento vía argv, rechazo de `Origin: null` sin token, bind exclusivo a `127.0.0.1`, rechazo de UNC/`\\?\`, validación de raíz y de symlinks en extracción, `flag:'wx'` al escribir bytes.
- **Integridad de copias:** escritura a `.<nombre>.omni-part-<id>` + `rename` atómico, limpieza del temporal en cancelación/error, listeners permanentes de error en streams, `utimes`/modo preservados.
- **Anti zip-slip:** `archiveEntryPath` + `assertArchiveDestination` + tests con entradas `../`, `C:/`, `..\\`, `CON.txt`, `a:stream`.
- **Rendimiento ya resuelto:** virtualización en `full`, `brief`, thumbnails y gallery; índice O(1) por carpeta con LRU; persistencia debounced y sin `content`; jobs acotados (`JOBS_LIMIT`, `RECENT_FILES_LIMIT`).
- **Electron:** `sandbox`, `contextIsolation`, sin `nodeIntegration`, navegación restringida, IPC con validación del emisor y normalización de payloads de la bandeja.
- **Tests y a11y:** 195 tests verdes, guard que obliga a que cada modal use `ModalShell`/`useModalDialog`, `ErrorBoundary` con recuperación y copia de detalles.

## 7. Priorización sugerida

**P0 — antes de cualquier publicación (≈1 día)**
1. Arreglar `getFolderSizes` (o retirar temporalmente el modal) + test.
2. Dejar `tsc` en verde: importar/props correctos del modal de contraseña, `password` fuera de `loadArchive` o tipado correcto, `getFiles` con dos argumentos.
3. Decidir el alcance real de archivos: implementar RAR/7Z/TAR y ZIP cifrado, o retirar la promesa de la UI hasta hacerlo.
4. Poner compuertas en CI (tipos, lint, tests, build) y bloquear el release si fallan.

**P1 — siguiente iteración (≈2–3 días)**
5. `npm audit fix` + actualizar Electron; añadir `engines`.
6. Límite y streaming para `read-bytes`; tamaño de entradas ZIP sin descomprimir.
7. Token también para GET sensibles y origen exacto.
8. CSP + validación estricta de URL en Electron.

**P2 — deuda continua**
9. Strict TS progresivo, eliminar `any` de modales, i18n de TreeSize y etiquetas del servidor.
10. Refactor de `server.cjs` en módulos; cota del pre-flight de espacio.
11. README/metadatos reales, limpiar dependencias sin uso y artefactos antiguos.

## 8. Verificación de esta auditoría

- `npx tsc --noEmit` → exit 2, 9 errores (listados arriba).
- `npx eslint src` → exit 1, 2 errores (`libarchive.d.ts` usa `Function`; otro más) y 51 warnings.
- `npx vitest run --maxWorkers=2 --reporter=dot` → 30 archivos, 195 tests, todos verdes (90,8 s).
- `npx vite build` → correcto; `dist` 1,5 MB; chunk principal 943,43 kB / 292,86 kB gzip.
- `npm audit` → 4 vulnerabilidades (2 altas, 1 moderada, 1 baja); `--omit=dev` → 1 alta.
- `app.asar` inspeccionado con `@electron/asar`: 4.761 entradas, `server.cjs` y dependencias de producción presentes (el empaquetado no está roto).
- Prueba temporal de ejecución (creada y eliminada; árbol de trabajo limpio): `fsEngine.getFolderSizes('C:')` → `TypeError: this.getActiveDriveId is not a function`.
- No se ejecutaron los E2E (requieren Chromium y dos servidores); no se probó la app instalada manualmente.
