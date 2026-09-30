import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, parseFeed, parseBce, parseBcePublications, deduplicate, relevant, recent } from './content.mjs';

const googleSearch = query => `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:30d`)}&hl=es-419&gl=EC&ceid=EC%3Aes-419`;

export const SOURCES = [
  { id: 'ecuador-news', name: 'Medios de Ecuador', category: 'ecuador', kind: 'news', adapter: 'google', url: 'https://news.google.com/rss/search?q=%28bancos%20OR%20seguros%20OR%20cooperativas%20OR%20fintech%20OR%20pagos%29%20Ecuador%20when%3A30d&hl=es-419&gl=EC&ceid=EC%3Aes-419', site: 'https://news.google.com/', allowHosts: ['primicias.ec', 'bloomberglinea.com', 'eluniverso.com', 'expreso.ec'] },
  { id: 'bce-junta', name: 'BCE · Junta Financiera', category: 'regulacion', kind: 'official', adapter: 'bce', url: 'https://www.bce.fin.ec/junta-de-politica-y-regulacion-financiera-y-monetaria/boletines-de-prensa/', site: 'https://www.bce.fin.ec/', language: 'es' },
  { id: 'bce-publicaciones', name: 'BCE · Datos financieros', category: 'regulacion', kind: 'official', adapter: 'bce-publications', url: 'https://contenido.bce.fin.ec/ultimas-publicaciones/', site: 'https://contenido.bce.fin.ec/ultimas-publicaciones/', language: 'es' },
  { id: 'bce-boletines', name: 'Banco Central del Ecuador', category: 'ecuador', kind: 'official', adapter: 'bce', url: 'https://www.bce.fin.ec/banco-central-del-ecuador/boletines-de-prensa/', site: 'https://www.bce.fin.ec/', language: 'es' },
  { id: 'seps', name: 'SEPS', category: 'regulacion', kind: 'official', adapter: 'rss', url: 'https://www.seps.gob.ec/feed/', site: 'https://www.seps.gob.ec/', language: 'es' },
  { id: 'superbancos', name: 'Superintendencia de Bancos', category: 'regulacion', kind: 'official', adapter: 'google', url: 'https://news.google.com/rss/search?q=site%3Asuperbancos.gob.ec%20when%3A30d&hl=es-419&gl=EC&ceid=EC%3Aes-419', site: 'https://www.superbancos.gob.ec/', allowHosts: ['superbancos.gob.ec'], language: 'es' },
  { id: 'supercias', name: 'Supercias', category: 'regulacion', kind: 'official', adapter: 'google', url: 'https://news.google.com/rss/search?q=site%3Asupercias.gob.ec%20when%3A30d&hl=es-419&gl=EC&ceid=EC%3Aes-419', site: 'https://www.supercias.gob.ec/', allowHosts: ['supercias.gob.ec'], language: 'es' },
  { id: 'regulatory-news', name: 'Cobertura de autoridades EC', category: 'regulacion', kind: 'news', adapter: 'google', url: googleSearch('(SEPS OR "Superintendencia de Bancos" OR "Junta de Política" OR "Supercias") (Ecuador OR ecuatoriana)'), site: 'https://news.google.com/', allowHosts: ['primicias.ec', 'eluniverso.com', 'expreso.ec', 'elcomercio.com', 'ecuavisa.com', 'vistazo.com'], language: 'es' },
  { id: 'latamlist', name: 'LatamList', category: 'latam', kind: 'news', adapter: 'rss', url: 'https://latamlist.com/feed/', site: 'https://latamlist.com/', language: 'en' },
  { id: 'latam-fintech-hub', name: 'Latam Fintech Hub', category: 'latam', kind: 'news', adapter: 'google', url: googleSearch('site:latamfintech.co/articles/'), site: 'https://www.latamfintech.co/articles', allowHosts: ['latamfintech.co'], language: 'es' },
  { id: 'iupana', name: 'iupana', category: 'latam', kind: 'news', adapter: 'rss', url: 'https://iupana.com/feed/', site: 'https://iupana.com/', language: 'es' },
  { id: 'latam-bloomberg', name: 'Bloomberg Línea · fintech', category: 'latam', kind: 'news', adapter: 'google', url: googleSearch('site:bloomberglinea.com (fintech OR neobanco OR billetera digital OR pagos) (Colombia OR México OR Argentina OR Brasil OR Perú)'), site: 'https://www.bloomberglinea.com/', allowHosts: ['bloomberglinea.com'], language: 'es' },
  { id: 'finextra-latam', name: 'Finextra · LATAM', category: 'latam', kind: 'news', adapter: 'rss', url: 'https://www.finextra.com/rss/channel.aspx?channel=retail', site: 'https://www.finextra.com/', language: 'en' },
  { id: 'pymnts', name: 'PYMNTS', category: 'pagos', kind: 'news', adapter: 'rss', url: 'https://www.pymnts.com/feed/', site: 'https://www.pymnts.com/', language: 'en' },
  { id: 'finextra-payments', name: 'Finextra · Payments', category: 'pagos', kind: 'news', adapter: 'rss', url: 'https://www.finextra.com/rss/channel.aspx?channel=payments', site: 'https://www.finextra.com/', language: 'en' },
  { id: 'finextra-crypto', name: 'Finextra · Blockchain', category: 'cripto', kind: 'news', adapter: 'rss', url: 'https://www.finextra.com/rss/channel.aspx?channel=blockchain', site: 'https://www.finextra.com/', language: 'en' },
  { id: 'chainalysis', name: 'Chainalysis', category: 'cripto', kind: 'analysis', adapter: 'rss', url: 'https://www.chainalysis.com/blog/feed/', site: 'https://www.chainalysis.com/', language: 'en' },
];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputArg = process.argv.indexOf('--output');
const output = outputArg === -1 ? resolve(root, 'site/data/news.json') : resolve(process.argv[outputArg + 1]);

async function fetchSource(source) {
  const response = await fetch(source.url, { headers: { 'User-Agent': 'NEWS-TV/1.0 (+https://github.com/andrescge/news-tv)', Accept: source.adapter.startsWith('bce') ? 'text/html' : 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(14000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 3_000_000) throw new Error('Respuesta demasiado grande');
  const raw = source.adapter === 'bce' ? parseBce(body) : source.adapter === 'bce-publications' ? parseBcePublications(body) : parseFeed(body, source);
  return raw.filter(row => {
    if (!source.allowHosts) return true;
    try { const host = new URL(row.sourceUrl).hostname.toLowerCase(); return source.allowHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`)); }
    catch { return false; }
  }).map(row => normalize(row, source)).filter(Boolean).filter(row => relevant(row, source)).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, source.category === 'latam' ? 8 : 25);
}

