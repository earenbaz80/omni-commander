# Portabilidad a Linux: capa de plataforma

**Estado:** fase 1 implementada (`volumes`, `cleanup`, `paths`, `trash` y `openWith` detrás del contrato) y fase 2
avanzada: el servidor arranca con `paths`/`volumes`, lista una carpeta real con rutas POSIX y la UI conserva `/`;
copiar, mover, renombrar, recorrer el árbol, extraer de un ZIP y mandar a la papelera pasan contra el servidor real
en `linux-integration.yml`, en cada push a `master` y en cada pull request. La papelera Linux usa `gio trash` con
fallback XDG. Los targets AppImage y `.deb` de prueba y su build de CI ya existen —el preflight empaqueta ambos como
artefactos de la corrida—, pero no se publica ninguna release Linux; Windows sigue siendo la única plataforma distribuida.

**Objetivo inicial:** Linux x64 con gestión de archivos local —listar, copiar,
mover, renombrar, borrar, papelera, abrir y línea de órdenes— y empaquetado
AppImage/`.deb`. La paridad completa y macOS quedan fuera de esta primera fase.

## 1. Regla de diseño

Las funciones de producto no preguntan por el sistema operativo. Piden
capacidades a una capa de plataforma; cada adaptador decide cómo cumplirlas.

```text
React  ->  capacidad (listar unidades, mover a papelera, abrir con...)
             |
       server/platform  o  electron/platform
             |
       adaptador Windows  |  adaptador Linux
```

La primera entrega del adaptador Windows **envuelve el código actual** sin
cambiar sus decisiones. Así la suite y el comportamiento en Windows siguen
siendo la referencia, y Linux se añade al lado, no reemplazando nada.

## 2. Dónde vive cada adaptador

| Capa | Ruta propuesta | Responsabilidad |
| --- | --- | --- |
| Servidor | `server/platform/` | Rutas, unidades/montajes, papelera, asociaciones, accesos directos, shell, procesos y estadísticas |
| Electron | `electron/platform/` | Ventana, bandeja, instancia única, elevación, autoarranque y actualizador |
| Renderer | `src/platform/` | Capacidades y etiquetas que la interfaz puede mostrar; nunca `process.platform` en componentes |

El contrato se escribe una vez y se prueba con un adaptador falso. Los módulos
existentes se van mudando por dominio, con sus tests, sin mezclar portabilidad y
arreglos funcionales en el mismo commit.

## 3. Contrato por dominio

