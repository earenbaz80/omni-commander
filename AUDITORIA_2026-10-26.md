# Auditoría general — OmniCommander Pro

**Fecha:** 26-oct-2026 · **Commit auditado:** `d3b113e` (master, árbol limpio) · **Versión:** 1.0.4
**Alcance:** compuertas de calidad, seguridad (API loopback, Electron, archivos), correctitud funcional, rendimiento, tests, CI y empaquetado.
**Método:** ejecución de las compuertas reales + lectura de código + prueba de ejecución aislada para el fallo de TreeSize.
**Estado:** revisado el 28-oct-2026. §0 mide el árbol actual y marca cada hallazgo; §1–§8 se conservan como la foto del 26-oct.

---

## 0. Estado a 28-oct-2026

Las secciones siguientes son el registro de lo que se encontró en `d3b113e` y se dejan intactas. Aquí se revisa cada punto contra el árbol de trabajo actual (HEAD `489dc90` más los cambios sin commitear) para separar lo corregido de lo que sigue abierto.

### 0.1 Compuertas, medidas hoy

| Compuerta | Comando | Resultado |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | ✅ sin errores |
| ESLint | `npx eslint src --max-warnings 0` | ✅ exit 0 — 0 errores, 0 warnings |
| Tests | `npx vitest run` | ✅ 67 ficheros / 495 pruebas, medido con la máquina al 100 % de CPU: las consultas asíncronas esperan hasta 5 s (`src/test/setup.ts`) y `server.treesize.test.ts` tiene 20 s de presupuesto |
| Build | `npx vite build` | ✅ 23 s; `dist` 1,7 MB; chunk principal 528 kB (147 kB gzip), antes 943 kB |
| Auditoría de deps | `npm audit` | ⚠️ 4 bajas (`deepmerge` vía `workbox-build`/`vite-plugin-pwa`); `--omit=dev` → **0 vulnerabilidades** |
| Empaquetado | `app.asar` | No re-medido en esta revisión |
| E2E | `npm run test:e2e` | No ejecutado (4 specs: `smoke`, `a11y`, `a11y.modals`, `archives`) |

### 0.2 Hallazgos

