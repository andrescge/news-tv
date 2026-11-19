import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import endeavorDirectory from './data/endeavor-latam.json' with { type: 'json' };
import { endeavorUrl } from './endeavor.mjs';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', trimValues: true });
const months = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
const DAY = 24 * 60 * 60 * 1000;
// Texto sin tildes ni mayúsculas, para comparar nombres y palabras.
const foldText = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘]/g, '\'').toLowerCase();
const escapeRx = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  return hostRejection(row, source) === null;
}
// Motivo por el que el medio de una nota no se acepta: 'allowHosts' (fuera de la lista), 'denyHosts' (en la lista negra) o
// 'medio sin dominio' (sin URL de medio legible); null si se acepta.
export function hostRejection(row, source) {
  if (!source.allowHosts && !source.denyHosts) return null;
  let host;
  try { host = new URL(row.sourceUrl).hostname.toLowerCase(); } catch { return 'medio sin dominio'; }
  const matches = list => list.some(domain => host === domain || host.endsWith(`.${domain}`));
  if (source.allowHosts && !matches(source.allowHosts)) return 'allowHosts';
  if (source.denyHosts && matches(source.denyHosts)) return 'denyHosts';
  return null;
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
// También la contratación de auditores y consultores («Se selecciona como primera opción a la firma…»).
const RO_NOISE = /^se (conoce|designa|delega|acoge|selecciona)|firma (auditora|consultora)|auditor[ií]a externa|defensor\/?a? del cliente|personer[ií]a jur[ií]dica|estatuto|cooperativa de vivienda|extingui|fondo complementario|\bfcpc\b|cesant[ií]a/i;
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
    const excerpt = [`${first.organ} · ${first.code}.`, /^registro oficial/i.test(edition) ? `${edition}.` : `Registro Oficial, ${edition}.`, ...(others.length ? [`También: ${others.map(label).join('; ')}.`] : [])].join(' ');
    rows.push({ title: normTitle(first.text), url: item.link, excerpt, publishedAt: item.pubDate, language: 'es' });
  }
  return rows;
}
// Titular legible de una norma: su asunto («Se reforma la Codificación…»), recortado en límite de palabra si pasa de
// NORM_TITLE_MAX; el órgano y el código van al principio del extracto. Solo se reordena y se recorta el texto del índice.
const NORM_TITLE_MAX = 160;
const normTitle = text => clipExcerpt(text, NORM_TITLE_MAX);
// Notas del Registro Oficial de ediciones anteriores, con el titular antiguo «Órgano: CÓDIGO asunto»: se pasan al formato actual.
const RO_OLD_TITLE = new RegExp(`^(${RO_ORGANS.map(([, name]) => escapeRx(name)).join('|')}): (\\S+) (.+)$`, 'u');
export function readableNorm(story) {
  const match = typeof story?.title === 'string' ? story.title.match(RO_OLD_TITLE) : null;
  if (!match || !/\d/.test(match[2])) return story;
  const [, organ, code, text] = match;
  return { ...story, title: normTitle(text), excerpt: clipExcerpt([`${organ} · ${code}.`, story.excerpt].filter(Boolean).join(' ')) };
}

// ---------------------------------------------------------------------------------------------------------
// Filtros por fuente. `relevant()` aplica el filtro de FILTERS[source.id]; una fuente sin entrada lo deja pasar todo.
// Campos: include / exclude (sobre el titular, o sobre titular + extracto con on: 'text'), path (la ruta de la URL
// debe cumplirlo), skipPath (la ruta no debe cumplirlo), test (comprobación adicional) y why (qué parte de test falló, para el
// registro de descartes). rejectReason() dice qué regla descartó cada nota.
// Las expresiones salen de la verificación de fuentes; las que se repiten entre fuentes del mismo tema son constantes.
const rx = (...parts) => new RegExp(parts.filter(Boolean).map(part => part instanceof RegExp ? part.source : part).join('|'), 'i');

