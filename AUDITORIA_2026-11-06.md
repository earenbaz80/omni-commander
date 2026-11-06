# Auditoría general — OmniCommander Pro

**Fecha:** 6-nov-2026 · **Commit auditado:** `00186b9` (*chore(release): cut 1.0.39*), idéntico a la etiqueta `v1.0.39` y a la punta de `origin/master` · **Versión:** 1.0.39
**Repositorio:** `github.com/earenbaz80/omni-commander` (público) · **Árbol:** limpio, 0 ficheros modificados
**Método:** lectura del código, medición estática del árbol, análisis del historial de Git y **ejecución de las compuertas**.
**Revisión:** tercera del día. La primera se hizo sin `.git`; la segunda añadió el historial y corrigió sus cifras (§3); esta ejecuta lo que las anteriores solo podían describir.

> **Estado de las compuertas.** Con Node v26.13.0 y npm 11.20.0 instalados, `node_modules` reconstruido con `npm ci` (971 paquetes, `package-lock.json` sin cambios) y los dos servidores de desarrollo corriendo, se ejecutaron **todas las compuertas disponibles**: formato, tipos, tipos estrictos, eslint, suite con umbral de cobertura, cobertura del servidor, build y `npm audit`. **Todas en verde** (§1), incluidos el e2e y el empaquetado de Electron.

---

## 0. Resumen

El repositorio está **sano**: 385 commits en doce días, un solo autor, mensajes convencionales, etiquetas cortadas una a una y `master` exactamente en la release publicada. Las compuertas lo confirman ahora con números en vez de con lectura: **1 002 pruebas unitarias en 138 ficheros pasan en 23 s**, la cobertura queda por encima de sus cuatro umbrales, el build termina en 568 ms, los **54 casos e2e pasan en 2,2 min** sobre Chromium 156, la auditoría de dependencias de producción no encuentra nada y el empaquetado produce instalador NSIS y portable con el hash de `latest.yml` coincidiendo con el fichero.

Los tres hallazgos que traían las pasadas anteriores **estaban abiertos en `HEAD`**; los tres se corrigieron después (§10) y el historial explica dos de ellos:

1. **`delete` y `move` aceptan la raíz de una unidad** (§2.1). La guarda existe desde `4f5a67a` para la limpieza de temporales, pero nunca se generalizó a las rutas que borran y mueven, que son anteriores (`900e871`).
2. **Los enlaces de licencia del mapa están muertos en Electron** (§2.2). El allowlist se escribió el 30-oct (`1e50726`) para la página de tokens; los enlaces de atribución llegaron el 4-nov (`749859f`) y nadie amplió el filtro. Cinco URLs, cero permitidas.
3. **`/api/tree` no exige el token de sesión** (§2.3), mientras `/api/list` y `/api/treesize` sí.

Ninguna compuerta los detectaba, y eso es parte del hallazgo: son reglas de negocio y de configuración, no errores de tipo, de formato ni de test. La deuda restante —documentación desfasada, acciones de CI sin fijar, cuatro vulnerabilidades bajas de desarrollo— es de higiene, no de comportamiento observable.

---

## 1. Compuertas ejecutadas

Todas el 6-nov-2026, en esta máquina, sobre el árbol de `00186b9`:

| Compuerta | Comando | Resultado | Detalle medido |
| --- | --- | --- | --- |
| Formato | `npm run format:check` | **PASA** (0) | «All matched files use Prettier code style!» |
| TypeScript | `npm run lint` | **PASA** (0) | `tsc --noEmit` sin una línea de salida |
| TypeScript estricto | `npm run typecheck:strict` | **PASA** (0) | `tsconfig.strict.json`, sin salida |
| ESLint | `npm run lint:eslint` | **PASA** (0) | `src` con `--max-warnings 0`: cero avisos |
| Pruebas | `npm run test:coverage` | **PASA** (0) | **138 ficheros, 1 002 casos**, 23 s |
| Cobertura | ídem | **PASA** | 58,19 / 51,99 / 46,79 / 61,17 % frente a 57 / 51 / 46 / 60 |
| Cobertura del servidor | `npm run test:server:coverage` | **PASA** (0) | **32 ficheros, 228 casos**, 11 s; 61,2 % de líneas, 63,3 % de funciones |
| Build | `npm run build` | **PASA** (0) | 568 ms, 61 ficheros en `dist/`, 59 entradas de precache (1 547 KiB) |
| Dependencias (prod) | `npm audit --omit=dev` | **PASA** (0) | **0 vulnerabilidades** |
| Dependencias (todas) | `npm audit` | **4 bajas** | `deepmerge` en desarrollo, vía `vite-plugin-pwa` → `workbox-build` |
| E2E | `npm run test:e2e` | **PASA** (0) | **14 specs, 54 casos**, 2,2 min con un worker |
| Empaquetado | `npm run build:electron` + `electron-builder` | **PASA** (0) | 102 s; NSIS 115,8 MB + portable 115,5 MB; `latest.yml` con sha512 correcto; **sin firmar** |
| Hooks | `.githooks/*` | **ACTIVOS** | `npm ci` ejecutó `prepare`; `core.hooksPath = .githooks` |

