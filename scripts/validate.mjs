import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recent, safeUrl, linkAllowed, CHANNELS } from './content.mjs';
import { endeavorUrl } from './endeavor.mjs';
// collect.mjs solo recopila cuando se ejecuta como programa: importarlo no hace peticiones.
import { SOURCES } from './collect.mjs';

// Campos opcionales: si están, deben tener un valor conocido.
const TIERS = [1, 2, 3], ACCESS = ['open', 'paywall', 'mixed'], LANGUAGES = ['es', 'en'];
const SOURCE_BY_ID = new Map(SOURCES.map(source => [source.id, source]));

// Lanza un Error con el primer problema de la edición. `now` fija el reloj en las pruebas.
export function validateEdition(data, { now = Date.now() } = {}) {
  const fail = message => { throw new Error(message); };
  if (data?.version !== 1 || !Array.isArray(data.sources) || !Array.isArray(data.stories)) fail('estructura de edición inválida');
  if (!data.sources.some(s => s?.status === 'ok')) fail('ninguna fuente respondió');
  const ids = new Set();
  for (const story of data.stories) {
    const name = story?.id || story?.title;
    if (!story?.id || !story.source || !story.title || !safeUrl(story.url) || !recent(story.publishedAt, now)) fail(`noticia inválida: ${name}`);
    if (ids.has(story.id)) fail(`noticia repetida: ${name}`);
    ids.add(story.id);
    if (!CHANNELS.includes(story.category)) fail(`canal desconocido en ${name}: ${story.category}`);
    if (story.tier !== undefined && !TIERS.includes(story.tier)) fail(`nivel inválido en ${name}: ${story.tier}`);
    if (story.access !== undefined && !ACCESS.includes(story.access)) fail(`acceso inválido en ${name}: ${story.access}`);
    if (story.stale !== undefined && story.stale !== true) fail(`marca stale inválida en ${name}`);
    if (story.sourceUrl !== undefined && !safeUrl(story.sourceUrl)) fail(`enlace del medio inválido en ${name}`);
    // Fuentes oficiales con lista de dominios (`linkHosts`): el enlace de la nota debe ser de uno de ellos.
    const source = SOURCE_BY_ID.get(story.sourceId);
    if (source?.linkHosts && !linkAllowed(story, source)) fail(`enlace fuera de los dominios de ${source.id} en ${name}: ${story.url}`);
    // Empresa Endeavor mencionada (opcional): nombre y, si hay enlace, una ficha https de endeavor.org.
    if (story.endeavor !== undefined && (typeof story.endeavor?.company !== 'string' || !story.endeavor.company || (story.endeavor.url !== undefined && !endeavorUrl(story.endeavor.url)))) fail(`empresa Endeavor inválida en ${name}`);
  }
  for (const source of data.sources) {
    if (source.tier !== undefined && !TIERS.includes(source.tier)) fail(`nivel inválido en la fuente ${source.id}`);
    if (source.access !== undefined && !ACCESS.includes(source.access)) fail(`acceso inválido en la fuente ${source.id}`);
    if (source.language !== undefined && !LANGUAGES.includes(source.language)) fail(`idioma inválido en la fuente ${source.id}`);
    if (source.url !== undefined && !safeUrl(source.url)) fail(`enlace inválido en la fuente ${source.id}`);
  }
  return { stories: data.stories.length, available: data.sources.filter(s => s.status === 'ok').length };
}

// Uso: node scripts/validate.mjs [ruta]. Sin ruta valida site/data/news.json (relativa al directorio actual).
async function main() {
  const file = resolve(process.argv[2] || 'site/data/news.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  let result;
  try { result = validateEdition(data); } catch (error) { throw new Error(`${file}: ${error.message}`); }
  console.log(`Edición válida: ${result.stories} publicaciones y ${result.available} fuentes disponibles.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