| Punto | Estado | Qué se midió |
| --- | --- | --- |
| P0-1 · TreeSize | ✅ Resuelto | `getFolderSizes(path, driveId)` exige la unidad y recorre con el índice por carpeta (`fileSystem.ts:2033`); `getActiveDriveId` ya no existe; cubierto en `fileSystem.test.ts`, `DiskUsageModal.test.tsx` y `DiskUsagePane.test.tsx` |
| P0-2 · ZIP con contraseña | ✅ Resuelto | `ArchivePasswordError` real (`archiveBackend.ts:171`), inspección con `password` en el servidor y `ZipPasswordModal` en uso; pruebas en `server.archives.test.ts`, `serverArchive.test.ts` y `ZipPasswordModal.test.tsx` |
| P0-3 · RAR/7Z/TAR | ✅ Resuelto | Se abren en el servidor con `libarchive.js` y `node-unrar-js` (`server.cjs:2234-2600`); `server.archives.test.ts` y `e2e/archives.spec.ts`, que abre y extrae RAR, ZIP, 7-Zip y un RAR cifrado en la app real |
| P0-4 · Release desde árbol roto | ✅ Resuelto | El job de release depende de `verify`, que corre en cada push a `master` y en cada PR (`.github/workflows/release.yml`) |
| P1-1 · Dependencias | ✅ Resuelto | `npm audit fix` subió `body-parser` a 1.20.9 (producción sin avisos), `electron` a 44.10.0, `fast-uri` a 3.1.9 y `serialize-javascript` a 7.1.4; quedan 4 avisos bajos que exigen un cambio mayor de `vite-plugin-pwa` |
| P1-2 · Archivos grandes | ✅ Resuelto | `read-bytes` responde 413 por encima de 64 MiB cuando nadie pide un tope ni el archivo entero, trunca las previsualizaciones y lee entero solo con `unlimited` (motor de archivos); las entradas ZIP se miden por el tamaño declarado y se verifican por su CRC al leerlas, no al abrir. Abrir el ZIP de prueba bajó de 1.324 a 179 ms, ver §P1-2 |
| P1-3 · CI sin compuertas | ✅ Resuelto | `verify` ejecuta formato, tipos, ESLint y tests en matriz de dos versiones, y el release depende de él |
| P1-4 · GET sin token | ✅ Resuelto | El token cubre mutaciones y los GET que describen el disco (`/api/list`, `/api/treesize`, `/api/fs/hash`, `/api/fs/jobs`, detalle de trabajo, panel, unidades y sugerencias del lanzador); el origen debe ser loopback en el puerto 3000 exacto, y el proxy de Vite presenta ese origen para cualquier puerto de desarrollo (`server.cjs:26-96`, `vite.config.ts`) |
| P1-5 · Electron | ✅ Resuelto | La navegación se valida por origen exacto y solo admite ficheros dentro de `dist` (`electron/navigationGuard.cjs`, con `navigationGuard.test.ts`), y la CSP del documento solo permite recursos propios y el API en loopback (`vite.config.ts`) |
| P2-1 · Pre-flight de espacio | ✅ Resuelto | Presupuesto de 10.000 fuentes distintas por petición (`OMNI_PREFLIGHT_SOURCE_BUDGET`), un solo paseo por fuente aunque se repita y 8 paseos en paralelo; el volumen que no se terminó de medir viaja con `complete: false` y el aviso de espacio lo enseña como mínimo. Ver §5.1 |
| P2-2 · `getFolderSizes` | ⚠️ Parcial | Ya usa el índice por carpeta y exige `driveId`; `DiskUsageModal.tsx:32` sigue leyendo `(fsEngine as any).files` |
| P2-3 · i18n | ⚠️ Parcial | `DiskUsageModal` traduce sus textos; las etiquetas de trabajo siguen en español (`server.cjs:2017`) |
| P2-4 · Tipado | ⚠️ Parcial | 33 usos de `any` en `src` (eran 57); `npm run typecheck:strict` existe, pero el CI no lo ejecuta |
| P2-5 · `includes` en render | ⚠️ Parcial | El caso del render ya usa un `Set`; el payload de arrastre sigue con `selectedIds.includes` (`FileList.tsx:339`) |
| P2-6 · Filtro del panel | ❌ Abierto | Sigue escapando solo `.`, `*` y `?` (`usePanels.ts:196`) |
| P2-7 · Carpetas protegidas | ✅ Resuelto | Se guarda un registro PBKDF2 por carpeta (sal + hash) y el desbloqueo deriva el hash en vez de comparar texto; una protección antigua en claro sigue abriendo y se reescribe como registro en el primer desbloqueo (`appLock.ts`, `UnlockFolderModal.tsx`, `useSettings.ts`) |
| P2-8 · README y metadatos | ✅ Resuelto | README real, `metadata.json` eliminado, `engines` presente, y ESLint con script propia que el CI sí ejecuta |
| P2-9 · Dependencias sin uso | ⚠️ Parcial | `libarchive.js` y `node-unrar-js` ya se usan; `@zip.js/zip.js` sigue declarado y sin uso |
| P2-10 · Higiene local | ❌ Abierto | `release/` ocupa 657 MB y los `.txt` de depuración siguen en la raíz |
| P2-11 · `server.cjs` monolítico | ⚠️ Parcial | 3.806 líneas (eran 3.851); dos responsabilidades ya viven fuera: la validación de rutas (`server/pathSafety.cjs`, 34 líneas) y la medición de CPU/RAM (`server/systemLoad.cjs`, 65 líneas), cada una con sus pruebas y con el servidor importándolas sin cambiar ninguna llamada. 14 ficheros `server.*.test.ts` |
| P2-12 · Tests | ⚠️ Parcial | 495 pruebas en 67 ficheros, con TreeSize, archivos, contraseñas y los guardas de origen y token cubiertos; sigue sin script de cobertura ni umbral |

