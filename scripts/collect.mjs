import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, parseFeed, parseBce, parseBcePublications, parseBceResolutions, parseSupercias, resolutionYear, deduplicate, relevant, recent } from './content.mjs';

const googleSearch = query => `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:30d`)}&hl=es-419&gl=EC&ceid=EC%3Aes-419`;

export const SOURCES = [
  { id: 'ecuador-news', name: 'Medios de Ecuador', category: 'ecuador', kind: 'news', adapter: 'google', url: 'https://news.google.com/rss/search?q=%28bancos%20OR%20seguros%20OR%20cooperativas%20OR%20fintech%20OR%20pagos%29%20Ecuador%20when%3A30d&hl=es-419&gl=EC&ceid=EC%3Aes-419', site: 'https://news.google.com/', allowHosts: ['primicias.ec', 'bloomberglinea.com', 'eluniverso.com', 'expreso.ec'] },
  { id: 'primicias', name: 'Primicias', category: 'ecuador', kind: 'news', adapter: 'rss', url: 'https://www.primicias.ec/rss/economia.xml', site: 'https://www.primicias.ec/economia/', language: 'es', limit: 8 },
  { id: 'asobanca', name: 'Asobanca', category: 'ecuador', kind: 'organization', adapter: 'rss', url: 'https://asobanca.org.ec/feed/', site: 'https://asobanca.org.ec/', language: 'es', limit: 3 },
  { id: 'banecuador', name: 'BanEcuador', category: 'ecuador', kind: 'official', adapter: 'rss', url: 'https://www.banecuador.fin.ec/feed/', site: 'https://www.banecuador.fin.ec/', language: 'es', limit: 2 },
  { id: 'cfn', name: 'Corporación Financiera Nacional', category: 'ecuador', kind: 'official', adapter: 'rss', url: 'https://www.cfn.fin.ec/feed/', site: 'https://www.cfn.fin.ec/', language: 'es', limit: 2 },
  { id: 'bce-publicaciones', name: 'BCE · Datos financieros', category: 'regulacion', kind: 'official', adapter: 'bce-publications', url: 'https://contenido.bce.fin.ec/ultimas-publicaciones/', site: 'https://contenido.bce.fin.ec/ultimas-publicaciones/', language: 'es', limit: 3 },
  { id: 'bce-junta-resoluciones', name: 'BCE · Resoluciones de la Junta', category: 'regulacion', kind: 'official', adapter: 'bce-resolutions', url: 'https://www.bce.fin.ec/junta-de-politica-y-regulacion-financiera-y-monetaria/resoluciones/resoluciones-emitidas/', site: 'https://www.bce.fin.ec/junta-de-politica-y-regulacion-financiera-y-monetaria/resoluciones/resoluciones-emitidas/', language: 'es' },
  { id: 'bce-resoluciones-admin', name: 'BCE · Resoluciones administrativas', category: 'regulacion', kind: 'official', adapter: 'bce-resolutions', url: 'https://www.bce.fin.ec/banco-central-del-ecuador/resoluciones-administrativas/', site: 'https://www.bce.fin.ec/banco-central-del-ecuador/resoluciones-administrativas/', language: 'es' },
  { id: 'bce-boletines', name: 'Banco Central del Ecuador', category: 'ecuador', kind: 'official', adapter: 'bce', url: 'https://www.bce.fin.ec/banco-central-del-ecuador/boletines-de-prensa/', site: 'https://www.bce.fin.ec/', language: 'es', reroute: { pattern: /\bJPRFM\b|Junta de Pol[ií]tica/i, category: 'regulacion' } },
  { id: 'seps', name: 'SEPS', category: 'regulacion', kind: 'official', adapter: 'rss', url: 'https://www.seps.gob.ec/feed/', site: 'https://www.seps.gob.ec/', language: 'es' },
  { id: 'superbancos', name: 'Superintendencia de Bancos', category: 'regulacion', kind: 'official', adapter: 'rss', url: 'https://www.superbancos.gob.ec/bancos/feed/', site: 'https://www.superbancos.gob.ec/', language: 'es' },
  { id: 'supercias', name: 'Supercias', category: 'regulacion', kind: 'official', adapter: 'supercias', url: 'https://www.supercias.gob.ec/portalscvs/', site: 'https://www.supercias.gob.ec/portalscvs/Noticias/Noticias.php', language: 'es' },
  { id: 'mef', name: 'Ministerio de Economía y Finanzas', category: 'regulacion', kind: 'official', adapter: 'rss', url: 'https://www.finanzas.gob.ec/feed/', site: 'https://www.finanzas.gob.ec/', language: 'es', limit: 3 },
  { id: 'uafe', name: 'UAFE', category: 'regulacion', kind: 'official', adapter: 'rss', url: 'https://www.uafe.gob.ec/feed/', site: 'https://www.uafe.gob.ec/', language: 'es', limit: 4 },
  { id: 'regulatory-news', name: 'Cobertura de autoridades EC', category: 'regulacion', kind: 'news', adapter: 'google', url: googleSearch('(SEPS OR "Superintendencia de Bancos" OR "Junta de Política" OR "Supercias") (Ecuador OR ecuatoriana)'), site: 'https://news.google.com/', allowHosts: ['primicias.ec', 'eluniverso.com', 'expreso.ec', 'elcomercio.com', 'ecuavisa.com', 'vistazo.com'], language: 'es' },
  { id: 'latamlist', name: 'LatamList', category: 'latam', kind: 'news', adapter: 'rss', url: 'https://latamlist.com/feed/', site: 'https://latamlist.com/', language: 'en', limit: 8 },
  { id: 'latam-fintech-hub', name: 'Latam Fintech Hub', category: 'latam', kind: 'news', adapter: 'google', url: googleSearch('site:latamfintech.co/articles/'), site: 'https://www.latamfintech.co/articles', allowHosts: ['latamfintech.co'], language: 'es', limit: 8 },
  { id: 'iupana', name: 'iupana', category: 'latam', kind: 'news', adapter: 'rss', url: 'https://iupana.com/feed/', site: 'https://iupana.com/', language: 'es', limit: 8 },
  { id: 'latam-bloomberg', name: 'Bloomberg Línea · fintech', category: 'latam', kind: 'news', adapter: 'google', url: googleSearch('site:bloomberglinea.com (fintech OR neobanco OR billetera digital OR pagos) (Colombia OR México OR Argentina OR Brasil OR Perú)'), site: 'https://www.bloomberglinea.com/', allowHosts: ['bloomberglinea.com'], language: 'es', limit: 8 },
  { id: 'valora-analitik', name: 'Valora Analitik', category: 'latam', kind: 'news', adapter: 'rss', url: 'https://www.valoraanalitik.com/feed/', site: 'https://www.valoraanalitik.com/', language: 'es', limit: 8 },
  { id: 'contxto', name: 'Contxto', category: 'latam', kind: 'news', adapter: 'rss', url: 'https://contxto.com/es/feed/', site: 'https://contxto.com/es/', language: 'es', limit: 4 },
  { id: 'colombia-fintech', name: 'Colombia Fintech', category: 'latam', kind: 'organization', adapter: 'rss', url: 'https://colombiafintech.co/feed', site: 'https://colombiafintech.co/', language: 'es', limit: 3 },
  { id: 'lavca', name: 'LAVCA', category: 'latam', kind: 'organization', adapter: 'rss', url: 'https://lavca.org/feed/', site: 'https://lavca.org/', language: 'en', limit: 4 },
  { id: 'felaban', name: 'FELABAN', category: 'latam', kind: 'organization', adapter: 'rss', url: 'https://felaban.net/rss', site: 'https://felaban.net/', language: 'es', limit: 3 },
  { id: 'endeavor-ar', name: 'Endeavor Argentina', category: 'latam', kind: 'organization', adapter: 'rss', url: 'https://www.endeavor.org.ar/feed/', site: 'https://www.endeavor.org.ar/', language: 'es', limit: 4 },
  { id: 'pymnts', name: 'PYMNTS', category: 'pagos', kind: 'news', adapter: 'rss', url: 'https://www.pymnts.com/feed/', site: 'https://www.pymnts.com/', language: 'en' },
  { id: 'paymentsdive', name: 'Payments Dive', category: 'pagos', kind: 'news', adapter: 'rss', url: 'https://www.paymentsdive.com/feeds/news/', site: 'https://www.paymentsdive.com/', language: 'en' },
  { id: 'digitaltransactions', name: 'Digital Transactions', category: 'pagos', kind: 'news', adapter: 'rss', url: 'https://www.digitaltransactions.net/feed/', site: 'https://www.digitaltransactions.net/', language: 'en', limit: 6 },
  { id: 'epi', name: 'Electronic Payments International', category: 'pagos', kind: 'news', adapter: 'rss', url: 'https://www.electronicpaymentsinternational.com/feed/', site: 'https://www.electronicpaymentsinternational.com/', language: 'en', limit: 6 },
  { id: 'pcm', name: 'Payments Cards & Mobile', category: 'pagos', kind: 'news', adapter: 'rss', url: 'https://www.paymentscardsandmobile.com/feed/', site: 'https://www.paymentscardsandmobile.com/', language: 'en', limit: 6 },
  { id: 'fed', name: 'Reserva Federal de EE. UU.', category: 'pagos', kind: 'official', adapter: 'rss', url: 'https://www.federalreserve.gov/feeds/press_all.xml', site: 'https://www.federalreserve.gov/newsevents/pressreleases.htm', language: 'en', limit: 3 },
  { id: 'ecb', name: 'Banco Central Europeo', category: 'pagos', kind: 'official', adapter: 'rss', url: 'https://www.ecb.europa.eu/rss/press.html', site: 'https://www.ecb.europa.eu/press/html/index.en.html', language: 'en', limit: 3 },
  { id: 'finextra-payments', name: 'Finextra · Payments', category: 'pagos', kind: 'news', adapter: 'rss', url: 'https://www.finextra.com/rss/channel.aspx?channel=payments', site: 'https://www.finextra.com/', language: 'en' },
  { id: 'finextra-crypto', name: 'Finextra · Blockchain', category: 'cripto', kind: 'news', adapter: 'rss', url: 'https://www.finextra.com/rss/channel.aspx?channel=blockchain', site: 'https://www.finextra.com/', language: 'en' },
  { id: 'coindesk', name: 'CoinDesk', category: 'cripto', kind: 'news', adapter: 'rss', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', site: 'https://www.coindesk.com/', language: 'en', limit: 8 },
  { id: 'theblock', name: 'The Block', category: 'cripto', kind: 'news', adapter: 'rss', url: 'https://www.theblock.co/rss.xml', site: 'https://www.theblock.co/', language: 'en', limit: 8 },
  { id: 'criptonoticias', name: 'CriptoNoticias', category: 'cripto', kind: 'news', adapter: 'rss', url: 'https://www.criptonoticias.com/feed/', site: 'https://www.criptonoticias.com/', language: 'es', limit: 6 },
  { id: 'trmlabs', name: 'TRM Labs', category: 'cripto', kind: 'company', adapter: 'rss', url: 'https://www.trmlabs.com/resources/blog/rss.xml', site: 'https://www.trmlabs.com/resources/blog', language: 'en', limit: 4 },
  { id: 'coincenter', name: 'Coin Center', category: 'cripto', kind: 'organization', adapter: 'rss', url: 'https://www.coincenter.org/feed/', site: 'https://www.coincenter.org/', language: 'en', limit: 3 },
  { id: 'chainalysis', name: 'Chainalysis', category: 'cripto', kind: 'company', adapter: 'rss', url: 'https://www.chainalysis.com/blog/feed/', site: 'https://www.chainalysis.com/', language: 'en', limit: 5 },
];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputArg = process.argv.indexOf('--output');
const output = outputArg === -1 ? resolve(root, 'site/data/news.json') : resolve(process.argv[outputArg + 1]);

const USER_AGENT = 'NEWS-TV/1.0 (+https://github.com/andrescge/news-tv)';
const MAX_DATE_LOOKUPS = 200;
// Tope por canal. Cada fuente tiene además su propio `limit`, para que ninguna acapare el canal.
const MAX_PER_CHANNEL = 40;

// Fecha de carga de cada PDF de resolución. Se consulta una sola vez por documento y se guarda
// en `tracked` dentro de news.json, de modo que las ejecuciones siguientes solo consultan los nuevos.
async function dateResolutions(entries, source, known, now = new Date()) {
  const minYear = now.getUTCFullYear() - (now.getUTCMonth() === 0 ? 1 : 0);
  const candidates = entries.filter(entry => (resolutionYear(entry) ?? minYear) >= minYear && relevant(entry, source));
  const tracked = {};
  for (const entry of candidates) if (known[entry.url]) tracked[entry.url] = known[entry.url];
  const pending = candidates.filter(entry => !tracked[entry.url]).slice(0, MAX_DATE_LOOKUPS);
  const worker = async () => {
    for (let entry = pending.shift(); entry; entry = pending.shift()) {
      try {
        const response = await fetch(entry.url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(14000) });
        const modified = Date.parse(response.headers.get('last-modified') || '');
        if (response.ok && Number.isFinite(modified)) tracked[entry.url] = new Date(modified).toISOString();
      } catch { /* Se reintenta en la siguiente ejecución. */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { tracked, rows: candidates.filter(entry => tracked[entry.url]).map(entry => ({ ...entry, publishedAt: tracked[entry.url] })) };
}

async function fetchSource(source, known = {}) {
  const response = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT, Accept: /^(bce|supercias)/.test(source.adapter) ? 'text/html' : 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(14000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 3_000_000) throw new Error('Respuesta demasiado grande');
  let tracked;
  let raw = source.adapter === 'bce' ? parseBce(body) : source.adapter === 'bce-publications' ? parseBcePublications(body) : source.adapter === 'bce-resolutions' ? parseBceResolutions(body, source.url) : source.adapter === 'supercias' ? parseSupercias(body, source.url) : parseFeed(body, source);
  if (source.adapter === 'bce-resolutions') ({ tracked, rows: raw } = await dateResolutions(raw, source, known));
  const stories = raw.filter(row => {
    if (!source.allowHosts) return true;
    try { const host = new URL(row.sourceUrl).hostname.toLowerCase(); return source.allowHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`)); }
    catch { return false; }
  }).map(row => normalize(row, source)).filter(Boolean).filter(row => relevant(row, source)).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, source.limit ?? 25).map(story => source.reroute?.pattern.test(story.title) ? { ...story, category: source.reroute.category } : story);
  return { stories, tracked };
}

