# Auditoría general — OmniCommander Pro

**Fecha:** 29-oct-2026 · **Commit auditado:** `f29afd2` más las cinco unidades de esta jornada y su corrección posterior — `a96ec8a` (FTP), `383bf07` (shell), `aed9cad` (vista rápida), `380e13a` (sincronización y búsqueda), `b58ce2e` (limpieza), `dea20de` (presupuesto de `tasklist`), `b7bf9a9` (fallo visible), `59c2ba1` (E2E de la barra), `820923f` (mutación de la barra), `3845a8a` (teardown de vitest), `e75a72a` (poll cancelable), `01cdde3` (lectura de procesos), `83bba23` (presupuesto del suite) · y la cadena de ventanas de la tarde: `f689011` (aviso una vez), `3edd1ae` (E2E del aviso), `3358f19` (solo `ModalShell`), `53f4019` (foco al abrir), `6cb3647` (ventanas con selección), `918c82b` (visor y editor), `0e5be21` (relevo visor→editor y lista nombrada), `186b13c` (panel en el nombre) · **Versión:** 1.0.4
**Alcance:** compuertas de calidad, datos que la interfaz presenta como reales, seguridad de la API local y de Electron, rendimiento, pruebas y CI.
**Método:** ejecución de las compuertas reales sobre el árbol de trabajo, lectura del código y prueba de ejecución de los endpoints nuevos contra la máquina.
**Relación con la anterior:** [AUDITORIA_2026-10-26.md](AUDITORIA_2026-10-26.md) midió `d3b113e`. Esta es una foto nueva, no una actualización de aquella.

---

## 0. Resumen

La app está **sana en lo que se puede medir automáticamente**: tipos, lint, 599 pruebas, build y los 46 E2E en verde, y sin vulnerabilidades en dependencias de producción. Sobre la anterior, se cerraron los tres bloqueantes y la deuda funcional que quedaba.

El trabajo de esta jornada se centró en otra clase de defecto que la auditoría anterior no cubría: **datos inventados**. La app presentaba como mediciones un handshake SSH que nunca ocurrió, un `ipconfig` con una IP fija, un `tasklist` con procesos que no existían, un `tree` de cuatro carpetas dibujadas, un volcado hexadecimal fabricado a partir del nombre del archivo, un reproductor con 180 s fijos, un progreso de sincronización con pausas de 60 ms y una versión `v5.50.2026` en un paquete `1.0.4`. Todo eso o se convirtió en una lectura real o desapareció; ninguna de esas pantallas puede volver a afirmar algo que no midió.

Lo que sigue abierto es deuda de higiene y de CI, no de comportamiento: `release/` con 657 MB, 30 `.txt` en la raíz, una dependencia declarada sin uso, 44 `any`, y una cobertura medida al 54,01 % que no tiene umbral ni script.

---

## 1. Compuertas medidas hoy

| Compuerta | Comando | Resultado |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | ✅ sin errores |
| ESLint | `npx eslint src --max-warnings 0` | ✅ 0 errores, 0 warnings |
| Pruebas | `npx vitest run` | ✅ 80 ficheros / **599 pruebas** (127 s), exit 0 |
| Cobertura | `npx vitest run --coverage` | ⚠️ medida: **54,01 %** sentencias, 47,27 % ramas, 43,69 % funciones, 56,80 % líneas. Sin umbral |
| Build | `npx vite build` | ✅ 12,6 s; `dist` **1,7 MB**; chunk principal **516 kB** (`ModalShell` 440 kB aparte) |
| E2E | `npx playwright test` | ✅ **46 pruebas** (6,1 min; más si `tasklist` tarda lo que mide su fila de presupuesto): humo, los tres de a11y —botones, listas y agrupaciones—, a11y de modales, los cuatro casos de archivo, los tres de la barra de comandos, los dos del menú contextual, los cuatro de la vista rápida, los dos de sincronización, los dos de copia/movimiento con colisión y los veintitrés de foco de ventanas |
| Deps de producción | `npm audit --omit=dev` | ✅ 0 vulnerabilidades |
| Deps totales | `npm audit` | ⚠️ 4 bajas (`deepmerge` vía `workbox-build`/`vite-plugin-pwa`) |
| TypeScript estricto | `npx tsc --noEmit -p tsconfig.strict.json` | ❌ **12 errores**; el CI no lo ejecuta |
| Empaquetado | `npm run electron:build` | No medido en esta auditoría |

---

## 2. Datos inventados: lo que había y lo que hay

Este es el hallazgo central de la auditoría. Cada fila se comprobó leyendo el código y, donde hay endpoint, con una prueba que compara la respuesta con lo que el propio Node ve de la máquina.

