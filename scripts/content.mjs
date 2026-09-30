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
  const url = safeUrl(raw.url, source.url);
  const publishedAt = parseDate(raw.publishedAt);
  if (!title || !url || !publishedAt || !recent(publishedAt, now)) return null;
  let excerpt = plainText(raw.excerpt).replace(/\s+The post .+? appeared first on .+\.?$/i, '').trim();
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
export function deduplicate(stories) {
  const seen = new Set();
  return [...stories].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).filter(story => {
    const key = `${story.category}:${canonicalUrl(story.url)}`;
    const titleKey = `${story.category}:${story.source.toLowerCase()}:${story.title.toLowerCase().replace(/\W/g, '')}`;
    if (seen.has(key) || seen.has(titleKey)) return false;
    seen.add(key); seen.add(titleKey); return true;
  });
}
export function relevant(story, source) {
  const text = `${story.title} ${story.excerpt}`.toLowerCase();
  if (source.id === 'bce-publicaciones') return /bolet[ií]n monetario|tasas de inter[eé]s|indicadores monetarios y financieros|reserva internacional|captaciones|colocaciones|volumen de cr[eé]dito/i.test(story.title);
  if (source.id === 'regulatory-news') return /superintendencia de bancos|supercias|\bseps\b|junta de pol[ií]tica|banco central|\bbce\b|entidades financieras? no autorizad|cr[eé]ditos? falsos|financieras? fantasma/i.test(story.title);
  if (source.id === 'latam-fintech-hub') return /fintech|paytech|neobanc|banc|pago|stablecoin|cr[eé]dito|financ|insurtech|segur|remes|billetera|wallet/i.test(story.title) && !/\b(evento|webinar|congreso|conferencia|emms)\b|latam fintech market/i.test(story.title);
  if (source.id === 'finextra-latam') return new URL(story.url).pathname.startsWith('/newsarticle/') && /latin america|latam|brazil|brasil|mexic|colombi|argentin|chile|peru|uruguay|jeeves|nubank|mercado pago|ual[aá]|bradesco|global66/i.test(text);
  if (source.id === 'finextra-payments' || source.id === 'finextra-crypto') {
    if (!new URL(story.url).pathname.startsWith('/newsarticle/')) return false;
    if (source.id === 'finextra-crypto') return /crypto|blockchain|tokeni[sz]|digital asset|stablecoin|bitcoin|ethereum|distributed ledger|web3|canton network|decentrali[sz]/i.test(text);
  }
  if (['seps', 'superbancos', 'supercias'].includes(source.id)) return /resoluci[oó]n|circular|normativa|regulaci[oó]n|reforma|ley|supervisi[oó]n|control|autorizaci[oó]n|comunicado oficial|sector financiero|cooperativas|seguros|remesas/i.test(text);
  if (source.id === 'latamlist') return /fintech|bank|banc|pagos|payment|crypto|cripto|credit|crédit|lending|insurance|segur|remes|wallet|billetera|financi|finance|stablecoin/i.test(text);
  if (source.id === 'pymnts') return /payment|pagos|bank|banc|fintech|card|tarjet|wallet|checkout|money transfer|remittance|merchant|digital currency|stablecoin/i.test(text);
  if (source.id === 'ecuador-news') return /ecuador|ecuator|primicias|el universo|expreso/i.test(text) && /banc|financ|segur|cooperativ|pago|fintech|cr[eé]dito|inter[eé]s|d[oó]lar|econom[ií]a|inversi[oó]n/i.test(text);
  return true;
}