### 0.3 Lo que queda, por prioridad

1. **División de `server.cjs`** en módulos (P2-11): validación de rutas y medición de CPU/RAM ya son módulos propios; siguen WMI/unidades, trabajos, copia y reciclaje.
2. **Limpieza**: `release/`, `.txt` de la raíz y `@zip.js/zip.js` (P2-9, P2-10).
3. **Cobertura con umbral** (P2-12) y `typecheck:strict` en el CI (P2-4).

---

## 1. Resumen ejecutivo

*Foto del 26-oct-2026; el estado actual de cada punto está en §0.*

La base es sólida: 195 tests pasan, el build de producción funciona, el endurecimiento de seguridad de la API local está bien pensado (token de sesión, rechazo de `Origin: null` sin token, copias a archivo temporal + `rename`, validación anti zip-slip, virtualización de listas, Electron con `sandbox` + `contextIsolation`).

Pero **el HEAD no está en estado publicable**:

1. `npm run lint` (`tsc --noEmit`) **falla con 9 errores**; se publicó el `.exe` 1.0.4 cuatro minutos después de ese commit.
2. La herramienta **TreeSize / Uso de disco revienta con `TypeError`** (verificado en ejecución) y el `ErrorBoundary` global sustituye toda la aplicación por la pantalla de error.
3. Las funciones de **ZIP con contraseña, RAR, 7Z y TAR no están implementadas**: hay UI y mensajes que las anuncian, un modal con símbolos inexistentes que ni compila, y una dependencia declarada que no se usa.
4. `npm audit` reporta **4 vulnerabilidades (2 altas)**, una de ellas en una dependencia de producción (`body-parser`).
5. **El CI no ejecuta ninguna compuerta** (ni tipos, ni lint, ni tests): solo compila al crear un tag. Por eso los puntos 1–3 llegaron a un release.

## 2. Estado de las compuertas (medido)

*Medición del 26-oct-2026; la de hoy está en §0.1.*

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
- ~~`POST /api/fs/read-bytes` hacía `fs.promises.readFile` del archivo completo y lo enviaba: sin tope, tanto el servidor como el renderer cargaban el archivo entero en RAM, y un ISO de varios GB podía tumbar la app.~~ Ahora el tope es la regla y no la excepción: sin `maxBytes`, el servidor comprueba el tamaño y responde **413 con `size` y `limit`** por encima de 64 MiB (`OMNI_READ_BYTES_LIMIT` solo existe para que una prueba cruce el umbral con un archivo pequeño). Quedan tres intenciones explícitas: `maxBytes` trunca sin protestar —el visor pide un byte más de lo que muestra a propósito, y su tope nunca supera el límite—, `unlimited` lee el archivo entero para el motor de archivos, que no puede analizar medio ZIP, y omitir ambos significa "el archivo si cabe".
- ~~`loadZipBackend` **descomprimía cada entrada** (`await entry.async('uint8array')`) solo para calcular el tamaño.~~ El tamaño sale ahora del directorio central que JSZip ya parseó (`declaredSize` en `archiveBackend.ts`), con el inflado como respaldo únicamente cuando la entrada no lo trae; un archivo de cero bytes se declara como tal, que es lo que JSZip guarda para él. La prueba espía `ZipObject.prototype.async` y comprueba que listar un ZIP con contenido no lo llama ni una vez.
- **El CRC se paga por entrada, no por archivo.** `loadArchive` abre con `checkCRC32: false` y cada entrada se verifica contra el CRC-32 que declara el directorio central cuando se lee (`readZipEntry`, `archiveBackend.ts`), antes de que sus bytes lleguen al visor, a una extracción o al disco. Medido antes y después, misma máquina y mismo ZIP (200 documentos de 300 KiB, 15,2 MiB), sobre la ruta completa de la app y mediana de 3 pasadas:

  | Apertura | Mediana |
  | --- | --- |
  | Recorriendo el archivo entero (antes) | 1.324 ms |
  | Verificando cada entrada al leerla (ahora) | **179 ms** |

  En JSZip aislado, en Node: 1.033 ms → 54 ms para ese archivo, y 460 ms → 38 ms para uno de 3.000 entradas de 2 KiB. El 86-95 % del tiempo de apertura era la verificación íntegra.