**Cobertura real, no redondeada** (`coverage/coverage-summary.json`):

| Métrica | Cubierto / total | Porcentaje | Umbral |
| --- | --- | ---: | ---: |
| Sentencias | 5 388 / 9 259 | 58,19 % | 57 |
| Ramas | 3 463 / 6 660 | 51,99 % | 51 |
| Funciones | 1 177 / 2 515 | 46,79 % | 46 |
| Líneas | 4 882 / 7 980 | 61,17 % | 60 |

Los cuatro umbrales se superan, pero por márgenes de 0,8 a 1,2 puntos: son suelos pegados a la realidad medida, no aspiraciones, y una limpieza de código sin pruebas puede tumbarlos.

**Las cuatro vulnerabilidades bajas** son una sola cadena de desarrollo: `deepmerge` (poisoning de prototipos) dentro de `@rollup/plugin-node-resolve`, que usa `workbox-build`, que usa `vite-plugin-pwa`. No llega al bundle publicado —`npm audit --omit=dev` da 0— y la corrección que propone npm es un `--force` que degradaría `vite-plugin-pwa` a la 0.2.1, es decir, romper la PWA para cerrar un aviso bajo en herramientas de build. Lo razonable es esperar la actualización de workbox y no forzar.

---

## 2. Hallazgos

### 2.1 · `delete` y `move` aceptan la raíz de una unidad — **Alta** · ✅ corregido (§10)

**Evidencia**

