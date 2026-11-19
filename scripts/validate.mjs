import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recent, safeUrl, linkAllowed, CHANNELS, DISCARD_STAGES, MAX_DISCARDS_PER_SOURCE } from './content.mjs';
import { endeavorUrl } from './endeavor.mjs';
import { validJudgment, validCoverage } from './editorial.mjs';
// collect.mjs solo recopila cuando se ejecuta como programa: importarlo no hace peticiones.
import { SOURCES, discardsPath } from './collect.mjs';

// Campos opcionales: si están, deben tener un valor conocido.
const TIERS = [1, 2, 3], ACCESS = ['open', 'paywall', 'mixed'], LANGUAGES = ['es', 'en'];
const SOURCE_BY_ID = new Map(SOURCES.map(source => [source.id, source]));
// Embudo de cada fuente (ver fetchSource en collect.mjs): contadores enteros no negativos y la marca `saturated`.
const FUNNEL_COUNTS = ['read', 'foreign', 'undated', 'host', 'normalize', 'topic', 'accepted'];
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isInteger(value) && value >= 0;
export function validFunnel(funnel) {
  if (!isObject(funnel)) return false;
  for (const [key, value] of Object.entries(funnel)) {
    if (key === 'saturated') { if (value !== true) return false; }
    else if (!FUNNEL_COUNTS.includes(key) || !count(value)) return false;
  }
  return FUNNEL_COUNTS.every(key => count(funnel[key])) && funnel.read === FUNNEL_COUNTS.slice(1).reduce((sum, key) => sum + funnel[key], 0);
}

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
    // Capa editorial (opcional): juicio con puntuación, línea en texto plano y grupo válidos; cobertura con nombres cortos.
    if (story.editorial !== undefined && !validJudgment(story.editorial)) fail(`juicio editorial inválido en ${name}`);
    if (story.coverage !== undefined && !validCoverage(story.coverage)) fail(`cobertura inválida en ${name}`);
    if (story.endeavor !== undefined &&(typeof story.endeavor?.company !== 'string' || !story.endeavor.company || (story.endeavor.url !== undefined && !endeavorUrl(story.endeavor.url)))) fail(`empresa Endeavor inválida en ${name}`);
  }
  for (const source of data.sources) {
    if (source.tier !== undefined && !TIERS.includes(source.tier)) fail(`nivel inválido en la fuente ${source.id}`);
    if (source.access !== undefined && !ACCESS.includes(source.access)) fail(`acceso inválido en la fuente ${source.id}`);
    if (source.language !== undefined && !LANGUAGES.includes(source.language)) fail(`idioma inválido en la fuente ${source.id}`);
    if (source.url !== undefined && !safeUrl(source.url)) fail(`enlace inválido en la fuente ${source.id}`);
    if (source.funnel !== undefined && !validFunnel(source.funnel)) fail(`embudo inválido en la fuente ${source.id}`);
  }
  return { stories: data.stories.length, available: data.sources.filter(s => s.status === 'ok').length };
}

// Registro de descartes (descartes.json, junto a la edición). Lanza un Error con el primer problema.
export function validateDiscards(data) {
  const fail = message => { throw new Error(message); };
  if (data?.version !== 1 || !Array.isArray(data.discards) || !isObject(data.omitted) || !Number.isFinite(Date.parse(data.generatedAt))) fail('estructura del registro de descartes inválida');
  const perSource = new Map();
  for (const entry of data.discards) {
    const name = entry?.title || entry?.url;
    if (!isObject(entry) || typeof entry.sourceId !== 'string' || !SOURCE_BY_ID.has(entry.sourceId)) fail(`descarte de fuente desconocida: ${name}`);
    if (!DISCARD_STAGES.includes(entry.stage) || typeof entry.reason !== 'string' || !entry.reason) fail(`descarte sin etapa o motivo válido: ${name}`);
    if (typeof entry.title !== 'string' || !entry.title || entry.title.length > 300 || !safeUrl(entry.url) || !Number.isFinite(Date.parse(entry.publishedAt))) fail(`descarte inválido: ${name}`);
    if (entry.host !== undefined && typeof entry.host !== 'string') fail(`dominio inválido en el descarte: ${name}`);
    perSource.set(entry.sourceId, (perSource.get(entry.sourceId) || 0) + 1);
  }
  for (const [id, total] of perSource) if (total > MAX_DISCARDS_PER_SOURCE) fail(`demasiados descartes de ${id}: ${total}`);
  for (const [id, value] of Object.entries(data.omitted)) if (!SOURCE_BY_ID.has(id) || !Number.isInteger(value) || value < 1) fail(`omitidos inválidos en ${id}`);
  return { discards: data.discards.length };
}

// Uso: node scripts/validate.mjs [ruta]. Sin ruta valida site/data/news.json (relativa al directorio actual). Si junto a la
// edición está el registro de descartes, también se valida.
async function main() {
  const file = resolve(process.argv[2] || 'site/data/news.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  let result;
  try { result = validateEdition(data); } catch (error) { throw new Error(`${file}: ${error.message}`); }
  console.log(`Edición válida: ${result.stories} publicaciones y ${result.available} fuentes disponibles.`);
  const discardsFile = discardsPath(file);
  let log;
  try { log = JSON.parse(await readFile(discardsFile, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return; throw new Error(`${discardsFile}: no se puede leer (${error.name})`); }
  try { result = validateDiscards(log); } catch (error) { throw new Error(`${discardsFile}: ${error.message}`); }
  console.log(`Registro de descartes válido: ${result.discards} titulares.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
