import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { recent, safeUrl } from './content.mjs';

const file = resolve('site/data/news.json');
const data = JSON.parse(await readFile(file, 'utf8'));
if (data.version !== 1 || !Array.isArray(data.sources) || !Array.isArray(data.stories)) throw new Error('Estructura de edición inválida');
if (!data.sources.some(s => s.status === 'ok')) throw new Error('Ninguna fuente respondió');
for (const story of data.stories) {
  if (!story.id || !story.source || !story.title || !safeUrl(story.url) || !recent(story.publishedAt)) throw new Error(`Noticia inválida: ${story.id || story.title}`);
}
console.log(`Edición válida: ${data.stories.length} publicaciones y ${data.sources.filter(s => s.status === 'ok').length} fuentes disponibles.`);
