# Hoja de ruta — OmniCommander Pro

**Fecha:** 3-nov-2026 · **Base:** `1e17d54` (1.0.30 más seis unidades de la jornada) · **Alcance:** los arreglos que salieron del análisis del código de ese commit.

**Corrección de partida:** en el análisis se dijo que no había CI por push. Es falso. [`.github/workflows/release.yml`](.github/workflows/release.yml) se llama «CI and Release» y ya ejecuta, en cada push a `master` y en cada PR: formato, tipos, tipos estrictos, eslint, tests unitarios y los e2e; el empaquetado y la publicación solo ocurren con una etiqueta `v*`. Lo que falta en el CI no es el gate, es la **cobertura** y un **presupuesto de tiempo**. El resto del plan se apoya en ese gate, no lo repite.

---

## 0. Punto de partida (medido, no estimado)

| Dato | Valor | Cómo se midió |
| --- | --- | --- |
| Tests | 741 en 97 ficheros | `npx vitest run` |
| Tests del servidor | 20 ficheros | `ls server.*.test.ts` |
| Cobertura de `src/**` | 46,68 % sentencias · 40,85 % ramas · 37,97 % funciones · 48,78 % líneas | `npm run test:coverage` (sin tests ni stories) |
| `server.cjs` en esa medida | **fuera, y no puede entrar así** | cada suite lo arranca como proceso hijo; V8 solo informa del suyo |
| Duración | 134 s con cobertura y 4 workers | el entorno jsdom se crea 97 veces y se lleva el 39 % |
| Dependencias de producción | 7 · 0 vulnerabilidades | `npm audit --omit=dev` |
| `tsc --noEmit` y `typecheck:strict` | limpios | `npm run lint`, `npm run typecheck:strict` |
| eslint | 0 avisos con `--max-warnings 0` | `npm run lint:eslint` |
| Bundle | 546 kB (152 kB gz) el trozo principal · 33 trozos perezosos · CSS 14 kB gz | `vite build` |
| Mayores ficheros | `server.cjs` 4 710 · `fileSystem.ts` 2 210 · `App.tsx` 1 792 · `FileList.tsx` 1 229 | `wc -l` |
| Marcadores | 1 TODO · 0 `eslint-disable` · 0 `@ts-ignore` · 75 `any`/`as any` · 62 usos de `localStorage` | `grep` sobre `src`, `electron`, `server.cjs` |

La auditoría del 29-oct hablaba del 54,01 % de cobertura y 44 `any`; son medidas de otro commit y con otro ámbito, así que no se comparan con esta tabla. Lo que sí sigue siendo cierto de aquella: `release/` ocupa cientos de MB, la raíz acumula volcados `.txt` (ignorados por git, pero presentes), y `server.cjs` es el fichero que más crece.

---

## 1. Cómo se ordena

1. Primero lo que **mide** y lo que **avisa**: sin cobertura y sin una suite estable, cada fase siguiente se hace a ciegas.
2. Después lo que **envejece mal**: los dos monolitos. Cuanto más crezcan, más caro es dividirlos.
3. Luego lo **transversal**: persistencia, tipos en la frontera, accesibilidad de lo nuevo.
4. Al final lo **cosmético o de proceso**: mapa, release, firma.

Cada fase se cierra con: suite verde, `typecheck:strict`, eslint sin avisos, e2e verde cuando toque UI, y **un commit por unidad de trabajo** (no un commit por fase).

Tallas: **S** ≈ una sesión · **M** ≈ dos o tres · **L** ≈ cuatro o más, partidas en tandas.

---

## 2. Fases

### F0 · Medir la cobertura y publicarla en el CI — S

**Por qué:** la cobertura existía como medición manual, sin script y sin umbral, así que nadie la miraba y nada impedía que bajara.

**Hecho, en este commit:**

- `npm run test:coverage` mide `src/**/*.{ts,tsx}` sin los ficheros de test ni las stories, que si no suben el número solos al crecer la suite.
- Umbral en `vite.config.ts` igual a la línea base redondeada a la baja: 46 sentencias, 40 ramas, 37 funciones, 48 líneas. Sube solo cuando sube el número real.
- En el CI un solo leg mide en vez de repetir la suite: el leg de Node 22 corre `test:coverage` y sube `coverage/` como artefacto, también cuando falla. El tiempo del job no cambia.

