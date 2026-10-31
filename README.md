# OmniCommander Pro

Administrador de archivos de doble panel: dos listados lado a lado, barra de teclas de función y línea de órdenes, con una interfaz de terminal pensada para manejarse desde el teclado. La UI es React + Vite, las operaciones sobre el sistema de archivos real pasan por un servidor Express local (`server.cjs`) y la app de escritorio se empaqueta con Electron.

## Requisitos

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` y npm. Es lo que declara `engines` en [package.json](package.json), y el CI lo comprueba en dos versiones: el suelo de ese rango, que lee del propio fichero, y la última 22.x (hoy 22.23.4). npm solo avisa si no se cumple: no bloquea la instalación.
- Windows para el empaquetado Electron.

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

## Hooks de Git

Los hooks viven en `.githooks/` y se activan con `core.hooksPath` (lo hace `scripts/install-git-hooks.cjs` desde `prepare`). Son una comodidad para no llegar al CI con el trabajo ya hecho; la compuerta real sigue siendo el CI.

- **pre-commit** — pasa Prettier solo por los ficheros que entran en el commit y vuelve a prepararlos. Salta los ficheros que además tienen cambios sin preparar (prepararlos enteros colaría trabajo en curso en el commit) y avisa sin bloquear si `node_modules` no está instalado.
- **pre-push** — `npm run lint` y después `npm test`. Corta en los tipos, así que un error de compilación no espera al minuto de suite. Los borrados de rama remota no lo disparan.

Se saltan con `git commit --no-verify` / `git push --no-verify`. Para desactivarlos del todo: `git config --unset core.hooksPath`; para reinstalarlos: `npm run prepare`.

## CI

[.github/workflows/release.yml](.github/workflows/release.yml) tiene tres jobs:

1. **engines** — en `ubuntu-latest`, lee el suelo de `engines.node` con [scripts/engines-floor.cjs](scripts/engines-floor.cjs) y lo publica como salida para la matriz. Así la versión que se prueba sale del propio `package.json` en vez de estar copiada en el workflow; si el rango no tiene una forma de la que se pueda leer un mínimo, el job falla en vez de adivinar.
2. **verify** — en `windows-latest`, en cada push a `master` y en cada pull request, en una matriz de dos versiones de Node (el suelo que devuelve `engines` y la última 22.x, hoy 22.23.4): instalación con `npm ci --engine-strict` (un Node fuera de `engines.node` rompe aquí en vez de solo avisar; el job `build` usa el mismo flag), formato (`format:check`), tipos (`lint`), lint (`lint:eslint`) y tests (`npm test -- --maxWorkers=2`). Las dos ramas se reportan por separado, así que un suelo roto se ve aunque la última 22.x esté en verde.
3. **build** — en `windows-latest`, solo en tags `v*`, y depende de `verify`: si algo falla arriba, no se empaqueta ni se publica la release.

## Actualizaciones y releases

La copia instalada no se actualiza sola a ciegas: `electron-updater` lee el `latest.yml` que electron-builder escribe dentro del paquete y comprueba si hay una versión más nueva en el repositorio. El updater solo existe en la instalación NSIS —un `npm run dev` o el portable, que se descomprime en un temporal en cada arranque, no tienen copia que reemplazar—, y nada se descarga hasta que se pulsa el botón: la comprobación es automática, la descarga es una decisión.

### El token del updater

El repositorio es privado, así que la URL anónima a la que la librería apunta por defecto contesta `404` y ninguna copia vería una actualización. Por eso el updater pide un token propio, de solo lectura, que se queda en la máquina del usuario y nunca se empaqueta. Se crea en [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) con **Only select repositories** apuntando al repo de la app, **Repository permissions → Contents: Read-only** y una caducidad; no hace falta ningún otro permiso. GitHub no permite crear estos tokens por API, así que es un paso manual por diseño.

Se pega en **Ajustes → Seguridad → Token de actualizaciones**, no en un fichero a mano: la app lo valida (rechaza menos de 20 caracteres o cualquier espacio en medio), lo escribe con permisos de usuario en `%APPDATA%\omnicommander-pro\update-token` y reconstruye el feed al momento, sin reiniciar. `OMNI_UPDATE_TOKEN` gana sobre ese fichero si está definida, que es lo cómodo en un equipo compartido o en una sesión temporal. El destino del feed no se configura aquí: sale del `app-update.yml` que electron-builder deja en el paquete.

La fecha de caducidad no viaja dentro del token y GitHub solo la muestra al crearlo, así que se anota en el campo **Caduca el** y se guarda aparte, en `update-token-meta.json` (`{"tokenExpiresAt":"2027-01-29"}`), para que el fichero del token siga siendo una sola línea. Con esa fecha la tarjeta deja una nota neutra, pasa a **ámbar cuando quedan 30 días o menos** y a rojo cuando ya pasó, siempre al lado del enlace que lleva a la página donde se renueva. Guardar un token nuevo o quitar el actual borra la fecha anotada, porque era de la credencial anterior: hay que volver a escribirla.

Rotarlo es borrar el viejo en GitHub, crear el nuevo y pegarlo. Mientras no se haga, un token caducado no rompe nada más que el updater: la comprobación falla con `401`, la tarjeta lo dice y el resto de la app sigue igual.

### Cortar una release

El job `build` solo se dispara con una etiqueta `v*` y exige que la etiqueta coincida con `version` en [package.json](package.json); si no coinciden, falla antes de empaquetar. El orden que funciona:

```bash
npm version 1.0.16 --no-git-tag-version    # sube package.json y package-lock.json

git add package.json package-lock.json
git commit -m "chore(release): cut 1.0.16"
git tag v1.0.16
git push origin master v1.0.16
```

El push de la etiqueta empaqueta el NSIS y el portable, renombra los artefactos sin espacios —GitHub los reescribe al subirlos y `latest.yml` dejaría de encontrarlos—, comprueba que `latest.yml` apunta a un fichero que existe y con el tamaño declarado, y publica la release de una vez en lugar de dejarla en borrador. Los dos `.exe`, sus `.zip`, el `.blockmap` y `latest.yml` quedan en esa misma release; las copias instaladas los leen con el token de arriba.

## Formato

[.prettierrc](.prettierrc): punto y coma, comillas simples, 120 columnas y fin de línea LF. [.prettierignore](.prettierignore) deja fuera el lockfile, el bundle vendorizado de `public/` y la documentación. [.gitattributes](.gitattributes) fuerza LF en el checkout para que la comprobación de formato dé lo mismo en Windows que en el CI. Y como Prettier no mira este fichero, sus tablas las vigila [README.tables.test.ts](README.tables.test.ts): falla si una columna deja de estar alineada, si una fila pierde una celda o si el separador no cubre su columna.
