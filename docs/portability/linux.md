# Portabilidad a Linux: capa de plataforma

**Estado:** fase 2 avanzada: el servidor arranca con `paths`/`volumes`, lista una
carpeta real con rutas POSIX y la UI conserva `/`; copiar, mover, renombrar,
recorrer el árbol, extraer de un ZIP y mandar a la papelera pasan contra el
servidor real en `linux-integration.yml`, en cada push a `master` y en cada pull
request; `server.share.test.ts` también corre en POSIX dentro de la suite
completa. La papelera Linux usa `gio trash` con fallback XDG. Linux
implementa `cleanup` para el target `user-temp` (`TMPDIR` o `/tmp`, con override
de test); `openWith` sigue sin implementación Linux. La suite completa de
`linux-portability.yml` es un gate bloqueante desde `365f9f1`, posterior a la
1.0.55. Los targets AppImage y `.deb` y su build de CI ya existen: el preflight
empaqueta ambos, y cada release publica los dos paquetes con su canal
`latest-linux.yml`; Windows sigue siendo la plataforma soportada.

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
| Temporales | `%TEMP%`, `%SystemRoot%\Temp`, Prefetch | `TMPDIR` o `/tmp`; target `user-temp` | `tempDir()` y `cleanupTargets()` por adaptador; Linux no inventa Prefetch |
| Empaquetado | NSIS + portable | AppImage + `.deb` | `electron-builder` con targets separados; no reutilizar `latest.yml` |
| Actualizador | `latest.yml` | `latest-linux.yml` | `electron-updater` resuelve una entrada por extensión: `DebUpdater` baja el `.deb` y lo instala con `dpkg`/`apt` bajo sudo; el AppImage se reemplaza sólo si se lo abrió como AppImage |

## 4. Puntos de acoplamiento medidos

- **Rutas:** quedan 32 usos de `path.win32` en producción:
  `server/runLauncher.cjs` (26), `server/pathSafety.cjs` (2),
  `server/fileOps.cjs` (1), `server/platform/windows.cjs` (1),
  `server/platform/windowsUserFolders.cjs` (1) y `electron/trayMenu.cjs` (1).
  En tests quedan cinco líneas en cuatro ficheros
  (`server.archives.routes.test.ts`, `server.catalog.test.ts`,
  `server.files.routes.test.ts` y `server.pathsafety.test.ts`). `catalog`,
  `archiveReader` y las rutas de ficheros ya no lo usan en producción.
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
  `linux` con AppImage y `.deb`; `.github/workflows/release.yml` publica los
  cuatro en la release de la etiqueta —el AppImage y el `.deb` se empaquetan en
  `ubuntu-latest` y se adjuntan con los de Windows, y un job escribe después el
  `latest-linux.yml` desde esos assets—, y
  `.github/workflows/linux-preflight.yml` los genera además como artefactos de
  CI con `--publish never` para probar el puerto sin cortar una versión.
- **Tests:** `server.cleanup.test.ts` y `server.share.test.ts` ya corren en
  Linux; cleanup conserva sólo el caso del archivo en uso detrás de `win32`,
  porque POSIX puede desvincular un archivo abierto. Siguen siendo Windows-only
  los casos de `server.open`, `server.run`, `server.openWith`, `server.sendto`,
  `server.run.suggestions` y `server.userfolders`, que ejercen shell, Run, Start
  Menu, `.lnk` o bibliotecas de Windows.

## 5. Orden de trabajo

### Fase 0 — Preflight

- Workflow Linux manual/rama `linux-port` con instalación, formato, enlaces,
  tipos, lint y build.
- Sin tests ni e2e todavía: la suite actual asume Windows y un verde falso sería
  peor que un rojo conocido.

### Fase 1 — Contrato y adaptador Windows

Implementada en `server/platform/`: el contrato común, el selector, el adaptador
Windows y un adaptador Linux que ya resuelve las rutas XDG y lee los montajes de
`/proc/self/mounts`; `trash` ya está implementado, `cleanup` se agregó después
para `user-temp` y `openWith` sigue declarado como no soportado en Linux.
`fileOps` consume `cleanup` y `trash`; `scratch` consume `paths`; `openWith`
consume el registro y el lanzador; y `catalog` consume `volumes` para enumerar
unidades y montajes.