| Pantalla | Antes (inventado) | Ahora (real) |
| --- | --- | --- |
| Cliente FTP/SFTP | Handshake escrito a mano (`[220] Welcome…`, `[230] logged in`), tres servidores de ejemplo y un botón que abría `drive_ftp`, un id que ninguna lista de unidades contiene | Formulario de ajustes con aviso explícito de que no hay cliente; sin botón de conectar ni unidad remota. Prueba: [`FTPManagerModal.test.tsx`](src/components/modals/FTPManagerModal.test.tsx) |
| `ipconfig` | `192.168.1.150`, máscara y puerta de enlace fijas en la tabla de traducciones | [`GET /api/net/adapters`](server.cjs) sobre `os.networkInterfaces()`; sin puerta de enlace, que este proceso no puede leer |
| `tasklist` | Tabla fija de cuatro procesos con PID y memoria inventados | [`GET /api/processes`](server.cjs): `tasklist /fo csv` en Windows, `ps` fuera; la prueba verifica forma y que la lista no es la de cuatro filas |
| `tree` | Cuatro nombres dibujados (`OMNICMD`, `WINDOWS`, `Users`, `Administrator`) sea cual sea la carpeta | [`GET /api/tree`](server.cjs): paseo real, acotado a 300 carpetas y 4 niveles, con 404 honesto si la carpeta no existe |
| `type` / `cat` | Leía `file.content`, campo que el listado de una unidad real nunca rellena: siempre “no se pudo leer” | Lee los bytes del disco con tope de 64 kB |
| Versión (About y banner) | `v5.50.2026 Pro (Build 2026.09.24-x64)` literal en el componente | `__APP_VERSION__` inyectado por Vite desde `package.json` → **1.0.4** |
| Modo administrador | Un booleano que cambiaba la insignia y el prompt, y un `sudo` que anunciaba “permisos sin restricciones” sin cambiar nada | `elevated` **medido por el sistema** (`WindowsPrincipal`) y servido en `/api/system/stats`; `sudo` pide el reinicio elevado de verdad ([`electron/main.cjs`](electron/main.cjs)) |
| Vista rápida · Hex | Volcado generado a partir de `${nombre}.${ext}_FILE_DATA` cuando no había bytes | Volcado de los bytes reales (precacheados a 2 MB), con aviso de recorte |
| Vista rápida · Multimedia | Duración fija de 180 s, “visualizador” de seno y play que solo cambiaba una etiqueta | `<audio>`/`<video>` nativos sobre un blob de los bytes reales; por encima de 50 MB dice que no lo abre |
| Sincronización de carpetas | `copyItem` sin `await` y una pausa de 60 ms “para simular progreso” | Copia esperada, contador real y fallo visible; y la fuente se direcciona por su ruta en disco, no por el id del listado, porque el propio ciclo recarga los paneles y renueva esos ids |
| Cola de tareas | `totalBytes \|\| 1024 * 1024`: 1 MB inventado para lo que no se midió | 0 = “sin medir”; el total real llega del servidor |
| Buscar/Grep | Patrón con el mismo escapado roto que el filtro del panel; grep sobre `file.content`, vacío en unidades reales → “sin resultados” siempre | Reglas de comodines compartidas (`utils/panelFilter`) y lectura real de contenidos con topes; los ficheros no leídos se cuentan en el pie |
| Drawer · Red y seguridad | “SMB Online” y “AES-256 Active”, ambos falsos (las rutas UNC se rechazan y los archivos no se cifran) | “Bloqueado” y “Sin uso” |
| `src/services/zipPasswordHandler.ts` | Esqueleto con `// Ejemplo de integración`, importado desde ningún sitio | Eliminado |

También se corrigió, en la unidad anterior, el **filtro del panel** (`a+b`, `[x]`, `report|draft` compilaban a otra expresión): ver `f29afd2`.

Las pruebas que sostienen lo nuevo del servidor están en [`server.machine.test.ts`](server.machine.test.ts) (4 casos): las direcciones deben pertenecer a `os.networkInterfaces()`, la lista de procesos no puede ser la tabla fija de cuatro, el árbol debe contener las carpetas creadas en un directorio temporal y una ruta inexistente debe responder 404.

---

## 3. Correctitud funcional