async function run() {
  let previous = { stories: [], sources: [] };
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch { /* Primera edición. */ }
  const checkedAt = new Date().toISOString();
  const results = await Promise.allSettled(SOURCES.map(fetchSource));
  const stories = []; const sources = []; let successful = 0;
  for (let i = 0; i < SOURCES.length; i++) {
    const source = SOURCES[i], result = results[i], oldState = previous.sources?.find(s => s.id === source.id);
    let current = [];
    if (result.status === 'fulfilled') { successful++; current = result.value; }
    else { current = (previous.stories || []).filter(story => story.sourceId === source.id && recent(story.publishedAt)); console.error(`${source.name}: ${result.reason?.message || result.reason}`); }
    stories.push(...current);
    sources.push({ id: source.id, name: source.name, category: source.category, kind: source.kind, url: source.site, status: result.status === 'fulfilled' ? 'ok' : 'error', checkedAt, lastSuccessAt: result.status === 'fulfilled' ? checkedAt : oldState?.lastSuccessAt || null, recentCount: current.length });
  }
  if (!successful) { console.error('Ninguna fuente respondió; se conserva la edición anterior.'); process.exitCode = 1; return; }
  const unique = deduplicate(stories);
  const limited = []; const perCategory = new Map();
  for (const story of unique) { const count = perCategory.get(story.category) || 0; if (count >= 25) continue; limited.push(story); perCategory.set(story.category, count + 1); }
  const payload = { version: 1, generatedAt: checkedAt, stories: limited, sources };
  await mkdir(dirname(output), { recursive: true });
  const temp = `${output}.tmp`;
  await writeFile(temp, JSON.stringify(payload, null, 2) + '\n', 'utf8'); await rename(temp, output);
  console.log(`Edición generada: ${limited.length} publicaciones, ${successful}/${SOURCES.length} fuentes disponibles.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