// Ecuador: la banca como negocio, que el vocabulario general no reconoce: crédito informal y usura, deudores y mora, banca
// pública (BanEcuador, CFN, Biess), mercado de valores, titularizaciones y bonos temáticos.
const EC_BANKING_BUSINESS = String.raw`chulc|chulquer|usura|agiotis|deudor|morosidad|banecuador|\bcfn\b|corporaci[oó]n financiera nacional|biess|banca p[uú]blica|bolsa de valores|casas? de valores|mercado de valores|titulariz|bonos? (azules|verdes|sociales|sostenibles|tem[aá]ticos)`;
// Ecuador: vocabulario financiero de los feeds de economía de Primicias y El Universo, y su ruido de consumo. «Presupuesto» solo
// cuenta como el del Estado: «con un presupuesto de USD 19 millones» es el costo de una obra.
const EC_FINANCE = String.raw`\bbanc|financ|\bsegur(o|os|adora)|aseguradora|cooperativ|fintech|cr[eé]ditos?|tasas? de inter[eé]s|tarjetas?|p[oó]lizas?|dep[oó]sitos?|remesas|riesgo pa[ií]s|billetera|transferencias?|medios de pago|superintendencia|banco mundial|\bfmi\b|\bbid\b|\bcaf\b|deuda|bonos? (soberanos?|de deuda|global)|pr[eé]stamos?|mercado burs[aá]til|proforma|presupuesto (general|del estado)|d[eé]ficit|recaudaci[oó]n|diferimiento|${EC_BANKING_BUSINESS}`;
const EC_CONSUMER_NOISE = String.raw`black friday|cyber ?(day|monday)|concurso|competencia econ[oó]mica|brigadas`;
// Prensa ecuatoriana general por búsqueda (El Comercio, Teleamazonas, La Hora): la banca de otros países y los avisos de feriado.
const EC_PRESS_ABROAD = String.raw`estados unidos|ee\.? ?uu|\basia|europe|paraguay|brasile|\blula\b|del mundo|feriado`;
// Supervisores de Ecuador (SEPS, Superintendencia de Bancos, Supercias): actos de control y actos protocolarios.
const EC_SUPERVISOR_ACTS = String.raw`resoluci[oó]n|sanci|intervenci|liquidaci|alerta|advierte`;
const EC_INSTITUTIONAL_NOISE = String.raw`capacit|aniversario`;
// Fintech de la región: términos comunes a La República, Bloomberg Línea, El Economista, Expansión México y Diario Financiero.
const LATAM_FINTECH = String.raw`fintech|neobanc|bancos? digital|nubank`;
// Fintech de la región por nombre: las que la prensa nombra sin decir «fintech» (resultados de MercadoLibre, Binance Pay Later).
const LATAM_FINTECH_NAMES = String.raw`mercado ?libre|mercado pago|bitso|binance|payjoy|kueski|konf[ií]o|ual[aá]\b|nequi|daviplata|dlocal|ebanx|\bstori\b|\bklar\b`;
// Banca y reguladores de la región (canal Fintech LATAM): supervisores, bancos centrales cuando actúan como reguladores (normas,
// pagos, capital, estabilidad, lavado), gremios bancarios, pagos inmediatos y efectivo, y la banca como negocio: resultados,
// licencias, compras y productos de bancos, y ciberseguridad del sistema financiero. La política monetaria y los mercados quedan
// fuera (LATAM_MARKET_NOISE). Las frases se buscan dentro de una misma oración: sin cruzar punto, punto y coma ni signo de cierre.
const LATAM_CENTRAL_BANKS = String.raw`banco central|banxico|banco de m[eé]xico|\bbcra\b|\bbacen\b|banco de la rep[uú]blica|\bbanrep\b`;
const LATAM_REGULATORY_TOPICS = String.raw`regula|\bnormas?\b|normativ|reglas|pagos|transferencias|stablecoins?|cripto|exigencia|capital\b|riesgos? financier|estabilidad|supervis|licencia|lavado|efectivo|billetes|ciber|open finance|finanzas abiertas`;
const LATAM_REGULATORS = String.raw`\bcmf\b|\bcnbv\b|superfinanciera|superintendencia (financiera|de bancos|de banca)|\babm\b|asociaci[oó]n de bancos|asobancaria|exigencia de capital|estabilidad financiera|riesgos financieros|sistema financiero|\bgafi\b|lista gris|lavado de (dinero|activos)|(${LATAM_CENTRAL_BANKS})[^.;?!]{0,80}(${LATAM_REGULATORY_TOPICS})|(${LATAM_REGULATORY_TOPICS})[^.;?!]{0,80}(${LATAM_CENTRAL_BANKS})`;
const LATAM_PAYMENTS = String.raw`\bpix\b|bre-?b\b|\bspei\b|\bcodi\b|pagos? (inmediat|instant|digital)|transferencias? (bancari|inmediat|interbancari)|transferir dinero|(uso|pagos?|aceptar[aá]n?) (de |en )?(el )?efectivo|sin efectivo|stablecoins?|pago diferido|pay later`;
const LATAM_BANKS = String.raw`\bbanc(a|o|os)\b|\bbank\b|bancolombia|davivienda|davibank|bancoomeva|banamex|banorte|bancoestado|\bbci\b|ita[uú]\b|santander|bbva|scotiabank|nubank|neobanc`;
const BANK_BUSINESS = String.raw`utilidad(es)?|ganancias?|p[eé]rdidas?|ingresos|resultados|licencia|compra\b|adquier|adquisici[oó]n|vend(e|i[oó])\b|venta\b|fusi[oó]n|cartera|tarjetas?|hipotecari|cr[eé]ditos?|pr[eé]stamos?|morosidad|\bmora\b|encaje|dep[oó]sitos|capital\b|estabilidad|solvencia|liquidez|\bapp\b|aplicaci[oó]n|cuentas? de ahorro|titulariz`;
// Banco y tema de negocio en la misma frase (sin cruzar un punto, un punto y coma ni un signo de cierre; los dos puntos de «Tema: detalle» sí), en cualquier orden.
const LATAM_BANKING = String.raw`(${LATAM_BANKS})[^.;?!]{0,80}(${BANK_BUSINESS})|(${BANK_BUSINESS})[^.;?!]{0,80}(${LATAM_BANKS})|(ciber|cyber)[^.;?!]{0,80}(financ|banc|bank)|(financ|banc|bank)[^.;?!]{0,80}cibern`;
const LATAM_BANKING_ALL = rx(LATAM_FINTECH_NAMES, LATAM_REGULATORS, LATAM_PAYMENTS, LATAM_BANKING).source;
// Política monetaria, tipo de cambio y mercados: tratan del banco central como autoridad monetaria o de la banca como acción
// en bolsa, no de la banca como negocio. También las páginas de cotización y los listados de casinos.
const LATAM_MARKET_NOISE = String.raw`\brecortes?\b|\brecorta\b|alzas? de (las )?tasas|(sube|suben|subir|baja|bajan|bajar|mantiene|mantienen|mantener|mantuvo|eleva) (la |las |su )?tasas?\b|tasa (de referencia|objetivo|de pol[ií]tica)|pol[ií]tica monetaria|inflaci[oó]n|\bselic\b|minutas|se deprecia|tipo de cambio|precio del d[oó]lar|el d[oó]lar (cerr|se cotiza|sube|baja)|\boro\b|cotizaci[oó]n|acciones (de|del|m[aá]s)\b|wall street|\bipsa\b|ibovespa|precio objetivo|compra de acciones|recompra|casinos?`;
const MEXICO_FINTECH = String.raw`econom[ií]a digital|\bcodi\b|\bspei\b|ueno|\bnu\b|mercado pago|sofipo|cnbv|pagos? (digital|electr|con qr)|criptomoneda|openbank|revolut|crowdfunding|inclusi[oó]n financiera`;
// Cripto en inglés (CoinDesk, The Block, Reuters): política, delito e infraestructura, sin mercado.
const CRYPTO_POLICY_EN = String.raw`stablecoin|tokeni[sz]|CBDC|digital (euro|dollar|currenc|asset|finance|money)|deposit token|crypto|blockchain|USDC|Tether|MiCA|GENIUS Act|Clarity Act|launder|sanction|OFAC|FinCEN|North Korea|DPRK|hack|heist|\bSEC\b|regulat|central bank|\bFed\b|custody|guilty|sentenced|fraud|scam|judge|senat|CFTC|digital payments?|\bCircle\b`;
const CRYPTO_MARKET_NOISE_EN = String.raw`\bprices?\b|analysts?|meme ?coin|Nvidia`;
// Ruido adicional de la prensa sectorial (CoinDesk, The Block): mineras, valoraciones, ETF y mercados de predicción. Los mercados
// de predicción solo son ruido si el titular no trata de su regulación (CFTC, SEC, Senado, tribunales, reguladores, candidatos).
const CRYPTO_SECTOR_NOISE_EN = String.raw`bottom|\bminers?\b|valuation|^(?!.*\b(CFTC|SEC|Senate|senators?|court|judge|regulators?|nominees?)\b).*\b(prediction markets?|Kalshi)\b|ETFs?\b|\bperps?\b`;
// Cripto en español (Cinco Días, Expansión, CriptoNoticias): regulación y delito; y ruido de cotizaciones. «Pasaporte»: la licencia
// MiCA que vale en toda la UE. «Banco»: bancos que adoptan cripto o firmas cripto que abren un banco.
const CRYPTO_POLICY_ES = String.raw`stablecoin|tokeniz|CBDC|criptoactiv|MiCA\b|\bBCE\b|regula|blanqueo|hacke|robo|licencia|pasaporte|autoriza|supervis|\bbanc(o|os|a)\b`;
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
  // Series de datos: el boletín de reservas se titula «Reservas Internacionales», en plural.
  'bce-publicaciones': { include: /bolet[ií]n monetario|tasas de inter[eé]s|indicadores monetarios y financieros|reservas? internacional(es)?|captaciones|colocaciones|volumen de cr[eé]dito|oferta y demanda de cr[eé]dito|operaciones activas y pasivas|gesti[oó]n de liquidez/i },
  // Boletines de prensa del BCE: fuera las jornadas de capacitación, ferias y aniversarios, y la balanza comercial (comercio exterior).
  'bce-boletines': { exclude: rx(EC_INSTITUTIONAL_NOISE, String.raw`jornadas? de|\bferias?\b|concurso|balanza comercial|(super[aá]vit|d[eé]ficit) comercial`) },
  // Junta: el sufijo del código indica la materia. Quedan fuera las administrativas (-A) y de gobierno interno (-G),
  // los informes que la Junta solo «conoce» y las designaciones.
  'bce-junta-resoluciones': { test: story => !['A', 'G'].includes(story.excerpt.match(/\bJPRFM-\d{4}-\d+-([A-Z]+)\b/)?.[1]) && !/^(conoce|designa|designar|nombra|nombrar)\b/i.test(story.title) },
  // BCE administrativas: la mayoría es gestión interna; solo entran las que afectan a pagos, moneda, liquidez o entidades.
  'bce-resoluciones-admin': { test: story => /sistema (nacional|central|auxiliar) de pagos|medios? de pago|transferencias?|mensajer[ií]a|moneda|billetes?|especies monetarias|dep[oó]sitos y retiros|encaje|liquidez|reservas?|\boro\b|tarifas?|corresponsal|recaudaci[oó]n|entidades financieras|sistema financiero|certificaci[oó]n de informaci[oó]n|firma electr[oó]nica|tasas? de inter[eé]s|reforma institucional|dinero electr[oó]nico|compensaci[oó]n|c[aá]mara/i.test(story.title) && !/^(memorando|oficio)\b|\b(designa|delega)|delegaci[oó]n|talento humano|remuneraci|anticipos|bienes muebles|r[eé]gimen laboral|[ií]ndice tem[aá]tico|servidores|contrataci[oó]n|proveedor/i.test(`${story.excerpt} ${story.title}`) },

  // Ecuador financiero.
  primicias: { include: rx(EC_FINANCE), exclude: rx(EC_CONSUMER_NOISE, String.raw`calculadora|bono de contingencia|seguridad`), path: /^\/economia\// },
  eluniverso: { include: rx(EC_FINANCE), exclude: rx(EC_CONSUMER_NOISE, 'kits|homenaje') },
  'forbes-ec': { include: rx(String.raw`\bbanc|cr[eé]dito|microcr[eé]dito|\bfmi\b|deuda|tarjetas?|asobanca|cooperativ|\bsegur(o|os)\b|aseguradora|riesgo pa[ií]s|fintech|bonos? (soberanos?|de deuda)|financiamiento`, EC_BANKING_BUSINESS), exclude: rx(String.raw`estados unidos|ee\.? ?uu|del mundo|paraguay|europe|chase|nvidia|^#|bonos de contingencia|^(forbes|money)\b`) },
  // El Comercio, Teleamazonas y La Hora llegan por una búsqueda con términos de banca en el titular: queda fuera la banca de
  // otros países (fallas de bancos en EE. UU., crisis de Paraguay, euro digital) y el horario de atención en feriados.
  'elcomercio-ec': { include: rx(EC_FINANCE), exclude: rx(EC_CONSUMER_NOISE, EC_PRESS_ABROAD) },
  teleamazonas: { include: rx(EC_FINANCE), exclude: rx(EC_CONSUMER_NOISE, EC_PRESS_ABROAD) },
  lahora: { include: rx(EC_FINANCE), exclude: rx(EC_CONSUMER_NOISE, EC_PRESS_ABROAD) },
  // CFN: productos de crédito y calificaciones de riesgo; fuera compras públicas, subastas, certificaciones y lemas.
  cfn: { include: rx(String.raw`cr[eé]ditos?|financiamiento|tasas?|calificaci[oó]n de riesgo|producto financiero|cartera|microcr[eé]dito|garant[ií]as`), exclude: rx(String.raw`convocatoria|solicitud de ofertas|cotizaciones|alquiler|contrataci|adquisici|subasta|\biso\b|selecci[oó]n`) },
  // Bloomberg Línea llega por una búsqueda: el titular debe nombrar a Ecuador y un tema financiero o fiscal.
  'bloomberg-ecuador': { include: rx(String.raw`(?=.*(ecuador|ecuatorian))(?=.*(\bfmi\b|riesgo pa[ií]s|deuda|bonos?\b|proforma|\bbanc|cr[eé]dito|financiamiento|fiscal|presupuest|seguros|cooperativ|remesas|dolariza))`), exclude: rx(String.raw`preventa|don omar|extradit|detenid|prisi[oó]n`) },

  // Autoridades EC.
  'reguladores-prensa': { include: rx(String.raw`superintenden|intendente|\bseps\b|junta de pol[ií]tica|no autorizad|(pr[eé]stamos?|cr[eé]ditos?|cooperativas?) fals|nueva norma|nuevas reglas para tarjetas|diferimiento de cr[eé]ditos|econom[ií]a popular y solidaria|\buafe\b|cosede|\bcfn\b|corporaci[oó]n financiera nacional|banecuador|biess|banca p[uú]blica`), exclude: rx(String.raw`paraguay|ueno|europeo|ordenamiento territorial|competencia econ[oó]mica|nutresa|consejo de participaci`) },
  // El adaptador ya separa las normas de órganos financieros; la expresión se aplica al titular y al extracto compuestos.
  'registro-oficial': { on: 'text', include: rx(String.raw`junta de pol[ií]tica y regulaci[oó]n|superintendencia de (bancos|econom[ií]a popular|compa[ñn][ií]as)|banco central|unidad de an[aá]lisis financiero|servicio de rentas internas|monetari|lavado de activos|ley org[aá]nica.*(financ|tribut|monetar|fintech|datos|valores|seguros)|cosede|dep[oó]sitos|fintech|c[oó]digo org[aá]nico monetario`), skipPath: /^\/edicion-(juridica|constitucional|especial)-/ },
  seps: { include: rx(EC_SUPERVISOR_ACTS, String.raw`norma|regulaci[oó]n|reforma|no autorizad|corte|sentencia|tasas?|segmentaci|fusi[oó]n|supervisi[oó]n|balance|indicadores`), exclude: rx(EC_INSTITUTIONAL_NOISE, String.raw`funcionarios|taller|feria|rendici[oó]n de cuentas`) },
  superbancos: { include: rx(EC_SUPERVISOR_ACTS, String.raw`calificaci[oó]n|normativa|circular|regulaci[oó]n|reforma|no autorizad|fintech|tasas?|cr[eé]dito|lavado|supervisi[oó]n|bolet[ií]n (financiero|estad[ií]stico)`), exclude: rx(EC_INSTITUTIONAL_NOISE, String.raw`media day|[aá]rboles|futuros economistas|sesi[oó]n (ordinaria|solemne)|\boea\b|sostenibilidad`) },
  // UAFE: lavado de activos, normas y reportes; fuera las páginas de trámites, los operativos de frontera, convocatorias y oficinas.
  uafe: { include: rx(String.raw`lavado|resoluci[oó]n|\bnormas?\b|sujetos obligados|reportes?\b|\bgafi\b|financiamiento del terrorismo|sanci|activos virtuales|cripto|control financiero`), exclude: rx(String.raw`registro del manual|desactivaci[oó]n|^solicitud de|operativo|convocatoria|oficina de servicios`) },
  mef: { include: rx(String.raw`\bfmi\b|deuda|bonos?|presupuest|proforma|multilateral|banco mundial|\bbid\b|\bcaf\b|riesgo pa[ií]s|tribut|recaudaci|calificaci[oó]n|sostenibilidad fiscal|banca p[uú]blica`), exclude: rx(String.raw`^\s*$|^proforma \d{4} \(`) },
  supercias: { include: rx(EC_SUPERVISOR_ACTS, String.raw`no (est[aá]n?|se encuentran?) autorizad|no mantienen?|norma|reglamento|\bley\b|disoluci|fraude|plazo|concordato|oficial de cumplimiento|^la superintendencia de compa[ñn][ií]as, valores y seguros a la ciudadan[ií]a`), exclude: rx(EC_INSTITUTIONAL_NOISE, String.raw`asisti[oó]|intervino|particip[oó]|congreso|sesi[oó]n solemne|ceremonia|jornada acad[eé]mica|embajada|estuvo presente|disculpas|semana mundial del inversionista|programa de formaci[oó]n|rindi[oó] cuentas|reuni[oó]n con|inaugur|clausur|estudiantes|recuerda a compa`) },

  // Fintech LATAM.
  iupana: { exclude: /ciberseguridad.*telco/i },
  // Los cinco medios generales de la región comparten LATAM_BANKING_ALL (fintech por nombre, banca y reguladores) y el ruido de
  // política monetaria y mercados (LATAM_MARKET_NOISE).
  'el-economista': { include: rx(LATAM_FINTECH, MEXICO_FINTECH, LATAM_BANKING_ALL), exclude: rx(LATAM_MARKET_NOISE, String.raw`televisa|at&t|\bine\b`) },
  'expansion-mx': { include: rx(LATAM_FINTECH, MEXICO_FINTECH, LATAM_BANKING_ALL), exclude: rx(LATAM_MARKET_NOISE, 'buen fin|condusef') },
  'la-republica': { include: rx(LATAM_FINTECH, LATAM_BANKING_ALL, String.raw`\bnu\b|revolut|billetera|open finance|finanzas abiertas|criptomoneda|d[oó]lares digitales|activos digitales|nequi|daviplata|bre-b|littio|wenia|lulo|pibank|^plata anunci|pagos? (digital|inmediat|con tarjetas|realizados por)|superfinanciera|banca virtual`), exclude: rx(LATAM_MARKET_NOISE) },
  // Bloomberg Línea llega por una búsqueda de Google con términos de banca y fintech en el titular.
  'bloomberg-negocios': { include: rx(LATAM_FINTECH, LATAM_BANKING_ALL, String.raw`\bnu\b|revolut|mercado pago|billetera|open finance|pagos? digital|\bual[aá]\b|ueno|stablecoin|licencia bancaria`), exclude: rx(LATAM_MARKET_NOISE) },
  'diario-financiero': { include: rx(LATAM_FINTECH, LATAM_BANKING_ALL, String.raw`billetera|open finance|finanzas abiertas|criptomoneda|medios de pago|transbank|tenpo|\bcmf\b|global66|fintual|toku|\bmach\b|destácame`), exclude: rx(LATAM_MARKET_NOISE) },
  // LatamList: el titular de una ronda suele decir solo «raises»; el sector («Brazilian fintech Nova…») está en el extracto.
  latamlist: { on: 'text', include: rx(String.raw`fintech|bank|payment|credit|lending|\bfinanc(e|ial)\b|wallet|crypto|stablecoin|insur|clara|cocos|yellow card|bbva|ita[uú]`) },
  // iProUP (Argentina) llega por una búsqueda con términos de fintech y banca en el titular. Fuera las guías de consumo
  // («qué billetera paga más», «cómo invertir», plazo fijo, dólar blue), los eventos y los mercados.
  iproup: { include: rx(LATAM_FINTECH, LATAM_BANKING_ALL, String.raw`billetera|mercado pago|ual[aá]|naranja x|brubank|personal pay|\bcocos\b|\bbcra\b|\bcnv\b|tarjetas?|\bpagos?\b|cr[eé]ditos?|stablecoin|usdc|cripto|licencia|\bmora\b|transferencias|open finance|banco como servicio|ser banco|para su banco|\bIA\b`), exclude: rx(LATAM_MARKET_NOISE, String.raw`^(qu[eé] billetera|cu[aá]nto|cu[aá]ndo es|c[oó]mo (invertir|activar|sacar|pedir|cobrar|comprar))|paga m[aá]s|beneficios (clave|exclusivos)|plazo fijo|d[oó]lar (blue|hoy|oficial|mep)|fintech forum|bancos cerrados|licitaci[oó]n en d[oó]lares`) },
  // Latam Fintech Hub llega por una búsqueda de su dominio: fuera su agenda de eventos, pódcast y cursos, los listados con emojis,
  // el contenido de marca («… | Mambu») y las fichas de empresa, que se titulan con el nombre solo.
  latamfintech: { exclude: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\b(forum|summit|bootcamp|podcast|episodio|webinar|stories|roadmap|meetup|hackathon|lab)\b|\s\|\s|\b20\d\d$/iu, test: story => story.title.trim().split(/\s+/).length > 3, why: () => 'ficha de empresa (tres palabras o menos)' },
  // Endeavor LATAM. La búsqueda por nombres trae mucho ruido: solo entra la nota cuyo titular nombra a una empresa del directorio.
  // Fuera también el ruido bursátil y los titulares promocionales (ENDEAVOR_MARKET_NOISE y ENDEAVOR_PROMO, definidos con el
  // resto del bloque Endeavor). El medio se comprueba aparte, con la lista ENDEAVOR_PRESS_HOSTS (allowHosts de la fuente).
  'endeavor-prensa': { test: story => !ENDEAVOR_MARKET_NOISE.test(story.title) && !ENDEAVOR_PROMO.test(story.title) && !!matchEndeavor(story, { titleOnly: true }), why: story => ENDEAVOR_MARKET_NOISE.test(story.title) ? 'ruido bursátil' : ENDEAVOR_PROMO.test(story.title) ? 'promoción' : 'sin empresa Endeavor en el titular' },
  'endeavor-ar': { exclude: /\bboard\b|experiencia endeavor|bootcamp|inscrip|convocatoria|bienvenid|emprendedores? endeavor del a[ñn]o|\bgala\b/i },

  // Pagos globales.
  paymentsdive: { skipPath: DIVE_SPONSORED },
  bankingdive: { exclude: /M&A business/i, skipPath: DIVE_SPONSORED },
  // Expansión · Banca: solo pagos, fintech, supervisión y regulación; la banca doméstica española (resultados, fichajes,
  // ratings, sentencias, fusiones) queda fuera.
  'expansion-banca': { include: rx(String.raw`\bpagos?\b|entidad de pago|euro digital|Banco de España|\bBCE\b|\bBIS\b|Bruselas|Revolut|Qonto|Monzo|N26|Openbank|neobanco|fintech|tarjeta|\bVisa\b|Mastercard|Bizum|regulaci|regulador|supervis|blanqueo|fraude|ciberataque|\bIA\b|banca (online|digital)|criptoactiv|stablecoin|tokeniz|Banco de Inglaterra`), exclude: rx(String.raw`soporte|media móvil|pistas|huelga|desgravaci|filantr|Euro Stoxx|economista jefe|rentables|\brating\b|perspectiva|Audiencia|condena a|fusionar|oferta en acciones`) },
  'ft-banking': { include: rx(String.raw`bank|deposit|payment|tokeni|lender|JPMorgan|HSBC|UBS|Julius Baer|Rothschild|AI agents`), exclude: rx(String.raw`Epstein|Trump|oligarch|Qatari|Aldi|Putin|jobs deal`) },
  // Finextra llega por Google sin extracto: fuera columnas de opinión firmadas, preguntas y altas en marketplaces.
  finextra: { exclude: rx(String.raw`: By [A-Z]|\?|^(From|Beyond|The (New|Five|building|third)|Building|Your Payment|When|Why|How|Should|1 in 10)|NextGen Nordics|Self-service`, String.raw`\bmarketplace\b`) },
  // The Paypers y Fintech Futures: fuera webinars, pódcast, white papers, premios, resúmenes, columnas y contenido de marca («… | Gr4vy»).
  thepaypers: { exclude: /webinar|white ?paper|^The Paypers$|\s\|\s|Total Economic Impact|podcast|\bawards?\b|sponsored|^(why|understanding|adding)\b/i },
  fintechfutures: { exclude: /What the FinTech|Georgie & Cog|Top five|round-?up|recent news|White ?paper|shortlist|Awards?\b|ICYMI|Episode|webinar|podcast|magazine|Money20\/20|^why\b|read the room/i },
  // The Banker: banca, pagos y sus autoridades (BCE, bancos centrales, reguladores). Fuera los rankings, las salidas a bolsa
  // y los informes por país patrocinados.
  thebanker: { include: rx(String.raw`bank|payment|stablecoin|Revolut|Reg Wrap|digital money|FCA|\bECB\b|Lagarde|Federal Reserve|regulators?|supervis|watchdog`), exclude: rx(String.raw`^(Regulation|Qatar|Germany|The Banker|Ask The Banker) - |Albania|Top 200|Top Islamic|midterm|gold reserves|Protesters|\bIPOs?\b|whistleblow|LCF`) },
  // American Banker: banca, pagos, cripto y sus reguladores; fuera el contenido patrocinado, los listados y las salidas a bolsa.
  americanbanker: { include: rx(String.raw`bank|payment|\bcards?\b|deposit|lend|credit|loan|mortgage|FDIC|\bOCC\b|CFPB|FinCEN|\bFed\b|Federal Reserve|stablecoin|crypto|fintech|charter|regulat|fraud|capital|merger|acqui|launder|\bAML\b|financial|downgrade|\bIMBs?\b`), exclude: rx(String.raw`Chosen and Showcased|Sponsor|Partner Insights|best places|\bIPOs?\b|goes public|Nvidia`) },
  pymnts: { include: rx(String.raw`payment|bank|fintech|card|wallet|checkout|money transfer|remittance|merchant|digital currency|stablecoin|Visa|Mastercard|PayPal|Stripe|fraud|\bFed\b|Federal Reserve|central bank|crypto`), exclude: rx(String.raw`^\d+%|Gen Z|When the Payout|Shopper|Nvidia`) },
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
  // OCC: fuera evaluaciones CRA, datos de préstamos, clima, discursos del contralor y listados mensuales de sanciones.
  occ: { exclude: /CRA Performance|Lending Data|Climate|Discusses|Emphasizes|Remarks|Testimony|Enforcement Actions for/i },

  // Cripto.
  'cinco-dias-cripto': { include: rx(CRYPTO_POLICY_ES, String.raw`(euro|bono) digital|activos tokenizados|blockchain|CNMV|ciberataque|cibercrimen|Binance|cripto`), exclude: rx(String.raw`corrige|MSCI|Anthropic|castiga|debilidad de bitcoin`) },
  'expansion-cripto': { include: rx(CRYPTO_POLICY_ES, String.raw`(euro|d[oó]lar|moneda|bono) digital|activos (digitales|tokenizados)|blockchain|CNMV|banco central|sanci[oó]n|ciberataque|fraude|custodia|Corea del Norte|Binance`), exclude: rx(CRYPTO_MARKET_NOISE_ES, String.raw`baja de|desinfla|m[ií]nimos?|m[aá]ximos|ETF|tesorer[ií]a|Strategy|MSCI|miedo extremo|futuros perpetuos|rentabilidad`), skipPath: /\/mercados\/bitcoin\// },
  criptonoticias: { include: rx(CRYPTO_POLICY_ES, String.raw`(euro|d[oó]lar|real|peso|moneda|bono) digital|activos (digitales|virtuales|tokenizados)|banco central|lavado|sanci[oó]n|restricciones|estafa|fraude|custodia|impuesto|\bSEC\b|\bley\b|condena`), exclude: rx(CRYPTO_MARKET_NOISE_ES, String.raw`\bsuben?\b|desplome|rentabilidad|ballenas|ETF|analistas?|tesorer[ií]a|miner[ií]a|\bIA\b|supercomputadora|Java`), path: /\/(regulacion|sucesos|judicial|adopcion)\// },
  'bloomberg-cripto': { include: rx(String.raw`cripto|bitcoin|stablecoin|tokeniz|binance`), exclude: rx(CRYPTO_MARKET_NOISE_ES, String.raw`\bsuben?\b|repunta|retrocede|m[ií]nimos?|liquidaci[oó]n|analistas?|Cotizaci[oó]n|bajistas|pierde impulso|recupera terreno|resiste|auge|superando|\bIA\b|Musk`) },
  // Reuters llega por una búsqueda con los términos en el titular. Revolut y las fintech entran por su supervisión y van a Pagos
  // (ROUTES).
  'reuters-cripto': { include: rx(String.raw`crypto|stablecoin|tokeni|digital (asset|finance)|binance|coinbase|North Korean hackers|Revolut|fintech|neobank`), exclude: rx(CRYPTO_MARKET_NOISE_EN, String.raw`slides?\b|\bdrops?\b|\bfalls?\b|Anthropic|Crypto Weekly|Tech Weekly|PODCAST|Morning Bid|lows\b|Trump Media|Strategy\b|trading volume|returns to profit|tracks stocks`) },
  'ft-cripto': { exclude: rx(String.raw`Trump Media|Anthropic|Would you take|prediction markets|bitcoin bet`) },
  theblock: { include: rx(CRYPTO_POLICY_EN), exclude: rx(CRYPTO_MARKET_NOISE_EN, CRYPTO_SECTOR_NOISE_EN, String.raw`raises \$|rating`), path: /\/news\/(regulation|business|defi)\// },
  // Decrypt mezcla cripto con IA y tecnología: solo regulación, delitos, bancos y stablecoins; fuera mercado, memecoins y su boletín.
  decrypt: { include: rx(String.raw`stablecoin|tokeni[sz]|CBDC|digital (euro|dollar|currenc|asset)|deposit token|USDC|Tether|MiCA|GENIUS Act|Clarity Act|launder|sanction|OFAC|FinCEN|North Korea|DPRK|hack|heist|exploit|\bSEC\b|regulat|central bank|\bFed\b|custody|guilty|sentenced|fraud|scam|judge|\btrial\b|prosecut|senat|CFTC|\bbanks?\b|\bCircle\b|lawmakers|\bbill\b|licen[cs]e`), exclude: rx(CRYPTO_MARKET_NOISE_EN, CRYPTO_SECTOR_NOISE_EN, String.raw`\bsurges?\b|\bslides?\b|\bdrops?\b|\bfalls?\b|\btanks?\b|tumbles?|plunge|rall(y|ies)|rebound|liquidation|whales?|outflows?|inflows?|Morning Minute|\bAI\b|\bNFTs?\b|airdrop|Polymarket`) },
  coindesk: { include: rx(CRYPTO_POLICY_EN), exclude: rx(CRYPTO_MARKET_NOISE_EN, CRYPTO_SECTOR_NOISE_EN, String.raw`slides?\b|\bdrops?\b|\bfalls?\b|tumbles?|plunge|rall(y|ies)|rebound|liquidation|whales?|outflows?|inflows?|chart|Anthropic|treasury|earnings|revenue|Live updates|Strategy\b`), path: /\/(policy|business)\// },
  // Chainalysis: fuera sus avisos de producto y de la propia empresa (los que empiezan «How Chainalysis…»; un caso que cuenta
  // cómo congeló fondos robados sí entra) y los informes de geografía cripto de regiones ajenas a LATAM.
  chainalysis: { exclude: rx(String.raw`AI Model|Security Incident|Webinar|Product|^How Chainalysis|Sub-Saharan|(Western|Eastern|Northern|Southern) Europe|Central (and Southern )?Asia|\bMENA\b|South Asia|East Asia|North America|Oceania`) },
};
// Motivo por el que una nota no pasa el filtro de tema de su fuente, con el nombre de la regla de FILTERS: 'include' (no
// coincide), 'exclude: <texto que coincidió>', 'path', 'skipPath', 'test' o 'test: <subregla>' (si el filtro define `why`).
// null si pasa. Una nota malformada (por ejemplo, de una edición anterior alterada) no hace lanzar: devuelve 'error'.
export function rejectReason(story, source) {
  const filter = FILTERS[source.id];
  if (!filter) return null;
  try {
    const text = filter.on === 'text' ? `${story.title} ${story.excerpt || ''}` : story.title;
    if (filter.include && !filter.include.test(text)) return 'include';
    const excluded = filter.exclude && text.match(filter.exclude);
    if (excluded) return `exclude: ${excluded[0].slice(0, 60)}`;
    if (filter.path || filter.skipPath) {
      const pathname = path(story);
      if (pathname == null || (filter.path && !filter.path.test(pathname))) return 'path';
      if (filter.skipPath?.test(pathname)) return 'skipPath';
    }
    if (filter.test && !filter.test(story)) return filter.why ? `test: ${filter.why(story)}` : 'test';
    return null;
  } catch { return 'error'; }
}
export function relevant(story, source) {
  return rejectReason(story, source) === null;
}

// ---------------------------------------------------------------------------------------------------------
// Embudo de una fuente: de las filas leídas, cuáles caen por el medio (allowHosts / denyHosts), por normalize (sin titular,
// enlace o fecha válidos, o con más de 30 días) y por el filtro de tema, y cuáles se aceptan. Las caídas por medio y por tema
// que normalize acepta (notas vigentes) se registran en `discards` con su motivo, para revisar después qué se pierde.
export const DISCARD_STAGES = ['tema', 'medio'];
const discardOf = (story, stage, reason, row) => {
  const entry = { sourceId: story.sourceId, stage, reason: String(reason).slice(0, 80), title: story.title, url: story.url, source: story.source, publishedAt: story.publishedAt };
  if (stage === 'medio') { try { entry.host = new URL(row.sourceUrl).hostname.toLowerCase(); } catch { /* Sin dominio legible. */ } }
  return entry;
};
export function screen(rows, source, now = Date.now()) {
  const stories = [], discards = [];
  const funnel = { host: 0, normalize: 0, topic: 0, accepted: 0 };
  for (const row of rows) {
    const host = hostRejection(row, source);
    const story = normalize(row, source, now);
    if (host) { funnel.host++; if (story) discards.push(discardOf(story, 'medio', host, row)); continue; }
    if (!story) { funnel.normalize++; continue; }
    const reason = rejectReason(story, source);
    if (reason) { funnel.topic++; discards.push(discardOf(story, 'tema', reason, row)); continue; }
    funnel.accepted++; stories.push(story);
  }
  return { stories, funnel, discards };
}
// Registro de descartes de una ejecución (descartes.json, junto a la edición): por fuente, como máximo `perSource` entradas,
// las más recientes y sin repetir titular; `omitted` cuenta las que no caben.
export const MAX_DISCARDS_PER_SOURCE = 40;
export function discardLog(discards, { generatedAt, perSource = MAX_DISCARDS_PER_SOURCE } = {}) {
  const bySource = new Map();
  for (const entry of [...discards].sort(byDateDesc)) {
    const list = bySource.get(entry.sourceId) || { kept: [], titles: new Set(), omitted: 0 };
    bySource.set(entry.sourceId, list);
    const key = entry.title.toLowerCase();
    if (list.titles.has(key)) continue;
    list.titles.add(key);
    if (list.kept.length < perSource) list.kept.push(entry); else list.omitted++;
  }
  const omitted = {};
  for (const [id, list] of bySource) if (list.omitted) omitted[id] = list.omitted;
  return { version: 1, generatedAt, perSource, discards: [...bySource.values()].flatMap(list => list.kept), omitted };
}

// Canal de cada nota. Por defecto, el de su fuente; ROUTES lo cambia por tema para fuentes que sirven a dos canales.
export const ROUTES = {
  'bce-boletines': [{ pattern: /\bJPRFM\b|Junta de Pol[ií]tica/i, category: 'regulacion' }],
  'bis-discursos': [{ pattern: BIS_CRYPTO_CHANNEL, category: 'cripto' }],
  // Reuters · Cripto también trae la supervisión de fintech y neobancos (Revolut): si el titular no nombra nada cripto, va a Pagos.
  'reuters-cripto': [{ pattern: /^(?!.*(crypto|stablecoin|tokeni[sz]|digital asset|bitcoin|\bether\b|binance|coinbase|tether|blockchain|CBDC|North Korean hackers))/i, category: 'pagos' }],
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
    const { stale, ...story } = source.adapter === 'registro-oficial' ? readableNorm(old) : old;
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
// Puntuación esperada de una nota sin juicio: la mediana de los juicios de su fuente en el canal (con tres o más), si no la del
// canal (con tres o más), y si no `neutral`. Así una nota recién llegada no queda por encima de la mitad de las juzgadas solo
// por no tener juicio, ni por debajo de todas: compite con lo que suele valer lo de su fuente.
const median = values => { if (values.length < 3) return null; const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1; return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
export function expectedScore(stories, neutral = 50) {
  const bySource = new Map(); const all = [];
  for (const story of stories) {
    const score = editorialScore(story);
    if (score == null) continue;
    all.push(score); bySource.set(story.sourceId, [...(bySource.get(story.sourceId) || []), score]);
  }
  const channel = median(all) ?? neutral;
  const sources = new Map([...bySource].map(([id, scores]) => [id, median(scores)]).filter(([, value]) => value != null));
  return story => sources.get(story.sourceId) ?? channel;
}
// Tope por tema (`perTopic`): en cada período, como mucho N notas que nombren a la misma entidad (`topics`, las palabras de los
// nombres propios del titular), por orden de mérito. Las notas oficiales no cuentan ni se recortan.
function capTopics(stories, { now, perTopic, topics, order, exempt }) {
  const counts = new Map(); const kept = [];
  for (const story of [...stories].sort(order)) {
    if (exempt(story)) { kept.push(story); continue; }
    const period = periodIndex(story, now);
    const keys = [...new Set(topics(story) || [])].map(word => `${period}\u0000${word}`);
    if (keys.some(key => (counts.get(key) || 0) >= perTopic)) continue;
    for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
    kept.push(story);
  }
  return kept;
}
// Composición con juicio editorial, si alguna nota del canal lo tiene:
// - `threshold`: fuera las notas juzgadas con menos puntos, salvo las de fuentes primarias oficiales (`primary`).
// - Los mismos topes, pero dentro de cada período se eligen las de más puntos (fecha como desempate) en vez de espaciarlas,
//   y el canal sale ordenado por período (de lo más reciente a lo más antiguo) y, dentro de cada uno, por importancia.
// - Una nota sin juicio vale su puntuación esperada (expectedScore). Sin ningún juicio en el canal, todo queda como antes
//   (espaciado y por fecha).
// Opciones de la edición (collect.mjs las activa; por omisión no cambian nada):
// - `perTopic` y `topics`: tope por tema (capTopics), antes del tope por fuente.
// - `reserve` y `reserveShare`: plazas reservadas para las notas que cumplen `reserve` (documentos oficiales de nivel 1), que
//   así no quedan fuera del tope de canal frente a medios prolíficos; lo que no usan vuelve al canal.
// - `refill`: si después de los topes el canal tiene sitio, se completa con las notas que solo había cortado el tope por fuente
//   (no de nivel 3): el tope por fuente reparte el canal, no deja huecos.
export function composeChannel(stories, { cap = 80, limitFor: perPeriod = () => 25, tier3Share = 0.2, now = Date.now(), threshold = 0, neutral = 50, primary = () => false, perTopic = Infinity, topics = () => [], reserve = () => false, reserveShare = 0, refill = false } = {}) {
  const kept = stories.filter(story => { const score = editorialScore(story); return score == null || score >= threshold || primary(story); });
  const ranked = kept.some(story => editorialScore(story) != null);
  const expected = expectedScore(stories, neutral);
  const value = story => editorialScore(story) ?? expected(story);
  const importance = (a, b) => value(b) - value(a) || byDateDesc(a, b);
  const merit = (a, b) => (a.tier ?? 9) - (b.tier ?? 9) || quality(b) - quality(a) || byDateDesc(a, b);
  const pick = ranked ? (list, count) => [...list].sort(importance).slice(0, Math.max(0, count)) : spaced;
  const pool = Number.isFinite(perTopic) ? capTopics(kept, { now, perTopic, topics, order: ranked ? importance : merit, exempt: story => story.kind === 'official' || primary(story) }) : kept;
  const bySource = new Map();
  for (const story of pool) bySource.set(story.sourceId, [...(bySource.get(story.sourceId) || []), story]);
  const capped = [...bySource.values()].flatMap(list => byPeriod(list, now).flatMap(bucket => pick(bucket, perPeriod(list[0]))));
  const candidates = capped.filter(story => story.tier !== 3 && reserve(story));
  const reserved = spread(candidates, Math.min(candidates.length, Math.floor(cap * reserveShare)), now, pick);
  const taken = new Set(reserved);
  const rest = capped.filter(story => !taken.has(story));
  const tier3 = rest.filter(story => story.tier === 3), others = rest.filter(story => story.tier !== 3);
  let allowed = Math.min(tier3.length, Math.floor(cap * tier3Share));
  const main = Math.min(others.length, cap - reserved.length - allowed);
  allowed = Math.min(allowed, Math.floor((reserved.length + main) * tier3Share / (1 - tier3Share) + 1e-9));
  const result = [...reserved, ...spread(others, main, now, pick), ...spread(tier3, allowed, now, pick)];
  if (refill && result.length < cap) {
    const chosen = new Set(result);
    result.push(...spread(pool.filter(story => story.tier !== 3 && !chosen.has(story)), cap - result.length, now, pick));
  }
  return ranked ? result.sort((a, b) => periodIndex(a, now) - periodIndex(b, now) || importance(a, b)) : result.sort(byDateDesc);
}
// Serie de una publicación periódica: el titular sin la fecha ni el número («Boletín Monetario Semanal. 13 de Noviembre 2026»
// y «Boletín Monetario Semanal. 6 de Noviembre 2026» son la misma serie; «Boletín de Reservas Internacionales. Octubre 2026»,
// otra).
const SERIES_CUT = new RegExp(String.raw`[.:;(]|\s\S*\d|\s(?:de\s)?(?:${Object.keys(months).join('|')})(?![a-z])`);
export function editionSeries(title) {
  const folded = foldText(title).trim();
  const cut = folded.search(SERIES_CUT);
  return (cut > 0 ? folded.slice(0, cut) : folded).trim();
}
// Tope por edición (`perEdition` de la fuente, por ejemplo los boletines de datos del BCE): solo las N más recientes de
// cada serie de esa fuente (editionSeries) en toda la edición, puntúen lo que puntúen.
export function capPerEdition(stories, perEdition = () => undefined) {
  const counts = new Map();
  return [...stories].sort(byDateDesc).filter(story => {
    const max = perEdition(story);
    if (!Number.isInteger(max)) return true;
    const key = `${story.sourceId}\u0000${editionSeries(story.title)}`;
    const count = counts.get(key) || 0;
    counts.set(key, count + 1);
    return count < max;
  });
}
// Con juicio editorial la edición va canal por canal, cada uno en su orden de importancia (site/app.js lo respeta); sin
// juicio, toda la edición va por fecha, como antes. Con `perTopic`, los temas salen de los nombres propios de los titulares de
// toda la edición (coverageSignatures).
export function composeEdition(stories, options = {}) {
  const pool = options.perEdition ? capPerEdition(stories, options.perEdition) : stories;
  const signatures = Number.isFinite(options.perTopic) ? coverageSignatures(pool) : null;
  const topics = signatures ? story => [...(signatures.get(story)?.entities || [])] : options.topics;
  const byChannel = new Map();
  for (const story of pool) byChannel.set(story.category, [...(byChannel.get(story.category) || []), story]);
  const composed = [...byChannel.values()].flatMap(list => composeChannel(list, { ...options, ...(topics ? { topics } : {}) }));
  return composed.some(story => editorialScore(story) != null) ? composed : composed.sort(byDateDesc);
}

// ---------------------------------------------------------------------------------------------------------
// Un hecho, una nota. Cada titular se reduce a una firma (coverageSignature):
// - entidades: nombres propios en grupos de palabras seguidas («Hong Kong» o «World Bank Group» cuentan como uno). Un nombre es
//   una palabra con mayúscula en mitad de la frase, una sigla o una palabra con mayúscula interior (BBVA, JPMorgan). Al principio
//   de la frase y en titulares con todas las palabras en mayúscula («Federal Reserve Board Announces…», «GOBIERNO DE…») solo
//   cuenta si otro titular de la misma tanda la escribe con mayúscula en mitad de la frase (`lexicon`).
// - importes: cifras con moneda o unidad, en millones y redondeadas a dos cifras («US$6.300 millones» = «$6.3 bln»).
// - palabras: las del titular sin palabras vacías ni términos genéricos del sector, sin el plural.
// Palabras con mayúscula que no identifican a nadie: países, gentilicios, meses, rótulos de sección y términos genéricos.
const COVERAGE_STOP = new Set(`fintech paytech insurtech neobanco banco bank central capital ventures serie series ronda startup latam latin america américa latina latinoamérica ecuador colombia colombian colombiana colombiano méxico mexico mexican mexicana mexicano argentina argentine argentino brasil brazil brazilian brasileña brasileño perú peru peruvian peruana chile chilean chilena chileno uruguay paraguay bolivia venezuela panamá estados unidos eeuu usd nuevo nueva the and for una uno los las del para con por how why what estas este esta así qué cómo auge ceo cfo
  ${Object.keys(months).join(' ')} january february march april may june july august september october november december lunes martes miércoles jueves viernes sábado domingo
  reg wrap buenas fuentes breakingviews commentary exclusive exclusiva update opinión opinion análisis analysis entrevista podcast newsletter gobierno ministerio group grupo sistema financiero financiera nacional banca bancos banks`.split(/\s+/).filter(Boolean).map(word => foldText(word)));
// Términos de los títulos de las normas que llevan mayúscula pero no son un nombre: sí cuentan como palabra del hecho.
const NAME_STOP = new Set('junta superintendencia superintendente norma normas resolución resoluciones codificación reglamento metodología'.split(' ').map(word => foldText(word)));
// Palabras que no distinguen un hecho de otro (ya sin tildes): vacías en español e inglés, cifras dichas con letras y el
// vocabulario común de todos los canales.
const WORD_STOP = new Set(`para como sobre entre desde hasta tras ante tiene tienen esta este estos estas esto pero porque cuando donde sera seran puede pueden podra podria hace hacen mucho muchos todo todos toda todas otro otra otros otras nuevo nueva nuevos nuevas cual cuales segun tambien ahora solo mientras durante contra hacia bajo cada mismo misma dice dicen millon millones miles dolar dolares euros pesos reales anos semana semanas meses
  with from into after over under about than that this these those their there have will would could should says said amid what when where which while more most first last just only also year years week weeks month months million millions billion billions dollar dollars
  banco bancos banca bank banks banking bancario bancaria fintech fintechs crypto cripto criptomoneda criptomonedas criptoactivo criptoactivos financiero financiera financieros financieras financial finance finanzas sistema system mercado mercados market markets empresa empresas company companies sector industria industry`.split(/\s+/).filter(Boolean));
const COVERAGE_WORD = /\p{L}[\p{L}\p{N}]*/gu;
const SENTENCE_START = /(?:^|[:.?!¿¡«“"'‘([|—–-])$/u;
const AMOUNT = /(US\$|USD|R\$|€|£|\$)?\s?(\d[\d.,]{0,14})\s?(mil millones|millones|mill[oó]n|million|billion|bln|bn|mn|mm|mdp|m|b)?(?![\p{L}\p{N}])(\s?(?:de\s)?(?:d[oó]lares|euros|pesos|reales))?/giu;
const AMOUNT_WORDS = /^(mil millones|millones|mill[oó]n|million|billion|bln|bn|mn|mdp)$/i;
// Sinónimos que los medios alternan para la misma norma («nuevas reglas», «la norma que regula»).
const WORD_SYNONYMS = { regla: 'norma', regula: 'norma', normativa: 'norma', reglamento: 'norma' };
const stemWord = word => word.length > 5 && /[rlndz]es$/.test(word) ? word.slice(0, -2) : word.length > 4 && /[^s]s$/.test(word) ? word.slice(0, -1) : word;
// Códigos de norma («SEPS-IGT-IGJ-2026-0160», «JPRFM-2026-048-T»): no son nombres ni palabras del titular.
const maskCodes = title => String(title).replace(/\S+/g, chunk => chunk.includes('-') && /\d/.test(chunk) && /^[A-Z0-9-]+[.,:;]?$/.test(chunk) ? ' '.repeat(chunk.length) : chunk);
function titleWords(title) {
  const shouting = isUpper(title);
  const words = [...maskCodes(title).matchAll(COVERAGE_WORD)].map(match => ({ text: match[0], index: match.index, end: match.index + match[0].length }));
  const later = words.slice(1).filter(word => word.text.length >= 4);
  const titleCase = later.length >= 3 && later.filter(word => /^\p{Lu}/u.test(word.text)).length / later.length >= 0.6;
  for (const word of words) {
    word.folded = foldText(word.text);
    word.capital = /^\p{Lu}/u.test(word.text);
    word.start = SENTENCE_START.test(title.slice(0, word.index).trimEnd());
    word.strong = !shouting && word.text.length >= 3 && /\p{Lu}/u.test(word.text.slice(1));
    word.midSentence = !shouting && !titleCase && word.capital && !word.start && word.text.length >= 3;
    word.styled = shouting || titleCase;
  }
  return words;
}
// Nombres propios de una tanda de titulares: los que alguno escribe con mayúscula en mitad de la frase, y los que salen con
// mayúscula (al principio de la frase) en dos titulares o más y nunca en minúscula («Nubank aumenta…», «Nubank suspende…»).
export function coverageLexicon(titles) {
  const lexicon = new Set(); const capital = new Map(); const lower = new Set();
  for (const title of titles) {
    for (const word of titleWords(title)) {
      if (word.midSentence) lexicon.add(word.folded);
      if (!word.capital) lower.add(word.folded);
      else if (!word.styled && word.text.length >= 3) capital.set(word.folded, (capital.get(word.folded) || 0) + 1);
    }
  }
  for (const [word, count] of capital) if (count >= 2 && !lower.has(word)) lexicon.add(word);
  return lexicon;
}
function amountsOf(title) {
  const amounts = new Set();
  for (const match of String(title).matchAll(AMOUNT)) {
    const [, currency, digits, unit = '', named] = match;
    if (!currency && !named && !AMOUNT_WORDS.test(unit)) continue;
    const raw = digits.replace(/[.,]+$/, '');
    const value = /^\d{1,3}(?:[.,]\d\d\d){1,4}$/.test(raw) ? Number(raw.replace(/[.,]/g, '')) : Number(raw.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) continue;
    const millions = /^(mil millones|billion|bln|bn|b)$/i.test(unit) ? value * 1000 : unit ? value : value / 1e6;
    amounts.add(`${Number(millions.toPrecision(2))}m`);
  }
  return amounts;
}
export function coverageSignature(title, lexicon = new Set()) {
  const words = titleWords(title); const shouting = isUpper(title);
  // Un nombre de varias palabras sigue con espacios o con un enlace corto («Economía Popular y Solidaria», «Banco de Chile»):
  // `link` es el enlace pendiente entre dos palabras con mayúscula.
  const runs = []; let run = null, previous = null, link = false;
  for (const word of words) {
    const name = word.text.length >= 3 && (word.strong || word.midSentence || ((word.capital || shouting) && lexicon.has(word.folded)));
    if (!name) {
      const connects = run && !link && /^(de|del|y|e|of|and)$/i.test(word.text) && /^\s+$/.test(title.slice(previous.end, word.index));
      if (connects) { link = true; previous = word; } else { run = null; link = false; }
      continue;
    }
    const joined = run && /^\s+$/.test(title.slice(previous.end, word.index));
    if (!joined) { run = []; runs.push(run); }
    if (!COVERAGE_STOP.has(word.folded) && !NAME_STOP.has(word.folded)) run.push(word.folded);
    previous = word; link = false;
  }
  const entityRuns = runs.filter(list => list.length);
  const tokens = new Set();
  for (const word of words) if (word.folded.length >= 4 && !/\d/.test(word.folded) && !WORD_STOP.has(word.folded) && !COVERAGE_STOP.has(word.folded)) { const stem = stemWord(word.folded); tokens.add(WORD_SYNONYMS[stem] ?? stem); }
  return { runs: entityRuns, entities: new Set(entityRuns.flat()), amounts: amountsOf(title), tokens };
}
// Firmas de una tanda de notas, con el léxico de nombres propios sacado de la misma tanda.
export function coverageSignatures(stories) {
  const lexicon = coverageLexicon(stories.map(story => story.title));
  return new Map(stories.map(story => [story, coverageSignature(story.title, lexicon)]));
}
// Dos notas cuentan el mismo hecho si salen con menos de cuatro días de diferencia y:
// (a) comparten un importe y una entidad, o dos entidades, y además una palabra que no sea nombre, o salen con menos de dos
//     días entre sí («Nexu secures $55M credit line from BBVA Spark» y «Fintech Nexu obtiene una línea de crédito de US$55M»);
// (b) comparten tres palabras que sean al menos la mitad de las del titular más corto, con una entidad en común, con cuatro
//     palabras o con todas las del titular más corto («Las nuevas reglas para los pagos con tarjetas en Ecuador» y «La JPRFM
//     establece nuevas reglas para los pagos con tarjetas»).
// Dos notas distintas sobre Binance («North Korea behind Binance theft», «North Korean hackers… launder Binance billions») o
// sobre Hong Kong no se unen.
const COVERAGE_WINDOW = 4 * DAY;
const CLOSE_WINDOW = 2 * DAY;
const sharedRuns = (a, b) => Math.max(a.runs.filter(run => run.some(word => b.entities.has(word))).length, b.runs.filter(run => run.some(word => a.entities.has(word))).length);
export function sameFact(a, b, { window = COVERAGE_WINDOW } = {}) {
  const gap = Math.abs(a.time - b.time);
  if (gap > window) return false;
  const runs = sharedRuns(a.signature, b.signature);
  const shared = [...a.signature.tokens].filter(token => b.signature.tokens.has(token));
  const plain = shared.some(token => !a.signature.entities.has(token) && !b.signature.entities.has(token));
  const amount = [...a.signature.amounts].some(value => b.signature.amounts.has(value));
  if ((runs >= 2 || (runs >= 1 && amount)) && (plain || gap <= CLOSE_WINDOW)) return true;
  const words = shared.length, shorter = Math.min(a.signature.tokens.size, b.signature.tokens.size);
  return words >= 3 && words * 2 >= shorter && (runs >= 1 || words >= 4 || words === shorter);
}
// Medios que también contaron el hecho (`coverage`): nombres de texto plano, sin el de la nota que queda, sin repetir, hasta 8.
const COVERAGE_MAX = 8;
function withCoverage(best, group) {
  const own = String(best.source || '').trim().toLowerCase(); const names = [];
  for (const story of [best, ...group.filter(story => story !== best)]) {
    for (const name of [story.source, ...(Array.isArray(story.coverage) ? story.coverage : [])]) {
      const clean = typeof name === 'string' ? name.trim() : '';
      if (!clean || clean.length > 80 || /[<>\u0000-\u001f]/.test(clean) || clean.toLowerCase() === own || names.some(other => other.toLowerCase() === clean.toLowerCase())) continue;
      names.push(clean);
    }
  }
  const { coverage: _old, ...rest } = best;
  return names.length ? { ...rest, coverage: names.slice(0, COVERAGE_MAX) } : rest;
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
    if (group.length === 1) return group[0];
    const best = group.reduce((a, b) => quality(b) > quality(a) || (quality(b) === quality(a) && channelRank(b.category) < channelRank(a.category)) ? b : a);
    const category = group.reduce((current, story) => channelRank(story.category) < channelRank(current) ? story.category : current, best.category);
    const merged = withCoverage(best, group);
    return category === merged.category ? merged : { ...merged, category };
  });
}
// La nota que representa a un hecho: documento primario oficial, mejor nivel de fuente, con extracto, enlace directo, más
// puntos y más reciente (el mismo orden que groupClusters en editorial.mjs).
const scoreOf = story => Number.isFinite(story?.editorial?.score) ? story.editorial.score : -1;
function bestCopy(group, primary) {
  const key = story => [primary(story) ? 0 : 1, story.tier ?? 9, story.excerpt ? 0 : 1, story.via ? 1 : 0, -scoreOf(story), -Date.parse(story.publishedAt)];
  return [...group].sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; })[0];
}
// Una nota aparece en un solo canal (ver oneCopy). Además, en todos los canales y entre canales, las notas de medios distintos
// sobre el mismo hecho (sameFact con cualquiera de las notas ya reunidas) quedan en una: la de bestCopy, en su propio canal, con
// los demás medios en `coverage`. Un grupo no reúne dos notas del mismo medio ni dos documentos primarios oficiales (`primary`).
export function deduplicate(stories, { primary = () => false, window = COVERAGE_WINDOW } = {}) {
  const copies = oneCopy(stories).sort(byDateDesc);
  const signatures = coverageSignatures(copies);
  const groups = [];
  for (const story of copies) {
    const entry = { story, signature: signatures.get(story), time: Date.parse(story.publishedAt), medium: String(story.source || '').trim().toLowerCase() };
    const fits = group => !group.some(other => other.medium === entry.medium) && !(primary(story) && group.some(other => primary(other.story)))
      && group.some(other => sameFact(entry, other, { window }));
    const group = groups.find(fits);
    if (group) group.push(entry); else groups.push([entry]);
  }
  return groups.map(group => {
    if (group.length === 1) return group[0].story;
    const members = group.map(entry => entry.story);
    return withCoverage(bestCopy(members, primary), members);
  });
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
  'Limonada', 'Loft', 'Mendel', 'Mensajeros Urbanos', 'Meru', 'Migrante', 'Minka', 'Moises', 'Mural', 'Neon', 'Nomad',
  'Pier', 'Poke', 'Pomelo', 'Prática', 'Prex', 'Prey', 'Principia', 'Prometeo', 'Proteus', 'Quero', 'Quinoa', 'Refinancia', 'Reservamos',
  'Reuse', 'Ripio', 'Runa', 'Runway', 'Sami', 'Sentinel', 'Shiva', 'Spira', 'Swap', 'Tala', 'Tangelo', 'Thais', 'Triciclos', 'Unico',
  'Ver de Verdad', 'VERTICAL', 'Will bank', 'Will Bank', 'Yema', 'Yerra', 'Zapping',
]);
// Nombres que no se etiquetan nunca: demasiado genéricos o compartidos con otras marcas conocidas aun con contexto.
// ISA y ENA (salud, Brasil y Argentina) comparten sigla con empresas de energía e infraestructura que salen más en prensa;
// Infocorp (software bancario, Uruguay) se llama igual que la central de riesgo de Perú.
export const ENDEAVOR_EXCLUDED = new Set(['Arizona', 'Comp', 'CORE', 'Dominion', 'Don’t Worry', 'ENA', 'GENESYS', 'Grupo Gastronómico', 'Infocorp', 'Insider', 'Involves', 'ISA', 'Prima', 'Take', 'Torre']);
// Otras grafías del nombre de una empresa del directorio (clave: slug). No añade empresas.
export const ENDEAVOR_ALIASES = { addi: ['Addi'], 'mercadolibre-com': ['MercadoLibre', 'Mercado Libre', 'Mercado Pago'], 'will-bank': ['Will Bank'] };
// Nombres hechos de palabras comunes que solo cuentan escritos como en la lista, con cada palabra en mayúscula («Un Estado
// fuerte para un mercado libre» no es la empresa; «Mercado Pago lanza…» sí). En titular o extracto y sin exigir contexto:
// con las dos mayúsculas no se confunden con nada («Mercado Bitcoin sufre ataque de hacker…» es la empresa).
export const ENDEAVOR_CASED = new Set(['Mercado Libre', 'Mercado Pago', 'Mercado Bitcoin']);
// Ruido bursátil y de portales de inversión en la búsqueda (precio objetivo, calificaciones de analistas, volumen,
// transcripciones de resultados, saltos de precio de tokens, caídas en Wall Street): como en Cripto, no entran notas de cotización.
export const ENDEAVOR_MARKET_NOISE = rx(String.raw`\((NASDAQ|NYSE|BSP|BVMF|BMV|B3):|\((DLO|MELI|NU|STNE|PAGS|VTEX|XP)\)|\bstock\b|price target|precio objetivo|\bshares (are|fall|rise|drop|jump|slide)|large volume|time to buy|earnings call|\bupside\b|\bdownside\b|undervalued|overvalued|bargain|\brating\b|\bBPA\b|\bEPS\b|la acci[oó]n de|acciones (de|del)\b|\bprice (jumps|drops|falls|rises|surges)|\brall(y|ies)\b|outperforms|\| News$|Wall Street|acciones (pierden|caen|suben|se desploman)|\b(cay[oó]|cae|sube|subi[oó]|se desploma) (casi |m[aá]s de )?\d+(,\d+)? ?%|suba la acci[oó]n`);
// Titulares promocionales sobre una empresa de la red (cupones, «0% de inicial», sorteos, «por tiempo limitado», premios a
// usuarios, regalos, «descuentos de hasta…», «rentabilidad garantizada… para tu CTS»): son anuncios de consumo, no noticias. Lista editable; cada caso nuevo, con su prueba en tests/content.test.mjs.
export const ENDEAVOR_PROMO = rx(String.raw`cup[oó]n(es)?\b|\bcoupons?\b|c[oó]digos? (de descuento|promocional)|promo ?codes?|\b0 ?% (de )?inicial|inicial de 0 ?%|sin (cuota )?inicial|\bsorteos?\b|\bsortea|giveaways?|por tiempo limitado|limited[- ]time|hasta agotar|premi(a|an|ar[aá]n?) a (sus |los )?(usuari|client)|premios? (a|para) (sus |los )?(usuari|client)|\bregal(a|an|ar[aá]n?)(?![a-záéíóúñ])|descuentos? de hasta \d|qu[eé] ofertas|rentabilidad garantizada|para tu (CTS|aguinaldo|quincena)|programa de referidos`);

// Medios aceptados en el canal Endeavor LATAM (allowHosts de la fuente `endeavor-prensa`, ver collect.mjs). Las notas llegan
// por Google News y se comprueba el dominio del medio real (`sourceUrl`); vale el dominio y sus subdominios.
// Criterio: prensa con redacción propia, de referencia o especializada. Quedan fuera las agencias de comunicados (GlobeNewswire,
// PR Newswire, Business Wire), los blogs de empresas y de exchanges (Binance Square), los agregadores, las webs de promociones
// y las páginas de cotizaciones (TradingView, Investing.com, Pluang). Un medio que no está en la lista no entra: para sumar uno,
// añade su dominio en el grupo que corresponda y un caso en las pruebas.
export const ENDEAVOR_PRESS_HOSTS = [
  // Medios que el proyecto ya usa como fuentes de nivel 1 y 2 (las pruebas comprueban que estén todos).
  'primicias.ec', 'eluniverso.com', 'forbes.com.ec', 'bloomberglinea.com', 'iupana.com', 'eleconomista.com.mx', 'larepublica.co',
  'latamlist.com', 'expansion.mx', 'df.cl', 'paymentsdive.com', 'bankingdive.com', 'expansion.com', 'ft.com',
  'finextra.com', 'thebanker.com', 'americanbanker.com', 'pymnts.com', 'wsj.com', 'elpais.com', 'reuters.com', 'theblock.co',
  'coindesk.com', 'criptonoticias.com', 'decrypt.co', 'thepaypers.com', 'fintechfutures.com', 'latamfintech.co', 'iproup.com',
  // Referencia internacional y agencias de noticias (no de comunicados).
  'bloomberg.com', 'economist.com', 'forbes.com', 'cnbc.com', 'techcrunch.com', 'restofworld.org', 'efe.com', 'americaeconomia.com', 'bnamericas.com',
  // Argentina.
  'cronista.com', 'forbesargentina.com', 'lanacion.com.ar', 'clarin.com', 'infobae.com', 'ambito.com', 'iprofesional.com', 'perfil.com', 'eleconomista.com.ar',
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
  'expreso.ec', 'elcomercio.com', 'vistazo.com', 'teleamazonas.com', 'lahora.com.ec',
  // Venezuela.
  'eluniversal.com', 'elnacional.com', 'eldiario.com', 'bancaynegocios.com',
  // Brasil.
  'valor.globo.com', 'oglobo.globo.com', 'folha.uol.com.br', 'estadao.com.br', 'exame.com', 'infomoney.com.br', 'neofeed.com.br', 'braziljournal.com',
  // Especializada: fintech, pagos, cripto, tecnología, capital de riesgo y derecho.
  'contxto.com', 'dplnews.com', 'cointelegraph.com', 'diariobitcoin.com', 'news.crunchbase.com', 'dealroom.co', 'lexology.com',
  // Prensa fintech, de tecnología y de negocios con redacción propia que cubre a la red (revisión de noviembre de 2026):
  // Fintech Expert (México), Xataka México, Mobile Time LATAM, LexLatin (derecho de negocios), Enter.co (Colombia),
  // ITSitio y Mexico Business News.
  'fintechexpert.mx', 'xataka.com.mx', 'mobiletime.la', 'lexlatin.com', 'enter.co', 'itsitio.com', 'mexicobusiness.news',
];
// Nombramientos y equipo directivo (español, inglés y portugués): cargos (CEO, CFO, «Chief … Officer», director financiero,
// gerente general, country manager) y verbos de nombramiento con su complemento («ficha a», «incorpora a»; no «incorporar
// esta fruta»). «named» y «names» sueltos no cuentan («a cat named Pomelo»), ni «head of» («Head of State visits Tala»). «Pomelo nombró a … como nuevo Chief Financial
// Officer» y «Pomelo refuerza su equipo directivo con la incorporación de…» son notas de empresa.
// Altas y salidas solo con su complemento de cargo o de equipo: «se suma al equipo de», «se suma a Klar como», «elige a su
// nuevo CEO», «asciende a directora», «renuncia a su cargo», «deja el cargo», cofundador, vicepresidente. Sueltos («Clara se
// suma a la protesta», «renuncia a la final») no cuentan.
const ENDEAVOR_APPOINTMENTS = String.raw`\b(ceo|cfo|coo|cto|cmo|cio|cpo|cro)\b|\bchief [a-z]+( [a-z]+)? officer\b|country manager|general manager|managing director|gerente (general|de pa[ií]s)|\bdirec?tora? (financ|general|geral|ejecutiv|executiv|de (finanzas|operaciones|tecnolog))|\bdirectiv[oa]s?\b|equipo de liderazgo|leadership team|alta (direcci[oó]n|gerencia)|\bc-?(suite|level)\b|\bnombr(a|ó)|\bdesign(a|ó)|\bfich(aje|ó|a al?\b)|\bincorpor(aci|ó|a al?\b)|\bcontrat(a|ó|ou)|\bnome(ia|ou|ad[oa]|a[cç][aã]o)\b|\bappoint|\bnames (new|its|former|ex)\b|\bhir(es|ed|ing)\b|\basum(e|ió) (como|el cargo|la (direcci|presidencia|gerencia))|\bassume (o cargo|como)|\b(se )?suma (a|al) (su |el |la )?(equipo|directorio|board|junta|comit[eé])|\bse suma a \S+ como\b|\belige a (su |un |una )?(nuev[oa] )?(ceo|cfo|coo|cto|director|directora|presidente|presidenta|gerente)|\bascend(i[oó]|e|ido) a (director|directora|gerente|jef[ea]|vicepresident|presidente|presidenta|socio|socia|ceo|cfo|coo|cto)|\brenunci(a|ó) (a su cargo|al cargo|como)|\bdej(a|ó) (el|su) cargo|\bdej(a|ó) la (direcci[oó]n|presidencia|gerencia)|\bcofundador(a|es)?\b|\bco-?founders?\b|\bvicepresident[ea]s?\b`;
// Contexto que exige un nombre ambiguo: vocabulario de empresa, inversión, finanzas o nombramientos en el titular o el extracto.
// No incluye importes sueltos («5 millones de toneladas de cobre» no es una ronda).
export const ENDEAVOR_CONTEXT = rx(String.raw`fintech|startups?\b|unicorn|scale-?ups?|emprendim|emprendedor|levanta|recauda|\binvert|\binvierte|\braises?\b|\braised\b|ronda|\bround\b|series? [a-e]\b|financia(ci[oó]n|miento|r)|funding|inversi[oó]n|inversionistas|investors?|\binvests?\b|adquiere|adquisici[oó]n|acquir|fusi[oó]n|merger|valuaci[oó]n|valoraci[oó]n|valuation|\bipo\b|salida a bolsa|neobanc|banco digital|billetera|wallet|\bpagos?\b|recargas|payments?|tarjetas?|cr[eé]dito|\bcredit\b|lending|pr[eé]stamos?|licencia|license|expan|\blanza\b|launch|alianza|al[ií]an?\b|partner|plataforma|platform|clientes|customers|usuarios|\busers\b|ingresos|revenue|seguros?\b|insurtech|software|\bapp\b|hacke[or]|\bhacks?\b|ciberataque|gastos? corporativ|viajes corporativos|tarjetas? corporativ|cuentas? en d[oó]lares`, ENDEAVOR_APPOINTMENTS);
// Titulares en los que un nombre ambiguo es otra cosa: minería y materias primas («Cobre en Perú…», «Cobre se desploma 5%…»,
// metal rojo, LME, onzas), cargos políticos, frutas y
// nutrición («Pomelo: el cítrico que…», también Tangelo, Limonada, Quinoa).
export const ENDEAVOR_NOISE = rx(String.raw`miner[ií]a|\bminer[oa]s?\b|\bmina\b|perforaci|toneladas|yacimiento|commodit|metales|\bmining\b|copper|se desploma|metal rojo|\bLME\b|\bonzas?\b|libra de cobre|alcald|jef[ae] de gobierno|candidat|diputad|senador|\bfrutas?\b|\bfruits?\b|c[ií]tric|citrus|grapefruit|toronja|vitamina|nutrici[oó]n|nutrition|\bdieta?\b`);

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
      if (ENDEAVOR_CASED.has(name)) { entries.push({ name, display: names[0], company, ambiguous: false, cased: true, pattern: bounded(escapeRx(name)) }); continue; }
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
//   en minúscula de cuatro letras o más («La fintech Bold…») o tras una preposición española («nuevo CFO de Pomelo», «alianza
//   con Klar»; no «a», que el inglés escribe en minúscula), que en mayúscula de título no existirían.
// - tras Santa, San, Santo o Puerto: es un lugar («Santa Clara contratará…»).
// Las comillas no separan al vecino («el ‘Tala’ Rangel» es una persona), y las palabras de producto no cuentan como vecino
// («Klar Empresarial colocó…», «Clip Pay»).
const PLACE_BEFORE = /(?:^|[^\p{L}])(Santa|San|Santo|Puerto)\s+$/u;
const PRODUCT_AFTER = /^\s+(Empresarial|Empresas|Business|Pay|Card|Bank|Cash|Wallet|Pro|Plus)(?![\p{L}\p{N}])/u;
function notACompany(title, match) {
  const after = title.slice(match.index + match[0].length).replace(/^[’'"»”]+/u, '');
  const before = title.slice(0, match.index).replace(/[‘'"«“]+$/u, '');
  if (PLACE_BEFORE.test(before)) return true;
  if (sentenceCased(title, match)) return (/^\s+\p{Lu}\p{Ll}/u.test(after) && !PRODUCT_AFTER.test(after)) || /\S\s+\p{Lu}\p{Ll}+\s+$/u.test(before);
  return !(/^\s*$/.test(before) || /['’]s\s+$|[:|–—-]\s+$|(?<![\p{L}\p{N}])(\p{Ll}{4,}|de|del|al|con|en|por|y)\s+$/u.test(before) || /^,/.test(after));
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
      if (entry.cased) { if (entry.pattern.test(field ? excerpt : title)) return endeavorTag(entry); continue; }
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

// Búsqueda dedicada (canal Endeavor LATAM): Google News por lotes de nombres unidos con OR. Se buscan las fintech de la red,
// las empresas con oficina en Ecuador y las de `slugs`. Cada ejecución consulta una parte de los lotes y la siguiente sigue
// donde quedó (`rotation`); la acumulación de 30 días hace que el canal se llene con el tiempo.
// Medido en Google News el 19 de noviembre de 2026:
// - Cada nombre va como `intitle:"…"`: el filtro de endeavor-prensa solo acepta titulares que nombran a la empresa, así que
//   pedirlo en el titular no pierde nada y deja fuera las notas que solo la citan en el cuerpo.
// - Con más de 9 `intitle:` Google ignora `when:30d` y devuelve notas de años (14 nombres: 45 de 45 con más de 30 días).
// - Un lote de 9 nombres devuelve menos notas de cada uno que la consulta suelta (Pomelo: 4 de 19), pero con lotes más chicos
//   la vuelta completa no cabe en un día.
// - Los ambiguos con ruido (Clara, Cobre, Tala, Clip, R2…) sin calificador llenan los 100 resultados con la alcaldesa, el metal
//   y Santa Clara (1 nota válida); con «fintech», 29 resultados y 13 válidas. Los de `quiet` casi no tienen ruido en el titular
//   y van sin calificador, con los no ambiguos (lote de Pomelo, Klar, ADDI… : 72 resultados, 13 válidas).
// - Un calificador con OR («(fintech OR pagos OR CEO)») también hace que Google ignore `when:30d`.
export const ENDEAVOR_SEARCH = {
  verticals: ['fintech'],
  offices: ['ecuador'],
  // Empresas de otros sectores con negocio de pagos, crédito o comercio digital (Mercado Pago, RappiPay, el crédito de Kavak).
  slugs: ['mercadolibre-com', 'rappi', 'kavak', 'vtex', 'nuvemshop', 'simetrik'],
  // Empresas con lotes propios y términos propios: Mercado Libre sola llena los 100 resultados, y Mercado Pago iría detrás.
  solo: { 'mercadolibre-com': [['Mercado Libre', 'MercadoLibre'], ['Mercado Pago']] },
  // Nombres ambiguos con poco ruido en los titulares: sin calificador.
  quiet: ['addi', 'belvo', 'brex', 'cloudwalk', 'crezcamos', 'klar', 'leasy', 'link-mobile', 'mendel', 'mercado-bitcoin', 'minka', 'pismo', 'pomelo', 'prex', 'prometeo', 'refinancia', 'ripio', 'tangelo', 'will-bank', 'yuno'],
  maxTerms: 9,
  // Ejecuciones reales por día (el cron horario corre 3 o 4 veces): cada ejecución consulta lotes / runsPerDay, así que la
  // vuelta completa cabe en un día.
  runsPerDay: 3,
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
    if (!config.verticals.includes(company.vertical) && !company.offices.some(office => config.offices.includes(office)) && !config.slugs?.includes(company.slug)) return false;
    seen.add(name.toLowerCase());
    return true;
  });
}
// Término de búsqueda: el nombre (el primero del directorio, salvo que se indique otro) en el titular.
export function searchTerm(company, name = endeavorNames(company)[0]) {
  return `intitle:"${name.replace(/"/g, '')}"`;
}
// Calificador del lote: los nombres ambiguos con ruido van en lotes propios que añaden su sector a toda la consulta
// («(intitle:"Clara" OR intitle:"Cobre") fintech»). Google no interpreta bien grupos anidados dentro de un OR, así que no se
// mezclan. Los de `quiet` no llevan calificador.
export function searchQualifier(company, config = ENDEAVOR_SEARCH) {
  if (!endeavorAmbiguous(endeavorNames(company)[0]) || config.quiet?.includes(company.slug)) return '';
  return company.vertical === 'fintech' ? 'fintech' : 'startup';
}
// Ediciones de Google News de una empresa: las que solo entran por su oficina en Ecuador se buscan en español.
function searchLanguages(company, config) {
  const regional = !config.verticals.includes(company.vertical) && !config.slugs?.includes(company.slug);
  return regional ? ['es'] : config.editions.map(edition => edition.language);
}
// Agrupa las empresas en lotes { terms, qualifier, languages } de hasta `maxTerms` nombres, por calificador y ediciones.
// Las de `solo` van en sus propios lotes, uno por grupo de términos.
export function searchBatches(companies, config = ENDEAVOR_SEARCH) {
  const groups = new Map(); const solo = [];
  for (const company of companies) {
    const languages = searchLanguages(company, config);
    if (config.solo?.[company.slug]) { for (const names of config.solo[company.slug]) solo.push({ terms: names.map(name => searchTerm(company, name)), qualifier: '', languages }); continue; }
    const qualifier = searchQualifier(company, config);
    const key = `${qualifier}|${languages.join(',')}`;
    if (!groups.has(key)) groups.set(key, { qualifier, languages, terms: [] });
    groups.get(key).terms.push(searchTerm(company));
  }
  const batches = [];
  for (const { qualifier, languages, terms } of groups.values()) {
    for (let start = 0; start < terms.length; start += config.maxTerms) batches.push({ terms: terms.slice(start, start + config.maxTerms), qualifier, languages });
  }
  return [...batches, ...solo];
}
export function searchQuery({ terms, qualifier }) {
  return `(${terms.join(' OR ')})${qualifier ? ` ${qualifier}` : ''} when:30d`;
}
// Cada lote se consulta en sus ediciones de Google News (español de la región e inglés): lote 1 es, lote 1 en, lote 2 es…
export function searchLots(batches, editions = ENDEAVOR_SEARCH.editions) {
  return batches.flatMap(batch => editions.filter(edition => !batch.languages || batch.languages.includes(edition.language))
    .map(edition => ({ ...batch, language: edition.language, url: `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery(batch))}&${edition.params}` })))
    .map((lot, index) => ({ ...lot, index }));
}
// Lotes por ejecución: la vuelta completa en `runsPerDay` ejecuciones.
export function searchPerRun(lots, runsPerDay = ENDEAVOR_SEARCH.runsPerDay) {
  return Math.ceil(lots.length / runsPerDay);
}
// Rotación: `count` lotes desde `cursor` (con vuelta al inicio) y la posición en la que empezará la ejecución siguiente.
export function rotation(lots, cursor = 0, count = searchPerRun(lots)) {
  if (!lots.length) return { picked: [], next: 0 };
  const start = ((Math.trunc(Number(cursor)) || 0) % lots.length + lots.length) % lots.length;
  const picked = Array.from({ length: Math.min(count, lots.length) }, (_, i) => lots[(start + i) % lots.length]);
  return { picked, next: (start + picked.length) % lots.length };
}
