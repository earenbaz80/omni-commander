# Hoja de ruta — OmniCommander Pro

**Fecha:** 6-nov-2026 · **Base:** `e288c33` (master, quince commits por delante de la 1.0.39 publicada) · **Alcance:** los arreglos que salieron del análisis del código de la 1.0.30; las fases F0 a F7 están cerradas. La tabla de la sección 0 se volvió a medir en esta base; el resto del documento conserva las mediciones del commit en que se cerró cada fase, y lo dice donde las cita.

**Corrección de partida:** en el análisis se dijo que no había CI por push. Es falso. [`.github/workflows/release.yml`](.github/workflows/release.yml) se llama «CI and Release» y ya ejecuta, en cada push a `master` y en cada PR: formato, tipos, tipos estrictos, eslint, tests unitarios y los e2e; el empaquetado y la publicación solo ocurren con una etiqueta `v*`. Lo que falta en el CI no es el gate, es la **cobertura** y un **presupuesto de tiempo**. El resto del plan se apoya en ese gate, no lo repite.

---

## 0. Punto de partida (medido, no estimado)

| Dato | Valor | Cómo se midió |
| --- | --- | --- |
| Tests | 1 040 en 141 ficheros | `npx vitest run` |
| Tests del servidor | 33 ficheros | `ls server.*.test.ts` |
| Cobertura de `src/**` | 58,19 % sentencias · 52,09 % ramas · 46,83 % funciones · 61,19 % líneas | `vitest run --coverage` (sin tests ni stories) |
| `server.cjs` en esa medida | **fuera**; se mide aparte con `npm run test:server:coverage` | cada suite lo arranca como proceso hijo; V8 solo informa del suyo |
| Duración | 12,4 s con todos los workers · 37-39 s con `--maxWorkers=2` | `npx vitest run`, sin cobertura |
| Dependencias de producción | 7 directas (1 111 en el árbol) · 0 vulnerabilidades | `npm audit --omit=dev` |
| Dependencias desfasadas | 28, ocho con salto de major | `npm outdated` |
| `tsc --noEmit` y `typecheck:strict` | limpios | `npm run lint`, `npm run typecheck:strict` |
| eslint | 0 avisos con `--max-warnings 0` | `npm run lint:eslint` |
| Bundle | 552 kB el trozo principal · 51 trozos · CSS 88 kB (sin comprimir) | `vite build` |
| Mayores ficheros | `FileList.tsx` 1 229 · `archiveReader.cjs` 1 026 · `fileOps.cjs` 988 · `fileSystem.ts` 963 · `App.tsx` 746 · `server.cjs` 566 | `wc -l` |
| Marcadores | 0 TODO · 1 `eslint-disable` (declaración vendorizada) · 1 `any` real en producción | `grep` sobre `src`, `electron`, `server` |