- El contrato, el selector y los adaptadores están en `server/platform/`.
- Los dominios `volumes`, `cleanup`, `paths`, `trash` y `openWith` se movieron al
  adaptador Windows y los módulos solo piden la capacidad; las suites HTTP y de
  logs siguen pasando sin cambios.
- Linux ya resuelve `paths`, `volumes`, `trash` y `cleanup` (`user-temp`);
  `openWith` se declara no soportada, así que las operaciones que todavía no
  existen no caen silenciosamente a una implementación de Windows.

### Fase 2 — Corte vertical Linux (en curso)

- `catalog` pide `paths.pathApi` al adaptador y usa `path.posix` para listar;
  `/api/list` acepta el punto de montaje como raíz y rechaza rutas fuera de él.
  El renderer conserva las rutas que empiezan por `/` y navega con ese separador.
- `createFileOps` construye el servidor Linux con `cleanup` (`user-temp`) y
  `openWith` no registra sus rutas cuando el adaptador no la declara. Así el
  arranque Linux no depende de capacidades que todavía son un hueco explícito.
- `trash.move` usa `gio trash` para el lote completo y, si falla, mueve a
  `$XDG_DATA_HOME/Trash` (o `~/.local/share/Trash`) las entradas que sigan en
  disco. El fallback crea `files/` e `info/`, escribe un `.trashinfo` con la ruta
  original codificada y la fecha local, evita sobrescribir nombres existentes y
  resuelve `EXDEV` copiando antes de borrar el origen.
- El servidor arranca con el adaptador Linux y `/api/drives` responde; el listado
  POSIX está probado con un sistema de archivos inyectado y con una carpeta real
  a través de la ruta POSIX.
- Los accesos rápidos del panel de árbol son las carpetas XDG del escritorio:
  `server/platform/linuxUserFolders.cjs` lee `$XDG_CONFIG_HOME/user-dirs.dirs`,
  expande `$HOME` y sólo ofrece las que están en disco, así que en una
  instalación en español son `Escritorio`, `Documentos`, `Descargas` y no los
  nombres ingleses. La resolución es una capacidad del adaptador (`userFolders`):
  Windows sigue preguntando al perfil por sus bibliotecas redirigidas, y una
  plataforma sin esa capacidad responde vacío en vez de adivinar rutas.
- Copiar, mover, renombrar, recorrer y medir el árbol, extraer de un ZIP,
  mandar a la papelera y borrar sin papelera ya están cubiertos por
  `server.linux.integration.test.ts`, que arranca el servidor real en CI. Sigue
  faltando: `openWith`, la integración de escritorio y la paridad de las
  operaciones que aún asumen Windows. Los paquetes AppImage y `.deb` ya se
  publican; `cleanup` cubre sólo `user-temp`, no los targets de Windows.

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
  y cada descarga 15 s sin reintentos, se cuenta cuántos paquetes trajo el índice
  —cero es una descarga vacía, no un paquete roto— y antes de instalar corre un
  `apt-get -s`, que resuelve la petición sin bajar nada: con un índice truncado
  falla en un segundo y nombra la dependencia que no puede satisfacer. El ensayo
  hace falta porque `apt-cache policy` no sirve para eso: `libgtk-3-0` en 24.04 es
  un nombre virtual que provee `libgtk-3-0t64` y reporta `Candidate: (none)` para
  un paquete que apt instala sin problema. Antes, un mirror que no contestaba se
  comía los 20 minutos del job sin decir nada. Ese job
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
- `latest-linux.yml` y el updater Linux ya están: el canal lo escribe el job
  `linux-channel` de la release desde los paquetes que esa release sirve, el
  preflight lo repite a mano sobre una versión cortada y el job
  `Find the published Linux channel with the app's updater` levanta `DebUpdater`
  contra el feed. Falta una release de prueba. Bajo
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
  `/tmp`, y las copias de noventa arranques llenaron el disco del runner. La
  suite completa de `linux-portability.yml` es un gate bloqueante desde
  `365f9f1`; la e2e empaquetada sigue en el preflight manual.

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
  (`linux-integration.yml`) y la suite completa de `linux-portability.yml` es
  bloqueante desde `365f9f1`; el preflight que empaqueta el AppImage y el `.deb`
  sigue siendo manual.

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

Este documento no cambia el soporte actual: Windows sigue siendo la única
plataforma soportada. Los paquetes Linux se publican como portabilidad en
progreso, no como una plataforma con soporte.