- **Qué cambia para un archivo dañado:** antes fallaba al abrirlo; ahora se lista, y **la corrupción se descubre al extraer** (o al abrir) la entrada afectada, que se rechaza con el nombre del archivo en el mensaje. Es más estricto donde importa —no se escribe una entrada que no coincide con su CRC— y está cubierto en `archiveBackend.crc.test.ts`, que corrompe un byte de una entrada sin comprimir y comprueba que listar funciona y que leerla falla.
- **Lo que no se hizo:** streaming del visor (sigue leyendo en memoria lo que pide, ya acotado) y límite de entradas/tiempo al montar un archivo.

### P1-3 · CI sin compuertas de calidad
- `.github/workflows/release.yml` solo se dispara con tags `v*` y ejecuta `npm ci` → `build:electron` → `electron-builder`. **No ejecuta `tsc`, ESLint, tests ni E2E.**
- Consecuencia directa: los P0 llegaron al release. Añadir un job en `push`/`pull_request` con `tsc --noEmit`, `eslint src`, `vitest run` y `vite build`, y hacer que el job de release dependa de él.

### P1-4 · Cualquier origen `localhost` puede leer la API sin token
- `server.cjs:23-38` acepta cualquier `Origin` cuyo host sea `localhost`/`127.0.0.1`/`::1`, en **cualquier puerto**.
- El token de sesión solo se exige para métodos mutantes (`server.cjs:64-70`). Los GET `/api/list`, `/api/fs/hash` y `/api/fs/jobs` quedan legibles por cualquier aplicación web local (otro dev server, una extensión, un servicio comprometido) y devuelven nombres/rutas/tamaños de cualquier unidad.
- No hay fuga de contenido (leer bytes es POST), pero sí de estructura del disco.
- **Arreglo:** exigir token también en `/api/fs/*` (o al menos en `list`, `hash`, `jobs`), y limitar el origen al puerto de desarrollo exacto en vez de "cualquier localhost".

### P1-5 · Endurecimiento de Electron incompleto
- ~~`electron/main.cjs:266-277`: la allowlist usa `target.startsWith('http://localhost:3000')`~~: la comprobación vive ahora en `electron/navigationGuard.cjs` y compara el **origen** exacto, así que `http://localhost:3000@evil.com` (usuario `localhost:3000`, host `evil.com`) se rechaza, igual que otro puerto, otro host o `https`. Para `file://` ya no basta el prefijo: el fichero tiene que estar dentro de `dist` y no puede nombrar un host, con lo que quedan fuera el resto del disco y las rutas de red tipo `file://server/share/...`. Comprobado en Electron con `will-navigate` y `setWindowOpenHandler` reales: los cuatro intentos de fuga quedan bloqueados y la ventana sigue en su documento.
- ~~No hay **CSP** en `index.html`~~: ya se inyecta una política en `<head>` desde `vite.config.ts`, antes de cualquier recurso, con `default-src 'self'`, `script-src 'self'` en el build, `connect-src` limitado a loopback y `object-src`/`frame-src`/`form-action` cerrados. El servidor de desarrollo recibe dos excepciones que el paquete no lleva: el preámbulo en línea de React y el websocket de HMR. Comprobado en Chromium sobre el build servido y sobre el `dist` empaquetado en Electron: la app carga sus ficheros y rechaza `fetch`, imagen y script remotos.
- El token vive en un global del renderer (`window.electronAPI.apiToken`), decisión razonable para IPC pero que convierte cualquier XSS en acceso total al disco. La CSP reduce ese riesgo a código propio, porque un script en línea ya no se ejecuta en el build.
- Se mantienen `nodeIntegration:false`, `sandbox:true` y `contextIsolation:true`.
- **Arreglo aplicado:** origen exacto en lugar de prefijo, `file://` acotado a `dist`, y CSP solo para lo propio y el API local.