**Lo que esta fase no puede hacer:** `server.cjs` no entra en la medida, y no es un olvido. Cada suite lo arranca como proceso hijo (`scripts/serverHarness.ts`) y la cobertura de V8 solo describe el proceso en el que corre; incluirlo daría cero sobre 4 710 líneas y un número falso. Medirlo pide `NODE_V8_COVERAGE` en ese hijo y una pasada que una los informes: es la tanda 0 de la F2, donde además habrá algo que medir.

**Riesgo:** bajo. El umbral está donde hoy llega el código; el peligro habría sido ponerlo en una aspiración y bloquear `master` desde el primer push.

---

### F1 · Suite rápida y sin falsos rojos — S/M

**Por qué:** 124 s de suite con 4 workers y dos rojos que no eran fallos: `server.systemload.test.ts` exigía ≥250 ms entre medidas y `server.cleanup.test.ts` se quejaba del bloqueo del fichero temporal. Una suite que miente acaba ignorándose.

**Hecho, en este commit:**

- El reparto por entorno ya existía y funciona: 43 ficheros declaran `// @vitest-environment node` y se respeta (comprobado con una prueba que exige que no haya `document`). El aviso «jsdom se creó 97 veces» engañaba: son los 54 ficheros de DOM, a unos 3 s cada uno. No había nada que separar, así que no se separó nada.
- `vmThreads` crea ese entorno una vez por worker en vez de una por fichero: **124 s → 89 s** con cobertura. No puede con tres ficheros, que se quedan en el pool normal y están listados en `vite.config.ts`: `vite.config.test.ts` y `scripts/engines-floor.test.ts` fallan al recolectarse dentro de la VM, y `SettingsModal.password.test.tsx` no ve sus mocks de PBKDF2. Con todo en vmThreads, 7 tests en rojo; con el reparto, 741 verdes.
- `server.systemload.test.ts` ya no compara contra el literal 250: el módulo exporta `CPU_WINDOW_MS` y la aserción usa 50 ms de tolerancia, que conserva el significado —una respuesta que no esperó no puede caer a 50 ms de la ventana—.
- `server.cleanup.test.ts`: el presupuesto para que PowerShell tome el bloqueo pasa de 10 s a 30 s, y su `beforeAll` de 40 s a 90 s. El marcador sigue probando que el handle está tomado antes de que corra ningún test.
- Tres ejecuciones seguidas de los dos ficheros reparados, verdes.

**Lo que no se hizo, y por qué:** `isolate: false` no llegó a probarse, porque el ahorro salió sin compartir registro de módulos entre ficheros. Y el «menos de 120 s» del CI no se puede afirmar desde aquí: el CI corre con `--maxWorkers=2` y el número real hay que leerlo del tiempo del paso, no de esta tabla.

**Falso rojo encontrado después, y arreglado:** una corrida completa hizo fallar los seis tests de `server.readbytes.test.ts` con `fetch failed: bad port`, y la siguiente pasó entera. No era el código: `fetch` (undici) rechaza ciertos puertos —6566 y 6665-6669 caen dentro del rango efímero de Windows— y `freePort()` podía devolver uno de ellos, con lo que el servidor arrancaba bien y la URL era inalcanzable. El arnés ahora descarta esos puertos antes de usarlos (`isFetchablePort`). Es el segundo rojo de esta clase que aparece, así que el contador «0 en diez ejecuciones» de la sección 5 sigue sin cumplirse.

**Trampa que queda:** un test nuevo que no funcione en vmThreads aparecerá como rojo sin explicación. Si pasa, se añade a la lista del proyecto `threads` con el motivo escrito al lado, como los otros tres.

---

### F2 · Dividir `server.cjs` — L, en tandas

**Por qué:** 4 710 líneas, 16 rutas, el motor de transferencias, el SSE y un panel HTML con su propio JavaScript embebido que no pasa por TypeScript ni por eslint.