- Los P0 de la auditoría anterior (TreeSize, ZIP con contraseña, RAR/7Z/TAR, release desde árbol roto) siguen cerrados, y el spec de archivos cubre RAR, ZIP, 7-Zip y RAR cifrado de extremo a extremo.
- La barra de comandos ya no puede inventar: `dir`, `cd`, `mkdir`, `del` van al motor; `ipconfig`, `tasklist`, `tree` y `type` van al disco o al sistema; `calc` dice que no existe; `sudo` pide elevación real o explica que no puede.
- **Tampoco puede callarse**: una lectura que lanza ahora deja una entrada de error con el mensaje (`cmdFailed`), en lugar de no dejar ninguna entrada. Se encontró en el E2E de la barra, donde un `tasklist` que agotó su presupuesto se veía como un comando que no había hecho nada; lo cubre [`useCommandExecution.test.tsx`](src/hooks/useCommandExecution.test.tsx).
- **Riesgos nuevos, acotados a propósito**: `quick view` mantiene hasta 50 MB en memoria para reproducir; el grep lee como máximo 100 ficheros de 1 MB por búsqueda y lo declara; `tasklist` lanza un proceso por invocación (con tope de 60 s: 15 s y 25 s resultaron cortos bajo carga); la comprobación de elevación lanza PowerShell una vez por proceso.

---

## 4. Seguridad

Sin cambios en los controles que la auditoría anterior verificó, y siguen cubiertos por pruebas:

- API solo en loopback, origen exacto `http://localhost:3000`, token de sesión en mutaciones y en los GET que describen el disco (`server.origin.test.ts`, `server.binding.test.ts`).
- Rutas: solo unidades locales; UNC y rutas de dispositivo rechazadas (`server/pathSafety.cjs`, `server.pathsafety.test.ts`).
- Electron: navegación por origen exacto y CSP que solo permite propios recursos y la API local.
- Carpetas protegidas: registro PBKDF2 por carpeta; el texto no se guarda.
- La vista rápida sigue usando `<img>` con data URL para SVG y nunca inyecta markup (`svgPreview.security.test.tsx`), ahora leyendo los bytes reales.

Los endpoints nuevos aceptan solo lectura, están detrás del mismo servidor de loopback y no reciben rutas del cliente salvo `driveId`/`path`, que pasan por `listDirectory` con su validación de unidad.

---

## 5. Rendimiento

- Bundle: 516 kB el chunk principal y 1,7 MB en `dist`; sin regresión medible frente a la revisión anterior (528 kB / 1,7 MB).
- Las lecturas nuevas están acotadas por diseño: árbol a 300 entradas y 4 niveles; grep a 100 ficheros de 1 MB; vista rápida a 2 MB de vista previa y 50 MB de reproducción.
- El pre-flight de espacio sigue con su presupuesto de 10.000 fuentes y 8 paseos en paralelo.
- No se hizo una medición nueva de tiempos de copia ni de TreeSize en esta auditoría.

---

## 6. Pruebas y cobertura

| Métrica | Valor |
| --- | --- |
| Ficheros de prueba | 80 |
| Pruebas | 599 |
| Cobertura de sentencias | 54,01 % |
| Cobertura de líneas | 56,80 % |
| Specs del servidor | 16 ficheros `server.*.test.ts` |
| E2E | 46 pruebas, 10 specs |

Sin umbral y sin script `coverage` en `package.json`, aunque `@vitest/coverage-v8` está instalado: la cobertura existe como medición manual, no como compuerta.

La vista rápida tiene su propio E2E desde esta unidad: [`e2e/quickview.spec.ts`](e2e/quickview.spec.ts) escribe tres ficheros en un temporal —texto con acentos, un binario con NUL y un WAV PCM real—, los enfoca en el panel derecho, abre el panel con el mismo Ctrl+Q que usa una persona y exige que el pane muestre **sus** bytes: el texto exacto leído del DOM, `00000000  4F 4D 4E 49 00 FF |OMNI..|` en Hex con el marcador de binario y sus 6 bytes, y un `<audio>` con `src` `blob:` más el tamaño real en Info. El pane lleva ahora `data-quick-view` y `data-quick-view-tab` para que la prueba pueda distinguirlo de la lista y leer qué pestaña eligió sola. Como mutación real, volver a pintar el volcado inventado (`binario.BIN_FILE_DATA`) hace fallar el caso del binario con ese texto exacto frente al esperado; restaurado, los cuatro vuelven a verde.

La barra de comandos tiene además seis casos de mutación: [`scripts/commandOutput.mutation.test.ts`](scripts/commandOutput.mutation.test.ts) pasa las respuestas fijas antiguas —el adaptador 192.168.1.150, la tabla de cuatro filas con `omnicmd.exe`, el árbol dibujado— por las mismas comprobaciones que ejecuta el E2E y exige que las rechacen; los casos de control construyen una respuesta medida y exigen cero quejas, para que «rechaza todo» no se confunda con «detecta la mutación». Ejecutado también como mutación real: con la app devolviendo las cuatro respuestas fijas, `e2e/commands.spec.ts` dio **3 fallos** con esos mensajes exactos y volvió a verde al restaurar el código.