| Dominio | Windows actual | Linux propuesto | Regla |
| --- | --- | --- | --- |
| Rutas | `path.win32`, raíces `C:\` | `path.posix`, raíz `/` | Una sola función de normalización por adaptador; ningún `path.win32` en features |
| Unidades | WMI/PowerShell (`Win32_LogicalDisk`) | `/proc/self/mounts` o `findmnt`; etiquetas con `lsblk`/`blkid` | La UI recibe `Volume { id, label, root, kind }`; no letras de unidad |
| Papelera | `Microsoft.VisualBasic.FileIO` | `gio trash` o `trash-cli`; fallback a `$XDG_DATA_HOME/Trash` | Misma operación `trash(paths)`; restaurar puede quedar fuera del MVP |
| Abrir con | Registro, App Paths, `.exe` | `xdg-open`, MIME (`xdg-mime`), `.desktop` | `open(path)` y `programsFor(path)`; sin rutas de registro en la UI |
| Accesos directos | `.lnk` + PowerShell | `.desktop` con `Exec`/`Icon` | `createShortcut(target, folder)`; el formato es del adaptador |
| Shell | `cmd.exe`, verbos DOS | `/bin/sh` o `bash`; `ls`, `clear`, `df` | La línea de órdenes pide `builtins()` y `run(argv)`; no concatena shell |
| Elevación | UAC + `elevate.exe` | PolicyKit (`pkexec`) o portal | No ejecutar la app entera como root; el MVP puede declarar la elevación no soportada |
| Procesos y carga | PowerShell/WMI | `/proc`, `ps`, APIs de Node | Misma forma de respuesta; el origen es del adaptador |
| Propiedades | Atributos Windows | Modo POSIX, propietario, grupo, enlaces | La UI muestra lo que el adaptador declara, no un union de ambos |
| Temporales | `%TEMP%`, Prefetch | `$XDG_RUNTIME_DIR`, `/tmp` | `tempDir()` y `cleanupTargets()` por adaptador |
| Empaquetado | NSIS + portable | AppImage + `.deb` | `electron-builder` con targets separados; no reutilizar `latest.yml` |
| Actualizador | `latest.yml` | `latest-linux.yml` | Decidir por formato: AppImage actualiza; `.deb` puede requerir repositorio o descarga manual |

## 4. Puntos de acoplamiento medidos

- **Rutas:** quedan 47 usos de `path.win32` —el README ya lo refleja—, 37 de
  ellos fuera de los tests: `server/runLauncher.cjs` (26), `server/fileOps.cjs`
  (7), `server/pathSafety.cjs` (2), `server/platform/windows.cjs` y
  `electron/trayMenu.cjs`. Los otros 10 están en siete ficheros de test
  (`server.archives.routes.test.ts`, `server/fileOps.stall.test.ts` y
  `server.files.routes.test.ts` con 2 cada uno, y `server.catalog.test.ts`,
  `server.cleanup.test.ts`, `server.pathsafety.test.ts` y
  `server.share.test.ts` con 1). `catalog`, `archiveReader` y las rutas de
  ficheros ya no lo usan en producción.
- **Servidor:** `server/platform/windowsVolumes.cjs` concentra el sondeo de
  unidades, WMI y las conexiones de red; `server/fileOps.cjs` y
  `server/openWith.cjs` ya delegan sus partes Windows en el adaptador;
  `server/runLauncher.cjs` usa `reg.exe`, `cmd.exe`, Prefetch, App Paths y UAC;
  `server/processes.cjs` y `server/systemLoad.cjs` usan PowerShell.
- **Electron:** `electron/main.cjs` tiene `setAppUserModelId`, bandeja y
  relanzamiento elevado; `electron/elevation.cjs` depende de `elevate.exe`;
  `electron/trayMenu.cjs` usa `path.win32`.
- **Interfaz:** la barra de unidades pinta la etiqueta que entrega el adaptador
  —una letra en Windows, el punto de montaje en Linux— y la barra de órdenes
  sigue siendo de verbos de DOS (`dir`, `cls`, `copy`, `xcopy`, `robocopy`),
  con alias POSIX sueltos (`ls`, `cat`, `rm`, `clear`). El campo se llama
  `letter` en todo el renderer aunque ya acepte una raíz `/`.
- **Empaquetado:** `package.json` declara `win` (NSIS/portable) y un target
  `linux` con AppImage y `.deb` de prueba; `.github/workflows/release.yml` corre
  en `windows-latest` y ejecuta `electron-builder --win`, mientras que
  `.github/workflows/linux-preflight.yml` genera el AppImage y el `.deb` como
  artefactos de CI con `--publish never`. No hay `latest-linux.yml` ni release
  Linux.
- **Tests:** `server.open.test.ts`, `server.run.test.ts` y
  `server.share.test.ts` tienen casos condicionados a `win32`; la suite Linux
  necesitará sus equivalentes, no borrar los de Windows.

## 5. Orden de trabajo

### Fase 0 — Preflight

- Workflow Linux manual/rama `linux-port` con instalación, formato, enlaces,
  tipos, lint y build.
- Sin tests ni e2e todavía: la suite actual asume Windows y un verde falso sería
  peor que un rojo conocido.

### Fase 1 — Contrato y adaptador Windows

Implementada en `server/platform/`: el contrato común, el selector, el adaptador
Windows y un adaptador Linux que ya resuelve las rutas XDG y lee los montajes de
`/proc/self/mounts`; `trash` ya está implementado y `cleanup`/`openWith` siguen
declarados como no soportados en Linux. `fileOps` consume `cleanup` y `trash`;
`scratch` consume `paths`; `openWith` consume el registro y el lanzador; y
`catalog` consume `volumes` para enumerar unidades y montajes.

- El contrato, el selector y los adaptadores están en `server/platform/`.
- Los dominios `volumes`, `cleanup`, `paths`, `trash` y `openWith` se movieron al
  adaptador Windows y los módulos solo piden la capacidad; las suites HTTP y de
  logs siguen pasando sin cambios.
- Linux ya resuelve `paths`, `volumes` y `trash`; `cleanup` y `openWith` se
  declaran no soportadas en sus capacidades, así que las operaciones que todavía
  no existen no caen silenciosamente a una implementación de Windows.

### Fase 2 — Corte vertical Linux (en curso)

- `catalog` pide `paths.pathApi` al adaptador y usa `path.posix` para listar;
  `/api/list` acepta el punto de montaje como raíz y rechaza rutas fuera de él.
  El renderer conserva las rutas que empiezan por `/` y navega con ese separador.
- `createFileOps` construye el servidor sin `cleanup` y `openWith` no registra sus
  rutas cuando el adaptador no la declara. Así el arranque Linux no depende de
  capacidades que todavía son un hueco explícito.
- `trash.move` usa `gio trash` para el lote completo y, si falla, mueve a
  `$XDG_DATA_HOME/Trash` (o `~/.local/share/Trash`) las entradas que sigan en
  disco. El fallback crea `files/` e `info/`, escribe un `.trashinfo` con la ruta
  original codificada y la fecha local, evita sobrescribir nombres existentes y
  resuelve `EXDEV` copiando antes de borrar el origen.
- El servidor arranca con el adaptador Linux y `/api/drives` responde; el listado
  POSIX está probado con un sistema de archivos inyectado y con una carpeta real
  a través de la ruta POSIX.
- Copiar, mover, renombrar, recorrer y medir el árbol, extraer de un ZIP,
  mandar a la papelera y borrar sin papelera ya están cubiertos por
  `server.linux.integration.test.ts`, que arranca el servidor real en CI. Sigue
  faltando: `cleanup`, `openWith` y un paquete publicado desde el que instalar.
  La UI muestra los montajes,
  pero el resto de operaciones reales todavía asume Windows.

### Fase 3 — Integración de escritorio

- `xdg-open`, asociaciones MIME, `.desktop`, bandeja y ventana.
- Decidir elevación: `pkexec` para operaciones puntuales o “no soportada” en el
  MVP.
- Añadir equivalentes Linux de los tests `win32` existentes.

### Fase 4 — Paquete y updater (en curso)

- Los targets AppImage y `.deb`, su icono de 512 px y los artefactos de CI ya
  están. El job Linux empaqueta ambos con `--publish never`, comprueba que el
  `.deb` declara la misma versión que `package.json` y los sube como artefactos
  de la corrida, sin crear una release. Después instala el `.deb` con `apt` y le
  pasa el mismo humo a la copia que queda en `/opt`: que el paquete se genere no
  decía nada sobre que se instale y arranque. Un job aparte,
  `clean-ubuntu-install`, repite la instalación en `ubuntu:24.04` limpio y
  arranca el binario allí: el runner ya trae las librerías de Electron, así que
  sólo un entorno desnudo distingue un `Depends` incompleto de uno completo. La
  primera corrida de ese job marcó `libgbm.so.1` y `libasound.so.2` como no
  encontradas, así que `build.deb.depends` repite la lista por defecto de
  electron-builder —declarar `depends` la reemplaza, no la extiende— y le añade
  `libgbm1` y `libasound2t64 | libasound2`: en 24.04 `libasound2` es un paquete
  virtual, y la alternativa cubre 22.04 sin dejar de instalar en 24.04. El apt
  de ese contenedor va acotado (`scripts/ubuntu-apt.sh`): el índice tiene 120 s
  y cada descarga 15 s sin reintentos, y antes de instalar se comprueba que el
  índice ofrezca candidato para cada dependencia declarada —`(none)` para todas
  a la vez es un índice truncado, no un paquete roto—. Antes, un mirror que no
  contestaba se comía los 20 minutos del job sin decir nada. Ese job
  sólo habla del paquete que su propio run acaba de compilar; el fichero que
  alguien descarga es el asset del Release, que con la misma versión son otros
  bytes. Por eso `released-deb-install` baja el asset publicado de `v<versión>`,
  lo compara con el `digest` y el tamaño que GitHub registra para él y lo
  instala en el mismo `ubuntu:24.04` y arranca el lanzador que deja el
  paquete: lo que se prueba es el archivo que se entrega, no una recompilación
  suya. No espera al build, porque lo que verifica ya está publicado. Ese
  lanzador es la entrada `.desktop`, no un comando en `/usr/bin`: el paquete
  pone el programa en `/opt/OmniCommander Pro` y el humo ejecuta el `Exec=` que
  la entrada declara, con sus códigos de campo quitados, porque es lo que corre
  un clic y lo único que puede decir si el icono abre algo. `released-appimage-boot`
  hace lo mismo con el AppImage publicado: mismo cotejo de tamaño y `digest`,
  y en el contenedor instala las librerías que el `.deb` de esa versión declara
  —el AppImage no declara ninguna— antes de arrancarlo con
  `--appimage-extract-and-run`, porque un contenedor no tiene montaje FUSE. El
  camino de montaje lo cubre el humo del AppImage de la corrida, que sí corre en
  un runner con FUSE. El arranque y la comprobación de que la ventana cargó
  viven en `scripts/ubuntu-app-boot.sh`, compartidos por los dos humos para que
  no se separen en qué aceptan como "abrió".
- Faltan `latest-linux.yml`, el updater Linux y una release de prueba. Bajo
  Xvfb el preflight ya no sólo abre el AppImage empaquetado y comprueba que
  lista un montaje: también abre una carpeta, copia un fichero entre paneles,
  borra otro sin papelera y, con la papelera encendida, manda uno a la papelera
  XDG —comprobando `files/`, el `.trashinfo` y la restauración—, con las carpetas
  y la papelera leídas de disco. Los cuatro casos son un piso escrito a mano; la
  suite e2e del proyecto corre además contra el AppImage con
  `playwright.packaged.config.ts`, que reemplaza la pestaña del servidor de Vite
  por la ventana de Electron: cada test arranca el paquete con su propio perfil
  (`--user-data-dir`), su propio puerto y su propio servidor, y `page.goto('/')`
  —lo único que los specs piden— se traduce en recargar esa ventana, donde ya
  están registrados los `addInitScript` que siembran los ajustes.
  De la suite quedan fuera tres specs: `dashboard-click` navega a la página
  `__jobs` que sirve la API y la ventana empaquetada no sale de sus dos
  documentos locales; `a11y.axe` pide una pestaña nueva que el puerto de
  depuración de Electron no abre; y `settings-updates` intercepta el feed de
  actualización desde la página, pero en el paquete ese feed vive en el proceso
  principal. La corrida de Linux recoge los 86 casos restantes: 21 se ejecutan y
  los otros 65 se declaran omitidos por ser de Windows (`ipconfig`, `tasklist`,
  los `.lnk`), y los 21 pasan contra el paquete; en Windows, la misma corrida
  deja 86 de 86. El AppImage se descomprime una vez (`--appimage-extract`) en
  lugar de una por test: cada arranque del runtime deja una copia entera en
  `/tmp`, y las copias de noventa arranques llenaron el disco del runner. Lo que falta es que Linux sea un
  gate, no que haya casos.

### Fase 5 — Paridad

- Completar archivos comprimidos, propiedades, procesos, estadísticas y
  preferencias que el MVP haya dejado fuera.
- Medir paridad contra la checklist de Windows, no solo “compila”.

## 6. Criterios de aceptación

- La suite Windows y sus e2e no cambian de resultado durante las fases 1–3.
- Ningún componente de `src/` comprueba `process.platform`.
- `path.win32` queda confinado al adaptador Windows y a fixtures de test.
- Linux lista el home y los montajes, y completa copiar/mover/renombrar/borrar
  con permisos POSIX.
- El paquete Linux se instala, abre, se identifica con la versión correcta y
  actualiza desde una copia anterior.
- La integración Linux corre en cada push a `master` y en cada pull request
  (`linux-integration.yml`), así que el adaptador POSIX ya es un gate; el
  preflight que empaqueta el AppImage y el `.deb` sigue siendo manual.

## 7. Decisiones pendientes

1. **Arquitectura del MVP:** x64 con AppImage y `.deb` ya se empaqueta; ¿se
   agrega arm64?
2. **Escritorio:** X11 y Wayland; GNOME/KDE como referencia, sin prometer
   integración profunda.
3. **Elevación:** ¿`pkexec` para operaciones puntuales o se declara fuera del
   MVP para no ejecutar la app como root?
4. **Updater:** AppImage únicamente, o `.deb` con una estrategia distinta.
5. **Modelo de unidades:** puntos de montaje visibles, favoritos y unidades
   extraíbles; decidir qué reemplaza exactamente a `C:` en la barra de rutas.

Este documento no cambia el soporte actual: hasta que las fases 1–4 estén
verdes, Windows sigue siendo la única plataforma distribuida.
