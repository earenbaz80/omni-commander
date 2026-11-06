# OmniCommander Pro

Administrador de archivos de doble panel: dos listados lado a lado, barra de teclas de función y línea de órdenes, con una interfaz de terminal pensada para manejarse desde el teclado. La UI es React + Vite, las operaciones sobre el sistema de archivos real pasan por un servidor Express local (`server.cjs`) y la app de escritorio se empaqueta con Electron.

## Plataforma

La app es **solo para Windows**, y la compatibilidad con Linux o macOS no es un objetivo. No es una carencia pendiente: es el diseño. Los paneles se direccionan por letra de unidad (`C:\`), la línea de órdenes ejecuta verbos de DOS (`dir`, `cls`, `vol`), y el servidor local se apoya en el shell de Windows para la papelera, los accesos directos `.lnk`, los App Paths del registro, las propiedades de archivo y la elevación con UAC. Ninguna de esas piezas tiene equivalente directo fuera de Windows, y sustituirlas cambiaría el producto, no solo su implementación.

En la práctica eso significa:

- El empaquetado produce instalador NSIS y portable para Windows, y el updater (`latest.yml` + `electron-updater`) es el de Windows. No hay targets para otros sistemas.
- Hacerla compatible no es un refactor: si algún día se quiere, es una decisión de producto con su propio diseño, y toca el modelo de rutas del servidor (73 usos de `path.win32`), las unidades que muestra el cliente y los tests que las asumen.
- Para usarla desde otro sistema, la vía razonable es una máquina virtual con Windows: no compromete nada del código ni añade una segunda plataforma que mantener.

## Requisitos

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` y npm. Es lo que declara `engines` en [package.json](package.json), y el CI lo comprueba en dos versiones: el suelo de ese rango, que lee del propio fichero, y la última 22.x (hoy 22.23.4). npm solo avisa si no se cumple: no bloquea la instalación.
- Windows, y solo Windows: ver [Plataforma](#plataforma).

El suelo no lo pone el código propio sino las dependencias: `jsdom` 30, el DOM de los tests, pide 22.22.2 en la línea 22 y 24.15 en la 24; `eslint` 10 pide 22.13 y `vitest` 5, 22.12. Por eso ni 22.20 ni 23.x valen.

## Puesta en marcha

```bash
npm install
npm run dev     # UI en http://localhost:3000
npm run server  # API de archivos en http://127.0.0.1:3001
```

`npm run dev` sirve solo la UI: Vite proxya `/api` al servidor local, así que sin `npm run server` la interfaz arranca pero las operaciones de archivos fallan.

El servidor prefiere el 3001 (`PORT` lo cambia) y, si está ocupado, avanza hasta encontrar un puerto libre: el que acabe usando se publica como `OMNI_API_PORT`, que es lo que lee el proxy de Vite.

`npm install` ejecuta `prepare`, que activa los hooks de Git (ver más abajo).

## Variables de entorno

Todas son opcionales. Para no repetirlas en cada orden, copia [.env.example](.env.example) a `.env`: lo cargan `npm run dev` (vía `loadEnv` de Vite) y `npm run server` (`node --env-file-if-exists`), y lo que ya esté exportado en la shell gana sobre el fichero. La app empaquetada con Electron no lo lee —arranca el servidor dentro de su propio proceso—, así que `.env` configura el flujo local, no la distribución.

| Variable        | Defecto | Qué hace                                                                                                                                                                                                                            | La lee                                                                         |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `PORT`          | `3001`  | Puerto preferido del servidor. Si está ocupado avanza hasta 25 más (`3001`-`3025`); vacío, `0` o no numérico caen al defecto.                                                                                                       | `server.cjs` y el proxy de Vite                                                |
| `OMNI_API_PORT` | —       | Puerto real donde escucha el servidor. Lo publica `server.cjs` al arrancar; fíjalo solo si necesitas que Vite o Playwright apunten a un puerto concreto. Fijarlo para Playwright implica reutilizar el servidor que ya escuche ahí. | [vite.config.ts](vite.config.ts), [playwright.config.ts](playwright.config.ts) |
| `E2E_UI_PORT`   | —       | Puerto de la UI en `npm run test:e2e`. Fíjalo (junto a `OMNI_API_PORT`) para que la suite use los servidores que ya tengas levantados en vez de arrancar los suyos.                                                                 | [playwright.config.ts](playwright.config.ts)                                   |
| `OMNI_DEBUG`    | vacío   | Log de depuración del servidor en stderr con prefijo `[omni]`: sondeos de unidades, WMI, cola de trabajos. Cualquier valor no vacío lo activa, **incluido `0`**.                                                                    | `server.cjs`                                                                   |
| `DISABLE_HMR`   | vacío   | `true` apaga solo la recarga en vivo de Vite. El servidor sigue vigilando los ficheros, así que recargar el navegador siempre trae el código actual.                                                                                | [vite.config.ts](vite.config.ts)                                               |

Para un valor puntual, sin `.env`:

```bash
PORT=3100 npm run server        # bash
```

```powershell
$env:PORT=3100; npm run server  # PowerShell
```

Hay variables que pone el propio proceso y no se configuran a mano: `OMNI_SESSION_TOKEN` (32 bytes aleatorios que [electron/main.cjs](electron/main.cjs) genera en cada arranque y exige en toda mutación y en las lecturas que describen el disco —listados, árboles de tamaño, hashes, trabajos y unidades—; sin token, como al lanzar el servidor a mano, todo se permite para no romper el flujo local), `E2E_RESERVED_PORTS` (el par de puertos que reserva la corrida de `test:e2e` y que comparten sus procesos), `PORTABLE_EXECUTABLE_FILE` y `TEMP` (Windows y electron-builder) y `OMNI_TEST_SERVER_CJS` (solo tests).

## Comandos

| Comando                    | Qué hace                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run dev`              | Vite en el puerto 3000 (`strictPort`: falla si está ocupado).                              |
| `npm run server`           | Servidor Express local que habla con el sistema de archivos.                               |
| `npm run build`            | Build de producción en `dist/`.                                                            |
| `npm run preview`          | Sirve el contenido de `dist/`.                                                             |
| `npm run clean`            | Borra `dist/` y `dev-dist/`.                                                               |
| `npm run electron:dev`     | Abre el shell de Electron sobre el proyecto.                                               |
| `npm run build:electron`   | Build de Vite para Electron.                                                               |
| `npm run electron:build`   | Build + `electron-builder`; los instaladores salen en `release/`.                          |
| `npm test`                 | Suite unitaria (Vitest).                                                                   |
| `npm run test:e2e`         | Playwright; arranca `dev` y `server` en puertos que pide al sistema, y los para al acabar. |
| `npm run lint`             | `tsc --noEmit` (tipos).                                                                    |
| `npm run lint:eslint`      | ESLint sobre `src` con `--max-warnings 0`.                                                 |
| `npm run typecheck:strict` | Tipos con `strict` y avisos de código muerto, que el tsconfig base no activa.              |
| `npm run format`           | Prettier sobre todo el repositorio, escribiendo.                                           |
| `npm run format:check`     | Prettier en modo comprobación (la compuerta del CI).                                       |
| `npm run storybook`        | Storybook en el puerto 6006.                                                               |
| `npm run build-storybook`  | Build estático de Storybook.                                                               |
| `npm run prepare`          | Instala los hooks de Git; lo lanza `npm install` solo.                                     |

### Puertos de la suite e2e

`npm run test:e2e` no toma prestados el 3000 ni el 3001: pide dos puertos al sistema operativo, levanta ahí sus propios `dev` y `server` y los para al acabar. De ahí que ya no pueda probar por error la aplicación que estuviera escuchando en el 3000, y que un puerto ocupado entre la reserva y el arranque sea un error claro en vez de un servidor en otro sitio.

Fija `E2E_UI_PORT` y `OMNI_API_PORT` para lo contrario: apuntar la suite a servidores que ya tengas levantados, que entonces reutiliza.

## La suite y el antivirus

`npm test` crea un jsdom por fichero de test —141 hoy— porque el aislamiento da a cada uno un registro de módulos nuevo, y jsdom son 949 módulos que hay que volver a leer del disco cada vez. En un equipo con el antivirus escaneando en tiempo real, esa lectura se paga cara. Aquí, abrir y cerrar un fichero de 55 bytes cuesta **0,68 ms** con el escaneo activo y **0,06 ms** con la carpeta excluida, mientras que un `stat` del mismo fichero son 0,05 ms: el peaje está en abrir contenido, no en mirar metadatos. Y no es cosa de la carpeta, porque una copia idéntica en `%TEMP%` lo paga igual.

Multiplicado por 141 ficheros, la diferencia no es cosmética:

| Medida                                    | Sin exclusión       | Con exclusión         |
| ----------------------------------------- | ------------------- | --------------------- |
| Abrir y cerrar un fichero de 55 B         | 0,68 ms             | 0,06 ms               |
| Leer los 663 ficheros de `jsdom/lib`      | 2,0–2,6 ms cada uno | 0,25–0,38 ms cada uno |
| Tiempo de entorno de una corrida completa | 166–344 s           | 115–124 s             |
| `npm test` de pared                       | 187–234 s           | 104–127 s             |

La comparación de las dos últimas filas no es un experimento controlado: el reloj de pared de esta suite baila mucho —cuatro núcleos lógicos, así que Vitest no pasa de tres workers, y cualquier otro proceso del equipo se nota— y las cifras salen de corridas distintas. Lo que sí está medido en el mismo instante es la lectura de ficheros: la misma arboleda, excluida y sin excluir, de 5 a 10 veces más rápida.

Así que en una máquina nueva la suite puede tardar el doble sin que nada esté roto. Para que no parezca que algo se ha estropeado, añade la carpeta del proyecto a las exclusiones del antivirus, desde una consola de administrador:

```powershell
Add-MpPreference -ExclusionPath 'C:\ruta\al\proyecto'
(Get-MpPreference).ExclusionPath   # comprobar que está
```

El precio es el que se espera: esa carpeta deja de escanearse en tiempo real. Para deshacerlo, `Remove-MpPreference -ExclusionPath '<ruta>'`. Y en Linux o macOS este peaje no se paga igual: el coste de abrir un fichero ahí es una fracción de esto.

## Hooks de Git

Los hooks viven en `.githooks/` y se activan con `core.hooksPath` (lo hace `scripts/install-git-hooks.cjs` desde `prepare`). Son una comodidad para no llegar al CI con el trabajo ya hecho; la compuerta real sigue siendo el CI.

- **pre-commit** — pasa Prettier solo por los ficheros que entran en el commit y vuelve a prepararlos. Salta los ficheros que además tienen cambios sin preparar (prepararlos enteros colaría trabajo en curso en el commit) y avisa sin bloquear si `node_modules` no está instalado.
- **pre-push** — `npm run lint` y después `npm test`. Corta en los tipos, así que un error de compilación no espera al minuto de suite. Los borrados de rama remota no lo disparan.

Se saltan con `git commit --no-verify` / `git push --no-verify`. Para desactivarlos del todo: `git config --unset core.hooksPath`; para reinstalarlos: `npm run prepare`.

## Ramas y limpieza

`master` es la única rama que vive para siempre: el trabajo entra por pull request, y GitHub borra la rama de origen en cuanto se fusiona, porque el repositorio tiene activado `delete_branch_on_merge`. El ajuste solo alcanza a las ramas que viven aquí: si el PR llega desde un fork, su rama se queda en el fork, que no es de este repositorio.

Cada clon tiene que hacer su parte una sola vez:

```bash
git config fetch.prune true
```

Con eso un `git fetch` normal elimina las referencias `origin/*` de ramas que ya no existen en el remoto, sin acordarse de `--prune`. No toca las ramas locales: Git no puede distinguir una rama terminada de una que vas a retomar, así que borrarlas sigue siendo decisión tuya.

```bash
git checkout master
git fetch                    # ya poda solo, por el ajuste de arriba
git branch --merged master   # las que ya están dentro de master
git branch -d <rama>         # sin forzar: si no está fusionada, se niega
```

`git branch --merged master` lista también `master`, que no hay que borrar. Para hacerlo en un solo paso está el alias `git prune-merged`: enseña lo que va a borrar, pide confirmación, y nunca toca `master` ni la rama en la que estás. Ese alias vive en `~/.gitconfig`, no en el repositorio, así que en un clon nuevo no existe.

Si hay que borrar una rama remota a mano —el caso del fork, o una que se quedó atrás—, `git push origin --delete <rama>` funciona sin `--no-verify`: el hook `pre-push` distingue un borrado por sus shas a cero y no corre tipos ni tests, porque no hay árbol que verificar.

## CI

[.github/workflows/release.yml](.github/workflows/release.yml) tiene cuatro jobs:

1. **engines** — en `windows-latest`, lee el suelo de `engines.node` con [scripts/engines-floor.cjs](scripts/engines-floor.cjs) y lo publica como salida para la matriz. Así la versión que se prueba sale del propio `package.json` en vez de estar copiada en el workflow; si el rango no tiene una forma de la que se pueda leer un mínimo, el job falla en vez de adivinar.
2. **verify** — en `windows-latest`, en cada push a `master` y en cada pull request, en una matriz de dos versiones de Node (el suelo que devuelve `engines` y la última 22.x, hoy 22.23.4): instalación con `npm ci --engine-strict` (un Node fuera de `engines.node` rompe aquí en vez de solo avisar; el job `build` usa el mismo flag), formato (`format:check`), tipos (`lint`), lint (`lint:eslint`) y tests (`npm test -- --maxWorkers=2`). Las dos ramas se reportan por separado, así que un suelo roto se ve aunque la última 22.x esté en verde.
3. **e2e** — en `windows-latest`, tras `verify`: instala Chromium y corre `npm run test:e2e`, los 14 ficheros y 54 casos de Playwright que hasta ahora solo se ejecutaban a mano. Es la única forma de que una rotura en el navegador no pase por verde. Tarda unos 5 minutos porque la suite es serial a propósito, y si falla sube el trace de la corrida como artefacto para saber qué spec y qué página.
4. **build** — en `windows-latest`, solo en tags `v*`, y depende de `verify` y de `e2e`: si algo falla arriba, no se empaqueta ni se publica la release.

Esa compuerta no se mide en segundos. El mismo código tarda entre **78 y 189 s** en el paso `Unit tests` según el host donde caiga, con una mediana de 136 s en veinte patas, y dos patas del mismo commit han llegado a separarse 100 s. No es el proyecto: las dos versiones de Node dan la misma mediana (136 s), el build de imagen del runner no separa los rápidos de los lentos, y el paso de instalar dependencias —que va de red— no correlaciona con los tests (r = 0,10), mientras que los pasos de solo CPU sí lo hacen (r = 0,69 con el lint). Es el host, así que la duración de ese paso no sirve como termómetro de rendimiento.

## Actualizaciones y releases

La copia instalada no se actualiza sola a ciegas: `electron-updater` lee el `latest.yml` que electron-builder escribe dentro del paquete y comprueba si hay una versión más nueva en el repositorio. El updater solo existe en la instalación NSIS —un `npm run dev` o el portable, que se descomprime en un temporal en cada arranque, no tienen copia que reemplazar—, y nada se descarga hasta que se pulsa el botón: la comprobación es automática, la descarga es una decisión.

### Sin credenciales

El repositorio es público, así que comprobar actualizaciones no necesita ninguna credencial: `electron-updater` lee el `latest.yml` de la última release por la misma URL anónima que usaría cualquiera, y el destino sale del `app-update.yml` que electron-builder deja en el paquete. Hubo una época en que no era así: con el repositorio privado esa URL contestaba `404` y la app pedía un token de solo lectura que el usuario tenía que crear a mano. Al abrirlo desaparecieron el campo del token, `OMNI_UPDATE_TOKEN`, el fichero `update-token` y la fecha de caducidad anotada. Si una copia antigua conserva `%APPDATA%\omnicommander-pro\update-token`, se puede borrar: ya nada lo lee.

### El canal beta

Las versiones de prueba se publican como **prerelease** de GitHub, y el canal estable no las ve nunca: electron-updater pregunta a `/releases/latest`, que las excluye por definición. Para recibirlas hay que pedirlo, con la casilla **Ajustes → Seguridad → Recibir versiones beta**. Marcarla escribe `beta` en `%APPDATA%\omnicommander-pro\update-channel`; desmarcarla borra el fichero, y sin fichero el canal es el estable. El cambio se aplica al momento y lanza una comprobación nueva, porque un interruptor que deja en pantalla el veredicto del feed anterior parece que no hizo nada.

Lo que hace la casilla es poner `allowPrerelease` en el updater: la librería deja de preguntar a `/releases/latest` y recorre la lista de releases, que sí incluye las prereleases, quedándose con la primera entrada — la más reciente, sea beta o estable. Con la copia en una versión estable elige esa entrada sin más filtro; con una beta ya instalada solo acepta betas iguales o mejores, para que nadie retroceda de canal. Dentro de la release pide el fichero de su canal (`beta.yml`) y, si no existe, cae a `latest.yml`; el workflow publica los dos, así que la beta se encuentra en el primer intento y no en el segundo. Cualquier valor que no sea exactamente `beta` se trata como estable, incluido un fichero editado a mano o a medio escribir: una nota ilegible no debe llevar versiones de prueba a quien no las pidió.

Volver al canal estable no degrada la copia instalada. Si tienes una beta más nueva que la última estable, sigues en ella —el updater nunca baja de versión— hasta que salga una estable superior.

### Cortar una release

El job `build` solo se dispara con una etiqueta `v*` y exige que la etiqueta coincida con `version` en [package.json](package.json); si no coinciden, falla antes de empaquetar. El orden que funciona:

```bash
npm version 1.0.16 --no-git-tag-version    # sube package.json y package-lock.json

git add package.json package-lock.json
git commit -m "chore(release): cut 1.0.16"
git tag v1.0.16
git push origin master v1.0.16
```

El push de la etiqueta empaqueta el NSIS y el portable, renombra los artefactos sin espacios —GitHub los reescribe al subirlos y `latest.yml` dejaría de encontrarlos—, comprueba que `latest.yml` apunta a un fichero que existe y con el tamaño declarado, y publica la release de una vez en lugar de dejarla en borrador. Los dos `.exe`, sus `.zip`, el `.blockmap` y `latest.yml` quedan en esa misma release, y una versión con sufijo añade además su `<canal>.yml`; las copias instaladas los leen sin credencial alguna.

Una versión con sufijo en `package.json` (`1.0.19-beta.1`) se publica **sola** como prerelease: el paso de publicación marca `prerelease` cuando el número lleva un guion, así que una beta no aparece como Latest ni llega a las copias que no han marcado la casilla de arriba. La etiqueta sigue teniendo que coincidir con esa versión (`v1.0.19-beta.1`), y la release lleva su `latest.yml` como cualquier otra más un `beta.yml` copiado de él —el fichero que el updater pide primero dentro de la release elegida—, así que ambos apuntan al mismo instalador.

### Firma y SmartScreen

**Hoy no hay firma.** `package.json` no declara `certificateSubjectName` ni `signingHashAlgorithms`, el workflow no define `CSC_LINK`, y no hay ningún paso de `signtool` en el repositorio: electron-builder empaqueta el NSIS y el portable sin firmar. La consecuencia es la de cualquier binario sin reputación — la primera vez que alguien ejecuta el instalador, SmartScreen muestra «Windows protegió su PC» y hay que pasar por *Más información → Ejecutar de todas formas*. No es un fallo del build ni algo que se arregle con una opción: un certificado de firma de código con reputación se compra, y uno autofirmado no cambia ese aviso, solo lo hace aparecer con otro nombre.

El día que haya certificado, el cambio es una línea en `build.win` (`certificateSubjectName`) más el secreto con el fichero `.pfx` que lea el job de build; nada más del flujo depende de ello, porque los artefactos ya se renombran sin espacios y `latest.yml` ya se comprueba.

### Checklist de una release

1. La rama está en verde: formato, tipos, lint, tests y e2e en el CI, no solo en local.
2. `version` en `package.json` es la que va a publicarse y la etiqueta `v` coincide con ella (el job `build` falla si no).
3. `git tag` no existe ya con ese número, ni en local ni en el remoto.
4. Tras el push de la etiqueta: la release no está en borrador, lleva los dos `.exe`, sus `.zip`, el `.blockmap` y `latest.yml`.
5. `latest.yml` apunta a un fichero que existe en la release y con el tamaño declarado.
6. Se ha descargado el instalador de la release y se ha instalado en una máquina limpia: abre, encuentra la versión y el updater ve la siguiente.
7. Los volcados `.txt` de la raíz y las builds viejas de `release/` se borran cuando ya no hacen falta; un `release/` con versiones de varias semanas ocupa más de un giga y no lo usa nadie.

El orden que hace que la beta llegue antes es el del propio flujo: se publica primero la beta (`1.0.22-beta.1`), se deja rodar, y cuando toca se publica la estable (`1.0.22`). Una copia con la casilla marcada ve la beta en cuanto se publica, porque su lista de releases incluye las prereleases; una copia sin marcar sigue mirando `latest.yml` y no ve la beta ni cuando ya existe, porque `/releases/latest` excluye por definición todo lo que no es la última estable.

## Formato

[.prettierrc](.prettierrc): punto y coma, comillas simples, 120 columnas y fin de línea LF. [.prettierignore](.prettierignore) deja fuera el lockfile, el bundle vendorizado de `public/` y la documentación. [.gitattributes](.gitattributes) fuerza LF en el checkout para que la comprobación de formato dé lo mismo en Windows que en el CI. Y como Prettier no mira este fichero, sus tablas las vigila [README.tables.test.ts](README.tables.test.ts): falla si una columna deja de estar alineada, si una fila pierde una celda o si el separador no cubre su columna.
