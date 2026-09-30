import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parseBce, parseBcePublications, parseFeed, parseDate, deduplicate, safeUrl, recent, relevant } from '../scripts/content.mjs';

const now = Date.parse('2026-09-29T15:00:00Z');
const source = { id: 'prueba', name: 'Medio de prueba', category: 'pagos', kind: 'news', url: 'https://example.com/feed.xml' };

test('las fechas españolas se interpretan y las entradas antiguas no se publican como recientes', () => {
  assert.equal(parseDate('25 de septiembre de 2026'), '2026-09-25T12:00:00.000Z');
  assert.equal(parseDate('32 de septiembre de 2026'), null);
  assert.equal(recent('2026-08-01T00:00:00Z', now), false);
  assert.equal(normalize({ title: 'Antigua', url: 'https://example.com/old', publishedAt: '2026-08-01' }, source, now), null);
  assert.equal(normalize({ title: 'Sin fecha', url: 'https://example.com/no-date' }, source, now), null);
});

test('se conservan fuente y enlace, pero se reduce contenido HTML a texto', () => {
  const rss = '<rss><channel><item><title>Nuevo pago digital</title><link>https://example.com/story</link><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Un <b>banco</b> abre pagos.</p><script>alert(1)</script>]]></description></item></channel></rss>';
  const parsed = parseFeed(rss, source);
  const story = normalize(parsed[0], source, now);
  assert.equal(story.source, 'Medio de prueba');
  assert.equal(story.excerpt, 'Un banco abre pagos.');
  assert.equal(story.url, 'https://example.com/story');
  assert.equal(safeUrl('javascript:alert(1)'), null);
});

test('el BCE vincula titular, extracto y fecha del mismo boletín', () => {
  const html = '<div class="entry-content"><article class="elementor-post"><h3 class="elementor-post__title"><a href="https://www.bce.fin.ec/pagos/">Nuevas reglas de pagos</a></h3><div class="elementor-post__meta-data"><span class="elementor-post-date">25 de septiembre de 2026</span></div><div class="elementor-post__excerpt">Reglas para transferencias.</div></article></div>';
  const raw = parseBce(html)[0];
  const story = normalize(raw, { ...source, kind: 'official' }, now);
  assert.equal(story.title, 'Nuevas reglas de pagos');
  assert.equal(story.publishedAt, '2026-09-25T12:00:00.000Z');
  assert.equal(story.excerpt, 'Reglas para transferencias.');
});

test('las publicaciones financieras del BCE conservan fecha y enlace, sin descargas XLSX', () => {
  const html = '<table><tr><td>29 de septiembre de 2026</td><td></td><td><a href="/boletin.pdf">Boletín Monetario Semanal</a></td></tr><tr><td>29 de septiembre de 2026</td><td></td><td><a href="/datos.xlsx">Datos monetarios</a></td></tr></table>';
  const rows = parseBcePublications(html);
  assert.equal(rows.length, 1);
  const bce = { ...source, id: 'bce-publicaciones', category: 'regulacion', kind: 'official', url: 'https://contenido.bce.fin.ec/ultimas-publicaciones/' };
  const story = normalize(rows[0], bce, now);
  assert.equal(story.url, 'https://contenido.bce.fin.ec/boletin.pdf');
  assert.equal(story.publishedAt, '2026-09-29T12:00:00.000Z');
  assert.equal(relevant(story, bce), true);
});

test('las distintas coberturas sobreviven mientras los duplicados se eliminan', () => {
  const a = normalize({ title: 'Pago instantáneo', url: 'https://example.com/news?utm_source=rss', publishedAt: '2026-09-29T10:00:00Z' }, source, now);
  const b = normalize({ title: 'Pago instantáneo', url: 'https://example.com/news?utm_source=home', publishedAt: '2026-09-29T10:00:00Z' }, source, now);
  const c = normalize({ title: 'Pago instantáneo', url: 'https://other.example/news', publishedAt: '2026-09-29T10:00:00Z', source: 'Otro medio' }, source, now);
  assert.equal(deduplicate([a, b, c]).length, 2);
  assert.equal(deduplicate([a, { ...a, category: 'regulacion' }]).length, 2);
});

test('las categorías temáticas filtran artículos ajenos al sector', () => {
  assert.equal(relevant({ title: 'Análisis de la banca digital', excerpt: '' }, { id: 'latamlist' }), true);
  assert.equal(relevant({ title: 'Software de restaurantes', excerpt: '' }, { id: 'latamlist' }), false);
  assert.equal(relevant({ title: 'Seguridad en cajeros', excerpt: '', url: 'https://www.finextra.com/blogposting/100' }, { id: 'finextra-crypto' }), false);
  assert.equal(relevant({ title: 'Jeeves raises $110m', excerpt: '', url: 'https://www.finextra.com/newsarticle/48498/jeeves' }, { id: 'finextra-latam' }), true);
  assert.equal(relevant({ title: 'London bank launches product', excerpt: '', url: 'https://www.finextra.com/newsarticle/123/test' }, { id: 'finextra-latam' }), false);
  assert.equal(relevant({ title: 'Growth en Fintech: webinar', excerpt: '' }, { id: 'latam-fintech-hub' }), false);
  assert.equal(relevant({ title: 'Fintechs en Perú piden un ecosistema financiero abierto', excerpt: '' }, { id: 'iupana' }), true);
  assert.equal(relevant({ title: 'Fintech Forum 2026 revela su agenda', excerpt: '' }, { id: 'iupana' }), false);
  assert.equal(relevant({ title: 'Mercado Pago y Revolut obtendrán licencia bancaria en Argentina', excerpt: '' }, { id: 'latam-bloomberg' }), true);
  assert.equal(relevant({ title: 'Cotización Banco Macro SA', excerpt: '' }, { id: 'latam-bloomberg' }), false);
  assert.equal(relevant({ title: 'Superintendencia de Bancos advierte sobre entidades no autorizadas', excerpt: '' }, { id: 'regulatory-news' }), true);
});