Tandas, cada una un commit:

0. **Medir el servidor — hecho.** `npm run test:server:coverage` corre las 20 suites con `NODE_V8_COVERAGE` y suma los volcados de cada hijo: **`server.cjs` está en 65 % de líneas (3 075/4 728) y 75,2 % de funciones (235/317)**; `server/pathSafety.cjs`, 97,1 %, y `server/systemLoad.cjs`, 93,5 %. Hubo que resolver dos cosas para que el número existiera: un hijo matado no escribe su volcado —en Windows `kill()` no ejecuta nada dentro del proceso—, así que el servidor expone un cierre ordenado `/api/__coverage-shutdown` **solo** cuando la medición define `SERVER_COVERAGE_SHUTDOWN`, y el arnés lo llama antes de matar; y V8 anida los bloques que no corrieron dentro de la función que sí, así que el primer cálculo daba 100 % — ahora decide el rango más pequeño que llega a cada línea. Es cobertura de líneas por bloques, no de ramas: sirve para comparar antes y después de partir el fichero, que es para lo que está.
1. **Rutas de sistema** (`/api/fs/*`, unidad, drives) → `server/routes/fs.cjs`. Ya hay precedente en `server/pathSafety.cjs` y `server/systemLoad.cjs`. **Primera tanda hecha:** las cuatro rutas que solo leen el motor de trabajos (`/api/fs/jobs`, `/api/fs/dashboard`, `/api/fs/job/:id`, `/api/fs/job/:id/:action`) viven ahora en `server/routes/jobs.cjs`, con sus dependencias pasadas explícitamente y seis tests propios que no arrancan un servidor completo. Después salieron `/api/fs/copy`, `/api/fs/move`, `/api/fs/delete` y la limpieza a `server/routes/transfers.cjs` (168 líneas, 4 tests), y las rutas de un solo camino —`mkdir`, `sendto`, `exists`, `rename`, `write-bytes`, `write`, `stat` y `read-bytes`— a `server/routes/files.cjs` (247 líneas, 8 tests). `server.cjs` va de 4 728 a 4 365 líneas. Quedaban dentro: archivos comprimidos, el diálogo Ejecutar, el motor de trabajos, el panel HTML y el arranque. Los archivos comprimidos salieron a `server/archiveReader.cjs` (476 líneas, 4 tests de contrato más las 29 comprobaciones con ficheros reales): es un subsistema con dos lectores WASM, no un bloque de rutas. `server.cjs` queda en 3 914 líneas. **Después salió el diálogo Ejecutar** a `server/runLauncher.cjs` (816 líneas): el primer intento se había revertido porque el bloque usaba `assertSafePath` e `isAbsoluteLocalPath` sin declararlos y siete tests de `/api/open` devolvían 400; esta vez el módulo requiere `server/pathSafety.cjs` él mismo y solo recibe `logDebug`, y el traslado fue mecánico —el bloque se copió tal cual, dedentado, sin reescribir una línea—: 769 líneas movidas y 15 tests propios sobre las reglas puras (argv, alias de carpetas, resolución y la cotización del script de elevación). `server.cjs` queda en **3 150 líneas**. Después salieron la comprobación de espacio, el hash real y las listas de copia a `server/routes/space.cjs` (191 líneas, 9 tests propios que arman un servidor mínimo con el medidor de árboles inyectado, para describir la aritmética de volúmenes sin recorrer un disco): `server.cjs` queda en **2 967 líneas**.
2. **Rutas de mapa** (teselas, búsqueda, caché offline) → `server/routes/maps.cjs`. Es la más reciente y la más autocontenida; sirve de ensayo.
3. **Motor de trabajos** (cola, pausa, reanudación, SSE) → `server/jobs.cjs`.
4. **Panel HTML de transferencias** (`server.cjs:1682` en adelante) → fuera del servidor o a `server/dashboard.cjs`, con su escape revisado.
5. El `server.cjs` que queda es arranque, middlewares y registro de rutas.

