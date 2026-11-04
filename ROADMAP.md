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

**Por qué:** 134 s de suite con 4 workers y dos rojos de hoy que no eran fallos (`server.systemload.test.ts` exige ≥250 ms entre medidas; `server.cleanup.test.ts` se queja del bloqueo del fichero temporal). Una suite que miente acaba ignorándose.

Tareas:

- Separar los tests que no necesitan DOM (`server.*.test.ts`, `src/services/**`) a un proyecto de vitest con `environment: 'node'`; los de componentes se quedan en jsdom. Evita crear jsdom 97 veces.
- Probar `pool: 'vmThreads'` o `isolate: false` en el proyecto de lógica pura y medir antes/después; quedarse solo si baja de verdad.
- `server.systemload.test.ts`: usar temporizadores falsos o aflojar la aserción a un rango que no dependa de la carga de la máquina.
- `server.cleanup.test.ts`: reintento acotado en la limpieza del temporal, o un directorio por ejecución en vez de uno compartido.
- Objetivo de duración en CI: por debajo de 120 s el job `verify` (hoy el paso de tests es de varios minutos por leg).

**Hecho cuando:** cinco ejecuciones seguidas de la suite completa en verde, sin tocar tests, y el job `verify` por debajo del presupuesto.

**Riesgo:** medio. `isolate: false` puede filtrar estado entre ficheros; por eso se limita al proyecto que no comparte DOM.

---

### F2 · Dividir `server.cjs` — L, en tandas

**Por qué:** 4 710 líneas, 16 rutas, el motor de transferencias, el SSE y un panel HTML con su propio JavaScript embebido que no pasa por TypeScript ni por eslint.

Tandas, cada una un commit:

0. **Medir el servidor:** el arnés pasa `NODE_V8_COVERAGE` al hijo y un paso une esos informes con el de `src`. Sin esta red, refactorizar el servidor es mover código a ciegas.
1. **Rutas de sistema** (`/api/fs/*`, unidad, drives) → `server/routes/fs.cjs`. Ya hay precedente en `server/pathSafety.cjs` y `server/systemLoad.cjs`.
2. **Rutas de mapa** (teselas, búsqueda, caché offline) → `server/routes/maps.cjs`. Es la más reciente y la más autocontenida; sirve de ensayo.
3. **Motor de trabajos** (cola, pausa, reanudación, SSE) → `server/jobs.cjs`.
4. **Panel HTML de transferencias** (`server.cjs:1682` en adelante) → fuera del servidor o a `server/dashboard.cjs`, con su escape revisado.
5. El `server.cjs` que queda es arranque, middlewares y registro de rutas.

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

**Hecho cuando:** no cambia ni un comportamiento observable (los e2e y los tests de componentes siguen iguales) y los ficheros bajan de esos umbrales.

**Riesgo:** medio. Es refactor puro; el peligro es mezclarlo con arreglos funcionales en el mismo commit.

---

### F4 · Persistencia y tipos en la frontera — M

**Por qué:** 62 usos de `localStorage`, cada uno con su `try/catch`; un valor corrupto resetea un ajuste en silencio. Y 75 `any`/`as any`, casi todos donde la respuesta del servidor se convierte en tipos del cliente.

Tareas:

- `src/services/storage.ts`: `readStored(key, validate, fallback)` y `writeStored`, con `schemaVersion` por clave y migración declarada.
- `usePersistedState` para los componentes; migrar primero el historial de la calculadora, el tema y los ajustes del mapa, y luego el resto.
- Un test por clave migrada con: valor válido, valor corrupto, y valor de una versión anterior.
- Sustituir `any` por tipos derivados de una única definición de la respuesta del servidor; empezar por `fileSystem.ts` (transferencias y árbol de uso de disco).
- Activar `@typescript-eslint/no-explicit-any` en `warn` y bajarlo a `error` cuando queden menos de 30.

**Hecho cuando:** no queda ningún `JSON.parse(localStorage...)` suelto en componentes, hay migración probada, y el contador de `any` baja de 30.

**Riesgo:** bajo, pero toca ajustes del usuario: cada migración necesita su test de valor corrupto.

---

### F5 · Accesibilidad de lo interactivo nuevo — S

**Por qué:** mover y redimensionar ventanas es solo ratón; el tirador es un `role="separator"` sin orientación ni valores, y no hay forma de colocar una ventana con teclado.

