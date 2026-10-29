# Auditoría general — OmniCommander Pro

**Fecha:** 29-oct-2026 · **Commit auditado:** `f29afd2` más las cinco unidades de esta jornada y su corrección posterior — `a96ec8a` (FTP), `383bf07` (shell), `aed9cad` (vista rápida), `380e13a` (sincronización y búsqueda), `b58ce2e` (limpieza), `dea20de` (presupuesto de `tasklist`), `b7bf9a9` (fallo visible), `59c2ba1` (E2E de la barra) · **Versión:** 1.0.4
**Alcance:** compuertas de calidad, datos que la interfaz presenta como reales, seguridad de la API local y de Electron, rendimiento, pruebas y CI.
**Método:** ejecución de las compuertas reales sobre el árbol de trabajo, lectura del código y prueba de ejecución de los endpoints nuevos contra la máquina.
**Relación con la anterior:** [AUDITORIA_2026-10-26.md](AUDITORIA_2026-10-26.md) midió `d3b113e`. Esta es una foto nueva, no una actualización de aquella.

---

## 0. Resumen

La app está **sana en lo que se puede medir automáticamente**: tipos, lint, 558 pruebas, build y los 11 E2E en verde, y sin vulnerabilidades en dependencias de producción. Sobre la anterior, se cerraron los tres bloqueantes y la deuda funcional que quedaba.

El trabajo de esta jornada se centró en otra clase de defecto que la auditoría anterior no cubría: **datos inventados**. La app presentaba como mediciones un handshake SSH que nunca ocurrió, un `ipconfig` con una IP fija, un `tasklist` con procesos que no existían, un `tree` de cuatro carpetas dibujadas, un volcado hexadecimal fabricado a partir del nombre del archivo, un reproductor con 180 s fijos, un progreso de sincronización con pausas de 60 ms y una versión `v5.50.2026` en un paquete `1.0.4`. Todo eso o se convirtió en una lectura real o desapareció; ninguna de esas pantallas puede volver a afirmar algo que no midió.

Lo que sigue abierto es deuda de higiene y de CI, no de comportamiento: `release/` con 657 MB, 30 `.txt` en la raíz, una dependencia declarada sin uso, 44 `any`, y una cobertura medida al 53,56 % que no tiene umbral ni script.

---

## 1. Compuertas medidas hoy

| Compuerta | Comando | Resultado |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | ✅ sin errores |
| ESLint | `npx eslint src --max-warnings 0` | ✅ 0 errores, 0 warnings |
| Pruebas | `npx vitest run` | ✅ 79 ficheros / **558 pruebas** (223 s) |
| Cobertura | `npx vitest run --coverage` | ⚠️ medida: **53,56 %** sentencias, 46,94 % ramas, 42,99 % funciones, 56,44 % líneas. Sin umbral |
| Build | `npx vite build` | ✅ 12,6 s; `dist` **1,7 MB**; chunk principal **516 kB** (`ModalShell` 440 kB aparte) |
| E2E | `npx playwright test` | ✅ **11 pruebas** (2,6 min): humo, a11y, a11y de modales, los cuatro casos de archivo y los tres de la barra de comandos |
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
| Sincronización de carpetas | `copyItem` sin `await` y una pausa de 60 ms “para simular progreso” | Copia esperada, contador real y fallo visible; si un elemento desapareció, se dice |
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
| Ficheros de prueba | 79 |
| Pruebas | 558 |
| Cobertura de sentencias | 53,56 % |
| Cobertura de líneas | 56,44 % |
| Specs del servidor | 16 ficheros `server.*.test.ts` |
| E2E | 11 pruebas, 5 specs |

Sin umbral y sin script `coverage` en `package.json`, aunque `@vitest/coverage-v8` está instalado: la cobertura existe como medición manual, no como compuerta.

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
| P2-12 · Cobertura | ⚠️ Parcial | Medida al 53,56 %, sin script ni umbral |
| Nuevo · E2E de la shell | ✅ Resuelto | [`e2e/commands.spec.ts`](e2e/commands.spec.ts) recorre la barra y contrasta `ipconfig` con `os.networkInterfaces()`, `tasklist` con un listado propio y `tree` con carpetas creadas en un temporal |

**Prioridad sugerida:** (1) sacar las rutas de máquina a un módulo y seguir con la división de `server.cjs`; (2) limpiar `release/`, los `.txt` y `@zip.js/zip.js`; (3) umbral de cobertura y `typecheck:strict` en el CI; (4) E2E para la vista rápida y la sincronización, que hoy solo tienen unidades.

---

## 8. Verificación de esta auditoría

```text
npx tsc --noEmit                                  → exit 0
npx eslint src --max-warnings 0                   → exit 0 (0 errores, 0 warnings)
npx vitest run                                    → 79 ficheros, 558 pruebas, 223 s
npx vitest run --coverage                         → 53,56 % sentencias (sin umbral)
npx vite build                                    → exit 0, dist 1,7 MB
npx playwright test                               → 11 pruebas, 2,6 min
npm audit --omit=dev                              → 0 vulnerabilidades
npm audit                                         → 4 bajas
npx tsc --noEmit -p tsconfig.strict.json          → 12 errores
```

No se ejecutó `npm run electron:build` ni se midió el empaquetado o el `.exe` resultante en esta revisión.
