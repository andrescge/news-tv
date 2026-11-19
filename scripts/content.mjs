import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import endeavorDirectory from './data/endeavor-latam.json' with { type: 'json' };
import { endeavorUrl } from './endeavor.mjs';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', trimValues: true });
const months = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
const DAY = 24 * 60 * 60 * 1000;
export const THIRTY_DAYS = 30 * DAY;
const MAX_EXCERPT = 280;
const MAX_EXCERPT_SCAN = 4000;
export const CHANNELS = ['ecuador', 'regulacion', 'latam', 'pagos', 'cripto', 'endeavor'];
// Períodos que ofrece el sitio (días). La composición de cada canal reparte las notas entre ellos.
export const PERIOD_DAYS = [1, 7, 15, 30];

export function asText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (typeof value === 'object') return asText(value['#text'] ?? value['#cdata'] ?? '');
  return String(value).trim();
}
export function plainText(value) {
  const $ = cheerio.load(`<div>${asText(value)}</div>`);
  $('script,style,svg,iframe').remove();
  return $('div').first().text().replace(/\s+/g, ' ').trim();
}
export function parseDate(value) {
  const input = asText(value);
  const spanish = input.toLowerCase().match(/\b(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})\b/u);
  if (spanish && months[spanish[2]] != null) {
    const day = Number(spanish[1]), month = months[spanish[2]], year = Number(spanish[3]);
    const date = new Date(Date.UTC(year, month, day, 12));
    if (date.getUTCDate() === day && date.getUTCMonth() === month) return date.toISOString();
    return null;
  }
  const time = Date.parse(input);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function safeUrl(value, base) {
  try { const url = new URL(asText(value), base); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
export function canonicalUrl(value) {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$|^ref$/i.test(key)) url.searchParams.delete(key);
  return url.href.replace(/\/$/, '');
}
export function recent(iso, now = Date.now()) {
  const time = Date.parse(iso);
  return Number.isFinite(time) && time >= now - THIRTY_DAYS && time <= now + 5 * 60 * 1000;
}
// Una URL http/https cuyo dominio es uno de la lista o un subdominio suyo.
export function inHosts(value, hosts, base) {
  const href = safeUrl(value, base);
  if (!href) return false;
  const host = new URL(href).hostname.toLowerCase();
  return hosts.some(domain => host === domain || host.endsWith(`.${domain}`));
}
// Las fuentes de Google News se restringen al dominio del medio (`allowHosts`), comprobado sobre la URL del editor.
// `denyHosts` descarta dominios (la búsqueda Endeavor no admite páginas de la propia Endeavor: no son prensa).
export function allowedHost(row, source) {
  if (!source.allowHosts && !source.denyHosts) return true;
  try {
    const host = new URL(row.sourceUrl).hostname.toLowerCase();
    const matches = list => list.some(domain => host === domain || host.endsWith(`.${domain}`));
    return (!source.allowHosts || matches(source.allowHosts)) && !(source.denyHosts && matches(source.denyHosts));
  } catch { return false; }
}
// Las fuentes oficiales que se leen de su propia página o feed solo aceptan enlaces de sus dominios (`linkHosts`): una nota
// rotulada «Publicación oficial» no puede llevar a otro sitio, y el recopilador no hace peticiones a dominios ajenos.
// Una fuente sin `linkHosts` acepta cualquier enlace http/https. Los enlaces relativos se resuelven contra `source.url`.
export function linkAllowed(row, source) {
  return !source.linkHosts || inHosts(row?.url, source.linkHosts, source.url);
}
// Una nota pasa los filtros de su fuente: dominio del medio (allowedHost), dominio del enlace (linkAllowed) y tema (relevant).
// La recopilación la aplica a lo nuevo y, en la acumulación, a lo que viene de la edición anterior: una nota conservada que ya
// no cumple la regla vigente sale. Una nota malformada no lanza: cuenta como que no pasa.
export function passes(story, source) {
  try { return allowedHost(story, source) && linkAllowed(story, source) && relevant(story, source); }
  catch { return false; }
}
// Extracto de como máximo `max` caracteres. Si el texto cabe, sale igual. Si no, se corta en el último límite de palabra
// que deje sitio para «…», se quitan los signos sueltos del final y se añade «…». Nunca se añade texto propio.
// Solo si no hay ningún espacio aprovechable (una sola palabra enorme) se corta dentro de la palabra.
export function clipExcerpt(value, max = MAX_EXCERPT) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  let head = text.slice(0, max - 1);
  const wordContinues = /[\p{L}\p{N}]/u.test(text[max - 1] ?? '') && /[\p{L}\p{N}]$/u.test(head);
  if (wordContinues) {
    const space = head.search(/\s\S*$/);
    if (space > max / 2) head = head.slice(0, space);
  }
  return `${head.replace(/[\s.,;:¿¡([{«“"'‘\-–—/]+$/u, '')}…`;
}
export function normalize(raw, source, now = Date.now()) {
  const sourceName = plainText(raw.source || source.name).slice(0, 80);
  let title = plainText(raw.title).slice(0, 300);
  if (raw.via && sourceName) title = title.replace(new RegExp(`\\s+-\\s+${sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '').trim();
  if (sourceName && title.toLowerCase().endsWith(` | ${sourceName.toLowerCase()}`)) title = title.slice(0, -sourceName.length - 3).trim();
  const url = safeUrl(raw.url, source.url);
  const publishedAt = parseDate(raw.publishedAt);
  if (!title || !url || !publishedAt || !recent(publishedAt, now)) return null;
  // La coletilla de WordPress se busca en un texto acotado: la expresión es cuadrática con extractos enormes, y con
  // MAX_EXCERPT_SCAN caracteres el recorte a MAX_EXCERPT sale igual.
  let excerpt = plainText(raw.excerpt).slice(0, MAX_EXCERPT_SCAN).replace(/(?:^|\s+)The post .+? appeared first on .+\.?$/i, '').trim();
  if (raw.via && excerpt.toLowerCase().startsWith(title.toLowerCase())) excerpt = '';
  excerpt = clipExcerpt(excerpt);
  const sourceUrl = safeUrl(raw.sourceUrl || source.url);
  const language = raw.language || (/\b(el|la|los|las|una|para|del|banco|pagos|financiero|ecuador)\b/i.test(`${title} ${excerpt}`) ? 'es' : 'en');
  const canonical = canonicalUrl(url);
  const story = { id: createHash('sha256').update(`${source.id}:${canonical}`).digest('hex').slice(0, 20), sourceId: source.id, category: source.category, kind: source.kind, title, excerpt, url, source: sourceName, sourceUrl, via: raw.via || '', language, publishedAt };
  if (source.tier) story.tier = source.tier;
  if (source.access) story.access = source.access;
  story.category = channelFor(story, source);
  return story;
}
export function parseFeed(xml, source) {
  const data = parser.parse(xml);
  // RSS 2.0, Atom y RSS 1.0 (RDF, usado por el BIS).
  const items = data?.rss?.channel?.item ?? data?.feed?.entry ?? data?.['rdf:RDF']?.item;
  if (items == null) throw new Error('El documento no contiene entradas RSS o Atom');
  return (Array.isArray(items) ? items : [items]).map(item => {
    const isGoogle = source.adapter === 'google';
    const publishedAt = item.pubDate || item.published || item.updated || item['dc:date'];
    const sourceNode = item.source;
    const media = isGoogle ? asText(sourceNode) : source.name;
    const mediaUrl = isGoogle ? sourceNode?.['@_url'] : source.url;
    const url = typeof item.link === 'object' ? (item.link?.['@_href'] || item.link?.['#text']) : item.link;
    // `byline`: el titular lleva delante el autor que publica el propio feed (discursos del BIS, como hace el BCE).
    const author = source.byline ? asText(item['dc:creator']) : '';
    const title = author ? `${author}: ${asText(item.title)}` : item.title;
    return { title, excerpt: item.description || item.summary || item['content:encoded'] || '', url, publishedAt, source: media, sourceUrl: mediaUrl, via: isGoogle ? 'Vía Google News' : '', language: source.language };
  });
}
export function parseBce(html) {
  const $ = cheerio.load(html); const entries = [];
  $('.entry-content .elementor-post').each((_, node) => {
    const card = $(node); const titleLink = card.find('.elementor-post__title a').first();
    const href = titleLink.attr('href') || card.find('.elementor-post__read-more').attr('href');
    const title = titleLink.text().trim() || card.find('.elementor-post__read-more').attr('aria-label')?.replace(/^Read more about /, '') || '';
    entries.push({ title, url: href, excerpt: card.find('.elementor-post__excerpt').text(), publishedAt: card.find('.elementor-post-date').text(), language: 'es' });
  });
  if (!entries.length) throw new Error('No se encontraron boletines en la estructura esperada del BCE');
  return entries;
}
export function parseBcePublications(html) {
  const $ = cheerio.load(html); const entries = [];
  $('tr').each((_, node) => {
    const cells = $(node).find('td');
    if (cells.length < 3) return;
    const link = cells.eq(2).find('a[href]').first();
    const href = link.attr('href');
    if (!href || /\.xlsx?(?:$|[?#])/i.test(href)) return;
    entries.push({ title: link.text().trim(), url: href, publishedAt: cells.eq(0).text().trim(), language: 'es' });
  });
  if (!entries.length) throw new Error('No se encontraron publicaciones en la estructura esperada del BCE');
  return entries;
}
// Las páginas de resoluciones del BCE no publican fecha: solo código, descripción y PDF.
// La fecha se obtiene después, de la cabecera Last-Modified de cada PDF (ver collect.mjs).
export function parseBceResolutions(html, base) {
  const $ = cheerio.load(html); const entries = []; const seen = new Set();
  const clean = value => value.replace(/\s+/g, ' ').trim();
  $('a[href]').each((_, node) => {
    const link = $(node); const url = safeUrl(link.attr('href'), base);
    if (!url || seen.has(url) || !/\/storage\/[^?#]+\/resoluciones\/[^?#]+\.pdf$/i.test(new URL(url).pathname)) return;
    const row = link.closest('tr'); let code = '', title = '';
    if (row.length) { const cells = row.find('td'); code = clean(cells.eq(0).text()); title = clean(cells.eq(1).text()); }
    else { const text = clean(link.text()); const cut = text.indexOf(': '); if (cut === -1) return; code = text.slice(0, cut); title = text.slice(cut + 2).trim(); }
    if (!code || !title) return;
    if (!/^(resoluci[oó]n|memorando|oficio)\b/i.test(code)) code = `Resolución ${code}`;
    seen.add(url);
    entries.push({ code, title, url, excerpt: `${code}. La fecha corresponde a la carga del documento en el sitio del BCE.`, language: 'es' });
  });
  if (!entries.length) throw new Error('No se encontraron resoluciones en la estructura esperada del BCE');
  return entries;
}
export function resolutionYear(entry) {
  const match = `${entry.code} ${decodeURIComponent(new URL(entry.url).pathname.split('/').pop())}`.match(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/);
  return match ? Number(match[1]) : null;
}
export function parseSupercias(html, base) {
  const $ = cheerio.load(html); const entries = []; const seen = new Set();
  $('a[href*="seccion=noticia-"]').each((_, node) => {
    const link = $(node); const url = safeUrl(link.attr('href'), base); const title = link.text().replace(/\s+/g, ' ').trim();
    const date = url?.match(/seccion=noticia-(\d{2})(\d{2})(\d{4})/);
    if (!url || !title || !date || seen.has(url)) return;
    seen.add(url);
    entries.push({ title, url, publishedAt: `${date[3]}-${date[2]}-${date[1]}T12:00:00Z`, language: 'es' });
  });
  if (!entries.length) throw new Error('No se encontraron noticias en la estructura esperada de Supercias');
  return entries;
}

// Registro Oficial: cada entrada del feed es una edición («Suplemento No. 412») cuyo índice viene en
// content:encoded, con el órgano emisor en mayúsculas y debajo cada norma como «CÓDIGO Se …».
// Se conservan solo las normas de órganos financieros y, de cada edición con alguna, sale una nota cuyo
// titular es «Órgano: CÓDIGO descripción» de la primera norma; las demás van al extracto. Todo el texto
// procede del índice publicado: no se resume ni se completa nada.
const RO_ORGANS = [
  [/JUNTA DE POL[IÍ]TICA Y REGULACI[OÓ]N\s+FINANCIERA/g, 'Junta de Política y Regulación Financiera y Monetaria'],
  [/SUPERINTENDENCIA DE BANCOS/g, 'Superintendencia de Bancos'],
  [/SUPERINTENDENCIA DE ECONOM[IÍ]A POPULAR/g, 'Superintendencia de Economía Popular y Solidaria'],
  [/SUPERINTENDENCIA DE COMPA[NÑ][IÍ]AS/g, 'Superintendencia de Compañías, Valores y Seguros'],
  [/BANCO CENTRAL DEL ECUADOR/g, 'Banco Central del Ecuador'],
  [/CORPORACI[OÓ]N DEL SEGURO DE\s*DEP[OÓ]SITOS/g, 'Corporación del Seguro de Depósitos (COSEDE)'],
  [/SERVICIO DE RENTAS INTERNAS/g, 'Servicio de Rentas Internas'],
  [/UNIDAD DE AN[AÁ]LISIS FINANCIERO/g, 'Unidad de Análisis Financiero y Económico'],
];
// Encabezados de cualquier otro órgano: si aparecen después del último órgano financiero, el bloque no es financiero.
const RO_OTHER_ORGAN = /MINISTERIO|AGENCIA|SERVICIO|SECRETAR[IÍ]A|GOBIERNO|CORTE|DEFENSOR|CONSEJO|EMPRESA|PRESIDENCIA|INSTITUTO|ARMADA|POLIC[IÍ]A|UNIVERSIDAD|DIRECCI[OÓ]N|SUPERINTENDENCIA|CORPORACI[OÓ]N|CONTRALOR|PROCURADUR|FISCAL|ASAMBLEA|MUNICIP|CANT[OÓ]N/g;
// Normas de trámite que no interesan aunque las emita un órgano financiero.
const RO_NOISE = /^se (conoce|designa|delega|acoge)|defensor\/?a? del cliente|personer[ií]a jur[ií]dica|estatuto|cooperativa de vivienda|extingui|fondo complementario|\bfcpc\b|cesant[ií]a/i;
const RO_ACRONYMS = new Set(['SCVS', 'SRI', 'SEPS', 'BCE', 'COSEDE', 'JPRFM', 'UAFE', 'IVA', 'RUC', 'NIIF', 'SB']);
const lastIndex = (text, pattern) => { let index = -1; for (const match of text.matchAll(pattern)) index = match.index; return index; };
function roOrgan(heading) {
  const text = heading.join(' ');
  let best = null, bestIndex = -1;
  for (const [pattern, name] of RO_ORGANS) { const index = lastIndex(text, pattern); if (index > bestIndex) { best = name; bestIndex = index; } }
  return best && bestIndex >= lastIndex(text, RO_OTHER_ORGAN) ? best : null;
}
const isUpper = line => { const letters = line.match(/\p{L}/gu) || []; return letters.length >= 4 && letters.filter(letter => /\p{Lu}/u.test(letter)).length / letters.length >= 0.8; };
const sentenceCase = text => isUpper(text) ? text.toLowerCase().replace(/\p{L}[\p{L}\d]*/gu, word => RO_ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word).replace(/^\p{L}/u, letter => letter.toUpperCase()) : text;
export function parseRegistroOficialIndex(html) {
  const lines = plainLines(html);
  const entries = []; let organ = null, heading = [], headingOpen = false, entry = null, pendingCode = null, codePrefix = '';
  const close = () => { if (entry) entries.push(entry); entry = null; };
  const settleOrgan = () => { if (heading.length) { organ = roOrgan(heading); heading = []; } headingOpen = false; };
  const start = (code, text) => { settleOrgan(); entry = { organ, code, text: [text] }; pendingCode = null; };
  for (const line of lines) {
    if (!line) { close(); headingOpen = false; continue; }
    // Un código largo puede partirse en dos líneas: «SEPS-IGT-…-INSEPS-» y «2026-0157 Se expide…».
    const fragment = line.match(/^(?:No\.?\s*)?([A-Z0-9]+(?:-[A-Z0-9]+)*-)$/);
    if (fragment) { close(); codePrefix = fragment[1]; continue; }
    const codeOnly = line.match(/^(?:No\.?\s*)?([A-Z0-9]+(?:-[A-Z0-9]+)+)\.?$/);
    const codeText = line.match(/^(?:No\.?\s*)?([A-Z0-9]+(?:-[A-Z0-9]+)+)\s+((?:Se|SE|se)\s.+)$/);
    const prefix = codePrefix; codePrefix = '';
    if (codeText && /\d/.test(codeText[1])) { close(); start(prefix + codeText[1], codeText[2]); continue; }
    if (codeOnly && /\d/.test(codeOnly[1])) { close(); settleOrgan(); pendingCode = prefix + codeOnly[1]; continue; }
    if (pendingCode && /^se\s/i.test(line)) { start(pendingCode, line); continue; }
    if (entry) {
      if (isUpper(line) && !/^se\s/i.test(line) && !(isUpper(entry.text.join(' ')) && !line.endsWith(':'))) { close(); heading = [line]; headingOpen = true; }
      else entry.text.push(line);
      continue;
    }
    if (isUpper(line) && !/^se\s/i.test(line)) { if (headingOpen) heading.push(line); else { heading = [line]; headingOpen = true; } pendingCode = null; }
  }
  close();
  return entries.map(item => ({ organ: item.organ, code: item.code, text: sentenceCase(item.text.join(' ').replace(/\s+/g, ' ').trim()) }));
}
function plainLines(html) {
  const $ = cheerio.load(`<div>${String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')}</div>`);
  return $('div').first().text().split('\n').map(line => line.replace(/\s+/g, ' ').trim());
}
export function registroOficialRelevant(entry) {
  if (!entry.organ || RO_NOISE.test(entry.text)) return false;
  // Junta: como en las resoluciones del BCE, fuera las administrativas (-A) y de gobierno interno (-G).
  if (entry.organ.startsWith('Junta') && /-(A|G)$/.test(entry.code)) return false;
  return true;
}
export function parseRegistroOficial(xml) {
  const data = parser.parse(xml);
  const items = data?.rss?.channel?.item;
  if (items == null) throw new Error('El documento no contiene entradas RSS del Registro Oficial');
  const rows = [];
  for (const item of Array.isArray(items) ? items : [items]) {
    const edition = asText(item.title);
    const norms = parseRegistroOficialIndex(asText(item['content:encoded'])).filter(registroOficialRelevant);
    if (!norms.length) continue;
    const [first, ...others] = norms;
    const label = norm => `${norm.organ}: ${norm.code} ${norm.text}`;
    const excerpt = [/^registro oficial/i.test(edition) ? `${edition}.` : `Registro Oficial, ${edition}.`, ...(others.length ? [`También: ${others.map(label).join('; ')}.`] : [])].join(' ');
    rows.push({ title: label(first), url: item.link, excerpt, publishedAt: item.pubDate, language: 'es' });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------
// Filtros por fuente. `relevant()` aplica el filtro de FILTERS[source.id]; una fuente sin entrada lo deja pasar todo.
// Campos: include / exclude (sobre el titular, o sobre titular + extracto con on: 'text'), path (la ruta de la URL
// debe cumplirlo), skipPath (la ruta no debe cumplirlo) y test (comprobación adicional).
// Las expresiones salen de la verificación de fuentes; las que se repiten entre fuentes del mismo tema son constantes.
const rx = (...parts) => new RegExp(parts.filter(Boolean).map(part => part instanceof RegExp ? part.source : part).join('|'), 'i');

// Ecuador: vocabulario financiero de los feeds de economía de Primicias y El Universo, y su ruido de consumo.
const EC_FINANCE = String.raw`\bbanc|financ|\bsegur(o|os|adora)|aseguradora|cooperativ|fintech|cr[eé]ditos?|tasas? de inter[eé]s|tarjetas?|p[oó]lizas?|dep[oó]sitos?|remesas|riesgo pa[ií]s|billetera|transferencias?|medios de pago|superintendencia|banco mundial|\bfmi\b|\bbid\b|\bcaf\b|deuda|bonos? (soberanos?|de deuda|global)|pr[eé]stamos?|biess|mercado (de valores|burs[aá]til)|bolsa de valores|proforma|presupuesto|d[eé]ficit|recaudaci[oó]n|diferimiento`;
const EC_CONSUMER_NOISE = String.raw`black friday|cyber ?(day|monday)|concurso|competencia econ[oó]mica|brigadas`;
// Supervisores de Ecuador (SEPS, Superintendencia de Bancos, Supercias): actos de control y actos protocolarios.
const EC_SUPERVISOR_ACTS = String.raw`resoluci[oó]n|sanci|intervenci|liquidaci|alerta|advierte`;
const EC_INSTITUTIONAL_NOISE = String.raw`capacit|aniversario`;
// Fintech de la región: términos comunes a La República, Bloomberg Línea, El Economista, Expansión México y Diario Financiero.
const LATAM_FINTECH = String.raw`fintech|neobanc|bancos? digital|nubank`;
const MEXICO_FINTECH = String.raw`econom[ií]a digital|\bcodi\b|\bspei\b|ueno|\bnu\b|mercado pago|sofipo|cnbv|pagos? (digital|electr|con qr)|criptomoneda|openbank|revolut|crowdfunding|inclusi[oó]n financiera`;
// Cripto en inglés (CoinDesk, The Block, Reuters): política, delito e infraestructura, sin mercado.
const CRYPTO_POLICY_EN = String.raw`stablecoin|tokeni[sz]|CBDC|digital (euro|dollar|currenc|asset|finance|money)|deposit token|crypto|blockchain|USDC|Tether|MiCA|GENIUS Act|Clarity Act|launder|sanction|OFAC|FinCEN|North Korea|DPRK|hack|heist|\bSEC\b|regulat|central bank|\bFed\b|custody|guilty|sentenced|fraud|scam|judge|senat`;
const CRYPTO_MARKET_NOISE_EN = String.raw`\bprices?\b|analysts?|meme ?coin|Nvidia`;
// Ruido adicional de la prensa sectorial (CoinDesk, The Block): mineras, valoraciones, ETF y mercados de predicción.
const CRYPTO_SECTOR_NOISE_EN = String.raw`bottom|\bminers?\b|valuation|prediction market|Kalshi|ETFs?\b|\bperps?\b`;
// Cripto en español (Cinco Días, Expansión, CriptoNoticias): regulación y delito; y ruido de cotizaciones.
const CRYPTO_POLICY_ES = String.raw`stablecoin|tokeniz|CBDC|criptoactiv|MiCA\b|\bBCE\b|regula|blanqueo|hacke|robo|licencia|autoriza|supervis`;
const CRYPTO_MARKET_NOISE_ES = String.raw`precio|\bcaen?\b`;
// Pagos: las secciones patrocinadas de Payments Dive y Banking Dive.
const DIVE_SPONSORED = /^\/spons\//;
// BIS: el mismo feed de discursos sirve a pagos y a cripto; cada discurso va a un solo canal (ver ROUTES).
const BIS_PAYMENTS = String.raw`payment|digital (euro|koruna|currency|money)|CBDC|tokeni|DLT|fintech|stablecoin|crypto|instant|cross-border|settlement|Stable banks|AI-driven finance|financial sector`;
const BIS_CRYPTO = String.raw`stablecoin|tokeni[sz]|CBDC|crypto|digital (euro|koruna|currenc|money|payments)|DLT`;
// Para elegir canal no cuenta «digital payments»: esos discursos tratan de pagos y van a pagos.
const BIS_CRYPTO_CHANNEL = rx(String.raw`stablecoin|tokeni[sz]|CBDC|crypto|digital (euro|koruna|currenc|money)|DLT`);

const path = story => { try { return new URL(story.url).pathname; } catch { return null; } };
export const FILTERS = {
  // Banco Central del Ecuador.
  'bce-publicaciones': { include: /bolet[ií]n monetario|tasas de inter[eé]s|indicadores monetarios y financieros|reserva internacional|captaciones|colocaciones|volumen de cr[eé]dito/i },
  // Junta: el sufijo del código indica la materia. Quedan fuera las administrativas (-A) y de gobierno interno (-G),
  // los informes que la Junta solo «conoce» y las designaciones.
  'bce-junta-resoluciones': { test: story => !['A', 'G'].includes(story.excerpt.match(/\bJPRFM-\d{4}-\d+-([A-Z]+)\b/)?.[1]) && !/^(conoce|designa|designar|nombra|nombrar)\b/i.test(story.title) },
  // BCE administrativas: la mayoría es gestión interna; solo entran las que afectan a pagos, moneda, liquidez o entidades.
  'bce-resoluciones-admin': { test: story => /sistema (nacional|central|auxiliar) de pagos|medios? de pago|transferencias?|mensajer[ií]a|moneda|billetes?|especies monetarias|dep[oó]sitos y retiros|encaje|liquidez|reservas?|\boro\b|tarifas?|corresponsal|recaudaci[oó]n|entidades financieras|sistema financiero|certificaci[oó]n de informaci[oó]n|firma electr[oó]nica|tasas? de inter[eé]s|reforma institucional|dinero electr[oó]nico|compensaci[oó]n|c[aá]mara/i.test(story.title) && !/^(memorando|oficio)\b|\b(designa|delega)|delegaci[oó]n|talento humano|remuneraci|anticipos|bienes muebles|r[eé]gimen laboral|[ií]ndice tem[aá]tico|servidores|contrataci[oó]n|proveedor/i.test(`${story.excerpt} ${story.title}`) },

  // Ecuador financiero.
  primicias: { include: rx(EC_FINANCE), exclude: rx(EC_CONSUMER_NOISE, String.raw`calculadora|bono de contingencia|seguridad`), path: /^\/economia\// },
  eluniverso: { include: rx(EC_FINANCE), exclude: rx(EC_CONSUMER_NOISE, 'kits|homenaje') },
  'forbes-ec': { include: rx(String.raw`\bbanc|cr[eé]dito|microcr[eé]dito|\bfmi\b|deuda|tarjetas?|asobanca|cooperativ|\bsegur(o|os)\b|aseguradora|riesgo pa[ií]s|fintech|bonos? (soberanos?|de deuda)|financiamiento`), exclude: rx(String.raw`estados unidos|ee\.? ?uu|del mundo|paraguay|europe|chase|nvidia|^#|bonos de contingencia|^(forbes|money)\b`) },
  // Bloomberg Línea llega por una búsqueda: el titular debe nombrar a Ecuador y un tema financiero o fiscal.
  'bloomberg-ecuador': { include: rx(String.raw`(?=.*(ecuador|ecuatorian))(?=.*(\bfmi\b|riesgo pa[ií]s|deuda|bonos?\b|proforma|\bbanc|cr[eé]dito|financiamiento|fiscal|presupuest|seguros|cooperativ|remesas|dolariza))`), exclude: rx(String.raw`preventa|don omar|extradit|detenid|prisi[oó]n`) },

  // Autoridades EC.
  'reguladores-prensa': { include: rx(String.raw`superintenden|intendente|\bseps\b|junta de pol[ií]tica|no autorizad|(pr[eé]stamos?|cr[eé]ditos?|cooperativas?) fals|nueva norma|nuevas reglas para tarjetas|diferimiento de cr[eé]ditos|econom[ií]a popular y solidaria|\buafe\b|cosede`), exclude: rx(String.raw`paraguay|ueno|europeo|ordenamiento territorial|competencia econ[oó]mica|nutresa|consejo de participaci`) },
  // El adaptador ya separa las normas de órganos financieros; la expresión se aplica al titular y al extracto compuestos.
  'registro-oficial': { on: 'text', include: rx(String.raw`junta de pol[ií]tica y regulaci[oó]n|superintendencia de (bancos|econom[ií]a popular|compa[ñn][ií]as)|banco central|unidad de an[aá]lisis financiero|servicio de rentas internas|monetari|lavado de activos|ley org[aá]nica.*(financ|tribut|monetar|fintech|datos|valores|seguros)|cosede|dep[oó]sitos|fintech|c[oó]digo org[aá]nico monetario`), skipPath: /^\/edicion-(juridica|constitucional|especial)-/ },
  seps: { include: rx(EC_SUPERVISOR_ACTS, String.raw`norma|regulaci[oó]n|reforma|no autorizad|corte|sentencia|tasas?|segmentaci|fusi[oó]n|supervisi[oó]n|balance|indicadores`), exclude: rx(EC_INSTITUTIONAL_NOISE, String.raw`funcionarios|taller|feria|rendici[oó]n de cuentas`) },
  superbancos: { include: rx(EC_SUPERVISOR_ACTS, String.raw`calificaci[oó]n|normativa|circular|regulaci[oó]n|reforma|no autorizad|fintech|tasas?|cr[eé]dito|lavado|supervisi[oó]n|bolet[ií]n (financiero|estad[ií]stico)`), exclude: rx(EC_INSTITUTIONAL_NOISE, String.raw`media day|[aá]rboles|futuros economistas|sesi[oó]n (ordinaria|solemne)|\boea\b|sostenibilidad`) },
  mef: { include: rx(String.raw`\bfmi\b|deuda|bonos?|presupuest|proforma|multilateral|banco mundial|\bbid\b|\bcaf\b|riesgo pa[ií]s|tribut|recaudaci|calificaci[oó]n|sostenibilidad fiscal`), exclude: rx(String.raw`^\s*$|^proforma \d{4} \(`) },
  supercias: { include: rx(EC_SUPERVISOR_ACTS, String.raw`no (est[aá]n?|se encuentran?) autorizad|no mantienen?|norma|reglamento|\bley\b|disoluci|fraude|plazo|concordato|oficial de cumplimiento|^la superintendencia de compa[ñn][ií]as, valores y seguros a la ciudadan[ií]a`), exclude: rx(EC_INSTITUTIONAL_NOISE, String.raw`asisti[oó]|intervino|particip[oó]|congreso|sesi[oó]n solemne|ceremonia|jornada acad[eé]mica|embajada|estuvo presente|disculpas|semana mundial del inversionista|programa de formaci[oó]n|rindi[oó] cuentas|reuni[oó]n con|inaugur|clausur|estudiantes|recuerda a compa`) },

  // Fintech LATAM.
  iupana: { exclude: /ciberseguridad.*telco/i },
  'el-economista': { include: rx(LATAM_FINTECH, MEXICO_FINTECH), exclude: rx(String.raw`casino|televisa|at&t|\bine\b`) },
  'expansion-mx': { include: rx(LATAM_FINTECH, MEXICO_FINTECH), exclude: rx('buen fin|condusef|banxico') },
  'la-republica': { include: rx(LATAM_FINTECH, String.raw`\bnu\b|revolut|billetera|open finance|finanzas abiertas|criptomoneda|d[oó]lares digitales|activos digitales|nequi|daviplata|bre-b|littio|wenia|lulo|pibank|^plata anunci|pagos? (digital|inmediat|con tarjetas|realizados por)|superfinanciera|banca virtual`), exclude: rx(String.raw`precio del d[oó]lar|\boro\b`) },
  'bloomberg-negocios': { include: rx(LATAM_FINTECH, String.raw`\bnu\b|revolut|mercado pago|billetera|open finance|pagos? digital|\bual[aá]\b|ueno|stablecoin|licencia bancaria`) },
  'diario-financiero': { include: rx(LATAM_FINTECH, String.raw`billetera|open finance|finanzas abiertas|criptomoneda|medios de pago|transbank|tenpo|\bcmf\b|global66|fintual|toku|\bmach\b|destácame`) },
  latamlist: { include: rx(String.raw`fintech|bank|payment|credit|lending|financ|wallet|crypto|stablecoin|insur|clara|cocos|yellow card|bbva|ita[uú]`) },
  contxto: { include: rx(String.raw`fintech|banc|financ|pagos|cr[eé]dito|neobanc|cripto|inversi[oó]n en startups`) },
  // Endeavor LATAM. La búsqueda por nombres trae mucho ruido: solo entra la nota cuyo titular nombra a una empresa del directorio.
  // Fuera también el ruido bursátil y los titulares promocionales (ENDEAVOR_MARKET_NOISE y ENDEAVOR_PROMO, definidos con el
  // resto del bloque Endeavor). El medio se comprueba aparte, con la lista ENDEAVOR_PRESS_HOSTS (allowHosts de la fuente).
  'endeavor-prensa': { test: story => !ENDEAVOR_MARKET_NOISE.test(story.title) && !ENDEAVOR_PROMO.test(story.title) && !!matchEndeavor(story, { titleOnly: true }) },
  'endeavor-ar': { exclude: /\bboard\b|experiencia endeavor|bootcamp|inscrip|convocatoria|bienvenid|emprendedores? endeavor del a[ñn]o|\bgala\b/i },

  // Pagos globales.
  paymentsdive: { skipPath: DIVE_SPONSORED },
  bankingdive: { exclude: /M&A business/i, skipPath: DIVE_SPONSORED },
  'expansion-banca': { include: rx(String.raw`pagos|euro digital|BCE|BIS|Bruselas|Europa|europe|Revolut|Qonto|JPMorgan|HSBC|UniCredit|Bank of America|Openbank|Latinoam|Brasil|Paraguay|fintech|neobanco|tarjeta|regulaci|regulator|blanqueo|fraude|\bIA\b|tecnolog|Banco de Inglaterra|UBS|ING |Crédit Agricole|Italia|TSB`), exclude: rx(String.raw`soporte|media móvil|pistas|huelga|desgravaci|Rubiales|filantr|Euro Stoxx|economista jefe|Foley|rentables`) },
  'ft-banking': { include: rx(String.raw`bank|deposit|payment|tokeni|lender|JPMorgan|HSBC|UBS|Julius Baer|Rothschild|AI agents`), exclude: rx(String.raw`Epstein|Trump|oligarch|Qatari|Aldi|Putin|jobs deal`) },
  // Finextra llega por Google sin extracto: fuera columnas de opinión firmadas, preguntas y altas en marketplaces.
  finextra: { exclude: rx(String.raw`: By [A-Z]|\?|^(From|Beyond|The (New|Five|building|third)|Building|Your Payment|When|Why|How|Should|1 in 10)|NextGen Nordics|Self-service`, String.raw`\bmarketplace\b`) },
  thebanker: { include: rx(String.raw`bank|payment|stablecoin|Revolut|Reg Wrap|digital money|FCA`), exclude: rx(String.raw`^(Regulation|Qatar|Germany|The Banker|Ask The Banker) - |Albania|Top 200|Top Islamic|midterm|gold reserves|Protesters|Anthropic IPO|whistleblow|LCF`) },
  americanbanker: { exclude: /Chosen and Showcased|Sponsor|Partner Insights/i },
  pymnts: { include: rx(String.raw`payment|bank|fintech|card|wallet|checkout|money transfer|remittance|merchant|digital currency|stablecoin|Visa|Mastercard|PayPal|Stripe|fraud`), exclude: rx(String.raw`^\d+%|Gen Z|When the Payout|Shopper|Nvidia`) },
  ecb: { include: rx(String.raw`digital euro|payment|money\b|bank|supervis|financial stability|financial system|TARGET|instant|stablecoin|crypto`), exclude: rx('monetary policy|wage|Interview') },
  'bis-discursos': { include: rx(BIS_PAYMENTS, BIS_CRYPTO) },
  'ft-fintech': { include: rx(String.raw`bank|payment|tokeni|Revolut|Monzo|Starling|Klarna|Stripe|Adyen|stablecoin|fintech|card|ledger`), exclude: rx(String.raw`Binance|hedge fund|bitcoin|prediction market|NYSE`) },
  'wsj-markets': { include: rx(String.raw`bank|card|payment|fintech|JPMorgan|Ramp|Visa|Mastercard|PayPal|stablecoin|lender`), exclude: rx(String.raw`Roundup|Market Talk|Opinion|Stock Market Today|Advisor|Burning Lenders`) },
  fsb: { include: rx(String.raw`payment|stablecoin|crypto|bank|priorit|cross-border|resolution|regulat|Financial stability`), exclude: rx('Regional Consultative Group|outreach event') },
  boe: { include: rx(String.raw`payment|RTGS|CHAPS|tokenis|stablecoin|digital pound|credit union|Meridian|regulat|PRA|capital|resolution|Senior Manager`), exclude: rx(String.raw`Minutes of the Meeting of the Court|Monetary Policy|Asset Purchase|Bank rate|Securities Lending`) },
  eba: { exclude: rx(String.raw`appoints|website maintenance|Taxonomy|NGFS`) },
  'ecb-supervision': { exclude: rx('Interview|nature') },
  'bis-investigacion': { include: rx(String.raw`payment|bank|stablecoin|liquidity|tokeni|CBDC|fintech`), exclude: rx(String.raw`central bankers|Central banks and macro`) },
  'fintech-business-weekly': { exclude: rx(String.raw`Interview:|, with |I Never Thought`) },
  fed: { on: 'text', include: /payment|fednow|fedwire|\bach\b|check services|stablecoin|instant|pricing|debit|interchange|regulation ii|digital (asset|dollar)|crypto|tokeni[sz]|comment period|proposed (rule|guidance)|final rule/i },

  // Cripto.
  'cinco-dias-cripto': { include: rx(CRYPTO_POLICY_ES, String.raw`(euro|bono) digital|activos tokenizados|blockchain|CNMV|ciberataque|cibercrimen|Binance|cripto`), exclude: rx(String.raw`corrige|MSCI|Anthropic|castiga|debilidad de bitcoin`) },
  'expansion-cripto': { include: rx(CRYPTO_POLICY_ES, String.raw`(euro|d[oó]lar|moneda|bono) digital|activos (digitales|tokenizados)|blockchain|CNMV|banco central|sanci[oó]n|ciberataque|fraude|custodia|Corea del Norte|Binance`), exclude: rx(CRYPTO_MARKET_NOISE_ES, String.raw`baja de|desinfla|m[ií]nimos?|m[aá]ximos|ETF|tesorer[ií]a|Strategy|MSCI|miedo extremo|futuros perpetuos|rentabilidad`), skipPath: /\/mercados\/bitcoin\// },
  criptonoticias: { include: rx(CRYPTO_POLICY_ES, String.raw`(euro|d[oó]lar|real|peso|moneda|bono) digital|activos (digitales|virtuales|tokenizados)|banco central|lavado|sanci[oó]n|restricciones|estafa|fraude|custodia|impuesto|\bSEC\b|\bley\b|condena`), exclude: rx(CRYPTO_MARKET_NOISE_ES, String.raw`\bsuben?\b|desplome|rentabilidad|ballenas|ETF|analistas?|tesorer[ií]a|miner[ií]a|\bIA\b|supercomputadora|Java`), path: /\/(regulacion|sucesos|judicial|adopcion)\// },
  'bloomberg-cripto': { include: rx(String.raw`cripto|bitcoin|stablecoin|tokeniz|binance`), exclude: rx(CRYPTO_MARKET_NOISE_ES, String.raw`\bsuben?\b|repunta|retrocede|m[ií]nimos?|liquidaci[oó]n|analistas?|Cotizaci[oó]n|bajistas|pierde impulso|recupera terreno|resiste|auge|superando|\bIA\b|Musk`) },
  'reuters-cripto': { include: rx(String.raw`crypto|stablecoin|tokeni|digital (asset|finance)|binance|coinbase|North Korean hackers`), exclude: rx(CRYPTO_MARKET_NOISE_EN, String.raw`slides?\b|\bdrops?\b|\bfalls?\b|Anthropic|Crypto Weekly|Tech Weekly|PODCAST|Morning Bid|lows\b|Trump Media|Strategy\b|trading volume|returns to profit|tracks stocks`) },
  'ft-cripto': { exclude: rx(String.raw`Trump Media|Anthropic|Would you take|prediction markets|bitcoin bet`) },
  theblock: { include: rx(CRYPTO_POLICY_EN), exclude: rx(CRYPTO_MARKET_NOISE_EN, CRYPTO_SECTOR_NOISE_EN, String.raw`raises \$|rating`), path: /\/news\/(regulation|business|defi)\// },
  coindesk: { include: rx(CRYPTO_POLICY_EN), exclude: rx(CRYPTO_MARKET_NOISE_EN, CRYPTO_SECTOR_NOISE_EN, String.raw`slides?\b|\bdrops?\b|\bfalls?\b|tumbles?|plunge|rall(y|ies)|rebound|liquidation|whales?|outflows?|inflows?|chart|Anthropic|treasury|earnings|revenue|Live updates|Strategy\b`), path: /\/(policy|business)\// },
  chainalysis: { exclude: rx(String.raw`AI Model|Security Incident|Webinar|Product|How Chainalysis`) },
};
// Una nota malformada (por ejemplo, de una edición anterior alterada) no hace lanzar al filtro: cuenta como que no pasa.
export function relevant(story, source) {
  const filter = FILTERS[source.id];
  if (!filter) return true;
  try {
    const text = filter.on === 'text' ? `${story.title} ${story.excerpt || ''}` : story.title;
    if (filter.include && !filter.include.test(text)) return false;
    if (filter.exclude?.test(text)) return false;
    if (filter.path || filter.skipPath) {
      const pathname = path(story);
      if (pathname == null || (filter.path && !filter.path.test(pathname)) || filter.skipPath?.test(pathname)) return false;
    }
    return filter.test ? !!filter.test(story) : true;
  } catch { return false; }
}

// Canal de cada nota. Por defecto, el de su fuente; ROUTES lo cambia por tema para fuentes que sirven a dos canales.
export const ROUTES = {
  'bce-boletines': [{ pattern: /\bJPRFM\b|Junta de Pol[ií]tica/i, category: 'regulacion' }],
  'bis-discursos': [{ pattern: BIS_CRYPTO_CHANNEL, category: 'cripto' }],
};
export function channelFor(story, source) {
  return ROUTES[source.id]?.find(route => route.pattern.test(story.title))?.category ?? source.category;
}
// Tope por período de una fuente en un canal: `limits[canal]` si existe; si no, `limit`.
export function limitFor(source, category, fallback = 25) {
  return source?.limits?.[category] ?? source?.limit ?? fallback;
}

// ---------------------------------------------------------------------------------------------------------
// Acumulación: muchos feeds solo conservan de 1 a 5 días. Cada edición suma a lo que trae el feed las notas que esa
// misma fuente aportó a la edición anterior, si siguen dentro de los 30 días y siguen pasando el filtro actual (`keep`).
// Si la fuente falló en esta ejecución, las notas conservadas se marcan `stale: true`; si respondió, no llevan marca.
// Las ediciones anteriores a clipExcerpt cortaban el extracto en seco a 280 caracteres, a veces a mitad de palabra: un
// extracto conservado de exactamente ese largo y sin «…» se vuelve a cortar en límite de palabra (solo se quita texto).
// La edición anterior viene de fuera del proceso: cada nota se revalida (`carryable`) antes de conservarla.
const filled = value => typeof value === 'string' && value.trim() !== '';
export function carryable(story, source) {
  if (!story || typeof story !== 'object' || !source || story.sourceId !== source.id) return false;
  if (!filled(story.id) || !filled(story.title) || !filled(story.source)) return false;
  if (!safeUrl(story.url) || !safeUrl(story.sourceUrl) || !Number.isFinite(Date.parse(story.publishedAt))) return false;
  if (story.excerpt !== undefined && typeof story.excerpt !== 'string') return false;
  return linkAllowed(story, source);
}
// Forma mínima de una edición anterior utilizable: `stories` y `sources` arreglos, `tracked` objeto o ausente.
export function editionShape(data) {
  const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
  return isObject(data) && Array.isArray(data.stories) && Array.isArray(data.sources) && (data.tracked === undefined || isObject(data.tracked));
}
export function accumulate(fresh, previous, source, { ok = true, now = Date.now(), keep = () => true } = {}) {
  const byId = new Map();
  for (const story of fresh) if (!byId.has(story.id)) byId.set(story.id, story);
  for (const old of Array.isArray(previous) ? previous : []) {
    if (!carryable(old, source) || byId.has(old.id) || !recent(old.publishedAt, now)) continue;
    let kept; try { kept = keep(old); } catch { kept = false; }
    if (!kept) continue;
    const { stale, ...story } = old;
    const carried = { ...story, kind: source.kind, category: channelFor(story, source) };
    if (typeof story.excerpt === 'string' && story.excerpt.length === MAX_EXCERPT && !story.excerpt.endsWith('…')) carried.excerpt = clipExcerpt(story.excerpt, MAX_EXCERPT - 1);
    if (source.tier) carried.tier = source.tier;
    if (source.access) carried.access = source.access;
    if (!ok) carried.stale = true;
    byId.set(old.id, carried);
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------------------------------------
// Composición de canal. Con la acumulación el canal crece: hay que dejar material para 24 horas, 7, 15 y 30 días.
// - Por fuente: como máximo `limit` notas en cada período (24 h, 1-7 días, 7-15 días, 15-30 días), o sea 4 × limit.
// - Por canal: hasta `cap` notas repartidas entre los cuatro períodos; lo que un período no usa pasa a los demás.
// - Nivel 3: no más de `tier3Share` del canal.
// Dentro de cada período se eligen notas espaciadas en el tiempo (siempre la más reciente), no solo las últimas:
// así las notas sobreviven al envejecer y el período de 15 a 30 días no queda vacío.
const byDateDesc = (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
export function periodIndex(story, now = Date.now()) {
  const days = (now - Date.parse(story.publishedAt)) / DAY;
  const index = PERIOD_DAYS.findIndex(limit => days <= limit);
  return index === -1 ? PERIOD_DAYS.length - 1 : index;
}
function byPeriod(stories, now) {
  const buckets = PERIOD_DAYS.map(() => []);
  for (const story of [...stories].sort(byDateDesc)) buckets[periodIndex(story, now)].push(story);
  return buckets;
}
export function spaced(list, count) {
  if (count <= 0) return [];
  if (list.length <= count) return list;
  if (count === 1) return [list[0]];
  return Array.from({ length: count }, (_, i) => list[Math.round(i * (list.length - 1) / (count - 1))]);
}
export function shares(sizes, cap) {
  const quota = sizes.map(() => 0); let remaining = cap;
  let open = sizes.map((_, i) => i).filter(i => sizes[i] > 0);
  while (remaining > 0 && open.length) {
    const share = Math.max(1, Math.floor(remaining / open.length));
    for (const i of open) { const add = Math.min(share, sizes[i] - quota[i], remaining); quota[i] += add; remaining -= add; if (!remaining) break; }
    open = open.filter(i => quota[i] < sizes[i]);
  }
  return quota;
}
function spread(stories, cap, now, pick = spaced) {
  const buckets = byPeriod(stories, now);
  const quota = shares(buckets.map(bucket => bucket.length), cap);
  return buckets.flatMap((bucket, i) => pick(bucket, quota[i]));
}
// Juicio editorial (scripts/editorial.mjs): puntuación 0-100 de la nota, o null si aún no tiene.
export const editorialScore = story => Number.isFinite(story?.editorial?.score) ? story.editorial.score : null;
// Composición con juicio editorial, si alguna nota del canal lo tiene:
// - `threshold`: fuera las notas juzgadas con menos puntos, salvo las de fuentes primarias oficiales (`primary`).
// - Los mismos topes, pero dentro de cada período se eligen las de más puntos (fecha como desempate) en vez de espaciarlas,
//   y el canal sale ordenado por período (de lo más reciente a lo más antiguo) y, dentro de cada uno, por importancia.
// - Una nota sin juicio se ordena con `neutral`. Sin ningún juicio en el canal, todo queda como antes (espaciado y por fecha).
export function composeChannel(stories, { cap = 80, limitFor: perPeriod = () => 25, tier3Share = 0.2, now = Date.now(), threshold = 0, neutral = 50, primary = () => false } = {}) {
  const kept = stories.filter(story => { const score = editorialScore(story); return score == null || score >= threshold || primary(story); });
  const ranked = kept.some(story => editorialScore(story) != null);
  const importance = (a, b) => (editorialScore(b) ?? neutral) - (editorialScore(a) ?? neutral) || byDateDesc(a, b);
  const pick = ranked ? (list, count) => [...list].sort(importance).slice(0, Math.max(0, count)) : spaced;
  const bySource = new Map();
  for (const story of kept) bySource.set(story.sourceId, [...(bySource.get(story.sourceId) || []), story]);
  const capped = [...bySource.values()].flatMap(list => byPeriod(list, now).flatMap(bucket => pick(bucket, perPeriod(list[0]))));
  const tier3 = capped.filter(story => story.tier === 3), others = capped.filter(story => story.tier !== 3);
  let allowed = Math.min(tier3.length, Math.floor(cap * tier3Share));
  const main = Math.min(others.length, cap - allowed);
  allowed = Math.min(allowed, Math.floor(main * tier3Share / (1 - tier3Share) + 1e-9));
  const result = [...spread(others, main, now, pick), ...spread(tier3, allowed, now, pick)];
  return ranked ? result.sort((a, b) => periodIndex(a, now) - periodIndex(b, now) || importance(a, b)) : result.sort(byDateDesc);
}
// Tope por edición (`perEdition` de la fuente, por ejemplo los boletines de datos del BCE): solo las N más recientes de
// esa fuente en toda la edición, puntúen lo que puntúen.
export function capPerEdition(stories, perEdition = () => undefined) {
  const counts = new Map();
  return [...stories].sort(byDateDesc).filter(story => {
    const max = perEdition(story);
    if (!Number.isInteger(max)) return true;
    const count = counts.get(story.sourceId) || 0;
    counts.set(story.sourceId, count + 1);
    return count < max;
  });
}
// Con juicio editorial la edición va canal por canal, cada uno en su orden de importancia (site/app.js lo respeta); sin
// juicio, toda la edición va por fecha, como antes.
export function composeEdition(stories, options = {}) {
  const pool = options.perEdition ? capPerEdition(stories, options.perEdition) : stories;
  const byChannel = new Map();
  for (const story of pool) byChannel.set(story.category, [...(byChannel.get(story.category) || []), story]);
  const composed = [...byChannel.values()].flatMap(list => composeChannel(list, options));
  return composed.some(story => editorialScore(story) != null) ? composed : composed.sort(byDateDesc);
}

// ---------------------------------------------------------------------------------------------------------
// Palabras con mayúscula que no identifican a una empresa: países, gentilicios y términos genéricos del sector.
const COVERAGE_STOP = new Set('fintech paytech insurtech neobanco banco bank central capital ventures serie series ronda startup latam latin america américa latina latinoamérica ecuador colombia colombian colombiana colombiano méxico mexico mexican mexicana mexicano argentina argentine argentino brasil brazil brazilian brasileña brasileño perú peru peruvian peruana chile chilean chilena chileno uruguay paraguay bolivia venezuela panamá estados unidos eeuu usd nuevo nueva the and for una uno los las del para con por how why what estas este esta así qué cómo auge ceo cfo'.split(' '));
export function coverageSignature(title) {
  const amounts = new Set(); const entities = new Set();
  for (const match of title.matchAll(/(?:US\$|USD|R\$|\$)\s?(\d+(?:[.,]\d+)?)\s?(mil millones|millones|million|billion|bn|mm|m|b)?(?![a-z])/gi)) {
    const unit = /^(mil millones|billion|bn|b)$/i.test(match[2] || '') ? 'b' : match[2] ? 'm' : '';
    amounts.add(`${Number(match[1].replace(',', '.'))}${unit}`);
  }
  for (const word of title.match(/\p{Lu}[\p{L}\d]{2,}/gu) || []) if (!COVERAGE_STOP.has(word.toLowerCase())) entities.add(word.toLowerCase());
  return { amounts, entities };
}
const COVERAGE_WINDOW = 4 * DAY;
function sameCoverage(a, b) {
  if (a.story.source === b.story.source || Math.abs(Date.parse(a.story.publishedAt) - Date.parse(b.story.publishedAt)) > COVERAGE_WINDOW) return false;
  const entities = [...a.signature.entities].filter(entity => b.signature.entities.has(entity)).length;
  const amounts = [...a.signature.amounts].filter(amount => b.signature.amounts.has(amount)).length;
  return entities >= 2 || (entities >= 1 && amounts >= 1);
}
// Cuando la misma nota llega a varios canales (mismo enlace, mismo medio y titular, o el mismo titular largo en dos
// fuentes, como un discurso publicado por el BCE y por el BIS), queda una sola copia: la de mejor calidad (con
// extracto y enlace directo), en el canal más específico según este orden.
export const CHANNEL_ORDER = ['regulacion', 'ecuador', 'latam', 'cripto', 'pagos'];
const quality = story => (story.excerpt ? 2 : 0) + (story.via ? 0 : 1);
const channelRank = category => { const index = CHANNEL_ORDER.indexOf(category); return index === -1 ? CHANNEL_ORDER.length : index; };
const titleKey = story => story.title.toLowerCase().replace(/\W/g, '');
function oneCopy(stories) {
  const groups = []; const index = new Map();
  for (const story of stories) {
    const key = titleKey(story);
    const keys = [`u:${canonicalUrl(story.url)}`, `m:${story.source.toLowerCase()}:${key}`, ...(key.length >= 30 ? [`t:${key}`] : [])];
    let group = keys.map(k => index.get(k)).find(Boolean);
    if (!group) { group = []; groups.push(group); }
    group.push(story);
    for (const k of keys) if (!index.has(k)) index.set(k, group);
  }
  return groups.map(group => {
    const best = group.reduce((a, b) => quality(b) > quality(a) || (quality(b) === quality(a) && channelRank(b.category) < channelRank(a.category)) ? b : a);
    const category = group.reduce((current, story) => channelRank(story.category) < channelRank(current) ? story.category : current, best.category);
    return category === best.category ? best : { ...best, category };
  });
}
// Una nota aparece en un solo canal (ver oneCopy). En los canales de mergeCoverage (Fintech LATAM y Endeavor LATAM), además, varias notas de medios
// distintos sobre la misma operación (misma empresa e importe, o dos nombres propios en común, en un margen de cuatro
// días) se reducen a una: la que trae extracto y enlace directo.
export function deduplicate(stories, mergeCoverage = ['latam', 'endeavor']) {
  const kept = [];
  for (const story of oneCopy(stories).sort(byDateDesc)) {
    const entry = { story, signature: mergeCoverage.includes(story.category) ? coverageSignature(story.title) : null };
    const twin = entry.signature ? kept.findIndex(other => other.signature && other.story.category === story.category && sameCoverage(entry, other)) : -1;
    if (twin === -1) kept.push(entry);
    else if (quality(story) > quality(kept[twin].story)) kept[twin] = entry;
  }
  return kept.map(entry => entry.story);
}

// ---------------------------------------------------------------------------------------------------------
// Empresas Endeavor de América Latina. La lista sale del directorio oficial (scripts/data/endeavor-latam.json, generado
// por scripts/endeavor.mjs desde la API de endeavor.org); aquí solo se decide cómo reconocerlas en una nota.
export const ENDEAVOR_COMPANIES = endeavorDirectory.companies;
export const ENDEAVOR_COUNTRIES = { argentina: 'Argentina', brazil: 'Brasil', chile: 'Chile', colombia: 'Colombia', ecuador: 'Ecuador', mexico: 'México', peru: 'Perú', uruguay: 'Uruguay', greece: 'Grecia', poland: 'Polonia' };
export const ENDEAVOR_VERTICALS = { fintech: 'Fintech', 'b2b-software': 'Software B2B', commerce: 'Comercio', healthcare: 'Salud', marketplaces: 'Marketplaces', 'smart-city-and-climate': 'Ciudades y clima', 'food-beverage': 'Alimentos y bebidas', education: 'Educación' };
// Nombres ambiguos: palabras comunes en español, inglés o portugués, nombres de persona u otras marcas. Solo cuentan en
// el titular, escritos como en el directorio (mayúscula inicial y tildes exactas) y con contexto de empresa o finanzas.
// Los nombres de tres caracteres o menos (R2, R5, B2, ISA…) se tratan siempre así. Lista editable.
// Revisión de ediciones reales: «Addi» es nombre de pila en EE. UU. (deportes), «Brex» un apellido, «CERC» el regulador
// eléctrico de India, «Belvo» un club de rugby irlandés, «Pismo» una playa de California, «Yuno» un nombre japonés y
// «tapi» el gasoducto TAPI y un río y un distrito de India. CloudWalk y Leasy son también empresas de China y Dinamarca.
export const ENDEAVOR_AMBIGUOUS = new Set([
  'ADDI', 'Addi', 'Belvo', 'Brex', 'CERC', 'CloudWalk', 'LEASY', 'Link Mobile', 'Pismo', 'tapi', 'Yuno',
  'albo', 'Alegra', 'Alice', 'ALTO', 'Ambar', 'AMARO', 'Angelus', 'Bellísima', 'Beleza Natural', 'Beso Francés', 'Birdman', 'Blip', 'Bold',
  'Campo Vivo', 'Capim', 'Caramba', 'Cayena', 'Ceibo', 'CEPA', 'Clara', 'Clip', 'Cobre', 'Compara', 'Comun', 'Comunal', 'Conexa', 'Contigo',
  'Cora', 'Crezcamos', 'Cultura Colectiva', 'Descomplica', 'Dito', 'Docket', 'Dynamo', 'Eden', 'Elenas', 'Enmedio', 'Envoys', 'Estoca',
  'Fairplay', 'Flash', 'Galgo', 'Gera', 'Gesto', 'Imagen Dental', 'Inventa', 'isaac', 'Jüsto', 'Justos', 'Kamino', 'Klar', 'La Zarza', 'Latir', 'Lemon',
  'Limonada', 'Loft', 'Mendel', 'Mensajeros Urbanos', 'Mercado Bitcoin', 'Meru', 'Migrante', 'Minka', 'Moises', 'Mural', 'Neon', 'Nomad',
  'Pier', 'Poke', 'Pomelo', 'Prática', 'Prex', 'Prey', 'Principia', 'Prometeo', 'Proteus', 'Quero', 'Quinoa', 'Refinancia', 'Reservamos',
  'Reuse', 'Ripio', 'Runa', 'Runway', 'Sami', 'Sentinel', 'Shiva', 'Spira', 'Swap', 'Tala', 'Tangelo', 'Thais', 'Triciclos', 'Unico',
  'Ver de Verdad', 'VERTICAL', 'Will bank', 'Will Bank', 'Yema', 'Yerra', 'Zapping',
]);
// Nombres que no se etiquetan nunca: demasiado genéricos o compartidos con otras marcas conocidas aun con contexto.
// ISA y ENA (salud, Brasil y Argentina) comparten sigla con empresas de energía e infraestructura que salen más en prensa;
// Infocorp (software bancario, Uruguay) se llama igual que la central de riesgo de Perú.
export const ENDEAVOR_EXCLUDED = new Set(['Arizona', 'Comp', 'CORE', 'Dominion', 'Don’t Worry', 'ENA', 'GENESYS', 'Grupo Gastronómico', 'Infocorp', 'Insider', 'Involves', 'ISA', 'Prima', 'Take', 'Torre']);
// Otras grafías del nombre de una empresa del directorio (clave: slug). No añade empresas.
export const ENDEAVOR_ALIASES = { addi: ['Addi'], 'mercadolibre-com': ['MercadoLibre', 'Mercado Libre'], 'will-bank': ['Will Bank'] };
// Ruido bursátil y de portales de inversión en la búsqueda (precio objetivo, calificaciones de analistas, volumen,
// transcripciones de resultados, saltos de precio de tokens): como en Cripto, no entran notas de cotización.
export const ENDEAVOR_MARKET_NOISE = rx(String.raw`\((NASDAQ|NYSE|BSP|BVMF|BMV|B3):|\((DLO|MELI|NU|STNE|PAGS|VTEX|XP)\)|\bstock\b|price target|precio objetivo|\bshares (are|fall|rise|drop|jump|slide)|large volume|time to buy|earnings call|\bupside\b|\bdownside\b|undervalued|overvalued|bargain|\brating\b|\bBPA\b|\bEPS\b|la acci[oó]n de|acciones (de|del)\b|\bprice (jumps|drops|falls|rises|surges)|\brall(y|ies)\b|outperforms|\| News$`);
// Titulares promocionales sobre una empresa de la red (cupones, «0% de inicial», sorteos, «por tiempo limitado», premios a
// usuarios): son anuncios de consumo, no noticias. Lista editable; cada caso nuevo, con su prueba en tests/content.test.mjs.
export const ENDEAVOR_PROMO = rx(String.raw`cup[oó]n(es)?\b|\bcoupons?\b|c[oó]digos? (de descuento|promocional)|promo ?codes?|\b0 ?% (de )?inicial|inicial de 0 ?%|sin (cuota )?inicial|\bsorteos?\b|\bsortea|giveaways?|por tiempo limitado|limited[- ]time|hasta agotar|premi(a|an|ar[aá]n?) a (sus |los )?(usuari|client)|premios? (a|para) (sus |los )?(usuari|client)`);

// Medios aceptados en el canal Endeavor LATAM (allowHosts de la fuente `endeavor-prensa`, ver collect.mjs). Las notas llegan
// por Google News y se comprueba el dominio del medio real (`sourceUrl`); vale el dominio y sus subdominios.
// Criterio: prensa con redacción propia, de referencia o especializada. Quedan fuera las agencias de comunicados (GlobeNewswire,
// PR Newswire, Business Wire), los blogs de empresas y de exchanges (Binance Square), los agregadores, las webs de promociones
// y las páginas de cotizaciones (TradingView, Investing.com, Pluang). Un medio que no está en la lista no entra: para sumar uno,
// añade su dominio en el grupo que corresponda y un caso en las pruebas.
export const ENDEAVOR_PRESS_HOSTS = [
  // Medios que el proyecto ya usa como fuentes de nivel 1 y 2 (las pruebas comprueban que estén todos).
  'primicias.ec', 'eluniverso.com', 'forbes.com.ec', 'bloomberglinea.com', 'iupana.com', 'eleconomista.com.mx', 'larepublica.co',
  'latamlist.com', 'expansion.mx', 'df.cl', 'contxto.com', 'paymentsdive.com', 'bankingdive.com', 'expansion.com', 'ft.com',
  'finextra.com', 'thebanker.com', 'americanbanker.com', 'pymnts.com', 'wsj.com', 'elpais.com', 'reuters.com', 'theblock.co',
  'coindesk.com', 'criptonoticias.com',
  // Referencia internacional y agencias de noticias (no de comunicados).
  'bloomberg.com', 'economist.com', 'forbes.com', 'cnbc.com', 'techcrunch.com', 'restofworld.org', 'efe.com', 'americaeconomia.com', 'bnamericas.com',
  // Argentina.
  'cronista.com', 'forbesargentina.com', 'lanacion.com.ar', 'clarin.com', 'infobae.com', 'ambito.com', 'iprofesional.com', 'perfil.com', 'eleconomista.com.ar', 'iproup.com',
  'mercado.com.ar', // Revista Mercado: revista de negocios argentina con redacción propia.
  // México.
  'eluniversal.com.mx', 'elfinanciero.com.mx', 'forbes.com.mx', 'milenio.com', 'excelsior.com.mx', 'razon.com.mx', 'elceo.com', 'reforma.com', 'jornada.com.mx',
  // Colombia.
  'eltiempo.com', 'portafolio.co', 'semana.com', 'elespectador.com', 'elcolombiano.com', 'valoraanalitik.com', 'forbes.co',
  // Perú.
  'gestion.pe', 'elcomercio.pe', 'semanaeconomica.com', 'larepublica.pe',
  // Chile.
  'emol.com', 'elmercurio.com', 'latercera.com', 'biobiochile.cl',
  // Uruguay.
  'elpais.com.uy', 'elobservador.com.uy',
  // Ecuador.
  'expreso.ec', 'elcomercio.com', 'vistazo.com',
  // Venezuela.
  'eluniversal.com', 'elnacional.com', 'eldiario.com', 'bancaynegocios.com',
  // Brasil.
  'valor.globo.com', 'oglobo.globo.com', 'folha.uol.com.br', 'estadao.com.br', 'exame.com', 'infomoney.com.br', 'neofeed.com.br', 'braziljournal.com',
  // Especializada: fintech, pagos, cripto, tecnología, capital de riesgo y derecho.
  'thepaypers.com', 'fintechfutures.com', 'latamfintech.co', 'dplnews.com', 'cointelegraph.com', 'diariobitcoin.com', 'news.crunchbase.com', 'dealroom.co', 'lexology.com',
];
// Nombramientos y equipo directivo (español, inglés y portugués): cargos (CEO, CFO, «Chief … Officer», director financiero,
// gerente general, country manager) y verbos de nombramiento con su complemento («ficha a», «incorpora a»; no «incorporar
// esta fruta»). «named» y «names» sueltos no cuentan («a cat named Pomelo»), ni «head of» («Head of State visits Tala»). «Pomelo nombró a … como nuevo Chief Financial
// Officer» y «Pomelo refuerza su equipo directivo con la incorporación de…» son notas de empresa.
const ENDEAVOR_APPOINTMENTS = String.raw`\b(ceo|cfo|coo|cto|cmo|cio|cpo|cro)\b|\bchief [a-z]+( [a-z]+)? officer\b|country manager|general manager|managing director|gerente (general|de pa[ií]s)|\bdirec?tora? (financ|general|geral|ejecutiv|executiv|de (finanzas|operaciones|tecnolog))|\bdirectiv[oa]s?\b|equipo de liderazgo|leadership team|alta (direcci[oó]n|gerencia)|\bc-?(suite|level)\b|\bnombr(a|ó)|\bdesign(a|ó)|\bfich(aje|ó|a al?\b)|\bincorpor(aci|ó|a al?\b)|\bcontrat(a|ó|ou)|\bnome(ia|ou|ad[oa]|a[cç][aã]o)\b|\bappoint|\bnames (new|its|former|ex)\b|\bhir(es|ed|ing)\b|\basum(e|ió) (como|el cargo|la (direcci|presidencia|gerencia))|\bassume (o cargo|como)`;
// Contexto que exige un nombre ambiguo: vocabulario de empresa, inversión, finanzas o nombramientos en el titular o el extracto.
// No incluye importes sueltos («5 millones de toneladas de cobre» no es una ronda).
export const ENDEAVOR_CONTEXT = rx(String.raw`fintech|startups?\b|unicorn|scale-?ups?|emprendim|emprendedor|levanta|recauda|\binvert|\binvierte|\braises?\b|\braised\b|ronda|\bround\b|series? [a-e]\b|financia(ci[oó]n|miento|r)|funding|inversi[oó]n|inversionistas|investors?|\binvests?\b|adquiere|adquisici[oó]n|acquir|fusi[oó]n|merger|valuaci[oó]n|valoraci[oó]n|valuation|\bipo\b|salida a bolsa|neobanc|banco digital|billetera|wallet|\bpagos?\b|recargas|payments?|tarjetas?|cr[eé]dito|\bcredit\b|lending|pr[eé]stamos?|licencia|license|expan|\blanza\b|launch|alianza|al[ií]an?\b|partner|plataforma|platform|clientes|customers|usuarios|\busers\b|ingresos|revenue|seguros?\b|insurtech|software|\bapp\b`, ENDEAVOR_APPOINTMENTS);
// Titulares en los que un nombre ambiguo es otra cosa: minería y materias primas («Cobre en Perú…»), cargos políticos, frutas y
// nutrición («Pomelo: el cítrico que…», también Tangelo, Limonada, Quinoa).
export const ENDEAVOR_NOISE = rx(String.raw`miner[ií]a|\bminer[oa]s?\b|\bmina\b|perforaci|toneladas|yacimiento|commodit|metales|\bmining\b|copper|alcald|jefa de gobierno|candidat|diputad|senador|\bfrutas?\b|\bfruits?\b|c[ií]tric|citrus|grapefruit|toronja|vitamina|nutrici[oó]n|nutrition|\bdieta?\b`);

const foldText = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘]/g, '\'').toLowerCase();
const escapeRx = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Palabra completa: ni letras o cifras pegadas, ni unidas por punto o guion a otra palabra («Bal.azos», «Devsu-Korgao»).
const bounded = body => new RegExp(`(?<![\\p{L}\\p{N}]|[\\p{L}\\p{N}][.-])(?:${body})(?![\\p{L}\\p{N}]|[.-][\\p{L}\\p{N}])`, 'u');
// Nombres con los que se reconoce una empresa: el del directorio sin aclaraciones («Galgo (formerly Migrante)» → Galgo y
// Migrante; «Zippedi Inc.» → Zippedi; «GIINT / Storeacell» → ambos) y sus grafías de ENDEAVOR_ALIASES.
export function endeavorNames(company) {
  const names = [];
  const former = [...company.name.matchAll(/\(([^)]*)\)/g)].map(match => match[1].trim().replace(/^(formerly|fmr\.|ex)\s+/i, ''));
  const base = company.name.replace(/\([^)]*\)/g, ' ').split(' / ');
  for (const raw of [...base, ...former, ...(ENDEAVOR_ALIASES[company.slug] || [])]) {
    const name = raw.replace(/\s+/g, ' ').trim().replace(/\s+(Inc|S\.\s?A|SA)\.?$/i, '').replace(/[!?]+$/, '');
    if (name.length >= 2 && !ENDEAVOR_EXCLUDED.has(name) && !names.includes(name)) names.push(name);
  }
  return names;
}
export function endeavorAmbiguous(name) {
  return ENDEAVOR_AMBIGUOUS.has(name) || name.replace(/[^\p{L}\p{N}]/gu, '').length <= 3;
}
// Índice de reconocimiento: nombres largos primero («Lemon Studios» antes que «Lemon»). Si dos empresas comparten nombre
// (Swap de México y de Brasil), cuenta la primera del directorio.
export function endeavorIndex(companies = ENDEAVOR_COMPANIES) {
  const entries = []; const seen = new Set();
  for (const company of companies) {
    const names = endeavorNames(company);
    for (const name of names) {
      const ambiguous = endeavorAmbiguous(name);
      // Los ambiguos se distinguen por su grafía exacta (ADDI y Addi son dos formas); los demás, sin mayúsculas ni tildes.
      const key = ambiguous ? `=${name}` : foldText(name);
      if (seen.has(key)) continue;
      seen.add(key);
      // Ambiguo: tal como está escrito en el directorio («tapi», «albo») o con mayúscula inicial; nunca en mayúsculas sostenidas
      // si el directorio no lo escribe así («TAPI» es el gasoducto). Si no es ambiguo: sin distinguir mayúsculas ni tildes.
      const forms = [...new Set([name, name[0].toUpperCase() + name.slice(1)])];
      entries.push({ name, display: names[0], company, ambiguous, pattern: ambiguous ? bounded(forms.map(escapeRx).join('|')) : bounded(escapeRx(foldText(name))) });
    }
  }
  return entries.sort((a, b) => b.name.length - a.name.length);
}
export const ENDEAVOR_INDEX = endeavorIndex();

// Titular en mayúscula de oración (español), no en mayúscula de título (inglés): la mayoría de sus palabras de cuatro letras o
// más van en minúscula. No cuentan la primera palabra del titular, el nombre encontrado ni la palabra que lo sigue.
const sentenceCased = (title, match) => {
  const before = title.slice(0, match.index).replace(/^\s*\S+/, '');
  const after = title.slice(match.index + match[0].length).replace(/^\s*\S+/, '');
  const words = `${before} ${after}`.match(/\p{L}{4,}/gu) || [];
  return words.filter(word => /^\p{Lu}/u.test(word)).length / (words.length || 1) < 0.5;
};
// Un nombre ambiguo no cuenta como empresa:
// - en mayúscula de oración, junto a otra palabra con mayúscula: casi siempre es una persona o un lugar («Clara Brugada»,
//   «María Clara»). La primera palabra del titular no cuenta como vecina: lleva mayúscula por posición.
// - en mayúscula de título (inglés), en medio del titular: ahí todas las palabras llevan mayúscula («…to Swap Crypto Wallet
//   Addresses»). Vale al principio, tras «’s» («Brazil’s Loft»), tras dos puntos o raya, antes de una coma o tras una palabra
//   en minúscula de cuatro letras o más («La fintech Bold…»), que en mayúscula de título no existiría.
function notACompany(title, match) {
  const after = title.slice(match.index + match[0].length);
  const before = title.slice(0, match.index);
  if (sentenceCased(title, match)) return /^\s+\p{Lu}\p{Ll}/u.test(after) || /\S\s+\p{Lu}\p{Ll}+\s+$/u.test(before);
  return !(/^\s*$/.test(before) || /['’]s\s+$|[:|–—-]\s+$|(?<![\p{L}\p{N}])\p{Ll}{4,}\s+$/u.test(before) || /^,/.test(after));
}
// Empresa Endeavor que menciona una nota: primero el titular y luego el extracto (salvo con `titleOnly`). Los nombres ambiguos
// solo cuentan en el titular y con contexto (ENDEAVOR_CONTEXT en titular o extracto, o nota del canal latam).
// Devuelve { company, country, vertical, url } o null.
export function matchEndeavor(story, { index = ENDEAVOR_INDEX, titleOnly = false } = {}) {
  const title = String(story?.title ?? '');
  const excerpt = titleOnly ? '' : String(story?.excerpt ?? '');
  const fields = [foldText(title), foldText(excerpt)];
  let context = null;
  const hasContext = () => (context ??= story?.category === 'latam' || ENDEAVOR_CONTEXT.test(`${title} ${story?.excerpt ?? ''}`));
  const hasNoise = () => ENDEAVOR_NOISE.test(title);
  for (const field of excerpt ? [0, 1] : [0]) {
    for (const entry of index) {
      if (!entry.ambiguous) { if (entry.pattern.test(fields[field])) return endeavorTag(entry); continue; }
      if (field === 1) continue;
      const match = title.match(entry.pattern);
      if (match && hasContext() && !hasNoise() && !notACompany(title, match)) return endeavorTag(entry);
    }
  }
  return null;
}
function endeavorTag({ display, company }) {
  const country = company.offices.map(office => ENDEAVOR_COUNTRIES[office] || office.replace(/-/g, ' ').replace(/^\p{L}/u, letter => letter.toUpperCase())).join(' / ');
  const tag = { company: display };
  if (country) tag.country = country;
  if (company.vertical) tag.vertical = ENDEAVOR_VERTICALS[company.vertical] || company.vertical;
  // Solo fichas de endeavor.org (https): un enlace de otro dominio no se publica.
  const url = endeavorUrl(company.url);
  if (url) tag.url = url;
  return tag;
}
// Copia de la nota con el campo `endeavor` recalculado: se pone si hay coincidencia y se quita si ya no la hay.
export function tagEndeavor(story, options) {
  const { endeavor, ...rest } = story;
  const tag = matchEndeavor(rest, options);
  return tag ? { ...rest, endeavor: tag } : rest;
}

// Búsqueda dedicada (canal Endeavor LATAM): Google News por lotes de nombres unidos con OR. Se empieza por las fintech de la
// región y las empresas con oficina en Ecuador. Cada ejecución consulta `perRun` lotes y la siguiente sigue donde quedó
// (`rotation`); la acumulación de 30 días hace que el canal se llene con el tiempo. `maxWords` evita consultas demasiado largas.
export const ENDEAVOR_SEARCH = {
  verticals: ['fintech'],
  offices: ['ecuador'],
  maxWords: 28,
  perRun: 4,
  editions: [
    { language: 'es', params: 'hl=es-419&gl=EC&ceid=EC%3Aes-419' },
    { language: 'en', params: 'hl=en-US&gl=US&ceid=US%3Aen' },
  ],
};
export function searchCompanies(companies = ENDEAVOR_COMPANIES, config = ENDEAVOR_SEARCH) {
  const seen = new Set();
  return companies.filter(company => {
    const [name] = endeavorNames(company);
    if (!name || seen.has(name.toLowerCase())) return false;
    if (!config.verticals.includes(company.vertical) && !company.offices.some(office => config.offices.includes(office))) return false;
    seen.add(name.toLowerCase());
    return true;
  });
}
// Término de búsqueda de una empresa: su nombre entre comillas.
export function searchTerm(company) {
  const [name] = endeavorNames(company);
  return `"${name.replace(/"/g, '')}"`;
}
// Calificador del lote: los nombres ambiguos van en lotes propios que añaden su sector a toda la consulta
// («("Clara" OR "Klar") fintech»). Google no interpreta bien grupos anidados dentro de un OR, así que no se mezclan.
export function searchQualifier(company) {
  return endeavorAmbiguous(endeavorNames(company)[0]) ? (company.vertical === 'fintech' ? 'fintech' : 'startup') : '';
}
const wordCount = term => term.replace(/[()"]/g, ' ').split(/\s+/).filter(Boolean).length;
// Agrupa las empresas en lotes { terms, qualifier }: cada consulta cuenta las palabras de los nombres, un OR entre nombres,
// el calificador y «when:30d», sin pasar de `maxWords`.
export function searchBatches(companies, maxWords = ENDEAVOR_SEARCH.maxWords) {
  const groups = new Map();
  for (const company of companies) {
    const qualifier = searchQualifier(company);
    groups.set(qualifier, [...(groups.get(qualifier) || []), searchTerm(company)]);
  }
  const batches = [];
  for (const [qualifier, terms] of groups) {
    const base = 1 + (qualifier ? 1 : 0);
    let current = [], words = base;
    for (const term of terms) {
      if (current.length && words + 1 + wordCount(term) > maxWords) { batches.push({ terms: current, qualifier }); current = []; words = base; }
      words += wordCount(term) + (current.length ? 1 : 0);
      current.push(term);
    }
    if (current.length) batches.push({ terms: current, qualifier });
  }
  return batches;
}
export function searchQuery({ terms, qualifier }) {
  return `(${terms.join(' OR ')})${qualifier ? ` ${qualifier}` : ''} when:30d`;
}
// Cada lote se consulta en cada edición de Google News (español de la región e inglés): lote 1 es, lote 1 en, lote 2 es…
export function searchLots(batches, editions = ENDEAVOR_SEARCH.editions) {
  return batches.flatMap(batch => editions.map(edition => ({ ...batch, language: edition.language, url: `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery(batch))}&${edition.params}` })))
    .map((lot, index) => ({ ...lot, index }));
}
// Rotación: `count` lotes desde `cursor` (con vuelta al inicio) y la posición en la que empezará la ejecución siguiente.
export function rotation(lots, cursor = 0, count = ENDEAVOR_SEARCH.perRun) {
  if (!lots.length) return { picked: [], next: 0 };
  const start = ((Math.trunc(Number(cursor)) || 0) % lots.length + lots.length) % lots.length;
  const picked = Array.from({ length: Math.min(count, lots.length) }, (_, i) => lots[(start + i) % lots.length]);
  return { picked, next: (start + picked.length) % lots.length };
}