- `server/pathSafety.cjs:14-31`: `assertSafePath('C:\\')` devuelve `C:\` a propósito, porque los paneles abren la raíz.
- `server/routes/transfers.cjs:151-188`: `const targets = (body.targets || []).map(assertSafePath)` y después `deleteTarget(target, useTrash)`.
- `server/fileOps.cjs:657-663`: `deleteTarget` es `sendToRecycleBin([target])` o `fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3 })`.
- `server/routes/transfers.cjs:44-99`: `move` acepta `sources = ['C:\\']`; entre unidades, `fileOps.cjs:620-622` copia el árbol y después `rm(src, { recursive: true })`.
- En contraste, la limpieza **sí** se protege: `server/fileOps.cjs:92-94` → `if (/^[a-zA-Z]:\\$/.test(root)) throw new Error('Refusing to clean a drive root')`. La guarda entró en `4f5a67a`; `deleteTarget` existe desde `900e871` y nunca la recibió.

**Impacto.** Una petición con el token puede borrar o mover una unidad entera. El borrado por defecto va a la Papelera (`useTrash !== false`), así que es recuperable; `useTrash: false` es `rm -rf`, y un `move` de `C:\` copia la unidad y luego borra el origen. La app es un gestor de archivos y borrar carpetas es su función, pero una raíz de volumen no es una carpeta, y la regla ya escrita para la limpieza es la que falta aquí.

**Arreglo.** Rechazar `^[A-Za-z]:\\$` en las rutas que borran y mueven (un guardia propio, o un parámetro en `assertSafePath` para no romper el listado). Decidir por escrito qué pasa con `C:\Windows` y `C:\Program Files`. Test: `POST /api/fs/delete { targets: ['C:\\'], useTrash: false }` → 400 y `POST /api/fs/move { sources: ['C:\\'], targetDir: 'D:\\x' }` → 400.

### 2.2 · Los enlaces de licencia del mapa no abren nada en Electron — **Alta (funcional y de licencia)** · ✅ corregido (§10)

**Evidencia**

- `src/components/modals/MapsModal.tsx:853-863`: el ancla de atribución llama `openLicense(event, activeLayer.licenseUrl)`.
- `MapsModal.tsx:772-778`: `openLicense` hace `preventDefault()` y `window.electronAPI.openExternal(url)`.
- `electron/externalLinks.cjs:26-35`: el allowlist **solo** acepta `https://github.com/settings/personal-access-tokens` y sus subrutas.
- `electron/main.cjs:530-536`: si el filtro rechaza, devuelve `false` y no abre nada, sin aviso.
- Las cinco URLs (`MapsModal.tsx:79, 86, 93, 100, 107`) son `openstreetmap.org`, `hotosm.org`, `cyclosm.org`, `opentopomap.org` y `memomaps.de`: **ninguna pasa**.
- Procedencia: el allowlist es de `1e50726` (30-oct, «open GitHub's token page»); los enlaces de atribución son de `749859f` (4-nov, «save a dragged rectangle as offline tiles»). La función nueva no tocó el filtro, y `electron/externalLinks.test.ts` solo fija la página del token.

**Impacto.** En la app empaquetada, pulsar «© OpenStreetMap» —o cualquiera de las otras cuatro— no abre el navegador y no dice nada. OSM exige una atribución enlazable; un enlace muerto incumple esa condición y, además, deja sin efecto una parte de la ventana de mapas que se dio por cerrada.

**Arreglo.** Ampliar el allowlist a los hosts de licencia (lista explícita, no «cualquier https») y añadir un test que recorra `MAP_LAYERS` y exija que cada `licenseUrl` sea aceptada, para que una capa nueva no vuelva a caer en el mismo hueco.

### 2.3 · `/api/tree` no exige el token de sesión — **Media** · ✅ corregido (§10)

**Evidencia**

- `server/tree.cjs:43-77`: `GET /api/tree` recorre carpetas reales (300 entradas, 4 niveles).
- `server.cjs:109-121`: `SENSITIVE_GET_ROUTES` tiene **10** entradas (`/api/drives`, `/api/user-folders`, `/api/list`, `/api/treesize`, `/api/fs/hash`, `/api/fs/jobs`, `/api/fs/dashboard`, `/__jobs`, `/api/run/suggestions`, `/api/open-with/programs`) más el prefijo `/api/fs/job/`; **no** contiene `/api/tree`.

**Impacto.** Un proceso local, o un cliente que no sea navegador, enumera la estructura de carpetas sin el secreto, mientras la misma información por `/api/list` lo exige. El modelo declarado —token para «las lecturas que describen el disco»— queda incompleto justo en la ruta que dibuja el árbol.

**Arreglo.** Añadir `'/api/tree'` al conjunto y un caso que pida sin cabecera con token configurado y espere 403. Aprovechar para decidir por escrito si `/api/processes` y `/api/net/adapters` son sensibles: hoy no lo son, y eso es una decisión, no un olvido.

### 2.4 · Electron no tiene política de permisos — **Media-baja** · ✅ corregido (§10)

`electron/main.cjs:392-407` configura `contextIsolation: true`, `nodeIntegration: false` y `sandbox: true`, pero no instala `setPermissionRequestHandler` ni `setPermissionCheckHandler`. Un renderer comprometido podría pedir geolocalización, notificaciones o captura de medios, y Chromium decidiría por su cuenta. La app no usa ninguno (la posición del mapa la resuelve el servidor por IP). Denegar por defecto antes de crear la ventana.

### 2.5 · `playwright: "latest"` — **Baja** · ✅ corregido (§10)

`package.json:109` declara `"playwright": "latest"`, mientras `@playwright/test` está en `^1.64.1` y el lockfile fija `1.64.1`. Son la pareja que debe coincidir; un `npm install` sin lock puede desalinearlas. Fijar `^1.64.1` o retirar el paquete si nada lo importa.

### 2.6 · `tsconfig.json` sin `include` ni `exclude` — **Baja** · ✅ corregido (§10)

`tsconfig.json` solo declara `allowJs: true` (línea 13). Sin `include`, `tsc --noEmit` recorre todo lo que cuelga de la raíz: `dist/`, `release/`, `public/worker-bundle.js` y `odd/`. No hay `checkJs`, así que el riesgo de errores espurios es bajo, pero el paso de tipos paga un trabajo que no sirve. Declarar `include` y excluir las salidas de build.

### 2.7 · Documentación desfasada — **Baja** · ✅ corregido (§10)

- `README.md:93` razona con «88 ficheros» de prueba; hay **138**.
- `README.md:151` dice «los 12 ficheros y 50 specs de Playwright»; hay **14 specs y 44 casos**.
- `ROADMAP.md:3` ancla la base en la **1.0.33**; el paquete está en **1.0.39** y no hay auditoría desde el 29-oct.
- `AUDIT_REPORT.md` es de otro producto (`twinpane-commander`) y afirma que no hay tests ni `engines` ni herramientas de calidad: hoy las tres cosas son falsas. Convive con tres auditorías reales y con el ROADMAP, y es el documento que más engaña a quien llega nuevo.

Actualizar las cifras, anotar la versión real y archivar o borrar `AUDIT_REPORT.md` (previo permiso: es un borrado).

### 2.8 · CI y hooks — **Baja / informativa**

- Cuatro jobs (`engines`, `verify`, `e2e`, `build`) en `windows-latest`, matriz de dos Node, `npm ci --engine-strict`, formato, tipos, tipos estrictos, eslint, tests con `--maxWorkers=2`, cobertura en el leg 22 con umbral, e2e tras `verify`, build solo en `v*` con `permissions: contents: write`, etiqueta validada contra `package.json`, `latest.yml` comprobado. Es más de lo que tiene la mayoría de proyectos así.
- Brechas cerradas el mismo día (§10.7): las cuatro acciones van fijadas por SHA con su versión en el comentario, `concurrency` cancela la corrida anterior de un PR y `npm audit` corre en cada push (producción bloqueante, total informativo). Sigue faltando Dependabot: nadie avisa de una dependencia nueva vulnerable hasta el push siguiente.
- Los hooks están bien escritos (pre-commit formatea solo lo que toca y se salta ficheros con cambios sin preparar; pre-push corre tipos y tests con un muestreador de CPU y deja log) y **ya están activos en esta copia**: `npm ci` ejecutó `prepare` y dejó `core.hooksPath = .githooks`. Siguen saltándose con 0 cuando falta `node_modules`, que es lo correcto para no bloquear una copia sin instalar.

### 2.9 · Comparación del token no es de tiempo constante — **Baja**

`server.cjs:135-137` y `150-156` comparan con `===`. Con un secreto aleatorio de 32 bytes, servicio en loopback y sin forma práctica de medir la comparación desde fuera, no es un oráculo explotable; se anota porque el resto del modelo de confianza está escrito con ese cuidado y esta pieza es la excepción.

### 2.10 · Endurecimiento del servidor — **Informativa**

- `server.cjs:471` sirve `dist/` con `express.static` sin `dotfiles: 'deny'` ni cabeceras de seguridad. La CSP va en `<meta>`, inyectada por modo en `vite.config.ts:66-80`; funciona para el documento, no para otras respuestas.
- `server/routes/files.cjs:127-146`: `write-bytes` acepta cuerpos de **512 MB** en memoria con `express.raw`, exige `root` y pasa por `assertArchiveDestination` (nada de symlinks ni de salir de la raíz) y escribe con `flag: 'wx'`. Coherente con extraer un archivo, pero el tope conviene que esté junto a los demás presupuestos.
- `rename` (`files.cjs:114-128`) rechaza `\ / : * ? " < > |` y comprueba que el destino no exista, así que `.` y `..` acaban en 409 y no hay escape de carpeta. Correcto, aunque merece un test propio.

### 2.11 · Los instaladores salen sin firmar y los nombres solo los alinea el CI — **Media-baja**

**Evidencia**

- `electron-builder` terminó con exit 0 y `release/` contiene `OmniCommander Pro Setup 1.0.39.exe` (115 803 459 B), `OmniCommander Pro 1.0.39.exe` (115 525 842 B), su `.blockmap`, `latest.yml` y `win-unpacked/`.
- `latest.yml` declara `path: OmniCommander-Pro-Setup-1.0.39.exe`, con guiones, y un `sha512` que **coincide** con el calculado sobre el fichero en disco; el tamaño declarado también (115 803 459).
- En disco el nombre lleva espacios, no guiones: `.github/workflows/release.yml:218-225` los renombra antes de subir y `:257` comprueba que coincidan. Fuera del CI, publicar el fichero tal cual rompería la actualización automática.
- `Get-AuthenticodeSignature` → `Status: NotSigned`. `electron-builder` invoca `signtool.exe`, pero no hay certificado configurado.

**Impacto.** Instalar mostrará el aviso de SmartScreen («Windows protegió tu PC») y el usuario tendrá que pasar por «Más información → Ejecutar de todas formas». La actualización automática no exige firma por defecto, así que no se rompe; lo que falta es confianza en el origen y en que el binario no se ha alterado.

**Arreglo.** Certificado de firma de código en `CSC_LINK`/`CSC_KEY_PASSWORD` como secretos del CI, firmando también el portable. Mientras no lo haya, documentar el aviso en el README.

---

## 3. Correcciones a las revisiones anteriores

| Dato | Revisión 1 | Revisión 2 (estática) | Ejecutado |
| --- | ---: | ---: | ---: |
| Ficheros de prueba | 131 | **138** | **138** ✅ |
| Casos unitarios | 678 | 909 (estático) | **1 002** |
| `any` fuera de pruebas | 33 | **4** | 4 ✅ |
| Rutas HTTP | 47 (21 GET / 26 POST) | **47** (20 / 26 / 1) | 47 ✅ |
| Specs e2e | 14 | 14 | 14 ✅ |
| Casos e2e | 44 | 44 | **54** |

La revisión 1 contaba solo `src` y la raíz; la 2 añadió `electron`, `scripts` y `server`. Las diferencias que quedan, 909 frente a **1 002** y 44 frente a **54**, no son un error de la revisión 2 sino del método estático: contar `it(`/`test(` en el texto no ve los casos que genera un bucle (`for (const caso of [...]) it(...)`). Las cifras válidas son las que reportan los ejecutores: **1 002 casos en 138 ficheros** y **54 casos e2e en 14 specs**, todos en verde.

---

## 4. Lo que está bien construido

- **Compuertas en verde y rápidas.** Suite completa en 23 s (dos pools, ver §6), cobertura del servidor en 11 s, build en 568 ms, eslint sin un aviso con `--max-warnings 0`. Un ciclo de verificación así se puede correr en cada cambio sin pensarlo.
- **Modelo de confianza de la API.** Bind a `127.0.0.1`, origen exacto `http://localhost:3000` comparado con `URL` (incluido el detalle de IPv6 entre corchetes), `Origin: null` solo con token, token por lanzamiento en `argv`, cabecera centralizada en `src/utils/fetchWithRetry.ts`, y token en query únicamente para lecturas de `<img>`/`<video>`. Los comentarios explican por qué existe cada regla, que es lo que evita que la siguiente persona la borre.
- **Rutas.** UNC y rutas de dispositivo rechazadas (`server/pathSafety.cjs`), con pruebas.
- **Integridad de copias.** Temporal `.<nombre>.omni-part-<id>` en el mismo directorio y `rename` atómico; el destino original no se abre hasta que el temporal está completo; limpieza del temporal en error, cancelación o caída (`server/fileOps.cjs:520-570`).
- **Anti zip-slip en tres capas.** `archiveEntryPath`, filtrado de entradas antes de escribir y `assertArchiveDestination` con comprobación de symlinks tramo a tramo (`server/fileOps.cjs:233-250`).
- **TreeSize** no sigue puntos de reparse, limita profundidad y declara truncamiento (`server/tree.cjs`).
- **Ejecución de procesos** sin shell: `argv` propio, elevación con `-EncodedCommand` y literales escapados, reciclaje por `-File` con argumentos, extensión validada para «Abrir con».
- **Electron**: sandbox, aislamiento de contexto, guardia de navegación por origen y por carpeta del bundle, `window.open` denegado, bandeja normalizada campo a campo, actualización que no descarga sin botón.
- **Panel de trabajos del servidor** (`server/dashboard.cjs`): todo lo que pinta pasa por `esc()`, incluidas rutas, mensajes de error y etiquetas; no hay inyección.
- **Persistencia y contraseñas**: sobre versionado con validador y migración, catálogo sin `content`, PBKDF2-SHA256 con sal por carpeta y comparación en tiempo constante.
- **Higiene del repositorio**: `.env*` ignorado con excepción de `.env.example`, `release/`, `dist/`, `coverage/` y artefactos de Playwright fuera del control de versiones, ningún secreto en el árbol, `package-lock.json` como único fichero grande y 3,12 MiB de repositorio.

---

## 5. Arquitectura y tamaño

| Fichero | Líneas | Objetivo del ROADMAP | Estado |
| --- | ---: | ---: | --- |
| `server.cjs` | 563 | < 800 | ✅ |
| `src/services/fileSystem.ts` | 962 | < 1 000 | ✅ |
| `src/App.tsx` | 746 | < 700 | ⚠️ por encima; creció ~86 líneas desde `v1.0.33` |
| `src/components/FileList.tsx` | 1 229 | — | el mayor de la interfaz, sin objetivo propio |
| `electron/main.cjs` | 645 | — | razonable para updater, bandeja, elevación e IPC |

- **261** ficheros `.ts`/`.tsx` en `src`; el servidor son 12 módulos `.cjs` más 5 ficheros de rutas.
- **47** rutas registradas (20 GET, 26 POST, 1 DELETE), sin duplicados de método + ruta.
- **4** usos de `any`/`as any` fuera de pruebas y **2** marcadores `TODO`/`FIXME`/`@ts-ignore`/`eslint-disable` entre `src`, `server` y `electron`.

El churn desde `v1.0.33` confirma dónde se trabajó: `server/fileOps.cjs` (+112/−19), `src/App.tsx` (+86/−10), `useTransferQueue.ts` (+54/−12), `TaskQueueBar.tsx` (+45/−22) y `electron/elevation.cjs` (+57), casi todo acompañado de pruebas nuevas (`fileOps.stall.test.ts` +164, `server.fileOps.test.ts` +159, `useTransferQueue.test.tsx` +130, `tree-navigation.spec.ts` +102, `elevation.test.ts` +100). La deuda de tamaño es de interfaz, no de servidor.

---

## 6. Pruebas (medidas)

| Métrica | Valor |
| --- | ---: |
| Ficheros de prueba | **138** (97 en `src`, 34 en la raíz, 4 en `electron`, 2 en `scripts`, 1 en `server`) |
| Casos unitarios ejecutados | **1 002**, todos pasan |
| Duración de la suite | **23 s** (20,5 s de tests) |
| Ficheros/casos del servidor | **32 / 228**, todos pasan, 11 s |
| Cobertura de `src` | 58,19 / 51,99 / 46,79 / 61,17 % |
| Cobertura del servidor | 61,2 % de líneas, 63,3 % de funciones |
| Specs e2e / casos e2e | **14 / 54**, todos pasan en 2,2 min |
| Historias de Storybook | 9 |
| Umbral de cobertura | 57 / 51 / 46 / 60, superado en los cuatro |

La estructura sostiene el resultado: el servidor se prueba arrancándolo de verdad (`scripts/serverHarness.ts`), hay suites por módulo (jobs, transfers, files, space, maps, árbol, limpieza) y la cobertura del servidor tiene su propio script con cierre ordenado. Los dos pools de Vitest —`vmThreads` para casi todo y `threads` para los tres ficheros que no toleran ese VM, con el motivo escrito en `vite.config.ts`— son la razón de que 1 002 casos quepan en 23 s.

El e2e también está medido: 14 specs y **54 casos en 2,2 min** sobre Chromium 156, con los dos servidores levantados por Playwright en puertos que pide al sistema (no reutiliza los del desarrollo). Cubre carga de la app y controles de ventana, navegación de árbol, cola de transferencias, quick view de texto, binario y audio, diferencias entre paneles y copia bidireccional. Las dos líneas «Archive listing failed…» que aparecen en el log son las pruebas negativas de archivos cifrados y contraseña incorrecta, no fallos.

---

## 7. CI, release e historial

**CI/release.** Un solo workflow, `contents: read` por defecto y `write` solo en `build`; el job `engines` lee el suelo del propio `package.json` en vez de duplicarlo; `verify` corre dos versiones de Node con `--engine-strict`; la cobertura se mide en el leg 22 y no se repite la suite; `e2e` depende de `verify`; `build` depende de los dos y solo corre en `v*`; se valida que la etiqueta coincida con la versión, se renombran artefactos sin espacios, se comprueba `latest.yml` contra los ficheros y se publica como prerelease si la versión lleva sufijo.

**Historial.** 385 commits, **un solo autor** (`earenbaz80`), del 26-oct al 6-nov; 20 commits desde `v1.0.33`. Mensajes convencionales en los últimos 200: `chore` 49, `refactor` 34, `fix` 34, `test` 27, `feat` 26, `docs` 20, `ci` 7, `perf` 2, `build` 1. Cada etiqueta de la 1.0.34 a la 1.0.39 es **un único commit** de release, y `v1.0.39` apunta al mismo commit que `master`: la disciplina de etiqueta = versión que exige el workflow se cumple en las seis últimas.

Esa concentración en un autor es el riesgo de proceso real del proyecto: no hay revisión cruzada, y las auditorías son el único control externo que ha tenido.

---

## 8. Prioridades

1. ✅ **Rechazar raíces de unidad en `delete` y `move`** (§2.1), con test. Era el único hallazgo destructivo. Hecho en §10.1.
2. ✅ **Arreglar los enlaces de licencia del mapa** (§2.2): allowlist por host y un test que recorra `MAP_LAYERS`. Hecho en §10.2.
3. ✅ **Token en `/api/tree`** (§2.3) y **política de permisos en Electron** (§2.4). Hecho en §10.4 y §10.5.
4. ✅ **Reproducibilidad**: fijar `playwright` (§2.5) y `include`/`exclude` en `tsconfig` (§2.6). Hecho en §10.6; queda retirar el `openExternal` sin consumidor de `useAppUpdate`.
5. ✅ **Documentación**: README con las cifras reales, ROADMAP a 1.0.39 y `AUDIT_REPORT.md` archivado (§2.7). Hecho en §10.6.
6. **Firma de los instaladores** (§2.11): hoy salen `NotSigned` y SmartScreen avisará en cada instalación. El `npm audit` del CI ya está en §10.7; queda Dependabot para enterarse sin esperar al push.

---

## 9. Verificación de esta pasada

```text
git rev-parse HEAD                     → 00186b9 (== v1.0.39 == origin/master)
git status --porcelain                 → 0 ficheros modificados
npm ci                                 → 971 paquetes; package-lock.json idéntico (sha256)
npm run format:check                   → exit 0, "All matched files use Prettier code style!"
npm run lint (tsc --noEmit)            → exit 0, sin salida
npm run typecheck:strict               → exit 0, sin salida
npm run lint:eslint                    → exit 0, --max-warnings 0
npm run test:coverage                  → exit 0; 138 ficheros, 1002 casos en 23 s
                                          58,19 / 51,99 / 46,79 / 61,17 % (umbral 57/51/46/60)
npm run test:server:coverage           → exit 0; 32 ficheros, 228 casos en 11 s
                                          61,2 % líneas, 63,3 % funciones
npm run build                          → exit 0; 568 ms, 61 ficheros, 59 precache (1547 KiB)
npm audit --omit=dev                   → exit 0; 0 vulnerabilidades
npm audit                              → 4 bajas (deepmerge vía workbox-build, solo dev)
npx playwright install chromium        → exit 0; Chromium 156 + headless shell (118 MiB, 31 s)
npm run test:e2e                       → exit 0; 14 specs, 54 casos, 2,2 min, 0 fallos
node node_modules/electron/install.js  → exit 0; electron.exe 245 775 872 B (44.10.0)
npm run build:electron                 → exit 0
npx electron-builder --publish never   → exit 0 en 102 s; NSIS + portable 115,8 / 115,5 MB
                                           latest.yml: sha512 y tamaño == fichero en disco
                                           firma: NotSigned; NSIS válido (7z, 197 bloques)
```

**Nota de entorno.** Al empaquetar, la unidad **C: estaba en 0 bloques libres** y `TEMP=/tmp` vive ahí: el primer intento murió con `ENOSPC` a los 12 s. Se movieron `TEMP`/`TMP`, `ELECTRON_CACHE` y `ELECTRON_BUILDER_CACHE` a `G:\tmp`, se limpió la caché de npm (regenerable, unos 350 MB) y el empaquetado completó. Conviene no dejar C: a cero: `npm ci` y cualquier instalador la consumen.

Los dos servidores de desarrollo quedaron corriendo para la revisión visual: `npm run server` en `127.0.0.1:3001` y `npm run dev` en `:3000`, con la interfaz cargando ambos paneles sobre `C:\` y `/api/list` respondiendo 200 a través del proxy.

---

## 10. Correcciones aplicadas tras el informe

Los dos hallazgos altos se corrigieron ese mismo día, con pruebas, y las compuertas se volvieron a pasar después.

### 10.1 · Raíz de unidad en `delete` y `move`

- `server/pathSafety.cjs`: nuevas `isDriveRoot(value)` (reconoce `C:`, `C:\`, `D:/`) y `assertMutablePath(value)`, que rechaza la raíz antes de normalizar. `assertSafePath` **no** cambia: listar y abrir una raíz sigue permitido, porque los paneles la necesitan.
- `server/routes/transfers.cjs`: `delete` rechaza cualquier objetivo que sea raíz; `move` rechaza cualquier fuente que lo sea. El destino de una copia o de un movimiento puede seguir siendo una raíz, que es una carpeta más.
- `server/fileOps.cjs`: la misma comprobación dentro de `deleteTarget` y `moveTree`, para que ningún otro llamador pueda saltársela.
- Pruebas: `server.pathsafety.test.ts` (+4 casos) y `server.transfers.routes.test.ts` (+3: borrar `C:\` → 400, mover `D:/` → 400, y una carpeta normal sigue dando 200).

### 10.2 · Enlaces de licencia del mapa

- `electron/externalLinks.cjs`: allowlist explícita `LICENSE_PAGES` con las cinco páginas (origen exacto y ruta) además de la del token. Sigue rechazando `http:`, credenciales en la URL y hosts parecidos como `www.openstreetmap.org.evil.com`.
- `src/components/modals/MapsModal.tsx`: `MAP_LAYERS` pasa a exportarse para poder probar el acoplamiento entre las capas y el filtro del shell.
- Pruebas: `electron/externalLinks.test.ts` (+2 casos) y `src/components/modals/MapsModal.licenses.test.ts` (nuevo), que recorre `MAP_LAYERS` y exige que cada `licenseUrl` pase el filtro: una capa nueva con otra licencia falla el test en vez de dejar un enlace muerto.

### 10.3 · Compuertas después del cambio

| Medida | Antes | Después |
| --- | ---: | ---: |
| Ficheros de prueba | 138 | **139** |
| Casos unitarios | 1 002 | **1 013** |
| Casos del servidor | 228 | **235** |
| Cobertura de `src` | 58,19 / 51,99 / 46,79 / 61,17 % | igual |
| Cobertura del servidor | 61,2 % líneas | 61,5 % líneas (63,4 % funciones) |
| Formato, tipos, tipos estrictos, eslint | verde | verde |
| Build | 568 ms | 599 ms |

### 10.4 · Token en `/api/tree`

- `server.cjs`: `'/api/tree'` entra en `SENSITIVE_GET_ROUTES`, con el comentario de por qué: dibuja el mismo árbol que `/api/list`, que ya lo exigía.
- Pruebas: `server.sessionToken.test.ts` (nuevo, 3 casos): sin cabecera → 403; con `x-omni-token` → nunca 403; y `/api/drives` sigue respondiendo 403 / 200 como antes.

### 10.5 · Política de permisos en Electron

- `electron/permissions.cjs` (nuevo): `denyAllPermissions(session)` registra `setPermissionRequestHandler` con `callback(false)` y `setPermissionCheckHandler` con `false`; devuelve `false` si la sesión no expone los manejadores.
- `electron/main.cjs`: lo llama sobre `session.defaultSession` dentro de `whenReady`, **antes** de crear la ventana.
- Pruebas: `electron/permissions.test.ts` (3 casos) con una sesión falsa: toda petición se deniega, la comprobación responde `false` y una sesión incompleta no rompe.

Tras estos dos, las compuertas quedan en **141 ficheros y 1 019 casos**, con formato, tipos, eslint y build en verde (910 ms).

### 10.6 · Reproducibilidad y documentación

- `package.json`: `playwright` pasa de `"latest"` a `^1.64.1`, la versión que fija el lockfile y con la que debe ir `@playwright/test`. El `package-lock.json` se regeneró con `npm install --package-lock-only` y `npm ci --dry-run` confirma que siguen en sincronía.
- `tsconfig.json`: `include` con el código real (`*.ts`, `*.tsx`, `*.cjs`, `src`, `electron`, `server`, `scripts`, `e2e`) y `exclude` con las salidas (`node_modules`, `dist`, `dev-dist`, `release`, `coverage`, `server-coverage`, `public`, `odd`). El paso de tipos ya no recorre bundles ni la copia de otra app.
- `README.md`: «88 hoy» y «88 ficheros» pasan a 141, y «los 12 ficheros y 50 specs» a «14 ficheros y 54 casos», que es lo medido.
- `ROADMAP.md`: la base pasa de `3227efe` (1.0.33) a `00186b9` (1.0.39).
- `AUDIT_REPORT.md` se movió a `docs/archive/AUDIT_REPORT-twinpane-commander.md`: es de otro producto y afirmaba lo contrario de lo que hay hoy.

### 10.7 · Endurecimiento del CI

- Acciones fijadas por SHA, resueltos con `git ls-remote` sobre las etiquetas que el workflow ya usaba (no se subió de major): `checkout` v4.4.0, `setup-node` v4.4.0, `upload-artifact` v4.6.2 y `action-gh-release` v2.6.2, cada uno con la versión en un comentario al lado. Una etiqueta mayor puede moverse bajo los pies; un SHA no.
- `concurrency` con grupo por workflow y `ref`: un PR que recibe otro push cancela su corrida anterior; una etiqueta no se cancela nunca, porque la publicación de la release ocurre a mitad del job y no tiene un punto seguro donde parar.
- `npm audit --omit=dev` bloquea el push (hoy 0 vulnerabilidades) y `npm audit` completo corre con `continue-on-error` para que las 4 bajas de desarrollo se vean sin tumbar la release; el porqué está escrito junto al paso.
- Comprobado en local: `prettier --check` parsea el YAML, `npm run format:check` sigue en verde, `npm audit --omit=dev` sale con 0 y `npm audit` con 1.

Con esto quedan cerrados todos los hallazgos del informe salvo los de distribución: la firma de los instaladores (§2.11) y las 4 vulnerabilidades bajas de desarrollo.

Las correcciones no cambiaron ninguna interfaz HTTP ni firma existente: los casos que ya pasaban siguen pasando, y los nuevos solo añaden rechazos que antes no existían.