**Cierre de la F2 (esta tanda).** Lo que quedaba salió en seis módulos más: `server/jobEngine.cjs` (la cola, las instantáneas y la pausa, como fábrica), `server/dashboard.cjs` (el panel de `/__jobs`, ya sin estado ajeno), `server/fileOps.cjs` (limpieza, copia y movimiento con sus conflictos, Send-To y el lanzador de trabajos: 824 líneas), `server/routes/maps.cjs` (teselas, caché offline, búsqueda y localización), `server/openWith.cjs` (el registro de programas y el arranque de uno) y `server/catalog.cjs`, `server/processes.cjs` y `server/tree.cjs` (unidades y listado con su caché, procesos y adaptadores, árbol y TreeSize). **`server.cjs` pasa de 3 150 a 534 líneas**: origen y token, arreglo de puertos, middlewares, arranque y el registro de rutas. Cada módulo nuevo tiene test propio — 20 del motor y el panel, 5 de contrato de los demás — y ningún contrato HTTP cambió: la suite pasó de 109 ficheros y 822 tests a 114 y 847, todos verdes.

El traslado se hizo con la misma receta que en las tandas anteriores —copiar el bloque tal cual, dedentarlo, envolverlo en su fábrica y sustituirlo por su llamada—, y una comprobación nueva hizo el resto: eslint con `no-undef` sobre cada módulo recién copiado enumera lo que le falta, así que las dependencias salieron de ahí y no de leer 800 líneas a ojo. Dos cosas hubo que ordenar a mano: el catálogo se construye después de las operaciones de fichero porque su resolución de carpetas vive allí, y `/api/tree` cayó en el módulo de procesos por dónde estaba su comentario; ahora está con TreeSize, donde corresponde.

**Hecho cuando:** `server.cjs` baja de 800 líneas, ningún contrato HTTP cambia, y cada módulo nuevo tiene al menos un test propio.

**Riesgo:** alto si se hace de golpe (16 rutas comparten estado de trabajos y token). Por eso tandas pequeñas, con la suite y los e2e entre una y otra.

---

### F3 · Adelgazar `App.tsx` y `fileSystem.ts` — M/L

**Por qué:** `App.tsx` son 1 792 líneas y 22 `useState`; `fileSystem.ts`, 2 210 líneas con transferencias, compresión, hashes y colas. `usePanels` ya demostró que extraer funciona.

Tareas:

- Sacar de `App.tsx` el sondeo de unidades y el estado de modales a hooks propios (`useDrives`, `useModalStack`).
- Sacar los atajos de teclado a `useGlobalShortcuts` con su tabla de comandos en un solo sitio.
- En `fileSystem.ts`, separar transferencias (`fileTransfer.ts`), compresión (`fileArchiveOps.ts`) y hashes, dejando el módulo como fachada. Mantener los re-exports para no tocar a los consumidores.
- Objetivo: `App.tsx` por debajo de 700 líneas, `fileSystem.ts` por debajo de 1 000.

**Primera tanda hecha (este commit).** El sondeo de unidades y la suscripción al catálogo vivían en dos `useEffect` de `App.tsx` que tenían que concordar entre sí: uno preguntaba al servidor cada cinco segundos y el otro republicaba lo que la tienda ya sabía. Ahora son un solo `useDrives`, que devuelve la lista y no expone su `setState`; App dejó de tener el estado de unidades y de saber cada cuánto se reintenta. `App.tsx` baja de 1 781 a 1 757 líneas —poco, porque el objetivo de esta fase es el reparto, no el recuento— y la suite no cambia ni un resultado: 114 ficheros y 847 tests.

**Segunda tanda (este commit).** El estado de modales y el embudo de transferencia salieron a `useModalStack`: qué ventana está abierta, con qué datos y qué ficheros, incluidos los tres disparadores de copiar/mover/borrar. La instantánea de la selección se toma al abrir, que es la regla que el comentario del viejo `App.tsx` documentaba y que un refactor ya había roto una vez; ahora la regla y el test viven juntos, y `selectionRef` deja explícito el único ciclo que quedaba (los paneles saben qué está seleccionado, pero necesitan el setter). `setActiveModal` sigue siendo estable, porque lo consumen `usePanels` y los atajos: un setter nuevo por render reiniciaría ambos. `App.tsx` baja de 1 757 a 1 733 líneas; 5 tests nuevos del hook (instantánea, selección vacía, modal ajeno, actualizador funcional, estabilidad del setter).

