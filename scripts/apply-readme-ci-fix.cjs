const fs = require('node:fs');
const file = 'README.md';
const nl = String.fromCharCode(10);
const lines = fs.readFileSync(file, 'utf8').split(nl);

function findLine(needle, label) {
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(needle)) hits.push(i);
  }
  if (hits.length !== 1) {
    throw new Error(label + ': expected 1 line, found ' + hits.length);
  }
  return hits[0];
}

const jobCount = findLine('tiene cuatro jobs:', 'job count');
lines[jobCount] = lines[jobCount].replace('tiene cuatro jobs:', 'tiene ocho jobs:');

const matrixStart = findLine('en una matriz de dos versiones de Node', 'matrix start');
let matrixEnd = matrixStart;
while (matrixEnd < lines.length && !lines[matrixEnd].includes('22.23.4): instalación')) {
  matrixEnd += 1;
}
if (matrixEnd >= lines.length) throw new Error('matrix end not found');
const beforeMatrix = lines[matrixStart].slice(0, lines[matrixStart].indexOf('en una matriz de dos versiones de Node'));
const afterVersion = lines[matrixEnd].slice(lines[matrixEnd].indexOf('22.23.4): ') + '22.23.4): '.length);
lines.splice(
  matrixStart,
  matrixEnd - matrixStart + 1,
  beforeMatrix + 'en una matriz de tres versiones de Node (el suelo que devuelve `engines`, la última 22.x, hoy',
  '22.23.4, y la última 24.x, hoy 24.22.2): ' + afterVersion
);

const legs = findLine('Las dos ramas se reportan por separado', 'verify legs');
lines[legs] = lines[legs].replace(
  'Las dos ramas se reportan por separado, así que un suelo roto se ve aunque la última 22.x esté en verde.',
  'Las tres ramas se reportan por separado, así que un suelo roto se ve aunque las otras dos estén en verde.'
);

let jobsStart = -1;
for (let i = 0; i < lines.length; i += 1) {
  if (lines[i].includes('4. **build** — en `windows-latest`, solo en tags')) {
    jobsStart = i;
  } else if (lines[i].trim() === '**build**' && i > 0 && lines[i - 1].trim() === '4.') {
    jobsStart = i - 1;
  }
}
if (jobsStart === -1) throw new Error('job list start not found');
let jobsEnd = -1;
for (let i = jobsStart; i < lines.length; i += 1) {
  if (lines[i].includes('lo adjunta.')) {
    jobsEnd = i;
    break;
  }
}
if (jobsEnd === -1) throw new Error('job list end not found');

const newJobs = [
  '4. **builds** — en `windows-latest`, tras `verify`: `npm run build` y `npm run build-storybook`, para que una config rota no se descubra recién en la etiqueta.',
  '5. **linux-packages** — en `ubuntu-latest`, solo en tags `v*`: compila con `npm run build:electron` y empaqueta con `electron-builder --linux AppImage deb --publish never` —no hay build cruzado de un',
  '`.deb` desde Windows—, comprueba que los nombres son los que declara `build.linux.artifactName` y que el control del paquete dice la versión de `package.json`, y deja los dos ficheros como artefacto de la corrida.',
  '6. **notes-preview** — en `windows-latest`, solo con `workflow_dispatch`: escribe en el resumen y en el log el cuerpo que generaría `scripts/release-notes.cjs` para la etiqueta pedida, sin instalar dependencias ni tocar ninguna release.',
  '7. **build** — en `windows-latest`, solo en tags `v*`, y depende de `verify`, de `e2e` y de `linux-packages`: si algo falla arriba, no se empaqueta ni se publica la release. Sube los seis ficheros de Windows y, del mismo `release/`, el `.deb` y el AppImage que bajó del job de Linux, así que la release sale completa.',
  '8. **linux-channel** — en `ubuntu-latest`, solo en tags `v*` y después de publicar: baja el',
  '`.deb` y el AppImage servidos por la release —cotejados contra el tamaño y el `digest` que registra GitHub—, escribe `latest-linux.yml` con lo que esos ficheros pesan y hashean, lo verifica y lo adjunta.',
  '',
  'Los dos jobs de Linux existen porque hasta la 1.0.52 la release publicaba sólo Windows y los dos paquetes se adjuntaban después a mano.'
];
lines.splice(jobsStart, jobsEnd - jobsStart + 1, ...newJobs);

const coverageStart = findLine('Esa compuerta no se mide en segundos', 'coverage start');
let coverageEnd = coverageStart;
while (coverageEnd < lines.length && !lines[coverageEnd].includes('Por eso la compuerta se lee')) {
  coverageEnd += 1;
}
if (coverageEnd >= lines.length) throw new Error('coverage end not found');
lines.splice(
  coverageStart,
  coverageEnd - coverageStart + 1,
  'Esa compuerta no se mide en segundos, y las patas ni siquiera ejecutan lo mismo: la de la última',
  '22.x mide con `test:coverage` y las del suelo y la 24 corren `Unit tests`, porque repetir la suite entera solo para medirla costaría una corrida más.',
  'En las seis corridas más recientes de `master` que se midieron, `Unit tests` tarda 33–48 s (mediana 45) y la variante con cobertura 50–79 s (mediana 72): unos 27 s de diferencia estructurales, que no dicen nada del código.',
  'A eso se le suma cada host, que mueve la pata entera: la diferencia entre dos patas de un mismo commit fue de 23 a 66 s, y en una corrida salió al revés —la del suelo tardó 157 s contra 124 s de la que mide cobertura—, que es justo la prueba de que el número no habla del proyecto.'
);

fs.writeFileSync(file, lines.join(nl));
console.log('README.md updated');
