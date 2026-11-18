import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', trimValues: true });
const months = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
export const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const MAX_EXCERPT = 280;

export function asText(value) {
  if (value == null) return '';
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
export function normalize(raw, source, now = Date.now()) {
  const sourceName = plainText(raw.source || source.name).slice(0, 80);
  let title = plainText(raw.title).slice(0, 300);
  if (raw.via && sourceName) title = title.replace(new RegExp(`\\s+-\\s+${sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '').trim();
  if (sourceName && title.toLowerCase().endsWith(` | ${sourceName.toLowerCase()}`)) title = title.slice(0, -sourceName.length - 3).trim();
  const url = safeUrl(raw.url, source.url);
  const publishedAt = parseDate(raw.publishedAt);
  if (!title || !url || !publishedAt || !recent(publishedAt, now)) return null;
  let excerpt = plainText(raw.excerpt).replace(/(?:^|\s+)The post .+? appeared first on .+\.?$/i, '').trim();
  if (raw.via && excerpt.toLowerCase().startsWith(title.toLowerCase())) excerpt = '';
  excerpt = excerpt.slice(0, MAX_EXCERPT);
  const sourceUrl = safeUrl(raw.sourceUrl || source.url);
  const language = raw.language || (/\b(el|la|los|las|una|para|del|banco|pagos|financiero|ecuador)\b/i.test(`${title} ${excerpt}`) ? 'es' : 'en');
  const canonical = canonicalUrl(url);
  return { id: createHash('sha256').update(`${source.id}:${canonical}`).digest('hex').slice(0, 20), sourceId: source.id, category: source.category, kind: source.kind, title, excerpt, url, source: sourceName, sourceUrl, via: raw.via || '', language, publishedAt };
}
export function parseFeed(xml, source) {
  const data = parser.parse(xml);
  const items = data?.rss?.channel?.item ?? data?.feed?.entry;
  if (items == null) throw new Error('El documento no contiene entradas RSS o Atom');
  return (Array.isArray(items) ? items : [items]).map(item => {
    const isGoogle = source.adapter === 'google';
    const publishedAt = item.pubDate || item.published || item.updated || item['dc:date'];
    const sourceNode = item.source;
    const media = isGoogle ? asText(sourceNode) : source.name;
    const mediaUrl = isGoogle ? sourceNode?.['@_url'] : source.url;
    const url = typeof item.link === 'object' ? (item.link?.['@_href'] || item.link?.['#text']) : item.link;
    return { title: item.title, excerpt: item.description || item.summary || item['content:encoded'] || '', url, publishedAt, source: media, sourceUrl: mediaUrl, via: isGoogle ? 'Vía Google News' : '', language: source.language };
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
const COVERAGE_WINDOW = 4 * 24 * 60 * 60 * 1000;
function sameCoverage(a, b) {
  if (a.story.source === b.story.source || Math.abs(Date.parse(a.story.publishedAt) - Date.parse(b.story.publishedAt)) > COVERAGE_WINDOW) return false;
  const entities = [...a.signature.entities].filter(entity => b.signature.entities.has(entity)).length;
  const amounts = [...a.signature.amounts].filter(amount => b.signature.amounts.has(amount)).length;
  return entities >= 2 || (entities >= 1 && amounts >= 1);
}
// Dentro de un medio se eliminan repeticiones por enlace o titular. En los canales de mergeCoverage, además,
// varias notas de medios distintos sobre la misma operación (misma empresa e importe, o dos nombres propios
// en común, en un margen de cuatro días) se reducen a una: la que trae extracto y enlace directo.
export function deduplicate(stories, mergeCoverage = ['latam']) {
  const seen = new Set(); const kept = [];
  const quality = story => (story.excerpt ? 2 : 0) + (story.via ? 0 : 1);
  for (const story of [...stories].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
    const key = `${story.category}:${canonicalUrl(story.url)}`;
    const titleKey = `${story.category}:${story.source.toLowerCase()}:${story.title.toLowerCase().replace(/\W/g, '')}`;
    if (seen.has(key) || seen.has(titleKey)) continue;
    seen.add(key); seen.add(titleKey);
    const entry = { story, signature: mergeCoverage.includes(story.category) ? coverageSignature(story.title) : null };
    const twin = entry.signature ? kept.findIndex(other => other.signature && other.story.category === story.category && sameCoverage(entry, other)) : -1;
    if (twin === -1) kept.push(entry);
    else if (quality(story) > quality(kept[twin].story)) kept[twin] = entry;
  }
  return kept.map(entry => entry.story);
}
export function relevant(story, source) {
  const text = `${story.title} ${story.excerpt}`.toLowerCase();
  if (source.id === 'bce-publicaciones') return /bolet[ií]n monetario|tasas de inter[eé]s|indicadores monetarios y financieros|reserva internacional|captaciones|colocaciones|volumen de cr[eé]dito/i.test(story.title);
  // Junta: el sufijo del código indica la materia. Quedan fuera las administrativas (-A) y de gobierno interno (-G),
  // los informes que la Junta solo «conoce» y las designaciones.
  if (source.id === 'bce-junta-resoluciones') return !['A', 'G'].includes(story.excerpt.match(/\bJPRFM-\d{4}-\d+-([A-Z]+)\b/)?.[1]) && !/^(conoce|designa|designar|nombra|nombrar)\b/i.test(story.title);
  // BCE administrativas: la mayoría es gestión interna; solo entran las que afectan a pagos, moneda, liquidez o entidades.
  if (source.id === 'bce-resoluciones-admin') return /sistema (nacional|central|auxiliar) de pagos|medios? de pago|transferencias?|mensajer[ií]a|moneda|billetes?|especies monetarias|dep[oó]sitos y retiros|encaje|liquidez|reservas?|\boro\b|tarifas?|corresponsal|recaudaci[oó]n|entidades financieras|sistema financiero|certificaci[oó]n de informaci[oó]n|firma electr[oó]nica|tasas? de inter[eé]s|reforma institucional|dinero electr[oó]nico|compensaci[oó]n|c[aá]mara/i.test(story.title) && !/^(memorando|oficio)\b|\b(designa|delega)|delegaci[oó]n|talento humano|remuneraci|anticipos|bienes muebles|r[eé]gimen laboral|[ií]ndice tem[aá]tico|servidores|contrataci[oó]n|proveedor/i.test(`${story.excerpt} ${story.title}`);
  if (source.id === 'endeavor-ar') return !/\bboard\b|experiencia endeavor|bootcamp|inscrip|convocatoria|bienvenid/i.test(story.title);
  // Fuentes directas de Ecuador.
  if (source.id === 'primicias') return /banc|financ|segur|cooperativ|fintech|cr[eé]ditos?|tasas? de inter[eé]s|tarjetas?|p[oó]lizas?|dep[oó]sitos?|remesas|riesgo pa[ií]s|billetera|transferencias?|medios de pago|superintendencia|banco mundial|\bfmi\b|\bbid\b|deuda|bonos? (soberanos?|de deuda)|pr[eé]stamo|biess|mercado de valores|bolsa de valores/i.test(story.title) && !/black friday|cyberday|calculadora|concurso/i.test(story.title);
  if (source.id === 'banecuador' || source.id === 'cfn') return /cr[eé]ditos?|financiamiento|tasas?|calificaci[oó]n de riesgo|bolet[ií]n econ[oó]mico|producto financiero|cartera|microcr[eé]dito/i.test(story.title) && !/^el gobierno|convocatoria|servicio de|alquiler|contrataci|adquisici|subasta|\biso\b|selecci[oó]n/i.test(story.title);
  if (source.id === 'mef') return /\bfmi\b|deuda|bonos?|presupuest|proforma|multilateral|banco mundial|\bbid\b|\bcaf\b|riesgo pa[ií]s|tribut|recaudaci|calificaci[oó]n|sostenibilidad fiscal/i.test(story.title);
  if (source.id === 'uafe') return /lavado|resoluci[oó]n|norma|sujetos obligados|reporte|gafi|financiamiento del terrorismo|sanci|activos virtuales|cripto/i.test(story.title) && !/registro del manual|desactivaci[oó]n|solicitud de|operativo/i.test(story.title);
  // Medios y organizaciones de la región.
  if (source.id === 'valora-analitik') return /fintech|neobanc|banc|cr[eé]dito|billetera|pagos|sistema financiero|nequi|daviplata|nubank|\baddi\b|bre-b|tarjetas?|\bcdt\b|aseguradora|superfinanciera|dep[oó]sitos de bajo monto|open finance|finanzas abiertas/i.test(story.title) && !/videopodcast|podcast|d[oó]lar hoy|premercado|banco de la rep[uú]blica|banrep|ee\.?\s?uu|estados unidos|wall street/i.test(story.title);
  if (source.id === 'contxto' || source.id === 'colombia-fintech') return /fintech|banc|pagos?|cr[eé]dito|financ|insurtech|seguros|neobanc|billetera|wallet|remesas|stablecoin|open finance|swift|bre-b|fraude|regulaci/i.test(story.title) && !/se une a colombia fintech|marketplace|canjear/i.test(story.title);
  if (source.id === 'lavca') return /fintech|payment|bank|credit|lending|insur|financial|neobank|wallet/i.test(text) && !/submissions|;/i.test(story.title);
  if (source.id === 'felaban') return /informe|estudio|regulaci|banca|bancari|basilea|riesgo|inclusi[oó]n|cr[eé]dito|pagos/i.test(story.title) && !/palabras de|nuevo presidente|bolsas de valores|asamblea anual/i.test(story.title);
  // Pagos: prensa sectorial y bancos centrales.
  if (source.id === 'digitaltransactions') return !/news briefs/i.test(story.title);
  if (source.id === 'epi') return new URL(story.url).pathname.startsWith('/news/');
  if (source.id === 'fed') return /payment|fednow|fedwire|\bach\b|check services|stablecoin|instant|pricing|debit|interchange|regulation ii|digital (asset|dollar)|crypto|tokeni[sz]/i.test(text);
  if (source.id === 'ecb') return /digital euro|payment|\btips\b|target2?|instant|\bcash\b|stablecoin|crypto|tokeni[sz]|\bdlt\b|wero|settlement/i.test(story.title);
  // Cripto: sin precios de mercado ni avisos de seguridad informática general.
  if (source.id === 'theblock') return /^\/news\/(regulation|policy|business|deals)\//.test(new URL(story.url).pathname) && /stablecoin|tokeni[sz]|bank|regulat|\bsec\b|cftc|cbdc|payment|custod|licen[sc]e|\blaw\b|\bbill\b|usdc|usdt|treasury|loans?|\betfs?\b|financial crime|sanction/i.test(story.title);
  if (source.id === 'criptonoticias') return /^\/(regulacion|comunidad\/adopcion|negocios|finanzas)\//.test(new URL(story.url).pathname);
  if (source.id === 'trmlabs') return !/^trm labs (launches|announces|named|joins|partners|expands|introduces|acquires)/i.test(story.title);
  if (source.id === 'regulatory-news') return /superintendencia de bancos|supercias|\bseps\b|junta de pol[ií]tica|banco central|\bbce\b|entidades financieras? no autorizad|cr[eé]ditos? falsos|financieras? fantasma/i.test(story.title);
  if (source.id === 'latam-fintech-hub') return /fintech|paytech|neobanc|banc|pago|stablecoin|cr[eé]dito|financ|insurtech|segur|remes|billetera|wallet/i.test(story.title) && !/\b(evento|webinar|congreso|conferencia|emms)\b|latam fintech market/i.test(story.title);
  if (source.id === 'iupana') return /fintech|open finance|stablecoin|neobanc|banc|revolut|mercado pago|pago|fraude|sofi|financ/i.test(story.title) && !/\b(evento|forum|foro|agenda|speakers|webinar|congreso)\b/i.test(story.title);
  // Bloomberg Línea llega por una búsqueda: además del tema, el titular debe situar la nota en la región.
  if (source.id === 'latam-bloomberg') return /fintech|neobanc|billetera|pagos|mercado pago|revolut|nubank|modo|licencia bancaria|banco digital|transferencia|remesa/i.test(story.title) && /colombia|m[eé]xic|argentin|brasil|per[uú]|chile|uruguay|paraguay|ecuador|latinoam|am[eé]rica latina|latam|nubank|mercado pago|ual[aá]|nequi|rappi/i.test(story.title);
  if (source.id === 'finextra-payments' || source.id === 'finextra-crypto') {
    if (!new URL(story.url).pathname.startsWith('/newsarticle/')) return false;
    if (source.id === 'finextra-crypto') return /crypto|blockchain|tokeni[sz]|digital asset|stablecoin|bitcoin|ethereum|distributed ledger|web3|canton network|decentrali[sz]/i.test(text);
  }
  if (source.id === 'seps') return /resoluci[oó]n|norma|regulaci[oó]n|reforma|liquidaci|intervenci|sanci|no autorizad|alerta|advierte|corte|sentencia|tasas?|segmentaci|fusi[oó]n|supervisi[oó]n|balance|indicadores/i.test(story.title) && !/capacit|funcionarios|taller|feria|aniversario|rendici[oó]n de cuentas/i.test(story.title);
  if (source.id === 'superbancos') return /calificaci[oó]n|normativa|resoluci[oó]n|circular|regulaci[oó]n|reforma|sanci|intervenci|liquidaci|no autorizad|alerta|advierte|fintech|tasas?|cr[eé]dito|lavado|supervisi[oó]n|bolet[ií]n (financiero|estad[ií]stico)/i.test(story.title) && !/media day|[aá]rboles|futuros economistas|aniversario|sesi[oó]n (ordinaria|solemne)|\boea\b|sostenibilidad|capacita/i.test(story.title);
  if (source.id === 'supercias') return /no (est[aá]n?|se encuentran?) autorizad|no mantienen?|alerta|advierte|resoluci[oó]n|norma|reglamento|\bley\b|sanci|intervenci[oó]n|liquidaci|disoluci|mercado de valores|seguros|inversionista|fraude|lavado|plazo|concordato|oficial de cumplimiento|a la ciudadan[ií]a/i.test(story.title) && !/asisti[oó]|intervino|particip[oó]|congreso|sesi[oó]n solemne|ceremonia|aniversario|jornada acad[eé]mica|capacit|embajada|estuvo presente|disculpas/i.test(story.title);
  if (source.id === 'paymentsdive') return new URL(story.url).pathname.startsWith('/news/');
  // CoinDesk publica sobre todo precios de mercado: solo entran política, regulación e infraestructura financiera.
  if (source.id === 'coindesk') return /^\/(policy|business)\//.test(new URL(story.url).pathname) && /stablecoin|tokeni[sz]|cbdc|digital (asset|euro|dollar)|custod|\bmica\b|\bsec\b|cftc|regulat|legislat|licen[sc]e|sanction|central bank|federal reserve/i.test(story.title) && !/nvidia|copper|prediction market|kalshi|polymarket|miners?\b/i.test(story.title);
  // Chainalysis es el blog de un proveedor: fuera anuncios de producto y temas ajenos a cripto.
  if (source.id === 'chainalysis') return /crypto|blockchain|stablecoin|sanction|ofac|launder|hack|exploit|dprk|scam|fraud|adoption|bitcoin|defi|darknet|ransom|seiz|fincen|illicit|\botc/i.test(text) && !/^chainalysis (supports|launches|announces|acquires|named|partners|joins)|automatic token support|webinar/i.test(story.title);
  if (source.id === 'latamlist') return /fintech|bank|banc|pagos|payment|crypto|cripto|credit|crédit|lending|insurance|segur|remes|wallet|billetera|financi|finance|stablecoin/i.test(text);
  if (source.id === 'pymnts') return /payment|pagos|bank|banc|fintech|card|tarjet|wallet|checkout|money transfer|remittance|merchant|digital currency|stablecoin/i.test(story.title);
  if (source.id === 'ecuador-news') return /ecuador|ecuator|primicias|el universo|expreso/i.test(text) && /banc|financ|segur|cooperativ|fintech|cr[eé]dito|tasas? de inter[eé]s|tarjetas?|p[oó]lizas?|dep[oó]sitos?|remesas|riesgo pa[ií]s|billetera|transferencias?|medios de pago|pagos (digitales|electr[oó]nicos|sin contacto|con tarjetas?)/i.test(story.title);
  return true;
}