**Tercera tanda (este commit).** La compresión salió a `fileArchiveOps.ts`: montar, crear y extraer un archivo comprimido eran 340 líneas seguidas de `FileSystemEngine` que tocaban dieciocho miembros suyos —la aritmética de rutas, el índice del catálogo, el puente con el servidor y la recarga del directorio—. Ahora es una fábrica que recibe esos miembros por nombre, y el motor conserva los mismos métodos públicos como delegados, así que ningún consumidor cambia. Nace perezosa porque varias de sus dependencias son métodos que leen estado que el constructor rellena. `fileSystem.ts` baja de 2 207 a 2 006 líneas, con 5 tests propios de dependencias falsas: montaje vacío, TAR creado y catalogado, extensión según el formato escrito, negativa a pisar un nombre listado y bytes guardados en base64. Queda para la siguiente tanda el otro corte de la fase: las transferencias, y bajar `App.tsx` de sus 1 731 líneas.

**Hecho cuando:** no cambia ni un comportamiento observable (los e2e y los tests de componentes siguen iguales) y los ficheros bajan de esos umbrales.

**Riesgo:** medio. Es refactor puro; el peligro es mezclarlo con arreglos funcionales en el mismo commit.

---

### F4 · Persistencia y tipos en la frontera — M

**Por qué:** 62 usos de `localStorage`, cada uno con su `try/catch`; un valor corrupto resetea un ajuste en silencio. Y 75 `any`/`as any`, casi todos donde la respuesta del servidor se convierte en tipos del cliente.

**Hecho, primera tanda (este commit):**

- `src/services/storage.ts`: `readStored(key, spec)` con `validate`, `version` y `migrate`, más `writeStored` y `removeStored`. El valor vive en un sobre `{version, value}`; lo escrito antes del sobre se lee como versión 0, **incluida una palabra suelta que no es JSON**. Un valor que ya encaja con la forma actual se usa tal cual — si no, cada ajuste existente se habría reseteado una vez al desplegar, que es el fallo que este módulo existe para evitar — y solo lo que no encaja pasa por `migrate`. Lo que no se puede rescatar se borra con su clave, en vez de repetir el mismo error en cada montaje.
- `usePersistedState` escribe el sobre al cambiar y **no** al montar: si escribiera al montar, una clave inexistente aparecería con el valor por defecto y «nunca configurado» dejaría de distinguirse de «configurado al valor por defecto».
- Migradas tres claves: el historial de la calculadora (que además rescata las líneas buenas de una lista a medias), los anchos de columna y la elección de qué hacer al terminar una transferencia. Esa última estaba dos veces, con su lector y su literal en `CopyMoveModal` y en `TransferMonitorModal`; ahora un solo módulo decide qué significa el valor guardado.
- Tests nuevos: 9 del módulo, 4 del hook y 4 de la elección, además de los que ya cubrían los anchos de columna.

**Segunda tanda (este commit):** los ajustes (`nc_settings_v1`, el valor con el que arranca la app), el historial de búsqueda y los marcadores. Los ajustes conservan su normalización (`normalizeProtectedFolders`, `migrateThemeId`) y ahora se leen como versión 2; un objeto guardado sin envoltorio sigue siendo válido y se usa tal cual, que es lo que impide que la actualización resetee todo una vez. Tests: la clave de ajustes en sus cuatro formas (nada guardado, objeto antiguo, envoltorio, valor corrupto), además del que ya cubría las contraseñas en claro.

**Tercera tanda (este commit):** el árbol de ficheros —unidades, listado y papelera— a `filesystemStorage.ts`, con un validador por lista y la entrada dañada filtrada en vez de tirar el catálogo entero. La duda de la tanda anterior se resolvió leyendo el código: `initialDrives` e `initialFiles` son listas vacías, así que «sembrar las iniciales» y «no hay nada» resultaban ser lo mismo y no había decisión de producto que tomar. Tests: catálogo ausente, guardado antiguo sin envoltorio, envoltorio, entrada dañada entre buenas, clave corrupta que no arrastra a las demás y escritura fallida.

