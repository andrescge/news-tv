import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { recent, safeUrl, CHANNELS } from './content.mjs';

// Uso: node scripts/validate.mjs [ruta]. Sin ruta valida site/data/news.json (relativa al directorio actual).
const file = resolve(process.argv[2] || 'site/data/news.json');
const data = JSON.parse(await readFile(file, 'utf8'));
const fail = message => { throw new Error(`${file}: ${message}`); };
if (data.version !== 1 || !Array.isArray(data.sources) || !Array.isArray(data.stories)) fail('estructura de edición inválida');
if (!data.sources.some(s => s.status === 'ok')) fail('ninguna fuente respondió');
// Campos opcionales: si están, deben tener un valor conocido.
const TIERS = [1, 2, 3], ACCESS = ['open', 'paywall', 'mixed'], LANGUAGES = ['es', 'en'];
const ids = new Set();
for (const story of data.stories) {
  const name = story.id || story.title;
  if (!story.id || !story.source || !story.title || !safeUrl(story.url) || !recent(story.publishedAt)) fail(`noticia inválida: ${name}`);
  if (ids.has(story.id)) fail(`noticia repetida: ${name}`);
  ids.add(story.id);
  if (!CHANNELS.includes(story.category)) fail(`canal desconocido en ${name}: ${story.category}`);
  if (story.tier !== undefined && !TIERS.includes(story.tier)) fail(`nivel inválido en ${name}: ${story.tier}`);
  if (story.access !== undefined && !ACCESS.includes(story.access)) fail(`acceso inválido en ${name}: ${story.access}`);
  if (story.stale !== undefined && story.stale !== true) fail(`marca stale inválida en ${name}`);
  // Empresa Endeavor mencionada (opcional): nombre y, si hay enlace, una URL http/https.
  if (story.endeavor !== undefined && (typeof story.endeavor?.company !== 'string' || !story.endeavor.company || (story.endeavor.url !== undefined && !safeUrl(story.endeavor.url)))) fail(`empresa Endeavor inválida en ${name}`);
}
for (const source of data.sources) {
  if (source.tier !== undefined && !TIERS.includes(source.tier)) fail(`nivel inválido en la fuente ${source.id}`);
  if (source.access !== undefined && !ACCESS.includes(source.access)) fail(`acceso inválido en la fuente ${source.id}`);
  if (source.language !== undefined && !LANGUAGES.includes(source.language)) fail(`idioma inválido en la fuente ${source.id}`);
}
console.log(`Edición válida: ${data.stories.length} publicaciones y ${data.sources.filter(s => s.status === 'ok').length} fuentes disponibles.`);