## 5. Hallazgos P2 — calidad, rendimiento y mantenibilidad

1. **Pre-flight de espacio sin cota:** ~~hasta 100 planes × 5000 fuentes, midiendo árboles secuencialmente en una sola petición; podía tardar minutos y consume el hilo.~~ Ahora mide como mucho **10.000 fuentes distintas por petición** (`OMNI_PREFLIGHT_SOURCE_BUDGET`), comparte el paseo entre repeticiones de la misma ruta —cobrando los bytes una vez por aparición, que es lo que el trabajo escribirá— y reparte los paseos **8 en paralelo** en lugar de uno detrás de otro. Cuando el presupuesto se agota, el volumen afectado viaja con `complete: false`: el faltante calculado con lo medido sigue siendo real y se avisa, pero el tamaño se muestra como **mínimo** ("≥") en vez de como total. Cubierto en `server.freespace.test.ts` (presupuesto, incompleto y repeticiones) y `FreeSpaceModal.test.tsx`.
2. **`getFolderSizes` algorítmicamente pobre** (`fileSystem.ts:1525-1550`): recursión que filtra todo el índice por carpeta (O(n²) en árboles grandes), variable `fullPath` sin usar, acceso a `(fsEngine as any).files` desde el modal (evita la versión de datos y no se re-renderiza). Rehacerlo con el índice por carpeta y memoización, o en servidor.
3. **i18n incompleta:** `DiskUsageModal` incluye textos fijos en inglés ("TreeSize — Folder Hierarchy", "No data", "Method not available") y `server.cjs` genera etiquetas de trabajo en español ("Eliminar…", "Copiar…", "Mover…"), en una app con 8 idiomas.
4. **Tipado:** `modalData: any` y 57 usos de `any` en `src`; `tsconfig.json` no activa `strict` (existe `tsconfig.strict.json`, pero no está en ninguna compuerta). Activar strict por capas (servicios primero).
5. **Restos de O(n·m) en render:** `FileList.tsx:323` sigue usando `selectedIds.includes` dentro de un `filter` (existe ya un `Set` en `:480`; usarlo también ahí).
6. **Filtro de panel:** `usePanels.ts:171-181` transforma el texto en regex escapando solo `.`, `*` y `?`; otros metacaracteres (`+`, `(`, `[`) alteran el resultado aunque el `try/catch` evite el crash. Escapar todo o hacer coincidencia literal con comodines.
7. **Protección de carpetas:** ~~`App.tsx:946-957` guarda la contraseña **en claro** en `protectedFolders` (localStorage) y solo se comprueba en `handleNavigate`.~~ Se guarda un registro PBKDF2 (sal y hash, uno por carpeta) y el desbloqueo lo verifica derivando el hash de lo que se teclea; el modal es el único sitio que ve la contraseña. Un valor guardado en claro por una versión anterior se lee como registro sin sal —sigue abriendo su carpeta— y se reescribe como registro en el primer desbloqueo que lo demuestra. **Lo que no cambia:** los ficheros no se cifran y la comprobación sigue viviendo solo en `handleNavigate`, así que es una barrera contra el acceso casual, no frente a quien abra la carpeta por otra vía.
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

*Plan tal como se propuso el 26-oct; lo que sigue pendiente hoy está en §0.3.*

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
10. Refactor de `server.cjs` en módulos: empezado por la validación de rutas y la medición de CPU/RAM (`server/pathSafety.cjs`, `server/systemLoad.cjs`); siguen WMI/unidades, trabajos, copia y reciclaje.
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