**Cierre del almacenamiento:** el plan de transferencia que sobrevive al reinicio elevado (`omnicommander.pendingElevatedTransfer`) también pasa por el lector, y con él no queda ningún `localStorage` crudo fuera de `storage.ts` y `filesystemStorage.ts`; lo que sigue leyendo del navegador lo hace detrás de una tienda inyectable (`calendarStore`, `runLauncher`), que ya era la forma correcta.

**Cierre de la F4:** los `any` explícitos salieron de `src` y `@typescript-eslint/no-explicit-any` vuelve a estar en `warn` con `--max-warnings 0`, así que uno nuevo rompe el lint en vez de acumularse. El puente de Electron es ahora una interfaz (`electronBridge.ts`) en lugar de `(window as any)` en cada llamada; los `catch` dejan de suponer que lo lanzado es un `Error`; los modales comparten `ModalData`; y las respuestas del servidor tienen su forma escrita (`ServerListItem`, `ScanMessage`, `Record<string, unknown>`). Los dobles de test conservan el `any` por configuración: describir un stub entero no le aporta nada a quien lo lee. Con esto la F4 queda cerrada.

**Riesgo:** bajo, pero toca ajustes del usuario: cada migración necesita su test de valor corrupto y de valor antiguo, que es lo que esta tanda añade.

---

### F5 · Accesibilidad de lo interactivo nuevo — S

**Por qué:** mover y redimensionar ventanas era solo ratón; el tirador era un `role="separator"` sin orientación ni valores, y no había forma de colocar una ventana con teclado.

**Hecho, en este commit:**

- La barra de título es un asa de teclado: `Tab` hasta ella y las flechas mueven la ventana 16 px; `Shift+flechas` la redimensionan. Se queda fuera cuando la ventana está maximizada, porque ahí no hay nada que mover.
- La esquina es un `separator` enfocable, con `aria-orientation`, `aria-valuemin` y `aria-valuemax`; `aria-valuenow` aparece en cuanto hay un tamaño propio, porque antes el ancho es el que le da el diseño del diálogo y no uno que este código controle. Sus flechas redimensionan 16 px y con `Shift`, 4 px para ajustar fino.
- Una región `role="status"` anuncia el tamaño después de cada pulsación (`416 × 300`), que es lo único que lo dice: nada en pantalla lo imprime.
- `useModalDialog` sigue atrapando el `Tab` en todos los paradas nuevas, pero el foco inicial prefiere un control de verdad: si no, cada diálogo abriría con el foco en su propia barra y habría que tabular antes de poder hacer nada.

**Lo que queda de esta fase:** el caso con `axe` sobre un modal movido. Hoy no hay `@axe-core/playwright` en el proyecto y la guarda de roles existente (`modalA11y.guard.test.ts`, 77 comprobaciones) sigue cubriendo lo que sí se puede afirmar sin navegador; añadir la dependencia es una decisión aparte, no un detalle de esta fase.

**Riesgo:** el que tenía. El cambio de foco inicial afecta a todos los diálogos, así que se comprobó con la suite entera, no solo con su test.

---

### F6 · Mapa: gestión de la caché y descarga por zona — M

**Por qué:** la caché offline ya existe y guarda 20 000 teselas como máximo, pero el usuario no ve cuánto ocupa ni puede vaciarla, y solo se descarga lo que está a la vista.

Tareas:

- Línea de estado en el diálogo: teselas guardadas y MB, con botón de vaciar (reutiliza `DELETE /api/maps/cache` si se añade).
- Descarga por rectángulo arrastrado sobre el mapa, con su propio tope por tanda.
- Enlazar la atribución de cada capa con su página de licencia (requisito de OSM/OpenTopoMap/CyclOSM).
- Test del recorte del rectángulo en `tilesCoveringView` y del vaciado en `server.maps.test.ts`.