Tareas:

- Flechas con modificador sobre la barra de título para mover; `Shift+flechas` para redimensionar desde la esquina.
- `aria-orientation`, `aria-valuenow/valuemin/valuemax` en el separador, o convertirlo en un botón con nombre claro si el rol no aporta.
- Anunciar el tamaño al soltar (región `aria-live` discreta), para que un lector de pantalla no quede a ciegas.
- Caso e2e con `axe` sobre un modal redimensionado y movido.

**Hecho cuando:** se puede mover y redimensionar una ventana sin ratón, y `axe` no reporta violaciones en los modales abiertos.

**Riesgo:** bajo.

---

### F6 · Mapa: gestión de la caché y descarga por zona — M

**Por qué:** la caché offline ya existe y guarda 20 000 teselas como máximo, pero el usuario no ve cuánto ocupa ni puede vaciarla, y solo se descarga lo que está a la vista.

Tareas:

- Línea de estado en el diálogo: teselas guardadas y MB, con botón de vaciar (reutiliza `DELETE /api/maps/cache` si se añade).
- Descarga por rectángulo arrastrado sobre el mapa, con su propio tope por tanda.
- Enlazar la atribución de cada capa con su página de licencia (requisito de OSM/OpenTopoMap/CyclOSM).
- Test del recorte del rectángulo en `tilesCoveringView` y del vaciado en `server.maps.test.ts`.

**Hecho cuando:** el diálogo informa del tamaño, permite vaciar, y se puede guardar una zona mayor que la pantalla.

**Riesgo:** medio: la descarga por zona multiplica peticiones a los servidores de teselas; hay que mantener el tope y la concurrencia baja.

---

### F7 · Release y firma — S

**Por qué:** el build firma con `signtool`, pero si el certificado no es de confianza pública SmartScreen seguirá avisando al instalar; y hay trabajo sin publicar acumulado (seis commits sobre 1.0.30).

Tareas:

- Confirmar qué certificado se usa y si está en el almacén de confianza; documentarlo en el README.
- Checklist de release en el README: versión, etiqueta, assets, `latest.yml`, comprobación de descarga.
- Limpiar `release/` y los volcados `.txt` de la raíz (ignorados por git, pero ocupan espacio y confunden).
- Decidir cadencia: una versión por bloque de arreglos, no un tag por cada commit.

**Hecho cuando:** un release sale con checklist cumplida y el instalador no dispara SmartScreen en una máquina limpia (o se documenta por qué sí).

**Riesgo:** bajo.

---

## 3. Resumen

| Fase | Qué arregla | Talla | Riesgo | Depende de |
| --- | --- | --- | --- | --- |
| F0 | Cobertura con umbral en el CI (ámbito `src/**`) | S | Bajo | — |
| F1 | Suite estable y a la mitad de tiempo | S/M | Medio | F0 |
| F2 | `server.cjs` dividido en módulos | L | Alto | F0, F1 |
| F3 | `App.tsx` y `fileSystem.ts` manejables | M/L | Medio | F1 |
| F4 | Persistencia con validación y migración; menos `any` | M | Bajo | F0 |
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

| Métrica | Hoy | Objetivo |
| --- | --- | --- |
| Cobertura de líneas del ámbito medido | 48,78 %, ya con umbral | 60 %, subiendo el umbral al subir el número |
| Duración de la suite en CI | varios minutos por leg | < 120 s |
| Rojos que no son fallos | 2 en una jornada | 0 en diez ejecuciones |
| `server.cjs` | 4 710 líneas | < 800 |
| `App.tsx` | 1 792 líneas | < 700 |
| `any`/`as any` | 75 | < 30 |
| `localStorage` sueltos en componentes | 62 | 0 (todo por `storage.ts`) |

---

## 6. Riesgos del plan

- **Refactor sin red:** `server.cjs` no está medido hoy. Por eso F0 lo mete en la cobertura **antes** de tocarlo.
- **Umbral que bloquea:** el umbral se pone en la línea base, no en una aspiración, y sube solo cuando el número real sube.
- **Trabajo mezclado:** una fase, un tipo de cambio. Un commit que arregla y otro que mueve, nunca los dos.
- **Suite que se «arregla» bajando exigencias:** los tests sensibles al reloj se reescriben con temporizadores falsos, no eliminando la comprobación.
