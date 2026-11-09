# OmniCommander Pro

Administrador de archivos de doble panel: dos listados lado a lado, barra de teclas de función y línea de órdenes, con una interfaz de terminal pensada para manejarse desde el teclado. La UI es React + Vite, las operaciones sobre el sistema de archivos real pasan por un servidor Express local (`server.cjs`) y la app de escritorio se empaqueta con Electron.

## Plataforma

La app es **solo para Windows**, y la compatibilidad con Linux o macOS no es un objetivo. No es una carencia pendiente: es el diseño. Los paneles se direccionan por letra de unidad (`C:\`), la línea de órdenes ejecuta verbos de DOS (`dir`, `cls`, `vol`), y el servidor local se apoya en el shell de Windows para la papelera, los accesos directos `.lnk`, los App Paths del registro, las propiedades de archivo y la elevación con UAC. Ninguna de esas piezas tiene equivalente directo fuera de Windows, y sustituirlas cambiaría el producto, no solo su implementación.

En la práctica eso significa:

- El empaquetado produce instalador NSIS y portable para Windows, y el updater (`latest.yml` + `electron-updater`) es el de Windows. No hay targets para otros sistemas.
- Hacerla compatible no es un refactor: si algún día se quiere, es una decisión de producto con su propio diseño, y toca el modelo de rutas del servidor (73 usos de `path.win32`), las unidades que muestra el cliente y los tests que las asumen.
- Para usarla desde otro sistema, la vía razonable es una máquina virtual con Windows: no compromete nada del código ni añade una segunda plataforma que mantener.

## Requisitos

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` y npm. Es lo que declara `engines` en [package.json](package.json), y el CI lo comprueba en tres versiones: el suelo de ese rango, que lee del propio fichero; la última 22.x (hoy 22.23.4), que es la que empaqueta las releases; y la última 24.x (hoy 24.22.2). La 26.x que el rango también admite todavía no está en la matriz. npm solo avisa si no se cumple: no bloquea la instalación.
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

## Extraer archivos comprimidos

Extraer pregunta qué hacer cuando el destino ya tiene una entrada con ese nombre. El aviso es el mismo de copiar y mover: enseña las dos rutas, los dos tamaños y la fecha, y ofrece omitir, conservar ambos, sobrescribir, sobrescribir si es distinto o renombrar el archivo viejo. La respuesta vale para ese miembro y, si se marca la casilla de siempre, para los siguientes; una extracción nueva vuelve a preguntar. Mientras el aviso está abierto no se escribe nada: el fichero que ya estaba sigue entero, y cerrar el aviso cancela la extracción en lugar de dejarla parada.

Sobrescribir tampoco escribe encima: el servidor redirige la escritura a un temporal que solo toma el nombre definitivo al terminar, y solo se salta su negativa cuando la petición se lo pide expresamente, que es lo que hace esta respuesta. Cuando la extracción la lanza algo que no puede preguntar —la copia de una entrada montada, una prueba—, el nombre ocupado se sigue rechazando con «El destino ya existe: nota.txt».

La comprobación es por entrada y no hay marcha atrás: si el choque está en el tercer miembro, los dos primeros ya están en disco, y omitirlo o cancelar deja el resto sin escribir sin deshacer lo anterior.

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

Hay variables que pone el propio proceso y no se configuran a mano: `OMNI_SESSION_TOKEN` (32 bytes aleatorios que [electron/main.cjs](electron/main.cjs) genera en cada arranque y exige en toda mutación y en las lecturas que describen el disco o la máquina —listados, árboles de tamaño, hashes, trabajos, unidades, procesos, tarjetas de red y carga del sistema—; sin token, como al lanzar el servidor a mano, todo se permite para no romper el flujo local), `E2E_RESERVED_PORTS` (el par de puertos que reserva la corrida de `test:e2e` y que comparten sus procesos), `PORTABLE_EXECUTABLE_FILE` y `TEMP` (Windows y electron-builder) y `OMNI_TEST_SERVER_CJS` (solo tests).

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
| `npm run check:links`      | Falla si un enlace relativo o un ancla de la documentación no resuelve.                    |
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
- **pre-push** — `npm run check:links`, después `npm run lint` y después `npm test`. Los enlaces van primero porque cuestan un segundo y no necesitan compilar: uno roto corta en el acto. Corta también en los tipos, así que un error de compilación no espera al minuto de suite. Los borrados de rama remota no lo disparan.

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
2. **verify** — en `windows-latest`, en cada push a `master` y en cada pull request, en una matriz de dos versiones de Node (el suelo que devuelve `engines` y la última 22.x, hoy 22.23.4): instalación con `npm ci --engine-strict` (un Node fuera de `engines.node` rompe aquí en vez de solo avisar; el job `build` usa el mismo flag), enlaces de la documentación (`check:links`), formato (`format:check`), tipos (`lint`), lint (`lint:eslint`) y tests (`npm test -- --maxWorkers=2`). Las dos ramas se reportan por separado, así que un suelo roto se ve aunque la última 22.x esté en verde.
3. **e2e** — en `windows-latest`, tras `verify`: instala Chromium y corre `npm run test:e2e`, los 14 ficheros y 54 casos de Playwright que hasta ahora solo se ejecutaban a mano. Es la única forma de que una rotura en el navegador no pase por verde. Tarda unos 5 minutos porque la suite es serial a propósito, y si falla sube el trace de la corrida como artefacto para saber qué spec y qué página.
4. **build** — en `windows-latest`, solo en tags `v*`, y depende de `verify` y de `e2e`: si algo falla arriba, no se empaqueta ni se publica la release.

Esa compuerta no se mide en segundos, y las dos patas ni siquiera ejecutan lo mismo: la de la última 22.x corre `Unit tests` y la del suelo mide con `test:coverage`, porque repetir la suite entera solo para medirla costaría el doble de verde. En las seis corridas más recientes de `master` —doce patas— `Unit tests` tarda 33–48 s (mediana 45) y la variante con cobertura 50–79 s (mediana 72): unos 27 s de diferencia estructurales, que no dicen nada del código. A eso se le suma cada host, que mueve la pata entera: la diferencia entre las dos de un mismo commit fue de 23 a 66 s, y en una corrida salió al revés —la del suelo tardó 157 s contra 124 s de la que mide cobertura—, que es justo la prueba de que el número no habla del proyecto. Por eso la compuerta se lee en verde o rojo y no en segundos; para medir rendimiento está la suite en local, donde el mismo árbol corre en unos 40 s.

### Dependabot

[`.github/dependabot.yml`](.github/dependabot.yml) revisa el repositorio cada día laborable y, cuando hay algo nuevo, abre un pull request en vez de esperar a que alguien haga push. Vigila dos cosas: las dependencias de `package.json` y las acciones del workflow, que van fijadas por SHA con su versión en el comentario.

Los PRs llegan agrupados a propósito. Primero `majors`, y después `production` y `development` con sus saltos de minor y patch revueltos; las acciones tienen su grupo aparte. La razón de separar el major no es el orden: un PR de parches se revisa leyendo el diff del lockfile, y uno que cambia de major se revisa leyendo las notas de la librería, que es otro trabajo.

**Minor y patch.** No piden ceremonia: el job `verify` ya corrió formato, tipos, tipos estrictos, eslint y la suite en el PR, y el `e2e` detrás. Basta con mirar que esté en verde, comprobar que el diff no toca nada fuera de `package.json` y `package-lock.json`, y fusionar. La suite son unos 40 s con dos workers, así que repetirla a mano añade poco.

**Major.** La pregunta no es «¿compila?» sino «¿lo soportan las herramientas que lo leen?». Hay un caso medido en este repositorio: TypeScript 7.0.2 deja los dos chequeos de tipos en **cero errores**, y aun así no se puede adoptar, porque `typescript-eslint` 8 se niega a cargar —«does not support TS 7.0»—: TS 7.0 solo publica el binario `tsc`, sin API de compilador. El puente oficial existe (`typescript` apuntando a `@typescript/typescript6`, el compilador nativo en paralelo) y funciona, pero cambia una dependencia por dos alias y un binario más; mientras la API no llegue en 7.1 y la herramienta no la soporte, ese PR se cierra diciendo exactamente eso.

La lista, en orden:

1. Lee las notas de la versión, no el número: breaking changes, requisitos de Node, cambios de API.
2. Mira los `peerDependencies` de quien la consume. Que compile solo no basta si el lint, el empaquetador o el plugin de turno declaran un rango que no incluye la versión nueva.
3. Reproduce en local con el lockfile que trae el PR: `npm ci`, y después `npm run lint`, `npm run typecheck:strict`, `npm run lint:eslint` y `npm test -- --maxWorkers=2`.
4. Si el paquete es de runtime —los siete de `dependencies` viajan dentro del instalador— mira también el tamaño del bundle; y si toca el shell de Electron, `npm run electron:build` y abrir la app, porque `libarchive.js` y `node-unrar-js` van fuera del asar y un salto de major ahí se nota al extraer, no al compilar.
5. Si sale bien, el commit lo dice; si se aplaza, se cierra el PR con el motivo (o se añade un `ignore` con su comentario). Un PR de major abierto durante meses es ruido que tapa al siguiente.

**Lo que no se hace.** Fusionar en rojo para vaciar la cola, ni `npm audit fix --force`: los cuatro avisos bajos de hoy son una sola cadena de desarrollo —`deepmerge` bajo `@rollup/plugin-node-resolve`, que usa `workbox-build`, que usa `vite-plugin-pwa`— y **no hay parche que aplicar**: `deepmerge` 4.3.1 es la última versión publicada y el advisory cubre justo hasta ella, así que no existe una 4.3.2 a la que saltar; la única corrección que ofrece npm es bajar `vite-plugin-pwa` a la 0.2.1, que rompe la PWA. Por eso el CI bloquea con `npm audit --omit=dev` —producción limpia, que es lo que se distribuye— y corre el árbol completo con `--audit-level=high`: un aviso alto o crítico pone el push en rojo, y los cuatro bajos dejan de aparecer como anotación de fallo en cada corrida.

**Las alertas no las enciende el fichero.** `dependabot.yml` gobierna las actualizaciones de versión; las alertas y los *security updates* se activan en **Settings → Code security**. Esos PRs ignoran el horario y el cooldown de tres días que sí tienen los de versión, y llegan el día que se publica el advisory: se tratan como urgentes, con la misma comprobación pero sin esperar turno.

## Actualizaciones y releases

La copia instalada no se actualiza sola a ciegas: `electron-updater` lee el `latest.yml` que electron-builder escribe dentro del paquete y comprueba si hay una versión más nueva en el repositorio. El updater solo existe en la instalación NSIS —un `npm run dev` o el portable, que se descomprime en un temporal en cada arranque, no tienen copia que reemplazar—, y nada se descarga hasta que se pulsa el botón: la comprobación es automática, la descarga es una decisión.

### Sin credenciales

El repositorio es público, así que comprobar actualizaciones no necesita ninguna credencial: `electron-updater` lee el `latest.yml` de la última release por la misma URL anónima que usaría cualquiera, y el destino sale del `app-update.yml` que electron-builder deja en el paquete. Hubo una época en que no era así: con el repositorio privado esa URL contestaba `404` y la app pedía un token de solo lectura que el usuario tenía que crear a mano. Al abrirlo desaparecieron el campo del token, `OMNI_UPDATE_TOKEN`, el fichero `update-token` y la fecha de caducidad anotada. Si una copia antigua conserva `%APPDATA%\omnicommander-pro\update-token`, se puede borrar: ya nada lo lee.

### El canal beta

Las versiones de prueba se publican como **prerelease** de GitHub, y el canal estable no las ve nunca: electron-updater pregunta a `/releases/latest`, que las excluye por definición. Para recibirlas hay que pedirlo, con la casilla **Ajustes → Seguridad → Recibir versiones beta**. Marcarla escribe `beta` en `%APPDATA%\omnicommander-pro\update-channel`; desmarcarla borra el fichero, y sin fichero el canal es el estable. El cambio se aplica al momento y lanza una comprobación nueva, porque un interruptor que deja en pantalla el veredicto del feed anterior parece que no hizo nada.

Lo que hace la casilla es poner `allowPrerelease` en el updater: la librería deja de preguntar a `/releases/latest` y recorre la lista de releases, que sí incluye las prereleases, quedándose con la primera entrada — la más reciente, sea beta o estable. Con la copia en una versión estable elige esa entrada sin más filtro; con una beta ya instalada solo acepta betas iguales o mejores, para que nadie retroceda de canal. Dentro de la release pide el fichero de su canal (`beta.yml`) y, si no existe, cae a `latest.yml`; el workflow publica los dos, así que la beta se encuentra en el primer intento y no en el segundo. Cualquier valor que no sea exactamente `beta` se trata como estable, incluido un fichero editado a mano o a medio escribir: una nota ilegible no debe llevar versiones de prueba a quien no las pidió.

Volver al canal estable no degrada la copia instalada. Si tienes una beta más nueva que la última estable, sigues en ella —el updater nunca baja de versión— hasta que salga una estable superior.

### Cortar una release

El job `build` solo se dispara con una etiqueta `v*` y exige que la etiqueta coincida con `version` en [package.json](package.json); si no coinciden, falla antes de empaquetar. Así se cortó la 1.0.41:

```bash
npm version 1.0.41 --no-git-tag-version    # sube package.json y package-lock.json
git commit -am "chore(release): cut 1.0.41"
git push origin master

git tag v1.0.41                            # sobre la punta de master, ya en verde
git push origin v1.0.41                    # solo la etiqueta
```

El commit del *bump* toca dos ficheros y seis líneas: la versión en `package.json` y sus dos entradas del lockfile. La etiqueta no tiene que ir encima de él, y en la 1.0.41 no fue así: se puso 25 commits más tarde, sobre un merge de Dependabot que seguía declarando `1.0.41`, porque el job compara ese campo y no mira la historia. Etiquetar la punta de `master` es lo que se hizo, y así el instalador sale de lo último que ya pasó el CI.

El push de la etiqueta empaqueta el NSIS y el portable, renombra los artefactos sin espacios —GitHub los reescribe al subirlos y `latest.yml` dejaría de encontrarlos—, comprueba que `latest.yml` apunta a un fichero que existe y con el tamaño declarado, y publica la release de una vez en lugar de dejarla en borrador. Los dos `.exe`, sus `.zip`, el `.blockmap` y `latest.yml` quedan en esa misma release, y una versión con sufijo añade además su `<canal>.yml`; las copias instaladas los leen sin credencial alguna. De punta a punta, la 1.0.41 tardó 12 min 47 s desde el push de la etiqueta hasta la release publicada: 15 s para comprobar el suelo de Node, las tres patas de `verify` de 2 min 40 s, 3 min 1 s y 1 min 37 s —en paralelo—, 1 min 17 s de `Build app and Storybook`, 4 min 48 s de `e2e` y 4 min 34 s del job que empaqueta y publica.

**Cortada la 1.0.42 (8-nov-2026).** La etiqueta fue sobre el commit del *bump* (`ee1eae1`) y no sobre la punta de `master`, que un commit después solo añadía una sección de este documento. Moverla habría pedido borrar el tag de una release ya publicada y resubir sus seis assets con otro `sha512` para entregar el mismo instalador, porque el README no entra en `build.files`. La release salió publicada, marcada Latest, con sus seis ficheros: el instalador de 125 570 671 bytes, su `.blockmap` de 132 157, los dos `.zip` de 125 573 692 y 113 202 362, el portable de 113 188 849 y un `latest.yml` de 366 que declara el tamaño del instalador y coincide con el que sirve GitHub. Los pasos 6 y 7 de la checklist —instalar en una máquina limpia y que una copia de la 1.0.41 vea la 1.0.42— siguen sin ejercerse.

**Cortada la 1.0.43 (9-nov-2026).** Etiqueta sobre la punta de `master` (`ced4612`), con el CI ya en verde sobre ese mismo commit, y release publicada, marcada Latest, con sus seis ficheros. La justifican dos arreglos y nada más: el updater que perdía una descarga terminada cuando una comprobación posterior volvía a ofrecer la misma versión (`a70a9bf`) y la ventana que se quedaba muerta cuando su renderer se caía, que ahora escribe el motivo en `omnicommander-renderer.log` y se recarga hasta tres veces (`0315c6e`). El camino no fue el de la 1.0.42: `Build and publish` falló dos veces en `Package Windows artifacts` con `Response code 504 (Gateway Time-out)` —la primera al llegar a las herramientas de NSIS, la segunda al relanzar los jobs fallidos veinte minutos después—, y no era el paquete sino GitHub devolviendo 504 también en su web; el tercer intento empaquetó y publicó a las 05:48:59 UTC, veintinueve minutos después del push de la etiqueta. Los números, medidos descargando: el instalador pesa 125 572 341 bytes y su `sha512` en base64 coincide carácter por carácter con el del `latest.yml` de 366 bytes, que declara ese mismo tamaño; el `.blockmap` pesa 132 210, el `.zip` del instalador 125 575 538 y el portable 113 190 552. Con esa descarga quedan cerrados el paso 3 —`git tag --list 'v1.0.43*'` vacío en local y en el remoto antes de cortar— y el paso 5. El 7 se ejerció después desde la copia instalada, con la misma app de la 1.0.41 y sus propios botones: la comprobación devolvió `available 1.0.43` y la descarga `downloaded 100%`, con 125 572 341 bytes en `pending/` y el mismo `sha512` en su `update-info.json`. Antes de eso, una veintena de comprobaciones se quedaron en error porque GitHub contestaba 504 al `latest.yml` de la release; la primera que encontró el manifiesto bueno pasó sin tocar nada más. El paso 6 sigue abierto: instalar en una máquina limpia, porque aquí el UAC no deja pasar y la copia continúa en 1.0.41.

Una versión con sufijo en `package.json` (`1.0.42-beta.1`) se publica **sola** como prerelease: el paso de publicación marca `prerelease` cuando el número lleva un guion, así que una beta no aparece como Latest ni llega a las copias que no han marcado la casilla de arriba. La etiqueta sigue teniendo que coincidir con esa versión (`v1.0.42-beta.1`), y la release lleva su `latest.yml` como cualquier otra más un `beta.yml` copiado de él —el fichero que el updater pide primero dentro de la release elegida—, así que ambos apuntan al mismo instalador.

### Ensayar el release sin publicar una versión

Cortar una etiqueta sobre la versión que ya está en `package.json` no es una prueba: `build` no distingue un ensayo de un release, así que publicaría la versión pendiente como **Latest** y las copias instaladas la verían en la siguiente comprobación del updater. Para ejercer el flujo entero —empaquetado, nombres de artefactos, `latest.yml`, canal beta y publicación— sin tocar el feed estable se usa la misma ruta que un canal beta: una versión con sufijo, en un commit que no llega a `master`.

```bash
git switch -c release-smoke-test
npm version 1.0.44-beta.1 --no-git-tag-version   # sube package.json y package-lock.json
git commit -am "chore: bump to a beta version for a release smoke test"
git tag v1.0.44-beta.1
git push origin v1.0.44-beta.1                   # solo la etiqueta; la rama se queda local
git switch master
git branch -D release-smoke-test
```

El push de la etiqueta corre el workflow entero —las tres patas de `verify`, el `e2e` y el `build`— y publica una **prerelease** con sus siete ficheros: los dos `.exe`, sus dos `.zip`, el `.blockmap`, `latest.yml` y el `beta.yml` que el updater de una copia beta pide primero. Medido el 8-nov-2026 con una `1.0.42-beta.1` cuando la pendiente era la `1.0.41`: doce minutos de punta a punta, de los cuales el job de publicación tardó 3 min 51 s, con artefactos de 113 MB y 125 MB.

Dos detalles que ahorran una sorpresa. El número tiene que ser distinto del que se piense publicar después, y por eso el ejemplo salta a `1.0.44-beta.1` en lugar de quedarse en la `1.0.43`, que es la siguiente que toca publicar: una etiqueta `v1.0.43` sobre esa versión publicaría la real, no una prueba. El sufijo conviene que sea el de un canal que ya exista (`beta.1`), porque el job copia `latest.yml` a `<canal>.yml` tomando el sufijo como nombre de canal. Y el commit se queda fuera de `master` a propósito: no hay nada que revertir, y `package.json` sigue con la versión que va a publicarse.

Leída la ejecución, se retira entero y empezando por la release: borrar solo la etiqueta deja una prerelease publicada apuntando a una etiqueta que ya no existe, y una copia en canal beta la seguiría viendo.

```bash
# Releases → la beta → Delete   (o: gh release delete v1.0.44-beta.1 --yes)
git push origin --delete v1.0.44-beta.1
git tag -d v1.0.44-beta.1
```

Queda comprobado con `git tag --list 'v1.0.44*'` vacío en local y en el remoto, y con que `…/releases/tags/v1.0.44-beta.1` contesta `404`. Antes de cortar la primera release detrás de un cambio en el workflow, este ensayo es el que dice si el `build` sigue en pie sin gastar un número de versión.

### Retirar una versión publicada por error

Borrar la release no desinstala nada: la copia instalada conserva su versión, y `allowDowngrade` sigue en `false` —nada en `electron/main.cjs` lo toca—, así que `isUpdateAvailable` descarta cualquier número menor y el updater no baja nunca. Lo que cambia es el feed: sin esa release, `/releases/latest` —la URL por la que el proveedor de GitHub resuelve el canal estable— pasa a apuntar a la anterior que no sea borrador ni prerelease, y una copia en la versión retirada se queda donde está, sin nada que instalar hasta que salga una superior.

De ahí las dos reglas. La release se borra **antes** que la etiqueta: al revés queda una release publicada colgando de una etiqueta inexistente, y `/releases/latest` no la distingue de una buena. Y si alguien llegó a instalarla, borrarla no lo arregla —no hay marcha atrás—, así que la corrección es publicar una versión **más alta**, no reetiquetar la misma: una copia ya en `1.0.41` no volvería a instalar otra `1.0.41`, porque `isUpdateAvailable` compara igualdad y contesta que no hay nada.

```bash
gh release delete v1.0.41 --yes     # o Releases → la versión → Delete release
git push origin --delete v1.0.41
git tag -d v1.0.41
```

Se comprueba al final: `git ls-remote --tags origin 'v1.0.41*'` vacío, `gh release view v1.0.41` contestando que no existe, y `…/releases/latest` devolviendo la `1.0.40`. Si el número no se va a reutilizar, `gh release delete v1.0.41 --yes --cleanup-tag` hace los dos pasos de una vez; a mano se separan porque el orden importa.

Lo que **no** arregla el problema, y por qué:

- **Ponerla en borrador o marcarla prerelease.** Saca la versión del canal estable en el acto y conserva los ficheros, así que sirve de freno mientras se decide; pero no devuelve a nadie a la anterior, y marcarla prerelease la deja visible para las copias con la casilla beta, que eligen la primera entrada del feed sin filtrar.
- **Editar a mano el `latest.yml` de la release.** Un manifiesto que declara un número menor no produce marcha atrás: el updater lo compara y lo ignora. Y si su `sha512` o su `size` dejan de coincidir con el fichero, quien sí tenga una versión anterior ve un error de comprobación en vez de una actualización.
- **Resubir un instalador recompilado con el mismo número.** Nadie que ya tenga esa versión lo recibe, y quien esté descargando en ese momento puede acabar con los bytes de uno y el hash del otro.
- **Borrar todas las estables.** El canal estable se resuelve por `…/releases/latest` y sin ninguna el updater falla con `ERR_UPDATER_LATEST_VERSION_NOT_FOUND`; la anterior es justo la que hay que dejar en pie.
- **Borrar solo la etiqueta.** La release sigue publicada y el feed la sigue sirviendo: es el caso que deja la versión viva sin código detrás.

Si nadie llegó a descargarla, el borrado es limpio y no hay nada más que hacer. El contador de descargas de cada asset —o `gh release view v1.0.41 --json assets`— dice si alguien la cogió; no dice si la instaló, porque instalar no deja rastro en el repositorio, y una descarga de más se resuelve igual con una versión nueva.

### Firma y SmartScreen

**Hoy no hay firma.** `package.json` no declara `certificateSubjectName` ni `signingHashAlgorithms`, el workflow no define `CSC_LINK`, y no hay ningún paso de `signtool` en el repositorio: electron-builder empaqueta el NSIS y el portable sin firmar. La consecuencia es la de cualquier binario sin reputación — la primera vez que alguien ejecuta el instalador, SmartScreen muestra «Windows protegió su PC» y hay que pasar por *Más información → Ejecutar de todas formas*. No es un fallo del build ni algo que se arregle con una opción: un certificado de firma de código con reputación se compra, y uno autofirmado no cambia ese aviso, solo lo hace aparecer con otro nombre.

El día que haya certificado, el cambio es una línea en `build.win` (`certificateSubjectName`) más el secreto con el fichero `.pfx` que lea el job de build; nada más del flujo depende de ello, porque los artefactos ya se renombran sin espacios y `latest.yml` ya se comprueba.

### Instalar el build para comprobarlo

`build.nsis` declara `oneClick: false` y `perMachine: false`, y eso no significa «instalar solo para el usuario actual»: significa que el instalador no obliga a instalar para todos y muestra la página que pregunta si es para todos los usuarios o solo para el actual. Quien lo ejecuta en silencio no ve esa página, y el resultado tampoco es la carpeta del usuario. Medido el 8-nov-2026 instalando la 1.0.40 con `Setup.exe /S`: quedó en `C:\Program Files\OmniCommander Pro` —404 MB—, con la entrada de desinstalación en `HKLM`, `DisplayVersion 1.0.40` y el desinstalador con `/allusers`. `perMachine: false` no impide esa instalación para todos los usuarios; solo evita que sea la única opción.

Tampoco sirve `/D=` para elegir carpeta cuando se instala así. En la misma prueba el destino se pidió con `/D=G:\temp\oc-app` como último argumento y sin comillas, que es la forma que exige NSIS, y el fichero acabó igualmente en `C:\Program Files`. El script sí trae su propio lector de `/D=` —`GetDParameter`, en `multiUser.nsh`—, pero aquí no llegó a aplicarse: la copia quedó donde decide el modo de instalación, no donde decía el argumento. Para elegir carpeta está la página del instalador gráfico; en silencio el destino no se negocia, y lo que queda es desinstalar al terminar:

```bash
"C:\Program Files\OmniCommander Pro\Uninstall OmniCommander Pro.exe" /allusers /S
```

Ese orden es el de la checklist: el paso 6 se cierra instalando en una máquina que se pueda tirar o desinstalando lo que se instaló, y la copia sirve sobre todo para el paso 7, porque el updater solo existe en la instalación NSIS. Una copia que se queda en `C:\Program Files` no daña nada, pero ocupa sitio y sale en «Aplicaciones instaladas» de todos los usuarios de la máquina.

### Checklist de una release

1. La rama está en verde: formato, tipos, lint, tests y e2e en el CI, no solo en local.
2. `version` en `package.json` es la que va a publicarse y la etiqueta `v` coincide con ella (el job `build` falla si no).
3. `git tag` no existe ya con ese número, ni en local ni en el remoto.
4. Tras el push de la etiqueta: la release no está en borrador, lleva los dos `.exe`, sus `.zip`, el `.blockmap` y `latest.yml`.
5. `latest.yml` apunta a un fichero que existe en la release y con el tamaño declarado.
6. Se ha descargado el instalador de la release y se ha instalado en una máquina limpia: abre, encuentra la versión y el updater ve la siguiente.
7. Una copia instalada de la versión **anterior** ve la nueva: con la casilla beta desmarcada, **Ajustes → Seguridad → Actualizaciones → Buscar actualizaciones** ofrece el número que acaba de publicarse, y después de instalarla la app se identifica con ese número. Es el único paso que ejerce el feed de verdad —`/releases/latest` y el `latest.yml` que va dentro de la release— en vez de la API de GitHub: si la versión no aparece, el fallo está en el manifiesto o en el flag de prerelease, no en la descarga, y la comprobación del paso 5 no lo habría visto porque mira los ficheros, no lo que el updater pregunta. El mensaje del error dice de quién es la culpa, y no siempre por el código: `/releases/latest` envuelve cualquier fallo en `ERR_UPDATER_LATEST_VERSION_NOT_FOUND` y deja el estado dentro del texto, así que un `504 Gateway Time-out` —o cualquier otro `5xx`— es GitHub caído, y le pasa igual a cualquier repositorio en ese momento, mientras que un `404` en esa URL sí es nuestro y significa que no queda ninguna estable publicada, solo borradores o prereleases. Un `404` al pedir el `latest.yml` de la release es siempre nuestro —la release existe pero le falta el manifiesto— y sale como `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`; cualquier otro estado al pedir ese fichero se relanza tal cual como `HTTP_ERROR_<código>`.
8. Los volcados `.txt` de la raíz y las builds viejas de `release/` se borran cuando ya no hacen falta; un `release/` con versiones de varias semanas ocupa más de un giga y no lo usa nadie.

El orden que hace que la beta llegue antes es el del propio flujo: se publica primero la beta (`1.0.22-beta.1`), se deja rodar, y cuando toca se publica la estable (`1.0.22`). Una copia con la casilla marcada ve la beta en cuanto se publica, porque su lista de releases incluye las prereleases; una copia sin marcar sigue mirando `latest.yml` y no ve la beta ni cuando ya existe, porque `/releases/latest` excluye por definición todo lo que no es la última estable.

## Formato

[.prettierrc](.prettierrc): punto y coma, comillas simples, 120 columnas y fin de línea LF. [.prettierignore](.prettierignore) deja fuera el lockfile, el bundle vendorizado de `public/` y la documentación. [.gitattributes](.gitattributes) fuerza LF en el checkout para que la comprobación de formato dé lo mismo en Windows que en el CI. Y como Prettier no mira este fichero, sus tablas las vigila [README.tables.test.ts](README.tables.test.ts): falla si una columna deja de estar alineada, si una fila pierde una celda o si el separador no cubre su columna.