async function run() {
  let previous = { stories: [], sources: [] };
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch { /* Primera edición. */ }
  const checkedAt = new Date().toISOString();
  const results = await Promise.allSettled(SOURCES.map(source => fetchSource(source, previous.tracked?.[source.id])));
  const stories = []; const sources = []; const tracked = {}; let successful = 0;
  for (let i = 0; i < SOURCES.length; i++) {
    const source = SOURCES[i], result = results[i], oldState = previous.sources?.find(s => s.id === source.id);
    let current = [];
    if (result.status === 'fulfilled') { successful++; current = result.value.stories; if (result.value.tracked) tracked[source.id] = result.value.tracked; }
    else { current = (previous.stories || []).filter(story => story.sourceId === source.id && recent(story.publishedAt)); if (previous.tracked?.[source.id]) tracked[source.id] = previous.tracked[source.id]; console.error(`${source.name}: ${result.reason?.message || result.reason}`); }
    stories.push(...current);
    sources.push({ id: source.id, name: source.name, category: source.category, kind: source.kind, url: source.site, status: result.status === 'fulfilled' ? 'ok' : 'error', checkedAt, lastSuccessAt: result.status === 'fulfilled' ? checkedAt : oldState?.lastSuccessAt || null, recentCount: current.length });
  }
  if (!successful) { console.error('Ninguna fuente respondió; se conserva la edición anterior.'); process.exitCode = 1; return; }
  const unique = deduplicate(stories);
  const limited = []; const perCategory = new Map();
  for (const story of unique) { const count = perCategory.get(story.category) || 0; if (count >= MAX_PER_CHANNEL) continue; limited.push(story); perCategory.set(story.category, count + 1); }
  const payload = { version: 1, generatedAt: checkedAt, stories: limited, sources, tracked };
  await mkdir(dirname(output), { recursive: true });
  const temp = `${output}.tmp`;
  await writeFile(temp, JSON.stringify(payload, null, 2) + '\n', 'utf8'); await rename(temp, output);
  console.log(`Edición generada: ${limited.length} publicaciones, ${successful}/${SOURCES.length} fuentes disponibles.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