**Hecho (este commit).** El diálogo dice cuántas teselas guarda y cuánto pesan, leídas de la carpeta de disco (`GET /api/maps/cache`) en vez de deducidas de lo descargado en esta sesión, y las vacía con `DELETE /api/maps/cache`: memoria, caché de búsquedas y el árbol entero, no solo los ficheros. Un rectángulo arrastrado fija la zona (`tilesCoveringRect`), se guarda a los mismos tres niveles que «guardar lo visible» y pasa por el mismo bucle de tandas, que ahora comparten función: 900 teselas como tope por rectángulo, 40 por petición y concurrencia 2 en el servidor, para no convertir una selección ambiciosa en un rastreo. La atribución de cada capa es un enlace a su licencia que se entrega al shell, porque la ventana bloquea la navegación.

Tres cosas que solo aparecieron al ejecutar los tests. La primera: el guardián del token miraba únicamente la query, que es lo que necesita un `<img>`; ahora acepta también la cabecera, que es lo que puede mandar el `fetch` del vaciado. La segunda: en la latitud límite la proyección cae una pizca por debajo de cero, el suelo de la fila daba `-1` y el rango salía vacío — un arrastre pegado al polo no habría guardado nada. La tercera: el antimeridiano, donde el oeste es numéricamente mayor que el este y normalizar con mínimo y máximo habría convertido una selección de dos columnas en la vuelta al mundo; las columnas caminan en espacio de mundo y se pliegan con el mismo `wrap` que ya usaba el guardado por vista.

Tests: 4 del servidor (recuento y peso reales, carpeta ausente, vaciado completo, 403 sin token y 200 con cabecera), 7 del recorte (mundo entero, caja pequeña, orientación del arrastre, antimeridiano, polos, relleno, redondeo de nivel) y 1 del diálogo. La suite pasa de 847 a 851 pruebas verdes y el tope por tanda se mantiene bajo.

**Ampliación (este commit).** El mundo entero no cabe: a nivel 19 son cientos de miles de millones de teselas y el caché de disco se poda a 20 000. Lo que sí cabe es el mundo a poca resolución, que es lo que sirve para orientarse sin conexión: el diálogo ofrece niveles 0–4, 0–5 y 0–6 (341, 1 365 y 5 461 teselas), con el recuento a la vista antes de aceptar y una advertencia explícita de que la política de uso de OpenStreetMap prohíbe las descargas masivas. El nivel 6 es el techo porque el 7 solo ya son 21 845 teselas y el caché empezaría a borrar lo que acaba de descargar. Se pide en tandas de 400, con dos peticiones simultáneas en el servidor.

Y una segunda cosa que salió de mirar por qué el mapa aparecía en blanco: cuando una imagen falla, el diálogo pregunta al servidor qué contestó y lo escribe (`HTTP 403`, o que no hay red). Una tesela que no llega era indistinguible de un token rechazado o de un proveedor caído, que es justo el dato que faltaba para diagnosticarlo. El servidor, por su parte, se comprobó en frío: `/api/maps/tile` devuelve 200 `image/png` y la caché cuenta la tesela.

**Hecho cuando:** el diálogo informa del tamaño, permite vaciar, y se puede guardar una zona mayor que la pantalla.

**Riesgo:** medio: la descarga por zona multiplica peticiones a los servidores de teselas; hay que mantener el tope y la concurrencia baja.

---

### F7 · Release y firma — S

**Por qué (corregido al hacerla):** la premisa era falsa. El build **no firma nada**: `package.json` no declara `certificateSubjectName` ni `signingHashAlgorithms`, el workflow no define `CSC_LINK` y no hay ningún `signtool` en el repositorio, así que el instalador sale sin firmar y SmartScreen avisa la primera vez. Lo que había que hacer no era confirmar un certificado sino escribir lo que pasa., pero si el certificado no es de confianza pública SmartScreen seguirá avisando al instalar; y hay trabajo sin publicar acumulado (seis commits sobre 1.0.30).

Tareas:

- Confirmar qué certificado se usa y si está en el almacén de confianza; documentarlo en el README.
- Checklist de release en el README: versión, etiqueta, assets, `latest.yml`, comprobación de descarga.
- Limpiar `release/` y los volcados `.txt` de la raíz (ignorados por git, pero ocupan espacio y confunden).
- Decidir cadencia: una versión por bloque de arreglos, no un tag por cada commit.

**Hecho (este commit).** El README explica ahora la situación real de la firma —qué falta, por qué un certificado autofirmado no lo arregla y qué habría que tocar el día que exista— y trae una checklist de release de siete pasos que incluye lo que el workflow ya garantiza (etiqueta igual a `version`, artefactos renombrados, `latest.yml` comprobado) y lo que no: instalar en una máquina limpia y mirar qué ve el updater. Los `.txt` de la raíz y las builds viejas de `release/` se quedan donde están por ahora: son artefactos de instalación y borrarlos sin permiso no es parte de documentar una checklist.

**Hecho cuando:** un release sale con checklist cumplida y el instalador no dispara SmartScreen en una máquina limpia (o se documenta por qué sí).

**Riesgo:** bajo.

---

## 3. Resumen

| Fase | Qué arregla | Talla | Riesgo | Depende de |
| --- | --- | --- | --- | --- |
| F0 | Cobertura con umbral en el CI (ámbito `src/**`) | S | Bajo | — |
| F1 | Suite estable y un 28 % más rápida | S/M | Medio | F0 |
| F2 | `server.cjs` dividido en módulos | L | Alto | F0, F1 |
| F3 | `App.tsx` y `fileSystem.ts` manejables | M/L | Medio | F1 |
| F4 | Persistencia con validación (primera tanda hecha) | M | Bajo | F0 |
| F5 | Ventanas usables con teclado, `aria` correcto | S | Bajo | — (queda el caso con `axe`) |
| F6 | Caché del mapa visible y descarga por zona | M | Medio | — |
| F7 | Release con checklist y firma comprobada | S | Bajo | — |

**Orden recomendado:** F0 → F1 → F5 → F2 → F4 → F3 → F6 → F7. Las dos primeras son baratas y habilitan el resto; F5 cabe en cualquier hueco; F2 va antes que F3 porque el servidor es el que más crece.

---

## 4. Lo que no entra

- Portar a macOS o Linux: el producto es Windows-only por decisión, y el CI también.
- Telemetría o informes remotos: la app funciona sin conexión y así se queda; si hace falta diagnóstico, un log local rotativo.
- Reemplazar Express o el motor de trabajos: no hay problema medido que lo justifique.
- Introducir un gestor de estado global: `usePanels` y los hooks por área bastan; el problema de `App.tsx` es de tamaño, no de librería.

---

## 5. Cómo se sabe que va bien

| Métrica | Hoy | Objetivo |
| --- | --- | --- |
| Cobertura de líneas del ámbito medido | 48,78 %, ya con umbral | 60 %, subiendo el umbral al subir el número |
| Duración de la suite | 124 s → 89 s con cobertura, 4 workers | < 120 s también con 2 workers en el CI |
| Rojos que no son fallos | 2 en una jornada | 0 en diez ejecuciones |
| `server.cjs` | 4 710 líneas | < 800 |
| `App.tsx` | 1 792 líneas | < 700 |
| Cobertura de líneas de `server.cjs` | 65 % (medida en la tanda 0 de la F2) | no bajar al partir el fichero |
| `any`/`as any` | 75 | < 30 |
| `localStorage` sueltos en componentes | 62 | 0 (todo por `storage.ts`) |

---

## 6. Riesgos del plan

- **Refactor sin red:** `server.cjs` no está medido hoy. Por eso F0 lo mete en la cobertura **antes** de tocarlo.
- **Umbral que bloquea:** el umbral se pone en la línea base, no en una aspiración, y sube solo cuando el número real sube.
- **Trabajo mezclado:** una fase, un tipo de cambio. Un commit que arregla y otro que mueve, nunca los dos.
- **Suite que se «arregla» bajando exigencias:** los tests sensibles al reloj se reescriben con temporizadores falsos, no eliminando la comprobación.