La sincronización de carpetas tiene su propio E2E desde esta unidad: [`e2e/sync.spec.ts`](e2e/sync.spec.ts) crea dos carpetas temporales con diferencias conocidas —uno solo a la izquierda, uno solo a la derecha, uno idéntico por tamaño y fecha y uno que la prueba decide omitir—, apunta los dos paneles a ellas, abre el diálogo desde el menú Comandos y lo ejecuta. El primer caso lee la tabla por sus ganchos nuevos (`data-sync-name`, `data-sync-status`, `data-sync-direction` en [`SyncFoldersModal.tsx`](src/components/modals/SyncFoldersModal.tsx)) y exige el estado y la dirección que el diálogo calculó solo; el segundo comprueba **el disco**: cada archivo copiado contiene los bytes de su origen, el omitido no existe al otro lado, no apareció nada más y el idéntico conserva su `mtime` (no se reescribió «por si acaso»).

Escribirlo encontró un fallo real, que era el motivo por el que una sincronización de dos direcciones no terminaba: el diálogo guardaba los `id` de catálogo de ambos paneles al abrirse, y cada copia recarga el panel destino, que **renueva los ids** de todos sus ficheros ([`fileSystem.ts:340`](src/services/fileSystem.ts#L340)). La segunda copia, con el id del snapshot, ya no resolvía y el run abortaba con «El archivo ya no está en el panel»: medido en el log como `Copy skipped: no catalogue entry for sys_real_C_0_…` tras copiar el primer archivo. Ahora cada entrada de una unidad real se copia por su ruta absoluta (`transferPaths`, la misma puerta que usa una transferencia replicada) y solo las virtuales y de archivo pasan por el id. Como mutación, volver al id del snapshot deja el caso en rojo con el diálogo todavía abierto (`Expected: 0, Received: 1`); restaurado, 2/2 en verde.

La copia y el movimiento con diálogo de colisión tienen E2E desde esta unidad: [`e2e/copy-move.spec.ts`](e2e/copy-move.spec.ts) prepara dos carpetas con los **mismos** nombres y contenidos distintos, enfoca la fila del panel izquierdo, pulsa F5 o F6 como una persona, cambia la política a «Preguntar» (el defecto de la app es sobrescribir), y responde al aviso real. El primer caso exige que el aviso **nombre las dos rutas y mida los dos tamaños** —«16 B» frente a «6.0 B»— y, tras «Sobrescribir», que el destino contenga los bytes del origen, que el origen siga ahí y que no haya aparecido una segunda copia; el segundo, un **movimiento** contestado con «Conservar ambos», exige que el destino quede con `mover.txt` intacto y `mover (2).txt` con los bytes que viajaron, y que el origen desaparezca.

Dos mutaciones ejecutadas, una por caso: con el aviso contestando siempre `'overwrite'` (ignorando el botón), el caso de «Conservar ambos» falla con `Expected: "viaja\n", Received: null` porque el archivo renombrado nunca llega a existir; con la política forzada a `'overwrite'` en la ventana de transferencia —el aviso no llega a abrirse— el caso de la copia falla con `element(s) not found` al esperarlo. Restaurado el código, 2/2 en verde.

Ese mismo spec dejó al descubierto que el aviso montaba **dos `role="dialog"` anidados con el mismo nombre accesible**: `ModalShell` ya pide las semánticas y la trampa de foco a `useModalDialog`, y el cuerpo del aviso las reclamaba otra vez sobre su propio `div`, así que un lector de pantalla lo anunciaba dos veces. El patrón estaba en **otras 30 ventanas**, cada una declarando su diálogo dentro del que ya declaraba el shell —casi siempre con un nombre distinto, que por eso no rompía los selectores pero sí duplicaba el anuncio—. Ahora el shell es el único dueño: las 30 dejaron de llamar al hook y aportan solo contenido, y el nombre accesible pasa a ser el **título visible** de la ventana; de ahí que el E2E de sincronización pida «Sincronizador de Directorios & Novedades» en lugar de la entrada del menú, que era como se llamaba antes. `FreeSpaceModal` conserva su hook porque no usa el shell y `QuitModal` su `useRef`; ninguna de las dos duplicaba nada.

La guarda de accesibilidad gana 34 casos que fallan si una ventana con shell vuelve a declarar un diálogo propio, y se comprobó reponiendo la llamada en `HelpModal` (`expected true to be false`) y retirándola después (69/69). El E2E del aviso exige **exactamente un** diálogo con ese nombre, así que reponer el `role` en el cuerpo también lo devuelve a rojo (`Expected: 1, Received: 2`).

El foco al abrir y cerrar ventanas tiene su propio E2E: [`e2e/modal-focus.spec.ts`](e2e/modal-focus.spec.ts) abre **nueve** ventanas —F1, F2, F7 y Alt+F7 por sí solas, y F3, F4, F5, F6 y F8 con un fichero real enfocado en una carpeta temporal— y, en lugar de conformarse con «hay un diálogo», lee `document.activeElement` y exige que sea **un control con nombre dentro del diálogo**, que dos Tab sigan dentro y que al cerrar quede un solo diálogo menos. Otro caso abre Configuración desde su botón y exige que al cerrar el foco **vuelva a ese mismo botón**, que es lo que evita que el siguiente teclazo caiga en el `body`. Otro caso comprueba que la ventana de copia deja el foco en su **campo de destino**: al escribirlo se vio que ese campo no estaba asociado a su etiqueta, así que la ventana ahora la enlaza con `htmlFor`/`id` y el campo puede decir qué es.

El visor y el editor (F3, F4) son las dos ventanas que leen los bytes del fichero, y por eso llevan además una comprobación propia: el visor tiene que mostrar el texto que está en el disco y el editor tenerlo en su búfer (`toHaveValue('una nota\n')`). Sin ella, las dos podrían pasar todas las demás comprobaciones de foco sobre un marco vacío —que es exactamente el defecto que tuvieron cuando pintaban `file.content`, un campo que el listado de un disco real nunca rellena—.

El visor entrega el fichero al editor con su botón «Editar (F4)», y ese relevo tiene caso propio: exige que el foco aterrice **en el editor** y no se quede en la lista de detrás, que es donde lo dejaría el cierre del visor si su restauración ganara la carrera al montaje del editor; que dos Tab sigan dentro de la ventana nueva; y que al cerrarla el foco vuelva **a la lista de la que salió el fichero** —su contenedor, que es enfocable y lleva las flechas— y no al `body`.

Las **diez ventanas que faltaban** tienen el mismo caso desde esta unidad, abiertas como lo haría una persona y sin atajo de fixture: **F10** (Salir), **Ctrl+M** (Renombrado Masivo), **Ctrl+H** (Checksum, con fichero), **Ctrl+D** (Marcadores) y las seis que solo viven en un menú o en un botón de la cabecera —Propiedades y Divisor desde «Archivos»/«Comandos», Acerca de y Proteger Carpeta desde «Ayuda», Cola de Tareas desde «Comandos» y la biblioteca CMD/Winget desde su botón—. Para las de menú el destino del foco no es la lista sino **el título del menú** que se abrió, y el caso lo nombra: el comando pulsado desaparece con el desplegable, así que una restauración que se quedara con él no tendría dónde ir. Las diez exigen lo mismo que las otras: un diálogo, foco en un control con nombre dentro, dos Tab dentro y, al cerrar con Escape, el foco de vuelta en ese título o botón y nunca en el `body`.

Como mutación, quitar la restauración de `useModalDialog` deja en rojo tres de los casos nuevos —«closing the help window left focus on the body», «closing the batch rename window…» y «closing the background tasks window…»—; restaurada, 23/23.

Ninguna de esas ventanas tenía, sin embargo, respuesta para el caso en que **no queda nada** a lo que devolver el foco. Abrir F10 justo después de cargar no registra ningún control externo —nadie ha enfocado nada todavía—, así que al cerrar el foco se quedaba en el `body`. `useModalDialog` cae ahora en la lista del **panel activo**, que se marca con `data-file-list-active` desde el `isActive` que ya recibía [`FileList.tsx`](src/components/FileList.tsx), y en cualquier lista si esa no está. Son dos pasadas y no un selector con comas: la lista del panel inactivo va antes en el documento, y el primer intento entregaba el teclado al lado equivocado. El caso E2E carga la app, comprueba que el foco está en el `body`, cambia de panel con Tab —que no mueve el foco—, abre F10 y exige que al cerrar esté en la lista del panel **derecho** y con su nombre. Quitar el respaldo deja el caso en rojo con `closing the quit window left focus on the body`; restaurado, verde.

El último punto se midió antes de darlo por defecto: al cerrar el editor el foco ya volvía a la lista, no al `body`, porque el visor restaura en su desmontaje antes de que monte el editor. No había nada que arreglar ahí, solo algo que impedir.

Lo que sí faltaba es que ese destino **dijera qué es**: era un `div` enfocable sin `role` ni nombre, así que un lector de pantalla no anunciaba nada al recibir el foco —un problema real aunque el foco técnicamente estuviera bien—. Ahora lleva `role="group"` y `aria-label` «Lista de archivos del panel izquierdo/derecho en {path}»: **dos claves nuevas**, una por panel, en los ocho idiomas, porque dos paneles pueden mirar la misma carpeta y entonces la ruta sola anunciaría lo mismo en los dos lados. [`e2e/a11y.spec.ts`](e2e/a11y.spec.ts) audita **todas** las listas de la página: rol `group`, nombre no vacío, `tabIndex` 0, que el foco pueda ir a ellas y que estén representados **los dos paneles**. Quitar rol y nombre las deja en rojo (`{"role": null, "name": ""}` por cada una) y poner la misma etiqueta en ambos lados también (`left` donde se esperaba `left` y `right`). El contenedor lleva además `data-file-list`, para que el caso del relevo nombre su destino en vez de conformarse con «algún sitio fuera del diálogo».

El resto de grupos y regiones pasan por la misma pregunta: [`e2e/a11y.spec.ts`](e2e/a11y.spec.ts) audita **todo** lo que lleva un rol de agrupación o de landmark —`group`, `region`, `toolbar`, `tablist`, `list`, `listbox`, `tree`, `grid`, `menu`, `navigation`, `main`, `banner`, `complementary`, `contentinfo`, `search`, `form`— y exige nombre accesible, porque un contenedor con rol se anuncia por su nombre y sin él un lector de pantalla solo dice «grupo». El inventario real es corto y ya estaba bien: las cuatro listas de los dos paneles, la barra de funciones F1-F10 (`toolbar`, «Barra de funciones F1-F10») y el menú de limpieza de temporales (`menu`, «Limpiar carpetas temporales»). Este último solo existe mientras está abierto, así que el caso lo abre, audita esa segunda pasada y lo vuelve a cerrar; sin eso, la página recién cargada nunca vería un menú. Quitar el `aria-label` del menú deja el audit en rojo con `{"role": "menu", "name": ""}`.

El menú contextual era el último contenedor sin semántica de nada, y ya la tiene: `role="menu"` con el nombre «Menú contextual» —clave nueva en los ocho idiomas—, `role="menuitem"` en sus 25 comandos, `separator` en las rayas y `presentation` en los encabezados de sección. El teclado pasa a ser el de un menú: el foco entra en el primer comando, las flechas recorren la lista con envolvente, Home y End van a los extremos, y Escape o Tab lo cierran devolviendo el foco a la lista de la que salió. Cada tecla que el menú atiende detiene su propagación, porque el motor global de atajos usa las mismas y, sin eso, la selección del panel se movía detrás del menú abierto.

[`e2e/context-menu.spec.ts`](e2e/context-menu.spec.ts) lo fija con dos casos: uno recorre la semántica y el teclado, otro comprueba que las flechas no llegan al panel. Ese segundo caso no mordía a la primera —la carpeta de prueba tenía una sola fila bajo el menú, así que la flecha no tenía adónde moverse— y hubo que añadirle un segundo fichero para que tuviera sujeto. Dos mutaciones: quitar el `aria-label` deja el primero en rojo con `element(s) not found` al buscar el menú por su nombre; quitar el `stopPropagation` deja el segundo en rojo con `Expected: "nota.txt", Received: "otra.txt"`.

Lo que este audit **no** ve, y queda anotado: los diálogos se auditan en `a11y.modals.spec.ts`, y ningún grupo o menú abierto dentro de una ventana pasa por el audit de agrupaciones.

Seis mutaciones: quitar el foco inicial de `useModalDialog` lo deja en rojo con `the help window opened with focus on <body> ""` y, en el caso del relevo, con `the editor never took focus after replacing the viewer`; quitar el `htmlFor` lo deja en rojo con `element(s) not found` al buscar el campo por su etiqueta; vaciar lo que pintan el visor y el editor deja en rojo sus dos casos (`toBeVisible() failed` para el texto del visor, `Expected: "una nota\n", Received: ""` para el búfer del editor); quitar la restauración de foco del hook deja el cierre del editor en rojo con `closing the editor left focus on <body> ""`, que es el defecto que ese caso vigila; quitar `role` y `aria-label` de la lista deja el audit de a11y en rojo con `{"role": null, "name": ""}` por cada lista; y dar a los dos paneles la misma etiqueta lo deja en rojo con `left` frente a `left` y `right`. Restaurado todo, 12/12 y 2/2.

**Carrera de teardown (resuelta en su causa):** con `--coverage`, una de cada varias corridas terminaba con exit 1 por `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` mientras todas las pruebas pasaban. El registro que se escapaba era real: el poll de unidades de `App` seguía reintentando después del desmontaje y, al fallar el último intento, registraba «Could not load real drives from API» con la ventana ya cerrada. Ahora `fetchWithRetry` acepta la señal del llamador, deja de reintentar al cancelarse y limpia el listener; `App` aborta en su cleanup y `loadRealDrivesFromApi` no registra un fallo que nadie espera. Medido con la consola activada (`VITEST_CONSOLE=1`, el modo donde el aviso sería visible): sin la señal aparece una vez; con ella, tres corridas consecutivas sin ningún aviso y exit 0.

Como segunda barrera, y porque el aviso podía volver desde cualquier otro `console.*`, el setup sustituye los métodos de consola por no-ops antes de importar la app —ninguna prueba afirma sobre esa salida— y `VITEST_CONSOLE=1` restaura la consola real para depurar. Verificando esto aparecieron dos causas más de un verde con exit 1, ambas de presupuesto: la prueba de contraseña hace tres derivaciones PBKDF2 reales de 100k iteraciones y superaba los 5 s por defecto bajo carga (ahora 30 s), y la lectura de procesos agotaba el presupuesto del servidor bajo la saturación de la suite, así que la prueba reintenta una vez —un endpoint que no puede leer procesos falla las dos—. El presupuesto de prueba del suite sube además de 5 s a 20 s en `vite.config.ts`, porque varias pruebas hacen trabajo real (lanzar procesos, derivar claves, planificar un comando) y medido se pasaba de cinco; una prueba que no termina sigue fallando, veinte segundos después. Tres corridas completas consecutivas después: exit 0, exit 0 y exit 0.

Zonas con poca cobertura medidas hoy: `soundEffects.ts` (27 %), `systemStats.ts` (30 %), `runLauncher.ts` (55 %), `cleanupTargets.ts` (17 %).

---

## 7. Deuda abierta

| Punto | Estado | Qué se midió |
| --- | --- | --- |
| P2-2 · `getFolderSizes` | ⚠️ Parcial | `DiskUsageModal.tsx:32` sigue accediendo a `(fsEngine as any).files` |
| P2-3 · i18n del servidor | ✅ Resuelto | No quedan etiquetas de trabajo en español en `server.cjs` |
| P2-4 · Tipado | ⚠️ Parcial | 44 usos de `any` fuera de pruebas; `typecheck:strict` da **12 errores** y el CI no lo ejecuta |
| P2-5 · `includes` en render | ⚠️ Parcial | `FileList.tsx:339` sigue con `selectedIds.includes` en el payload de arrastre |
| P2-9 · Dependencias sin uso | ⚠️ Parcial | `@zip.js/zip.js` declarado y sin uso en `src`, `server.cjs` ni `electron` |
| P2-10 · Higiene local | ❌ Abierto | `release/` **657 MB** y **30** `.txt` de depuración en la raíz |
| P2-11 · `server.cjs` monolítico | ⚠️ Parcial | **3.938 líneas** (creció ~130 con las rutas nuevas); solo dos módulos fuera: `pathSafety.cjs` y `systemLoad.cjs` |
| P2-12 · Cobertura | ⚠️ Parcial | Medida al 54,01 %, sin script ni umbral |
| Nuevo · E2E de la shell | ✅ Resuelto | [`e2e/commands.spec.ts`](e2e/commands.spec.ts) recorre la barra y contrasta `ipconfig` con `os.networkInterfaces()`, `tasklist` con un listado propio y `tree` con carpetas creadas en un temporal |
| Nuevo · E2E de la vista rápida | ✅ Resuelto | [`e2e/quickview.spec.ts`](e2e/quickview.spec.ts): cuatro casos contra los ficheros que escribe la prueba, con la mutación del volcado inventado comprobada |
| Nuevo · Presupuesto de `tasklist` | ✅ Resuelto | La lectura en frío mide **38 s** en una máquina ociosa y pasó de **2 min** con la suite al lado; 60 s devolvía «Command failed» y dejaba el E2E en rojo. Servidor a **180 s**, cliente a **210 s**. El spec seguía esperando 120 s —menos que la propia app— y volvió a fallar con la suite entera encima; alineado a 210 s, el caso mide **4,7 min** de prueba completa y la suite da 19/19 |
| Nuevo · E2E de copia/movimiento con colisión | ✅ Resuelto | [`e2e/copy-move.spec.ts`](e2e/copy-move.spec.ts): sobrescribir en una copia y «Conservar ambos» en un movimiento, ambos comprobados contra el disco y con dos mutaciones ejecutadas |
| Nuevo · E2E de sincronización | ✅ Resuelto | [`e2e/sync.spec.ts`](e2e/sync.spec.ts): dos casos contra los ficheros que escribe la prueba, con la mutación del id obsoleto comprobada; encontró y cerró el fallo que cortaba la sincronización de dos direcciones en el primer archivo |

### 7.1 Lo que deja abierto la cadena de ventanas

La cadena cerró lo que se propuso —diálogo único por ventana, un solo dueño de las semánticas, foco al abrir en las nueve ventanas, foco al cerrar y nombre accesible de la lista—, y deja esto a la vista:

| Punto | Estado | Qué se sabe |
| --- | --- | --- |
| Menú contextual | ✅ Resuelto | `role="menu"` con nombre en los ocho idiomas, `menuitem` en sus 25 comandos, flechas con envolvente, Home/End, y Escape o Tab que cierran devolviendo el foco a la lista. Dos casos E2E y dos mutaciones |
| Foco al cerrar | ✅ Resuelto | El E2E exige el retorno del foco en las **veintitrés** ventanas que abre: las nueve de tecla vuelven a la lista, Configuración a su botón, el relevo visor→editor a la lista, y las diez nuevas (F10, Ctrl+M, Ctrl+H, Ctrl+D, Propiedades, Acerca de, Proteger Carpeta, biblioteca CMD/Winget, Divisor y Cola de Tareas) al título del menú o al botón que las abrió |
| Restauración sin red | ✅ Resuelto | Si el control que abrió la ventana ya no existe y el historial no guarda ninguno conectado, el foco va a la lista del panel **activo** y no al `body`. Caso E2E con F10 sin nada enfocado y mutación comprobada |
| Agrupaciones dentro de diálogos | ⚠️ Abierto | El audit de agrupaciones recorre la página principal; de los diálogos solo se auditan sus controles (`a11y.modals`). Ningún grupo o menú abierto dentro de una ventana pasa por él |
| Respaldo muerto en la barra | ⚠️ Menor | `t.functionBarAriaLabel \|\| 'Barra de funciones'` deja un literal en español que nunca se usa, porque las ocho tablas definen la clave |
| Cola de tareas en segundo plano | ⚠️ Sin E2E | Sigue cubierta solo con unidades |
| Deuda de la sección 7 | ❌ Intacta | Nada de la tabla anterior cambió con esta cadena: 12 errores de `typecheck:strict`, 4 bajas de `npm audit`, cobertura 54,01 % sin umbral, `release/` de 657 MB, `@zip.js/zip.js` sin uso y `server.cjs` de 3.938 líneas |

Una nota sobre las medidas, para que no engañen: dos corridas completas de la suite se interrumpieron por el entorno —una con `Execution context was destroyed` en `a11y.modals`, que aislado pasa siempre y no reprodujo, y otra que se comió un atasco de máquina de 35 minutos en el caso de 7-Zip—. La corrida limpia posterior, con la máquina libre, dio **46/46 en 6,1 min**; ninguna de las dos anomalías apunta al código de esta cadena.

**Prioridad sugerida:** (1) sacar las rutas de máquina a un módulo y seguir con la división de `server.cjs`; (2) limpiar `release/`, los `.txt` y `@zip.js/zip.js`; (3) umbral de cobertura y `typecheck:strict` en el CI. Los huecos de E2E que quedaban —la sincronización y la copia/movimiento con diálogo de colisión— están cerrados; lo que sigue sin E2E es la cola de tareas en segundo plano, que hoy solo se cubre con unidades. La deuda de foco de esta cadena quedó cerrada: [`e2e/modal-focus.spec.ts`](e2e/modal-focus.spec.ts) cubre ya veintitrés ventanas, incluidas las diez que solo se abrían desde un menú o un botón de la cabecera, y la restauración ya no depende de que sobreviva el control que la abrió.

---

## 8. Verificación de esta auditoría

```text
npx tsc --noEmit                                  → exit 0
npx eslint src --max-warnings 0                   → exit 0 (0 errores, 0 warnings)
npx vitest run                                    → 80 ficheros, 599 pruebas, 127 s, exit 0
npx vitest run --coverage                         → 54,01 % sentencias (sin umbral), exit 0
npx vite build                                    → exit 0, dist 1,7 MB
npx playwright test                               → 46 pruebas, 6,1 min, exit 0
npm audit --omit=dev                              → 0 vulnerabilidades
npm audit                                         → 4 bajas
npx tsc --noEmit -p tsconfig.strict.json          → 12 errores
```

No se ejecutó `npm run electron:build` ni se midió el empaquetado o el `.exe` resultante en esta revisión.