Las tres auditorías —[26-oct](docs/audits/AUDITORIA_2026-10-26.md#2-estado-de-las-compuertas-medido), [29-oct](docs/audits/AUDITORIA_2026-10-29.md#1-compuertas-medidas-hoy) y [6-nov](docs/audits/AUDITORIA_2026-11-06.md#1-compuertas-ejecutadas)— viven juntas en `docs/audits/` y miden commits distintos, así que sus cifras no se comparan con esta tabla; la del 29-oct hablaba del 54,01 % de cobertura y 44 `any`. Lo que sí sigue siendo cierto de aquellas: `release/` ocupa cientos de MB y la raíz acumula volcados `.txt` ignorados por git.

**Aviso de dependencias, ya configurado.** El commit `9b6e681` añade [`.github/dependabot.yml`](.github/dependabot.yml), y con él una versión nueva o un advisory se ven sin esperar al siguiente push: es la brecha que la auditoría del 6-nov dejaba abierta. Revisa `package.json` y las acciones fijadas por SHA cada día laborable; los saltos de major llegan en un PR propio y el resto se agrupa por tipo de dependencia, para que las 28 desfasadas de la tabla no lleguen como 28 peticiones. El fichero no enciende las dos cosas que viven en Ajustes del repositorio: las alertas y los *security updates*, que son justo las que convierten un CVE publicado en un PR.

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
- Umbral en `vite.config.ts` igual a la línea base redondeada a la baja: arrancó en 46 sentencias, 40 ramas, 37 funciones y 48 líneas, y las fases siguientes lo subieron detrás de cada mejora hasta el 57/51/46/60 de hoy. Sube solo cuando sube el número real.
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

**Cuarta tanda (este commit).** La capa de transferencias del servidor salió a `fileTransfer.ts`: leer la instantánea de un trabajo, seguirlo hasta el final, espejar pausa y cancelación en el servidor, subir el límite de velocidad, lanzar un trabajo de fondo y resolver la colisión con un solo prompt por destino. Son ~270 líneas que el motor ya no necesita para nada más; lo único que le pide de vuelta es la entrada del catálogo que la transferencia dejó, y eso llega como dependencia. `lostJobRetryPolicy` se mudó junto al sondeo que lo lee y el motor lo re-exporta, porque `fileSystem.realDrive.test.ts` lo importa de ahí para acortar la ventana. `fileSystem.ts` pasa de 2 207 a 1 826 líneas, y el módulo nuevo trae 5 tests propios con `fetchWithRetry` falso: un prompt por destino mientras el conflicto sigue aparcado, transferencia declarada perdida cuando el servidor deja de contestar, el motivo del servidor cuando no arranca, el tamaño real informado con fallo al terminar con errores, y la entrada devuelta con las dos carpetas recargadas en un movimiento entre unidades.

**Quinta tanda (este commit).** `App.tsx` empieza a devolver estado. La elevación real del proceso era un `useState` con su `useEffect` y su `useCallback` seguidos; ahora es `useElevation`, que lee una vez lo que el servidor mide del proceso —los derechos no se ganan en caliente, solo relanzando, y relanzar reemplaza al proceso que preguntó— y devuelve el relanzamiento como la única forma de cambiarlos. El bloqueo de la app era tres sitios con la misma regla escrita a mano: el estado inicial, el embudo que lo activa y el efecto que re-bloquea al habilitar el ajuste. Ahora es `useAppLock`, con la regla en un solo lugar: sin contraseña guardada no se bloquea, porque el bloqueo sin hash o se abriría con el valor público retirado o dejaría al usuario fuera de su propia app; y habilitarlo en Ajustes vuelve a bloquear la sesión al momento, sin esperar a reiniciar. `App.tsx` baja de 1 731 a 1 689 líneas —cuarenta y dos— y el objetivo de la fase sigue siendo el reparto, no el recuento: lo que se gana es que cada regla tiene un dueño y un test. 10 tests nuevos: lo que el servidor informa, su silencio, el relanzamiento y su no-op sin puente, el arranque bloqueado o abierto, la negativa sin hash, bloquear y desbloquear, el bloqueo inmediato al habilitar el ajuste y la negativa a re-bloquear por un cambio ajeno. Suite: 120 ficheros, 881 tests.

**Sexta tanda (este commit).** El menú contextual de archivos salió a `FileContextMenu`: eran unas 195 líneas de JSX con treinta cierres sobre el motor, los ajustes y los setters de modales, cada uno repitiendo el mismo «si hay objetivo, selecciónalo y abre este diálogo». Ahora el componente lee el objetivo de la instantánea con la que el menú se dibuja —así un panel que navegue con el menú abierto no puede redirigir un comando ya elegido, que es la misma regla que se aplicó a las transferencias— y App solo le pasa estado y disparadores. La ruta absoluta de una carpeta se extrajo a `favoritePath`, con test: fijar una carpeta en el árbol depende de que el separador sea el de Windows, y un error ahí falla en silencio, porque el árbol simplemente no encuentra la entrada. `App.tsx` baja de 1 692 a 1 511 líneas y el bloque del menú pasa de 195 líneas a 22. Suite: 121 ficheros, 884 tests.

**Séptima tanda (este commit).** El motor de transferencias salió a `useTransferQueue`: eran ~390 líneas contiguas de `App.tsx` con el estado del prompt de colisión y del aviso de disco lleno, la construcción de planes, la cola que los ejecuta, los tres caminos que llegan a ella —transferencia en vivo, lista guardada reanudada y lote aparcado a través de un reinicio elevado— y los dos confirmadores de copiar y mover. Sigue siendo un solo embudo, y ahora el estado que espera una respuesta del usuario vive con la maquinaria que lo espera y no con la ventana que lo dibuja: el conflicto de nombres y el disco lleno son respuestas que esta cola está esperando. `App.tsx` baja de 1 511 a 1 092 líneas —cuatrocientas diecinueve, el corte más grande de la fase— y el hook trae 3 tests propios con el motor y la cola falsos: el plan aparcado se reanuda una sola vez al montar (repetirlo en cada montaje volvería a copiar el mismo lote), sin plan no se encola nada, y descartar el aviso de espacio no deja trabajo pendiente. Suite: 122 ficheros, 887 tests.

**Octava tanda (este commit).** El visor de doble panel salió a `DualPaneView`: el contenedor, las dos `PanelView` y el divisor arrastrable eran 133 líneas de JSX en `App` con dos listas de props casi idénticas, y con ellas se iba también el último sitio donde el lado se escribía a mano dos veces. La vista recibe un `PaneBinding` por lado —su estado, su pestaña, su unidad, su árbol, sus ocho handlers propios— y un `PaneHandlers` compartido en el que cada handler recibe el lado por el que se le llama: navegar, cambiar de unidad o pestaña, abrir, cerrar, bloquear o duplicar una pestaña, ir atrás y adelante, y soltar elementos. Esa es ahora la única parte que sabe que hay dos lados, y el test lo comprueba: un clic en el panel derecho navega el derecho y nunca el izquierdo, cada mitad recibe su parte del reparto al mover el divisor, y arrastrar el divisor avisa en vez de gestionarse dentro de la vista. `App.tsx` baja de 1 092 a 1 044 líneas. Suite: 123 ficheros, 890 tests.

**Novena tanda (este commit).** Las operaciones de fichero salieron a `useFileOperations`: borrar —con su tarea medida en entradas, porque un borrado no mueve bytes—, enviar a carpeta, renombrar, crear carpeta y fichero, renombrado en lote, comprimir, extraer, soltar elementos del panel y ficheros del navegador, y poner o quitar la contraseña de una carpeta. Todas comparten la misma forma —toman lo que el usuario eligió, lo ejecutan y refrescan los paneles— y ninguna era estado de la ventana; lo que entra es la instantánea de la selección que tiene el diálogo, así que un refresco que llegue con el diálogo abierto no puede redirigir una operación ya confirmada. Se quedan en `App` las que sí son suyas: la migración de la contraseña heredada y el efecto que cierra el árbol de carpetas al pulsar fuera. `App.tsx` baja de 1 044 a 845 líneas. El hook trae 4 tests: un borrado se encola como una sola tarea y limpia la velocidad en bytes que no tiene, la contraseña de carpeta se guarda como registro derivado y nunca como texto (con una aserción que falla si el secreto aparece en los ajustes), quitarla afecta solo a esa carpeta, y comprimir sin selección no arranca nada. Suite: 124 ficheros, 894 tests.

**Décima tanda (este commit).** El cromo de la ventana salió a `WindowChrome`: el overlay de CRT, la pantalla de bloqueo, la barra de menús y la toolbar eran 135 líneas de JSX en `App` con cinco callbacks por widget. El componente recibe estado de paneles (no ficheros) y escribe él mismo en ajustes —tema, idioma, CRT e inclinación del reparto—, así que `App` pasa una línea por asunto en vez de cinco por control. Se lleva también el `React.lazy` del bloqueo, que debe seguir por encima de la capa de modales porque activarlo desde Configuración deja ese diálogo abierto. Lo que no cambió: las acciones siguen entrando como props (no se inventó estado nuevo) y el overlay de bloqueo conserva su `z-[70]`. `App.tsx` baja de 845 a 749 líneas. El test del cromo cubre las decisiones que se mudaron: el overlay de CRT solo aparece con su ajuste y con la intensidad elegida, el botón de vista rápida del menú actúa sobre el panel **contrario** al activo, el toggle de CRT se escribe en ajustes en vez de guardarse local, bloquear desde el menú llama a la cerradura y no abre un diálogo, y la limpieza entrega primero su objetivo y después abre su ventana. Suite: 125 ficheros, 899 tests.

**Undécima tanda (este commit).** Los diálogos salieron a `AppModalLayer`, y con ellos el primer objetivo de la fase: **`App.tsx` baja de 749 a 670 líneas**, por debajo de las 700 que pedía el roadmap (partía de 1 792). Eran cuatro bloques sueltos —`AppModals` con la pila principal, y las tres preguntas que una transferencia levanta por su cuenta: colisión, espacio insuficiente y contraseña de archivo— más el tirador del árbol clavado en el borde. Lo que justifica que vivan juntos no es el ahorro de líneas: comparten una regla de orden que es fácil de romper cuando están separados, que un diálogo abierto desde otro tiene que quedar encima y que una pregunta formulada a mitad de una transferencia no puede ser sustituida por una segunda. Las props entran agrupadas por asunto (`ui`, `panels`, `modal`, `transfers`, `files`, `commands`, `treeHandle`) en lugar de una por control; la capa recibe el motor de transferencias entero, porque las respuestas a esos prompts son sus propios callbacks y no un segundo camino a la misma decisión. Detalle que no se movió solo: la instantánea de una transferencia puede llegar vacía antes de que la cola publique su lista, y la capa rellena ese hueco con los elementos de la cola, igual que hacía `App`. El test fija justo ese punto y el resto del cableado: respeta una instantánea que sí trae elementos, entrega la respuesta de colisión al resolutor de la cola —no a un manejador nuevo—, y el tirador del árbol se rotula en el idioma de la aplicación y alterna su glifo con el estado. Suite: 126 ficheros, 903 tests.

**Duodécima tanda (este commit).** Empieza la segunda mitad de la F3: el catálogo en memoria y la papelera salieron a `fileCatalog.ts`. Eran las once operaciones que escriben sobre lo que la app tiene listado —crear carpeta y fichero, guardar contenido, renombrar, borrar uno o un lote, mover a la papelera, restaurar, vaciar y borrar definitivamente—, 366 líneas seguidas en mitad de la clase que tocaban una docena de sus miembros. Dos reglas viajaban con ellas y ahora viven en un módulo con su propia firma: una unidad real la escribe el servidor y el catálogo solo la refleja después, y la papelera de la app es un overlay virtual que **no** debe recibir lo que ya se llevó la Papelera de Windows. La mudanza enseñó algo sobre el estado: `files` y `recycleBin` no se mutan solo con `push`, se **reasignan** al filtrar los descendientes de una carpeta o al vaciar la papelera, así que pasarlos como copia habría dejado a los paneles leyendo un array huérfano. Ahora son un solo `state` compartido, el mismo objeto en los dos lados, y el motor conserva sus once métodos públicos como delegados para que ningún consumidor cambie. `fileSystem.ts` baja de 1 826 a 1 545 líneas y el módulo nuevo trae 446. Dos guardias hicieron su trabajo otra vez antes de escribir: el bloque llamaba a `this.moveToRecycleBin` desde `deleteItem` y a `this.deleteItem` desde el borrado en lote, y ambas se veían como miembros sin resolver hasta nombrarlas como dependencias. Suite: 126 ficheros, 903 tests, sin cambios.

**Decimotercera tanda (este commit).** La copia y el movimiento dentro del catálogo salieron a `fileCopyMove.ts`: 204 líneas en el motor que solo reestructuraban la lista en memoria y que, sin embargo, arrastraban dos casos que se leen mal de un vistazo — copiar desde un archivo montado es realmente una extracción, y una unidad real no se copia aquí sino en el servidor, con el resultado reflejado después. Ambas reglas viajan ahora en la firma del módulo. Se conserva lo que ya estaba bien y no era obvio: los hijos se recogen **antes** de empujar nada, que es el arreglo de una carrera que llegó a copiar una carpeta dentro de sí misma, y una colisión no se resuelve sola — sobrescribir o renombrar a `_Copy` son decisiones que pide quien llama. `fileSystem.ts` baja de 1 545 a 1 436 líneas y el módulo nuevo trae 264. Suite: 126 ficheros, 903 tests, sin cambios.

**Decimocuarta tanda (este commit).** La medición de carpetas salió a `fileTreeSize.ts`: `getTreeSize` y `getFolderSizes` eran 117 líneas dentro del motor, más dos ayudantes que solo ellas usaban y que vivían sueltos en la cabecera del fichero —el que distingue una petición cancelada de un fallo, y el que traduce un estado HTTP a lo que el panel puede contar (sin permiso, ya no está, servidor caído, negado)—. Los dos se han mudado con su lector, junto con `ScanMessage`, el tipo de cada línea que el servidor escribe mientras mide: un tipo que solo describe ese flujo no tiene por qué estar en la fachada del motor. La firma del módulo deja a la vista el reparto real: la medición la hace el servidor y llega en streaming, mientras que lo local es la aritmética sobre lo ya listado, y por eso el tamaño aparece al instante en una unidad virtual y hay que pedirlo en una real. `fileSystem.ts` baja de 1 436 a 1 307 líneas y el módulo nuevo trae 187. Dos detalles que el compilador cazó y que la mudanza deja limpios: `TreeSizeFailure` y `sessionTokenHeader` dejaron de usarse en el motor al irse el bloque; se podaron en vez de quedarse como import muerto. Suite: 126 ficheros, 903 tests, sin cambios.

**Decimoquinta tanda (este commit).** El envío a carpetas, la comprobación de existencia y la limpieza de temporales salieron a `fileFolderQueries.ts`: son las preguntas sobre carpetas que solo el servidor puede contestar —qué rutas fijadas siguen ahí, dejar un acceso directo en el escritorio o los documentos, y medir o vaciar los temporales—, y con ellas se fueron sus tipos públicos y la tabla de qué carpetas exige permisos de administrador. El motor los re-exporta, así que nada de lo que los consume cambia. La firma del módulo hace explícito lo que antes era un campo privado: `lastCallError` entra como dependencia porque `callServerFs` devuelve `null` en vez de lanzar —algunas llamadas se disparan como `void`— y el diagnóstico tiene que salir por banda. También deja claro qué **no** se movió: `callServerFs` sigue en el motor, porque es el puente que usan todos los demás. `fileSystem.ts` baja de 1 307 a 1 252 líneas y el módulo nuevo trae 145. Tres guardias frenaron cortes malos antes de escribir nada: el primero se tragaba la definición de `callServerFs` —que vive entre las dos zonas del bloque—, el segundo recortaba con `trim()` y se comía la indentación del getter que delimitaba la segunda zona, y el tercero detectó que el bloque de tipos se calculaba pero no se recortaba. Suite: 126 ficheros, 903 tests, sin cambios.

**Decimosexta tanda (este commit).** El estado del motor dejó de vivir suelto entre los métodos y pasó a un solo contenedor, `fileEngineState.ts`, y la persistencia se fue con él a `fileStorageOps.ts`. Eran dos cosas distintas que estaban mezcladas: el contenedor dice **qué** es el motor —unidades, catálogo, papelera, suscriptores, versiones y los índices— y el módulo de almacenamiento dice **cuándo** se escribe, quién se entera y cómo se recupera al arrancar. La razón de que el contenedor exista es la misma que en la tanda del catálogo: las operaciones reasignan listas al filtrar, así que una copia habría dejado a los paneles con un array huérfano; ahora hay un objeto compartido y una sola definición de sus campos. El temporizador de guardado viaja dentro del estado porque lo comparten los dos lados: quien escribe lo programa y quien carga lo cancela. `fileSystem.ts` baja de 1 252 a 1 194 líneas y los módulos nuevos traen 27 y 102.

**Decimoséptima tanda (este commit).** Unidades, listados y el puente de rutas reales salieron a `fileListing.ts`: veinte funciones seguidas —cargar unidades del sistema y del servidor, buscar y listar, indexar, normalizar y emparentar rutas— más la traducción entre una ruta de panel y una absoluta de Windows, que es lo que decide si una operación la hace el servidor o el catálogo. Con ellas se fue la caché de directorios y su tope: cada directorio visitado se acumulaba para siempre y se persistía entero, así que una sesión larga reventaba la cuota de almacenamiento; ahora se guardan como mucho `maxCachedDirectories` y el menos usado se descarta, con la recarga silenciosa de siempre. La firma del módulo deja a la vista lo que el motor no puede recalcular: el overlay de archivos montados —un listado dentro de un zip no es una unidad—, el guardado, y la búsqueda del montaje que ya cubre una ruta. `listingCachePolicy` se queda exportada desde el motor y entra como política, y los delegados nuevos son propiedades en flecha de una línea: eran diecisiete métodos con el mismo cuerpo y así el motor no se come en andamiaje lo que acaba de soltar. `fileSystem.ts` baja de 1 194 a **962 líneas**, por debajo del umbral de la fase. Tres cosas hubo que arreglar antes de dar la tanda por buena: el corte se llevó media cabecera del comentario del último error de servidor —que pertenece a un campo que se queda—, `ServerListItem` se quedó sin su único lector y viajó con él, y `driveLetterOf` sobrevivió como delegado que ya nadie llamaba; el compilador lo cazó y se podó en vez de quedar como código muerto. Suite: 126 ficheros, 903 tests, sin cambios.

**Fase cerrada.** Con las diecisiete tandas los dos objetivos están cumplidos y medidos: `App.tsx` baja de 1 792 a **670 líneas** (límite 700) y `fileSystem.ts` de 2 210 a **962** (límite 1 000), sin un solo cambio de comportamiento observable —los 126 ficheros y 903 tests de la suite, componentes incluidos, no cambian de resultado entre la primera tanda y la última; los e2e los corre el CI en el push—. El reparto quedó en módulos con firma propia y test donde hacía falta: catorce piezas de interfaz y motor para la ventana, y diez para el sistema de ficheros, con el motor como fachada que conserva delegados para no tocar a ningún consumidor.

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

**Cierre de la fase (este commit).** El caso con `axe` ya existe: `e2e/a11y.axe.spec.ts` abre Configuración desde la cabecera, mueve la ventana dos pasos con las flechas sobre la barra de título, la agranda desde la esquina y solo entonces audita el diálogo con las etiquetas WCAG 2.0 y 2.1, niveles A y AA. Se audita **después** del movimiento a propósito: una ventana recién abierta no enseña lo que este caso busca —la barra enfocable, el `separator` que ya reporta `aria-valuenow` porque el usuario eligió tamaño, y la región `status` que acaba de hablar—. El test comprueba antes que el movimiento ocurrió (dos pulsaciones, más de 20 px) y que la esquina creció la ventana, así que un fallo de accesibilidad no se puede confundir con uno de teclado. `@axe-core/playwright` entra como `devDependency`; era lo único que impedía cerrar la fase. Resultado: cero violaciones, 25,9 s, y la guarda de roles existente (`modalA11y.guard.test.ts`, 77 comprobaciones) sigue cubriendo lo que se puede afirmar sin navegador.

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

**Ampliación (este commit).** El mundo entero no cabe: a nivel 19 son cientos de miles de millones de teselas y el caché de disco se poda a 20 000. Lo que sí cabe es el mundo a poca resolución, que es lo que sirve para orientarse sin conexión: el diálogo ofrece niveles 0–4, 0–5 y 0–6 (341, 1 365 y 5 461 teselas), con el recuento a la vista antes de aceptar y una advertencia explícita de que la política de uso de OpenStreetMap prohíbe las descargas masivas. El nivel 6 es el techo porque el 7 solo ya son 21 845 teselas y el caché empezaría a borrar lo que acaba de descargar. Se pide en tandas de 100, con dos peticiones simultáneas en el servidor: la tanda es también el grano del avance, y cuatrocientas teselas dejaban la barra quieta casi un minuto.

**Avance y cancelación (commits `b4990e8` y `aa4272f`, publicados en la 1.0.33).** La tanda de cien es el grano del avance, pero mientras corría no había forma de saber si seguía viva ni de pararla salvo cerrando el diálogo, que además dejaba las peticiones al aire. El progreso es ahora un bloque propio bajo los controles, con `role="progressbar"` y `aria-valuenow`/`aria-valuemax`, recuento, porcentaje y los fallos parciales en curso; el parte final dice cuántas fallaron sobre el total (`failed/total`), porque «algo falló» no decía cuánto. Al lado va el botón de cancelar: aborta con un `AbortController` el `fetch` en vuelo, corta la cola y deja un aviso en ámbar con las teselas confirmadas hasta ahí. Cancelar no se cuenta como fallar —la tanda abortada no llega a pedirse— y el servidor termina la que ya tenía entre manos y la cachea: trabajo útil, no basura, aunque no sea una parada instantánea del tráfico hacia OpenStreetMap.

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

**Cortada la 1.0.32 (5-nov-2026).** Con 52 commits sin publicar desde la 1.0.31, la checklist se cumplió entera y esta vez con las comprobaciones hechas, no supuestas: `master` estaba en verde en el CI antes de tocar la versión (`9956693`, ejecución 138), `package.json` y la etiqueta `v1.0.32` coinciden, la etiqueta no existía ni en local ni en el remoto, y tras el push salió una release publicada al primer intento —no en borrador, no prerelease— con los dos `.exe`, sus dos `.zip`, el `.blockmap` y `latest.yml`. El quinto punto se comprobó descargando el instalador desde la release: 115 799 523 bytes, el mismo tamaño que declara, y su `sha512` en base64 idéntico al del fichero. La ejecución del tag tardó 56 s en los tests con cobertura y 43 s sin ella, con dos workers, así que el objetivo de duración del CI también entra.

**Fase cerrada (5-nov-2026):** la 1.0.32 se instaló y arranca —la interfaz se pinta, la versión es la correcta y la copia queda usable—. Dos matices se escriben aquí en lugar de darse por supuestos: el texto literal de SmartScreen no se transcribió, aunque el aviso aparece porque el build no firma, que es lo que el README explica; y la comprobación de que el updater ve la *siguiente* versión no se ejerció, porque al instalar la última publicada no hay nada más nuevo que ofrecer. Se hará sola en la próxima release, cuando una copia en 1.0.32 pregunte y encuentre la 1.0.33.

**Cortada la 1.0.33 (5-nov-2026).** La justifican dos arreglos de mapas y nada más: la descarga del mundo enseña su avance mientras corre y esa misma barra lleva el botón de cancelar. El resto es el ritual comprobado y no supuesto: `master` en verde antes de tocar la versión, `package.json` y la etiqueta coincidiendo en 1.0.33, etiqueta nueva en local y en el remoto, y una release publicada al primer intento —ni borrador ni prerelease— con sus seis assets y el `latest.yml` validado por el propio workflow antes de publicar. Con esta versión existe por fin algo que ofrecerle a una copia en 1.0.32, que es la comprobación del updater que la fase anterior dejó pendiente; ejercerla con la app instalada sigue siendo trabajo de la máquina de escritorio, no del CI, y no está hecha.

**Y un fallo que salió de esa instalación.** Las builds 1.0.30 y 1.0.31 enseñaban la pantalla negra y el recuadro de «No se pudo pintar esta parte de la interfaz». El arranque del motor leía `nc_drives_v1` con un `JSON.parse` crudo y después hacía `[...this.drives]`, así que un valor guardado con la forma que escribe el lector versionado —`{ version, value }`— llegaba al render como un objeto y lanzaba `this.drives is not iterable`. El perfil de una máquina recién estrenada no lo dispara; el de una que ya había guardado catálogo, sí, que es justo la razón de que no apareciera ni en las pruebas ni en un paquete empaquetado al efecto con un perfil limpio. En la 1.0.32 ninguna ruta lee esa clave sin validar, y [`src/services/fileSystem.storedDrives.test.ts`](src/services/fileSystem.storedDrives.test.ts) fija los cuatro casos —envoltorio, array pelado, valor que no es lista y objeto suelto— para que el lector y el arranque no vuelvan a separarse. El arreglo ya viajaba dentro de la 1.0.32, así que no hizo falta release nueva: lo que se añadió después es el test que lo sujeta.

**Cortada la 1.0.40 (7-nov-2026).** La etiqueta apunta al commit de la versión y la release salió publicada al primer intento, ni borrador ni prerelease, con sus seis assets: el instalador NSIS y su `.blockmap`, sus dos `.zip` y el portable `.exe`, más `latest.yml`. El job `Build and publish` cerró los diecisiete pasos en verde, incluidos los que no son empaquetar sino comprobar: etiqueta igual a `version`, artefactos nombrados como los espera el manifiesto, y la validación de que manifiesto y artefactos coinciden antes de publicar. Lo de después se hizo descargando, no leyendo la API: los cuatro ficheros responden 200 con el tamaño exacto que declara `latest.yml`, y el instalador bajado entero pesa 115 815 748 bytes con un `sha512` en base64 idéntico, carácter por carácter, al del manifiesto, que es el valor que el updater compara antes de instalar. Conviene dejar escrito el tropiezo: durante los primeros minutos la URL del instalador devolvía 404 aunque la release ya figuraba publicada, porque subir 115 MB lleva su tiempo; la conclusión de «faltan binarios» se sacó antes de mirar el job, que estaba entero en verde. El `verify` del commit de la versión también pasó, con el chequeo de enlaces de la documentación ya dentro.

**Cortada la 1.0.42 (8-nov-2026).** Con la etiqueta sobre el commit del *bump* (`ee1eae1`) y no sobre la punta de `master`, que un commit después solo añadía una sección de documentación: moverla habría pedido borrar el tag de una release viva y resubir seis assets con otro `sha512` para entregar el mismo instalador, porque el README no entra en `build.files`. El CI de ese commit pasó en verde —suelo de Node en 13 s, las tres patas de `verify` entre 2 min 10 s y 2 min 40 s, `Build app and Storybook` 1 min 14 s y el `e2e` completo— y la release salió publicada, marcada Latest, con el instalador de 125 570 671 bytes y un `latest.yml` cuyo tamaño declarado coincide con el que sirve GitHub. No se ejercieron los pasos 6 y 7 de la checklist —instalar en una máquina limpia y que una copia de la 1.0.41 vea la 1.0.42—, que son los únicos que prueban el feed de verdad.

**Cortada la 1.0.43 (9-nov-2026).** Dos arreglos —el updater que perdía una descarga terminada y el renderer que dejaba la ventana muerta sin decir por qué—, etiqueta sobre la punta de `master` (`ced4612`, con el CI en verde) y release publicada al tercer intento: los dos primeros `Build and publish` murieron en `Package Windows artifacts` con `Response code 504 (Gateway Time-out)` de GitHub, no del paquete, y el tercero publicó a las 05:48:59 UTC, veintinueve minutos después de la etiqueta. El instalador que sirve el feed pesa 125 572 341 bytes y su `sha512` coincide con el del `latest.yml`, comprobado bajándolo entero; el `.blockmap` 132 210, el `.zip` del instalador 125 575 538 y el portable 113 190 552. Pasos 1 a 5 hechos, y el 7 también: la copia instalada en 1.0.41 ofreció y descargó la 1.0.43 —125 572 341 bytes en `pending/` con el `sha512` del manifiesto— después de una veintena de comprobaciones que se comieron el 504 de GitHub en el `latest.yml`. El 6 sigue esperando una máquina donde el UAC deje instalar.

**Reintento ante 5xx del updater (9-nov-2026).** Aquellas veinte comprobaciones seguidas que se quedaron en error no eran la app: el updater no distinguía el 504 de GitHub de un «no hay versión», así que una comprobación fallida quedaba congelada hasta el parte de seis horas, el tiempo suficiente para parecer rota. Ahora un 5xx —el `HttpError: 504`, el cuerpo `504 Gateway Time-out` en lugar del manifiesto o un `Response code 502` del descargador— se reintenta solo con 30 s, 60 s y 120 s, y la escalera se reinicia cuando una comprobación llega a una respuesta o cuando el usuario pulsa comprobar o descargar; un 404 y un fallo de red local no se reintentan, porque repetirlos da lo mismo dentro de un minuto. La decisión vive en [`electron/updateRetry.cjs`](electron/updateRetry.cjs), aparte de `main.cjs` para poder probarla sin arrancar Electron, y está en `master` como `da6fb47` con el CI en verde —run 42575477367, número 243, de las 06:49:57 a las 06:56:52 UTC del 9-nov—. Los ocho tests cubren las cadenas reales de aquel 504 y los negativos, y el 9-nov se ejerció en vuelo sobre un paquete de la 1.0.44 cuyo `app-update.yml` apuntaba a un servidor local que contestaba 503: cuatro peticiones a los 0, 30, 60 y 120 s, y ninguna más. Con el mismo servidor en 404, una sola petición y ningún reintento en los cincuenta segundos siguientes.

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
| F5 | Ventanas usables con teclado, `aria` correcto | S | Bajo | — |
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

Medido hoy en `e288c33`, con todas las fases del plan cerradas:

| Métrica | Hoy | Objetivo |
| --- | --- | --- |
| Cobertura de líneas del ámbito medido | 61,19 % (58,19 % sentencias · 52,09 % ramas · 46,83 % funciones) en 141 ficheros y 1 040 tests, con el umbral una décima por debajo (57/51/46/60) | 60 % — **alcanzado** |
| Duración de la suite | 37-39 s sin cobertura en local con 2 workers · 12,4 s con todos los workers | < 120 s también con 2 workers en el CI — **alcanzado** |
| Rojos que no son fallos | 0 en las 19 últimas ejecuciones de `master` (de la 140 a la 121) | 0 en diez ejecuciones — **alcanzado** |
| `server.cjs` | 566 líneas | < 800 |
| `App.tsx` | 746 líneas | < 700 — **por encima** |
| `fileSystem.ts` | 963 líneas | < 1 000 |
| `server/archiveReader.cjs` | 1 026 líneas | el mayor del servidor; dividir antes de que crezca |
| Cobertura de líneas de `server.cjs` | 65 % (medida en la tanda 0 de la F2) | no bajar al partir el fichero |
| `any`/`as any` en código de producción | 1 (`libarchive.d.ts`, el worker de la librería); 32 contando dobles de test | < 30 |
| `localStorage` en componentes | 0 en crudo; las 3 lecturas que quedan viven dentro de tiendas inyectables (`calendarStore`, `runLauncher`) | 0 (todo por `storage.ts`) |

Dos cosas salieron de volver a medir. La primera: el informe de cobertura imprimía un `PARSE_ERROR` en cada ejecución, y era el proveedor v8 intentando leer la declaración de `libarchive.js` —TypeScript vendido en un `.d.ts`, con `any` en la firma del worker— para mapear los ficheros que nadie importa. Un `.d.ts` no tiene código en ejecución, así que ahora queda excluido y el error desapareció. La segunda: con el número delante no tiene sentido que el umbral siga en la línea base de la primera medición; sube a lo que la suite alcanza hoy (49 % sentencias, 42 % ramas, 42 % funciones, 51 % líneas), de modo que un descenso falle la ejecución en vez de pasar desapercibido.

Después de eso, tres diálogos que no tenían un solo test —sincronizar carpetas, buscar/grep y el estudio de imagen— entran en la cuenta y mueven la línea a 55,99 %, con el umbral subido otra vez detrás. Los tres cubren lo que se puede afirmar sin navegador: la clasificación del diff y qué copia una ejecución, los filtros y el recuento de ficheros ilegibles, y las rutas de carga y guardado con el lienzo y la imagen doblados. Después entra `FileList.tsx`, que era el mayor hueco: doce casos sobre las filas (tamaño, tipo y atributos), la selección, el orden por columna y el soltar —incluido negarse a mover una carpeta dentro de sí misma—, con el virtualizador doblado porque jsdom no tiene layout y no pinta una sola fila. La línea sube a 57,07 % y el umbral la sigue. Después, `CommandLineBar`, que estaba al 13,76 %: quince casos sobre las sugerencias (historial, comandos internos y ficheros), el texto fantasma, la navegación del historial, la tabulación, el cajón de log y el modo elevado. La línea queda en 59,06 %, a menos de un punto del objetivo, y el umbral se mueve otra vez detrás de ella.

El último tramo lo pone la guarda del teclado. `useKeyboardShortcuts` tenía tests de las dos rutas que rompieron en producción —la trama de tamaños tragándose las teclas y el ciclo de unidades sin unidades—, pero no del resto del mapa: las F, las combinaciones con Ctrl, la navegación de filas y la búsqueda al teclear. Un fichero nuevo de dieciséis casos las recorre, y la línea pasa de 59,06 % a 60,81 %. **El objetivo de esta sección queda cumplido**, con el umbral detrás una vez más (57 sentencias, 51 ramas, 46 funciones, 60 líneas).

**Remedido al cortar la 1.0.33.** La suite, ya con los dos arreglos de mapas dentro, son 978 tests en 133 ficheros y dejan la línea en 60,87 % (57,88 % sentencias · 51,61 % ramas · 46,68 % funciones). La tabla de arriba lleva esas cifras; el 60,81 % del párrafo anterior es lo que se midió en el commit donde la fase se cerró, y las seis centésimas de diferencia son el ruido del proveedor v8 más dos casos nuevos, no cobertura de producto que hubiera faltado contar.

La última fila se mide de otra manera porque no existe un registro aparte: lo que se cuenta son las conclusiones que la API del repositorio da para las ejecuciones de `master`. Hoy son diecinueve seguidas en verde, de la 140 a la 121 —la 139 es la del tag `v1.0.32`, que corre por su cuenta—, ya sin los dos rojos que no eran fallos. Conviene leerlo como lo que es: una racha, no una garantía. Nadie la vigila sola, y el número baja el día que alguien vuelve a preguntar y encuentra un rojo en medio.

---

## 6. Riesgos del plan

- **Refactor sin red:** `server.cjs` no está medido hoy. Por eso F0 lo mete en la cobertura **antes** de tocarlo.
- **Umbral que bloquea:** el umbral se pone en la línea base, no en una aspiración, y sube solo cuando el número real sube.
- **Trabajo mezclado:** una fase, un tipo de cambio. Un commit que arregla y otro que mueve, nunca los dos.
- **Suite que se «arregla» bajando exigencias:** los tests sensibles al reloj se reescriben con temporizadores falsos, no eliminando la comprobación.
