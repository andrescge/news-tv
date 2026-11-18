import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parseBce, parseBcePublications, parseBceResolutions, resolutionYear, parseFeed, parseDate, deduplicate, safeUrl, recent, relevant } from '../scripts/content.mjs';

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

test('las resoluciones del BCE se leen de tabla o de lista y toman la fecha que aporta el recopilador', () => {
  const junta = { ...source, id: 'bce-junta-resoluciones', category: 'regulacion', kind: 'official', url: 'https://www.bce.fin.ec/junta/resoluciones-emitidas/' };
  const admin = { ...source, id: 'bce-resoluciones-admin', category: 'regulacion', kind: 'official', url: 'https://www.bce.fin.ec/resoluciones-administrativas/' };
  const table = '<table><tr><td>Resolución</td><td>Descripción</td><td>Año</td><td>Visualizar</td></tr><tr><td><p>JPRFM-2026-048-T</p></td><td><p>Aprueba la <em>Norma que regula la operación de tarjetas de pago</em>.</p></td><td>2026</td><td><a href="https://www.bce.fin.ec/storage/JPRFM/resoluciones/JPRFM-2026-048-T.pdf">VER</a></td></tr><tr><td>JPRFM-2026-047-A</td><td>Aprueba la política interna de provisiones.</td><td>2026</td><td><a href="/storage/JPRFM/resoluciones/JPRFM-2026-047-A.pdf">VER</a></td></tr><tr><td>JPRFM-2026-049-M</td><td>Conoce el informe sobre reservas de liquidez.</td><td>2026</td><td><a href="/storage/JPRFM/resoluciones/JPRFM-2026-049-M.pdf">VER</a></td></tr></table><a href="/otro/documento.pdf">Otro PDF</a>';
  const rows = parseBceResolutions(table, junta.url);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].title, 'Aprueba la Norma que regula la operación de tarjetas de pago.');
  assert.equal(rows[1].url, 'https://www.bce.fin.ec/storage/JPRFM/resoluciones/JPRFM-2026-047-A.pdf');
  assert.equal(resolutionYear(rows[0]), 2026);
  assert.deepEqual(rows.map(row => relevant(row, junta)), [true, false, false]);
  assert.equal(normalize(rows[0], junta, now), null);
  const story = normalize({ ...rows[0], publishedAt: '2026-09-27T16:45:32.000Z' }, junta, now);
  assert.equal(story.publishedAt, '2026-09-27T16:45:32.000Z');
  assert.match(story.excerpt, /^Resolución JPRFM-2026-048-T\./);
  assert.equal(relevant(story, junta), true);

  const list = '<p><a href="https://www.bce.fin.ec/storage/BCE/resoluciones/BCE-GG-007-2026.pdf">Resolución Administrativa No. BCE-GG-007-2026: Expide la Norma para el Estándar de Mensajería para Transferencias Electrónicas para Pago en Tiempo Real.</a></p><p><a href="https://www.bce.fin.ec/storage/BCE/resoluciones/BCE-GG-011-2026.pdf">Resolución Administrativa No. BCE-GG-011-2026: Expide el Reglamento Interno de Administración del Talento Humano.</a></p><p><a href="https://www.bce.fin.ec/storage/BCE/resoluciones/BCE-BCE-2026-0327-M.pdf">Memorando Nro. BCE-BCE-2026-0327-M: Delegación para la suscripción del Convenio sobre transferencias.</a></p>';
  const adminRows = parseBceResolutions(list, admin.url);
  assert.equal(adminRows[0].code, 'Resolución Administrativa No. BCE-GG-007-2026');
  assert.deepEqual(adminRows.map(row => relevant(row, admin)), [true, false, false]);
  assert.throws(() => parseBceResolutions('<p>Sin documentos</p>', admin.url));
});

test('Endeavor solo aporta notas de la región y sin la coletilla del feed', () => {
  assert.equal(relevant({ title: 'How these Brazilian scientists built a skincare brand', excerpt: '' }, { id: 'endeavor-global' }), true);
  assert.equal(relevant({ title: 'Postcards from Elsewhere: Amman, Jordan', excerpt: '' }, { id: 'endeavor-global' }), false);
  assert.equal(relevant({ title: 'Nuevos miembros del Board de Endeavor Argentina', excerpt: '' }, { id: 'endeavor-ar' }), false);
  const story = normalize({ title: 'Introducing Endeavor Catalyst Fund V', url: 'https://endeavor.org/fund-v', publishedAt: '2026-09-29T10:00:00Z', excerpt: 'The post Introducing Endeavor Catalyst <span>Fund V</span> appeared first on Endeavor.' }, source, now);
  assert.equal(story.excerpt, '');
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
