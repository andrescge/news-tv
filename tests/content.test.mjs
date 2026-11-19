import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rejectReason, hostRejection, screen, registroOficialRelevant, discardLog, MAX_DISCARDS_PER_SOURCE, normalize, parseBce, parseBcePublications, parseBceResolutions, parseRegistroOficial, parseRegistroOficialIndex, readableNorm, parseSupercias, resolutionYear, coverageSignature, coverageLexicon, editionSeries, expectedScore, capPerEdition, parseFeed, parseDate, deduplicate, safeUrl, recent, relevant, allowedHost, linkAllowed, inHosts, carryable, editionShape, passes, clipExcerpt, channelFor, limitFor, accumulate, composeChannel, composeEdition, periodIndex, spaced, shares, FILTERS, CHANNELS, matchEndeavor, tagEndeavor, endeavorIndex, endeavorNames, searchCompanies, searchTerm, searchQualifier, searchQuery, searchBatches, searchLots, searchPerRun, rotation, ENDEAVOR_COMPANIES, ENDEAVOR_AMBIGUOUS, ENDEAVOR_SEARCH, ENDEAVOR_PRESS_HOSTS, ENDEAVOR_PROMO, ENDEAVOR_MARKET_NOISE, ENDEAVOR_CONTEXT, ENDEAVOR_NOISE } from '../scripts/content.mjs';
import { decodeEntities, toCompany, latamCompanies, endeavorUrl } from '../scripts/endeavor.mjs';
import { SOURCES, loadPrevious, dateResolutions, readBody, discardsPath, writeJson } from '../scripts/collect.mjs';
import { validateEdition, validateDiscards, validFunnel } from '../scripts/validate.mjs';
import endeavorDirectory from '../scripts/data/endeavor-latam.json' with { type: 'json' };

const now = Date.parse('2026-09-29T15:00:00Z');
const source = { id: 'prueba', name: 'Medio de prueba', category: 'pagos', kind: 'news', url: 'https://example.com/feed.xml' };
const DAY = 24 * 60 * 60 * 1000;
const sourceById = id => SOURCES.find(item => item.id === id);

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

test('sin extracto en la fuente, la nota queda sin extracto y lleva nivel y acceso de su fuente', () => {
  const story = normalize({ title: 'Solo titular', url: 'https://example.com/solo', publishedAt: '2026-09-29T10:00:00Z' }, { ...source, tier: 2, access: 'paywall' }, now);
  assert.equal(story.excerpt, '');
  assert.equal(story.tier, 2);
  assert.equal(story.access, 'paywall');
  assert.equal('stale' in story, false);
  assert.equal('tier' in normalize({ title: 'Otra', url: 'https://example.com/otra', publishedAt: '2026-09-29T10:00:00Z' }, source, now), false);
});

test('el BCE vincula titular, extracto y fecha del mismo boletín', () => {
  const html = '<div class="entry-content"><article class="elementor-post"><h3 class="elementor-post__title"><a href="https://www.bce.fin.ec/pagos/">Nuevas reglas de pagos</a></h3><div class="elementor-post__meta-data"><span class="elementor-post-date">25 de septiembre de 2026</span></div><div class="elementor-post__excerpt">Reglas para transferencias.</div></article></div>';
  const raw = parseBce(html)[0];
  const story = normalize(raw, { ...source, kind: 'official' }, now);
  assert.equal(story.title, 'Nuevas reglas de pagos');
  assert.equal(story.publishedAt, '2026-09-25T12:00:00.000Z');
  assert.equal(story.excerpt, 'Reglas para transferencias.');
  const bce = sourceById('bce-boletines');
  assert.equal(normalize({ ...raw, title: 'La Junta de Política y Regulación aprueba nuevas normas' }, bce, now).category, 'regulacion');
  assert.equal(normalize(raw, bce, now).category, 'ecuador');
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

test('Endeavor Argentina omite notas institucionales y los extractos pierden la coletilla del feed', () => {
  assert.equal(relevant({ title: 'Giraffe Bio levanta USD 6,4 millones', excerpt: '' }, { id: 'endeavor-ar' }), true);
  assert.equal(relevant({ title: 'Nuevos miembros del Board de Endeavor Argentina', excerpt: '' }, { id: 'endeavor-ar' }), false);
  const story = normalize({ title: 'Introducing Endeavor Catalyst Fund V', url: 'https://endeavor.org/fund-v', publishedAt: '2026-09-29T10:00:00Z', excerpt: 'The post Introducing Endeavor Catalyst <span>Fund V</span> appeared first on Endeavor.' }, source, now);
  assert.equal(story.excerpt, '');
});

test('Supercias aporta fecha desde el enlace y solo entran avisos y normas', () => {
  const html = '<a href="https://www.supercias.gob.ec/portalscvs/Noticias/Noticias.php?seccion=noticia-30012026"><img src="x.png"></a><a href="https://www.supercias.gob.ec/portalscvs/Noticias/Noticias.php?seccion=noticia-30012026">Article Track View no está autorizada para realizar actividades de inversión</a><a href="Noticias/Noticias.php?seccion=noticia-281020261">Superintendente estuvo presente en la ceremonia de la Aviación Nacional</a><a href="/otra.php">Otra página</a>';
  const rows = parseSupercias(html, 'https://www.supercias.gob.ec/portalscvs/');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].publishedAt, '2026-01-30T12:00:00Z');
  assert.equal(rows[1].url, 'https://www.supercias.gob.ec/portalscvs/Noticias/Noticias.php?seccion=noticia-281020261');
  assert.equal(rows[1].publishedAt, '2026-10-28T12:00:00Z');
  assert.deepEqual(rows.map(row => relevant({ ...row, excerpt: '' }, { id: 'supercias' })), [true, false]);
  assert.throws(() => parseSupercias('<p>Sin noticias</p>', 'https://www.supercias.gob.ec/portalscvs/'));
});

test('la misma operación contada por varios medios queda en una nota que nombra a los demás, en cualquier canal', () => {
  const latam = { ...source, category: 'latam' };
  const story = (title, medium, publishedAt, extra = {}) => normalize({ title, url: `https://example.com/${encodeURIComponent(`${medium}/${title}`)}`, publishedAt, source: medium, ...extra }, latam, now);
  const english = story('Cocos raises $34M at $508M valuation', 'LatamList', '2026-09-27T10:00:00Z', { excerpt: 'Cocos closed a new round.' });
  const spanish = story('Fintech argentina Cocos levantó US$34M para escalar su banco digital', 'El Economista', '2026-09-28T10:00:00Z', { via: 'Vía Google News' });
  const partners = story('Paytech Akua recibe inversión de Itaú Ventures', 'El Economista', '2026-09-28T09:00:00Z', { via: 'Vía Google News' });
  const partnersEnglish = story('Colombian fintech Akua secures investment from Itaú Unibanco', 'LatamList', '2026-09-28T08:00:00Z');
  const other = story('Revolut prevé lanzar su banco en Argentina', 'Bloomberg Línea', '2026-09-28T07:00:00Z');
  const later = story('Cocos compra una sociedad de bolsa por US$34M', 'iupana', '2026-09-10T07:00:00Z');
  assert.deepEqual([...coverageSignature('Cocos raises $34M at $508M valuation').amounts], ['34m', '510m']);
  assert.deepEqual([...coverageSignature('Fintech argentina levanta USD 6,4 millones').amounts], ['6.4m']);
  const result = deduplicate([spanish, english, partners, partnersEnglish, other, later]);
  assert.deepEqual(result.map(item => item.title), [english.title, partnersEnglish.title, other.title, later.title]);
  assert.deepEqual(result.map(item => item.coverage), [['El Economista'], ['El Economista'], undefined, undefined]);
  // Ahora también en Pagos (antes solo en Fintech LATAM y Endeavor LATAM).
  const payments = [english, spanish].map(item => ({ ...item, category: 'pagos' }));
  assert.equal(deduplicate(payments).length, 1);
});

test('un hecho, una nota: importes en millones, nombres propios por grupos y titulares en mayúsculas', () => {
  // Importes: la misma cifra en las formas de la prensa en español e inglés; sin moneda ni unidad no hay importe.
  const amounts = title => [...coverageSignature(title).amounts];
  assert.deepEqual(amounts('Robo histórico de 6.300 millones de dólares en 20 minutos: jaque a Binance'), ['6300m']);
  assert.deepEqual(amounts('Binance freezes assets after $6.3 bln heist, crypto industry\'s biggest'), ['6300m']);
  assert.deepEqual(amounts('BBVA Spark inyecta más de 1,000 mdp a la fintech mexicana Nexu'), ['1000m']);
  assert.deepEqual(amounts('Ecuador registró un superávit comercial de USD 3.308 millones entre enero y septiembre de 2026'), ['3300m']);
  assert.deepEqual(amounts('Proforma 2027 con 20 minutos de debate y 13,4% de crecimiento'), []);
  // Nombres: «Hong Kong» o «Economía Popular y Solidaria» son un solo nombre; al principio de la frase solo cuentan los que la
  // tanda escribe con mayúscula en mitad de una frase o siempre con mayúscula.
  const lexicon = coverageLexicon(['Nubank aumenta ganancias en el tercer trimestre', 'Nubank suspende operaciones con criptomonedas', 'Las webs de Ikea y HSBC sufren un ciberataque']);
  assert.ok(lexicon.has('nubank') && lexicon.has('ikea') && !lexicon.has('las'));
  assert.deepEqual(coverageSignature('Banks in Hong Kong test tokenized deposits', lexicon).runs, [['hong', 'kong']]);
  assert.deepEqual(coverageSignature('Estas son las falsas cooperativas no autorizadas, alerta Superintendencia de Economía Popular y Solidaria').runs, [['economia', 'popular', 'solidaria']]);
  assert.deepEqual(coverageSignature('Nubank suspende operaciones con criptomonedas en Brasil', lexicon).runs, [['nubank']]);
  // Titular con todas las palabras en mayúscula: solo cuentan los nombres conocidos de la tanda; las siglas, siempre.
  assert.deepEqual(coverageSignature('Federal Reserve Board Announces Pricing for Payment Services').runs, []);
  assert.deepEqual(coverageSignature('OpenAI Gives AI Agents a Wallet Without Seeing the Card').runs, [['openai']]);
  // Los códigos de norma no son nombres.
  assert.deepEqual(coverageSignature('La SEPS amplía el plazo: SEPS-IGT-IGJ-INFMR-DNLESF-2026-0160').runs, [['seps']]);
});

test('un hecho, una nota: titulares reales que se unen entre canales y hechos distintos que no se unen', () => {
  const at = (iso, sourceId, channel, medium, title, extra = {}) => ({ id: `${sourceId}-${iso}`, sourceId, category: channel, kind: 'news', tier: 2, title, excerpt: '', url: `https://example.com/${encodeURIComponent(sourceId + title)}`, source: medium, sourceUrl: 'https://example.com', via: '', language: 'es', publishedAt: iso, ...extra });
  const primaryIds = new Set(['bce-junta-resoluciones', 'registro-oficial']);
  const primary = story => primaryIds.has(story.sourceId);
  const titles = list => list.map(item => item.title).sort();
  // El Banco Mundial con Citi y Circle: The Block en Cripto y Finextra en Pagos, el mismo día.
  const block = at('2026-11-18T04:21:00Z', 'theblock', 'cripto', 'The Block', 'World Bank Group taps Circle and Citi to test stablecoin-based fund disbursements', { excerpt: 'The World Bank Group is testing stablecoins.' });
  const finextra = at('2026-11-18T09:00:00Z', 'finextra', 'pagos', 'Finextra Research', 'World Bank partners Citi and Circle to test stablecoins for development payments', { via: 'Vía Google News' });
  const [bank] = deduplicate([finextra, block]);
  assert.deepEqual([bank.sourceId, bank.category, bank.coverage], ['theblock', 'cripto', ['Finextra Research']]);
  // La norma de tarjetas del Ecuador: la resolución de la Junta (primaria, Autoridades), el boletín del BCE y Forbes (Ecuador).
  const junta = at('2026-11-07T16:45:00Z', 'bce-junta-resoluciones', 'regulacion', 'BCE · Resoluciones de la Junta', 'Aprueba la “Norma que regula la operación de tarjetas de pago en el Ecuador”.', { kind: 'official', tier: 1, excerpt: 'Resolución JPRFM-2026-048-T.' });
  const bulletin = at('2026-11-07T12:00:00Z', 'bce-boletines', 'ecuador', 'Banco Central del Ecuador', 'La JPRFM establece nuevas reglas para los pagos con tarjetas y refuerza la protección de los usuarios', { kind: 'official', tier: 1, excerpt: 'La Junta aprobó la norma.' });
  const forbes = at('2026-11-10T13:46:00Z', 'forbes-ec', 'ecuador', 'Forbes Ecuador', 'Las nuevas reglas para los pagos con tarjetas en Ecuador', { via: 'Vía Google News' });
  const cards = deduplicate([forbes, junta, bulletin], { primary });
  assert.equal(cards.length, 1);
  assert.deepEqual([cards[0].sourceId, cards[0].category], ['bce-junta-resoluciones', 'regulacion']);
  assert.deepEqual([...cards[0].coverage].sort(), ['Banco Central del Ecuador', 'Forbes Ecuador']);
  // Nubank y Mercado Pago suspenden las transferencias cripto: Reuters en Cripto y El Economista en Fintech LATAM.
  const reuters = at('2026-11-06T08:00:00Z', 'reuters-cripto', 'cripto', 'Reuters', 'Nubank, Mercado Pago halt crypto transfers after external provider disruption', { tier: 1, via: 'Vía Google News' });
  const economista = at('2026-11-06T14:00:00Z', 'el-economista', 'latam', 'El Economista', 'Nubank y Mercado Pago suspenden sus transferencias de criptomonedas por inestabilidad en el sistema', { tier: 1, via: 'Vía Google News' });
  assert.equal(deduplicate([reuters, economista]).length, 1);
  // El hackeo de Binance: la misma cifra el mismo día se une; hechos distintos del mismo caso no.
  const heist = [
    at('2026-10-30T07:00:00Z', 'reuters-cripto', 'cripto', 'Reuters', 'Binance freezes assets after $6.3 bln heist, crypto industry\'s biggest', { tier: 1 }),
    at('2026-10-30T09:56:00Z', 'cinco-dias-cripto', 'cripto', 'Cinco Días · Criptoactivos', 'Robo histórico de 6.300 millones de dólares en 20 minutos: jaque a Binance, la mayor plataforma cripto del mundo', { tier: 1, excerpt: 'El robo.' }),
  ];
  const [one] = deduplicate(heist);
  assert.deepEqual([one.sourceId, one.coverage], ['cinco-dias-cripto', ['Reuters']]);
  const distinct = [
    at('2026-10-30T07:00:00Z', 'reuters-cripto', 'cripto', 'Reuters', 'Blockchain analysis firm TRM says North Korea behind Binance crypto theft'),
    at('2026-11-03T05:00:00Z', 'ft-cripto', 'cripto', 'Financial Times', 'North Korean hackers expected to take months to launder Binance billions'),
    at('2026-11-02T15:02:00Z', 'ft-cripto', 'cripto', 'FT Alphaville', 'What caused the $6.3bn Binance hack?'),
    at('2026-11-13T16:54:00Z', 'expansion-cripto', 'cripto', 'Expansión', 'Binance cerrará todas las cuentas europeas en 2027'),
    at('2026-11-14T08:45:00Z', 'reuters-cripto', 'cripto', 'Reuters', 'Binance targets full reopening of withdrawals by next week'),
    at('2026-11-17T15:11:00Z', 'coindesk', 'cripto', 'CoinDesk', 'Hong Kong, Swift test tokenized deposits as banks chase stablecoin-style speed'),
    at('2026-11-18T15:23:00Z', 'decrypt', 'cripto', 'Decrypt', 'Hong Kong wants banks to use AI to catch crypto crime before money disappears'),
  ];
  assert.deepEqual(titles(deduplicate([...distinct, heist[0]])), titles([...distinct, heist[0]]));
  // Dos documentos primarios no se unen entre sí, ni dos notas del mismo medio.
  const gazette = at('2026-11-09T15:21:00Z', 'registro-oficial', 'regulacion', 'Registro Oficial', 'Se reforma la Norma que regula la operación de tarjetas de pago en el Ecuador', { kind: 'official', tier: 1, excerpt: 'Junta · JPRFM-2026-048-T.' });
  assert.equal(deduplicate([junta, gazette], { primary }).length, 2);
  assert.equal(deduplicate([heist[0], { ...heist[1], source: 'Reuters', id: 'otra' }]).length, 2);
  // Más de cuatro días entre notas: hechos distintos aunque compartan nombre e importe.
  assert.equal(deduplicate([heist[0], { ...heist[1], publishedAt: '2026-11-04T12:00:00Z' }]).length, 2);
  // La cobertura de una nota conservada se suma a la de las nuevas.
  const [kept] = deduplicate([{ ...heist[1], coverage: ['FT'] }, heist[0]]);
  assert.deepEqual(kept.coverage, ['FT', 'Reuters']);
});

test('una nota aparece en un solo canal: se elimina el duplicado y gana el canal más específico', () => {
  const a = normalize({ title: 'Pago instantáneo', url: 'https://example.com/news?utm_source=rss', publishedAt: '2026-09-29T10:00:00Z' }, source, now);
  const b = normalize({ title: 'Pago instantáneo', url: 'https://example.com/news?utm_source=home', publishedAt: '2026-09-29T10:00:00Z' }, source, now);
  const c = normalize({ title: 'Pago instantáneo', url: 'https://other.example/news', publishedAt: '2026-09-29T10:00:00Z', source: 'Otro medio' }, source, now);
  assert.equal(deduplicate([a, b, c]).length, 2);
  const moved = deduplicate([a, { ...a, category: 'regulacion' }]);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].category, 'regulacion');
  // El mismo artículo de Primicias por su feed (con extracto) y por Google News en Autoridades EC.
  const direct = normalize({ title: 'La SEPS alerta sobre 134 entidades no autorizadas', url: 'https://www.primicias.ec/economia/seps-alerta/', publishedAt: '2026-09-29T10:00:00Z', excerpt: 'El listado está disponible en línea.' }, sourceById('primicias'), now);
  const viaGoogle = normalize({ title: 'La SEPS alerta sobre 134 entidades no autorizadas - Primicias', url: 'https://news.google.com/rss/articles/abc', publishedAt: '2026-09-29T09:00:00Z', source: 'Primicias', sourceUrl: 'https://www.primicias.ec', via: 'Vía Google News' }, sourceById('reguladores-prensa'), now);
  const merged = deduplicate([direct, viaGoogle]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, direct.id);
  assert.equal(merged[0].category, 'regulacion');
});

test('los discursos del BIS se leen una vez, llevan autor y van a pagos o a cripto según el tema', () => {
  const bis = sourceById('bis-discursos');
  const rdf = '<?xml version="1.0"?><rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel rdf:about="https://www.bis.org/doclist/cbspeeches.rss"><title>Central bankers speeches</title></channel>'
    + '<item rdf:about="https://www.bis.org/speeches/a"><title>Cash and the digital euro - two sides of the same coin</title><link>https://www.bis.org/speeches/a</link><description>Speech by Mr Piero Cipollone, Member of the Executive Board of the European Central Bank.</description><dc:creator>Piero Cipollone</dc:creator><dc:date>2026-09-28T00:00:00Z</dc:date></item>'
    + '<item rdf:about="https://www.bis.org/speeches/b"><title>Payments in a fragmenting world - sovereignty, strategy and system design</title><link>https://www.bis.org/speeches/b</link><description>Speech by Ms A, Governor of the Central Bank of Iceland.</description><dc:creator>A</dc:creator><dc:date>2026-09-28T00:00:00Z</dc:date></item>'
    + '<item rdf:about="https://www.bis.org/speeches/c"><title>We have kept the policy rate unchanged</title><link>https://www.bis.org/speeches/c</link><description>Speech.</description><dc:creator>B</dc:creator><dc:date>2026-09-28T00:00:00Z</dc:date></item></rdf:RDF>';
  const stories = parseFeed(rdf, bis).map(row => normalize(row, bis, now)).filter(story => relevant(story, bis));
  assert.deepEqual(stories.map(story => [story.title, story.category]), [['Piero Cipollone: Cash and the digital euro - two sides of the same coin', 'cripto'], ['A: Payments in a fragmenting world - sovereignty, strategy and system design', 'pagos']]);
  assert.match(stories[0].excerpt, /^Speech by Mr Piero Cipollone/);
  assert.equal(new Set(stories.map(story => story.id)).size, 2);
  assert.equal(limitFor(bis, 'pagos'), 3);
  assert.equal(limitFor(bis, 'cripto'), 2);
  // Casos del informe: canal elegido por tema.
  const route = title => channelFor({ title }, bis);
  assert.equal(route('Next-day securities settlement, tokenisation and the transformation of Europe’s financial infrastructure'), 'cripto');
  assert.equal(route('The Czech National Bank’s first DLT bond and the new physics of the digital koruna'), 'cripto');
  assert.equal(route('A new payment scheme for Iceland - building a sovereign and secure payment system'), 'pagos');
  assert.equal(route('Safeguarding trust and monetary sovereignty in a digital payments era'), 'pagos');
  assert.equal(relevant({ title: 'Welcome address - Fourth Women in Central Banking Workshop' }, bis), false);
  // El mismo discurso publicado por el BCE (sin extracto) queda en una sola nota: la del BIS, con extracto.
  const ecb = normalize({ title: 'Piero Cipollone: Cash and the digital euro: two sides of the same coin', url: 'https://www.ecb.europa.eu/press/key/date/2026/html/ecb.sp1.en.html', publishedAt: '2026-09-28T08:00:00Z' }, sourceById('ecb'), now);
  const merged = deduplicate([ecb, stories[0]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sourceId, 'bis-discursos');
});

test('el extracto se recorta en límite de palabra con «…» solo si no cabe entero', () => {
  // Cabe entero: sale igual, sin «…».
  assert.equal(clipExcerpt('Un banco abre pagos.'), 'Un banco abre pagos.');
  const exact = 'a'.repeat(279) + '.';
  assert.equal(clipExcerpt(exact), exact);
  // No cabe: se corta en el último espacio, sin palabras partidas ni signos sueltos, y termina en «…» sin pasar de 280.
  const long = 'Hyundai’s credit card arm says it has seen success from its blockchain payments partnership with Kinexys by J.P. Morgan. This effort has shown the potential for artificial intelligence (AI) agents to “autonomously and securely execute financial transactions,” Hyundai Card said in a statement released this week.';
  const clipped = clipExcerpt(long);
  assert.ok(clipped.length <= 280, String(clipped.length));
  assert.ok(clipped.endsWith('…'));
  const body = clipped.slice(0, -1);
  assert.ok(long.startsWith(body), 'solo se quita texto, no se añade');
  assert.match(long.slice(body.length), /^[\s,.;:]/u, 'el corte cae en límite de palabra');
  assert.equal(clipExcerpt('uno dos tres cuatro cinco', 12), 'uno dos…');
  assert.equal(clipExcerpt('uno dos, tres cuatro', 10), 'uno dos…');
  // Una sola palabra enorme: se corta dentro, pero también con «…».
  assert.equal(clipExcerpt('x'.repeat(300)), 'x'.repeat(279) + '…');
  // normalize lo aplica.
  const story = normalize({ title: 'Hyundai Card prueba pagos con agentes', url: 'https://example.com/h', publishedAt: '2026-09-29T10:00:00Z', excerpt: long }, source, now);
  assert.equal(story.excerpt, clipped);
  // Una nota conservada de una edición anterior, cortada en seco a 280 caracteres, se vuelve a cortar en límite de palabra.
  const legacy = { ...make('prueba', 3), excerpt: long.slice(0, 280) };
  assert.equal(legacy.excerpt.length, 280);
  const [carried] = accumulate([], [legacy], source, { now });
  assert.ok(carried.excerpt.endsWith('said…'), carried.excerpt.slice(-20));
  const fits = { ...make('prueba', 4), excerpt: 'Extracto corto.' };
  assert.equal(accumulate([], [fits], source, { now })[0].excerpt, 'Extracto corto.');
});

test('Google News: solo entran notas del dominio del medio y se quita el sufijo del titular', () => {
  const forbes = sourceById('forbes-ec');
  assert.equal(allowedHost({ sourceUrl: 'https://www.forbes.com.ec' }, forbes), true);
  assert.equal(allowedHost({ sourceUrl: 'https://forbes.com.mx' }, forbes), false);
  assert.equal(allowedHost({ sourceUrl: 'nada' }, forbes), false);
  assert.equal(allowedHost({ sourceUrl: 'https://cualquiera.example' }, sourceById('primicias')), true);
  const rss = '<rss><channel><item><title>Nuevo crédito del FMI por US$ 710 millones - Forbes Ecuador</title><link>https://news.google.com/rss/articles/x</link><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate><description>Nuevo crédito del FMI por US$ 710 millones Forbes Ecuador</description><source url="https://www.forbes.com.ec">Forbes Ecuador</source></item></channel></rss>';
  const [row] = parseFeed(rss, forbes);
  const story = normalize(row, forbes, now);
  assert.equal(story.title, 'Nuevo crédito del FMI por US$ 710 millones');
  assert.equal(story.excerpt, '');
  assert.equal(story.via, 'Vía Google News');
  assert.equal(relevant(story, forbes), true);
});

test('Registro Oficial: el titular es el asunto de la norma, el extracto lleva órgano y código, y solo entran normas de órganos financieros', () => {
  const item = (title, link, html) => `<item><title>${title}</title><link>${link}</link><pubDate>Mon, 28 Sep 2026 13:22:50 +0000</pubDate><description><![CDATA[resumen]]></description><content:encoded><![CDATA[${html}]]></content:encoded></item>`;
  const xml = `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>${[
    item('Quinto Suplemento No. 410', 'https://www.registroficial.gob.ec/quinto-suplemento-no-410/', '<p>FUNCIÓN EJECUTIVA<br>ACUERDO:<br>MINISTERIO DE GOBIERNO:<br>MDG-SMS-2026-0218-A Se aprueba el estatuto de la Iglesia Evangélica<br><br>RESOLUCIONES:<br>JUNTA DE POLÍTICA Y REGULACIÓN<br>FINANCIERA Y MONETARIA:<br>JPRFM-2026-050-F Se conoce el contenido del informe de actividades del Directorio<br><br>JPRFM-2026-051-F Se reforma la Codificación de Resoluciones Monetarias, Financieras, de Valores y Seguros</p>'),
    item('Tercer Suplemento No. 409', 'https://www.registroficial.gob.ec/tercer-suplemento-no-409/', '<p>FUNCIÓN EJECUTIVA<br>ACUERDO:<br>MINISTERIO DE DESARROLLO ECONÓMICO Y PRODUCTIVO:<br>MDEP-MDEP-2026-0053-A Se expide la delegación ante la Junta de Política y Regulación Financiera y Monetaria</p><p>FUNCIÓN DE TRANSPARENCIA Y CONTROL SOCIAL<br>SUPERINTENDENCIA DE BANCOS:<br>SB-2026-1389 Se acoge la recomendación efectuada en el informe técnico<br>No. SB-INCSS-2026-014-I de 17 de marzo de 2026</p>'),
    item('Segundo Suplemento No. 395', 'https://www.registroficial.gob.ec/segundo-suplemento-no-395/', '<p>FUNCIÓN DE TRANSPARENCIA<br>Y CONTROL SOCIAL<br>SUPERINTENDENCIA DE<br>ECONOMÍA POPULAR Y SOLIDARIA:<br>SEPS-IGT-IGS-IGJ-INSESF-INR-INGINT-INSEPS-<br>2026-0157 Se expide la Norma de control de seguridades en el uso de canales electrónicos</p><p><br>CORPORACIÓN DEL SEGURO DEDEPÓSITOS, FONDO DE LIQUIDEZ<br>Y FONDO DE SEGUROS PRIVADOS:<br>COSEDE-COSEDE-2026-0068-R Se actualizan los valores de benchmark aplicables al sector financiero privado</p>'),
    item('Cuarto Suplemento No. 402', 'https://www.registroficial.gob.ec/cuarto-suplemento-no-402/', '<p>SERVICIO DE RENTAS INTERNAS<br>RESOLUCIÓN No.<br>NAC-DGERCGC26-00000038<br>SE EXPIDEN LAS NORMAS PARA EL INTERCAMBIO AUTOMÁTICO DE INFORMACIÓN DE LA SCVS Y EL SRI</p>'),
    item('Edición Jurídica No. 458', 'https://www.registroficial.gob.ec/edicion-juridica-no-458-2/', '<p>FUNCIÓN JUDICIAL Y JUSTICIA INDÍGENA<br>CORTE NACIONAL DE JUSTICIA</p>'),
    item('Edición Especial No. 1700', 'https://www.registroficial.gob.ec/edicion-especial-no-1700/', '<p>BANCO CENTRAL DEL ECUADOR:<br>BCE-GG-021-2026 Se reforma la Norma para depósitos y retiros de especies monetarias</p>'),
  ].join('')}</channel></rss>`;
  const ro = sourceById('registro-oficial');
  const rows = parseRegistroOficial(xml);
  // El titular es el asunto de la norma; el órgano y el código abren el extracto.
  assert.deepEqual(rows.map(row => row.title), [
    'Se reforma la Codificación de Resoluciones Monetarias, Financieras, de Valores y Seguros',
    'Se expide la Norma de control de seguridades en el uso de canales electrónicos',
    'Se expiden las normas para el intercambio automático de información de la SCVS y el SRI',
    'Se reforma la Norma para depósitos y retiros de especies monetarias',
  ]);
  assert.equal(rows[0].excerpt, 'Junta de Política y Regulación Financiera y Monetaria · JPRFM-2026-051-F. Registro Oficial, Quinto Suplemento No. 410.');
  assert.equal(rows[1].excerpt, 'Superintendencia de Economía Popular y Solidaria · SEPS-IGT-IGS-IGJ-INSESF-INR-INGINT-INSEPS-2026-0157. Registro Oficial, Segundo Suplemento No. 395. También: Corporación del Seguro de Depósitos (COSEDE): COSEDE-COSEDE-2026-0068-R Se actualizan los valores de benchmark aplicables al sector financiero privado.');
  const stories = rows.map(row => normalize(row, ro, now));
  assert.deepEqual(stories.map(story => relevant(story, ro)), [true, true, true, false]);
  assert.equal(stories[0].category, 'regulacion');
  assert.equal(stories[0].kind, 'official');
  assert.equal(parseRegistroOficialIndex('<p>MINISTERIO DE SALUD PÚBLICA:<br>MSP-2026-1 Se concede personalidad jurídica</p>')[0].organ, null);
  assert.throws(() => parseRegistroOficial('<html></html>'));
});

test('Registro Oficial: un asunto largo se recorta en límite de palabra y las notas con el titular antiguo se pasan al nuevo', () => {
  // Titular real de la edición publicada (255 caracteres con órgano y código).
  const text = 'Se amplía el plazo para la liquidación de la Cooperativa de Ahorro y Crédito el Esfuerzo Ltda. “En Liquidación”, domiciliada en el cantón Ambato, provincia de Tungurahua';
  const xml = `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Registro Oficial No. 405</title><link>https://www.registroficial.gob.ec/registro-oficial-no-405/</link><pubDate>Wed, 11 Nov 2026 13:07:00 +0000</pubDate><content:encoded><![CDATA[<p>SUPERINTENDENCIA DE ECONOMÍA POPULAR Y SOLIDARIA:<br>SEPS-IGT-IGJ-INFMR-DNLESF-2026-0160 ${text}</p>]]></content:encoded></item></channel></rss>`;
  const [row] = parseRegistroOficial(xml);
  assert.ok(row.title.length <= 160, String(row.title.length));
  assert.ok(row.title.endsWith('…'));
  assert.ok(text.startsWith(row.title.slice(0, -1)), 'solo se recorta el texto del sumario');
  assert.equal(row.excerpt, 'Superintendencia de Economía Popular y Solidaria · SEPS-IGT-IGJ-INFMR-DNLESF-2026-0160. Registro Oficial No. 405.');
  // Nota conservada de una edición anterior con el titular «Órgano: CÓDIGO asunto».
  const ro = sourceById('registro-oficial');
  const old = { ...make('registro-oficial', 30), category: 'regulacion', kind: 'official', url: 'https://www.registroficial.gob.ec/quinto-suplemento-no-410/', title: 'Junta de Política y Regulación Financiera y Monetaria: JPRFM-2026-051-F Se reforma la Codificación de Resoluciones Monetarias, Financieras, de Valores y Seguros', excerpt: 'Registro Oficial, Quinto Suplemento No. 410.' };
  const [carried] = accumulate([], [old], ro, { now, keep: story => relevant(story, ro) });
  assert.equal(carried.title, 'Se reforma la Codificación de Resoluciones Monetarias, Financieras, de Valores y Seguros');
  assert.equal(carried.excerpt, 'Junta de Política y Regulación Financiera y Monetaria · JPRFM-2026-051-F. Registro Oficial, Quinto Suplemento No. 410.');
  // Una nota ya en el formato nuevo, o un titular cualquiera con dos puntos, no se toca.
  assert.equal(readableNorm(carried), carried);
  const press = { title: 'Superintendencia de Bancos: “Las instituciones financieras tienen el músculo suficiente”' };
  assert.equal(readableNorm(press), press);
});

// Muestras de titulares pertinentes (true) y de ruido (false) de la verificación de fuentes, por fuente.
// La URL se indica cuando la fuente tiene regla de ruta. Generadas a partir del informe; no editar a mano.
const SAMPLES = [
  ["primicias","Superintendencia autoriza a GIA Holding la compra de acciones de AIG Metropolitana","https://www.primicias.ec/economia/nota/",true],
  ["primicias","Banco Mundial aprueba USD 30 millones para Ecuador, que debe demostrar que ha reducido emisiones contaminantes","https://www.primicias.ec/economia/nota/",true],
  ["primicias","Surindu busca financiamiento por USD 30 millones en el mercado bursátil de Ecuador","https://www.primicias.ec/economia/nota/",true],
  ["primicias","Décimo de Navidad: ¿Cuánto recibirá este 2026 en Ecuador? Calcule aquí su bono","https://www.primicias.ec/economia/nota/",false],
  ["primicias","China Mall, Hiperasia y otros megaalmacenes chinos se expanden en Ecuador","https://www.primicias.ec/economia/nota/",false],
  ["primicias","¿Va a renovar electrodomésticos en Black Friday?","https://www.primicias.ec/economia/nota/",false],
  ["eluniverso","Préstamos falsos: “Ninguna institución financiera autorizada le va a decir que necesita un valor previo para poder calificar el crédito”",null,true],
  ["eluniverso","Ecuador obtiene respaldo por $ 30 millones para financiamiento climático",null,true],
  ["eluniverso","Noboa Trading destaca en Machala en el Banana Business 2026",null,false],
  ["eluniverso","Productores de Riobamba reciben 38 kits fitosanitarios",null,false],
  ["eluniverso","Banaflex gana concurso estudiantil de Banco del Pacífico",null,false],
  ["bloomberg-ecuador","Ecuador podría recibir otros US$1.090 millones del FMI entre crédito y financiamiento climático",null,true],
  ["bloomberg-ecuador","Ecuador presenta su Proforma 2027 con recursos para sectores clave y un petróleo estimado en US$66",null,true],
  ["bloomberg-ecuador","Así se movió el riesgo país en América Latina en octubre: fuerte alza en Argentina y Ecuador",null,true],
  ["bloomberg-ecuador","Riesgo país en Latinoamérica comienza noviembre con Venezuela al alza y Argentina y Ecuador lejos de sus mínimos",null,true],
  ["bloomberg-ecuador","Cómo será la preventa de Don Omar en Ecuador",null,false],
  ["bloomberg-ecuador","FMI prevé menor crecimiento en Colombia",null,false],
  ["bloomberg-ecuador","Wells Fargo proyecta que el S&P 500 llegará a 8.200 puntos en 2027",null,false],
  ["forbes-ec","Las nuevas reglas para los pagos con tarjetas en Ecuador",null,true],
  ["forbes-ec","Nuevo crédito del FMI por US$ 710 millones",null,true],
  ["forbes-ec","Daniel Noboa decreta hasta 90 días de plazo para que los bancos cobren deudas a afectados por El Niño",null,true],
  ["forbes-ec","Asobanca propone facilidades de pago a los clientes afectados por las lluvias",null,true],
  ["forbes-ec","Estos son los bancos más grandes del mundo en 2026",null,false],
  ["forbes-ec","Jensen Huang abandona Nvidia tras escándalos",null,false],
  ["forbes-ec","El jugo de mora burbujeante del Ecuador tiene 112 años",null,false],
  ["seps","La SEPS alerta sobre 134 entidades no autorizadas y llama a prevenir el fraude financiero",null,true],
  ["seps","Corte Provincial respalda la actuación de la SEPS y descarta vulneración de derechos",null,true],
  ["superbancos","Calificación de Riesgo Instituciones Financieras 2026",null,true],
  ["superbancos","SB presenta su Informe de Sostenibilidad",null,false],
  ["mef","El Gobierno de Daniel Noboa alcanza acuerdo técnico con el FMI previo a la sexta revisión de su programa económico",null,true],
  ["mef","GOBIERNO DE DANIEL NOBOA PRIORIZA MÁS RECURSOS PARA OBRAS E INVERSIÓN SOCIAL EN LA PROFORMA 2027",null,true],
  ["mef","EN EL GOBIERNO DE NOBOA AUMENTA EL CONSUMO DE LAS FAMILIAS ECUATORIANAS",null,false],
  ["mef","EL GOBIERNO NACIONAL CUMPLE CON EL PAGO DEL DÉCIMO TERCER SUELDO PARA DINAMIZAR LA ECONOMÍA DE LAS FAMILIAS",null,false],
  ["supercias","Superintendente presentó recomendaciones al proyecto de Ley de Concurso Preventivo",null,true],
  ["supercias","Superintendente asistió a la Sesión Solemne por los 206 años de provincialización del Guayas",null,false],
  ["supercias","Superintendencia participó en Money Day 2026 con un panel sobre protección al inversionista",null,false],
  ["supercias","Disculpas públicas por disposición judicial",null,false],
  ["supercias","Superintendencia realizó capacitaciones sobre disolución, liquidación y cancelación en Quito",null,false],
  ["reguladores-prensa","Botón de pánico, alertas contra fraudes y atención 24 horas: así es la nueva norma de ciberseguridad para cooperativas, mutualistas y otras entidades",null,true],
  ["reguladores-prensa","Nuevas reglas para tarjetas en Ecuador: 7 cambios que te interesan si pagas con crédito o débito",null,true],
  ["reguladores-prensa","Diferimiento de créditos por El Niño no será automático y requerirá autorización del cliente",null,true],
  ["reguladores-prensa","Estas son las falsas cooperativas no autorizadas para operar en Ecuador, alerta Superintendencia de Economía Popular y Solidaria",null,true],
  ["reguladores-prensa","Auge de entidades sin permiso para captar dinero y dar crédito encubriría posibles delitos de lavado de dinero y narcotráfico, advierte superintendente",null,true],
  ["reguladores-prensa","Banco Central de Paraguay interviene Ueno Bank, vinculado al presidente Santiago Peña",null,false],
  ["reguladores-prensa","Christine Lagarde dejará la presidencia del Banco Central Europeo en febrero",null,false],
  ["reguladores-prensa","El SRI despliega más de 111 brigadas móviles en el país durante noviembre",null,false],
  ["reguladores-prensa","Quito Fashion Week: Takiri, Cristina Toro, Paula Recalde y Ramiro Naranjo, cuatro miradas de la moda ecuatoriana",null,false],
  ["iupana","EE. UU. cuestiona gobernanza de Pix, pero reelección de Lula fortalece posición del Banco Central como regulador y operador",null,true],
  ["iupana","Perú atrae nuevos adquirentes y Niubiz busca diferenciarse con préstamos e IA",null,true],
  ["iupana","Resolución de ueno bank de Paraguay abre espacio a competidores",null,true],
  ["iupana","Entel busca ganar espacio en el negocio de ciberseguridad, pero su imagen como telco aún pesa",null,false],
  ["latamlist","Colombian fintech Akua secures investment from Itaú Unibanco",null,true],
  ["latamlist","Cocos raises $34M at $508M valuation",null,true],
  ["latamlist","Clara raises $105M Series C round",null,true],
  ["latamlist","Vuun raises $525K pre-seed round led by 500 Global",null,false],
  ["latamlist","Nova raises $24M Series A led by Canaan",null,false],
  ["bloomberg-negocios","Revolut prevé lanzar su banco en Argentina en el segundo semestre de 2027",null,true],
  ["bloomberg-negocios","Nu ve oportunidad de ser más competitivo en México con Ley de Economía Digital",null,true],
  ["bloomberg-negocios","De US$50.000 a valer US$508 millones: la fintech Cocos atrajo al fondo que apostó por Nubank",null,true],
  ["bloomberg-negocios","“Queremos salir a la bolsa de EE.UU. y ser el próximo unicornio argentino”, dice el CEO de Laboratorios Richmond",null,false],
  ["bloomberg-negocios","Banca de México trabaja en financiar proyectos mixtos de CFE con empresas privadas",null,false],
  ["la-republica","Revolut Colombia aclara que la supervisión judicial de Italia no afecta sus operaciones",null,true],
  ["la-republica","Existen al menos ocho billeteras en el mercado que permiten comprar dólares digitales",null,true],
  ["la-republica","Plata anunció que elevará su compromiso de inyección de capital a US$400 millones",null,true],
  ["la-republica","El dólar se cotiza más de $7 al alza, mientras estiman nueva subida de tasas de la FED",null,false],
  ["la-republica","Oro cae por debajo de los US$3.800 mientras la FED da señales de subida en las tasas",null,false],
  ["la-republica","Banco Popular tuvo una utilidad neta acumulada de $50.000 hasta septiembre",null,true],
  ["expansion-mx","Ley de Economía Digital desempolva a CoDi: bancos facilitarán su uso a partir de diciembre",null,true],
  ["expansion-mx","Quiebra de Ueno Bank exhibe fallas de supervisión y corrupción en Paraguay, advierte Moody’s",null,true],
  ["expansion-mx","Ley de economía digital: los riesgos que enfrentarán los usuarios con más pagos con QR y transferencias",null,true],
  ["expansion-mx","Buen fin 2026: Guía para evitar deudas con la tarjeta de crédito, según Condusef",null,false],
  ["expansion-mx","Barclays prevé otro recorte de Banxico en marzo y anticipa una tasa de 6% en 2027",null,false],
  ["el-economista","Nuevos bancos digitales suman 200,000 millones de pesos en activos; 1.2% del sector",null,true],
  ["el-economista","Nubank y Mercado Pago suspenden sus transferencias de criptomonedas por inestabilidad en el sistema",null,true],
  ["el-economista","Fintech ven oportunidad de negocio en factoraje para impulsar crédito a pymes",null,true],
  ["el-economista","Casinos con depósito mínimo en México: top 10 desde 20 MXN",null,false],
  ["el-economista","Televisa y Fintech compran un AT&T que gana 3.6 centavos de cada dólar que ingresa",null,false],
  ["el-economista","EU derrota 6-0 a Haití en cuartos de Liga de Naciones, su mayor goleada con Pochettino",null,false],
  ["diario-financiero","Banco de Chile, Bci y BancoEstado entran en la recta final por la compra de Transbank",null,true],
  ["diario-financiero","Toku crea holding, separa sus negocios y tramita licencia ante la CMF",null,true],
  ["diario-financiero","AgendaPro entra al negocio fintech con créditos para PYME no bancarizadas",null,true],
  ["diario-financiero","Comisión de Hacienda avanza en votación de reforma MK4 y aprueba creación del Fonavi",null,false],
  ["diario-financiero","CMPC vende toda su operación forestal en Argentina por US$ 170 millones",null,false],
  ["diario-financiero","Nuevo proyecto con viviendas y hotel a pasos de mall Alto Las Condes",null,false],
  ["endeavor-ar","Endeavor Catalyst cierra su Fondo V de USD 320 millones: desde 2011 ya invirtió en 21 compañías argentinas",null,true],
  ["endeavor-ar","Nuevos miembros del Board de Endeavor Argentina",null,false],
  ["endeavor-ar","Los fundadores de Tiendanube fueron elegidos “Emprendedores Endeavor del Año”",null,false],
  ["ft-banking","EU banking watchdog veers away from single deposit insurance scheme",null,true],
  ["ft-banking","Don't scoff at the dangers of tokenisation",null,true],
  ["ft-banking","The warnings from Paraguay's banking scandal",null,true],
  ["ft-banking","Aldi owners used 'aggressive' Deutsche Bank scheme to avoid EUR200mn tax",null,false],
  ["ft-banking","German coalition disagreements hold up ECB jobs deal",null,false],
  ["ft-fintech","Bank of England orders probe into Revolut's internal controls",null,true],
  ["ft-fintech","Monzo explores fundraising at GBP7.5bn valuation as private equity talks stall",null,true],
  ["ft-fintech","What caused the $6.3bn Binance hack?",null,false],
  ["ft-fintech","Quant hedge fund to spin out of Tudor in record $9bn launch",null,false],
  ["wsj-markets","AI Bots Are Using Credit Cards. Banks Are Racing to Keep Up.",null,true],
  ["wsj-markets","Corporate-Card Startup Ramp Raising Funds at $70 Billion Valuation",null,true],
  ["wsj-markets","Financial Services Roundup: Market Talk",null,false],
  ["wsj-markets","WSJ Dollar Index Falls 0.04% to 98.42",null,false],
  ["wsj-markets","11 of the Best Financial Advisor Companies",null,false],
  ["americanbanker","Bank capital rules inch closer to finalization",null,true],
  ["americanbanker","FDIC approves embattled OneMain to establish an ILC bank",null,true],
  ["americanbanker","Fuse Chosen and Showcased at the Money20/20 Startup Media Session",null,false],
  ["bankingdive","Dave applies for national bank charter","https://www.bankingdive.com/news/nota/1/",true],
  ["bankingdive","OpenAI wallet taps card networks","https://www.bankingdive.com/news/nota/1/",true],
  ["bankingdive","JPMorgan hires up to win smaller M&A business","https://www.bankingdive.com/news/nota/1/",false],
  ["paymentsdive","Fed to boost payment service fees","https://www.paymentsdive.com/news/nota/1/",true],
  ["paymentsdive","Visa, Mastercard face possible trial","https://www.paymentsdive.com/news/nota/1/",true],
  ["paymentsdive","Why PayPal wants to have a bank","https://www.paymentsdive.com/news/nota/1/",true],
  ["paymentsdive","Why \"faster cash flow\" sells embedded payments to US SMBs","https://www.paymentsdive.com/spons/nota/1/",false],
  ["paymentsdive","Embedded finance in 2026: What merchants want","https://www.paymentsdive.com/spons/nota/1/",false],
  ["pymnts","Visa Adds PayPal and Stripe to Agentic Ready Program",null,true],
  ["pymnts","Singapore Steps Up Use of AI to Combat Fraud",null,true],
  ["pymnts","62% of CFOs Say Their Teams Can Absorb Fraud Losses Without Disruption",null,false],
  ["pymnts","SEC Investigating Whether Nvidia Misled Investors",null,false],
  ["pymnts","Croissant Launches AI Personal Shopper",null,false],
  ["finextra","Canada's real-time payments system launches",null,true],
  ["finextra","EU and Canada plan to link real-time payment systems",null,true],
  ["finextra","HKMA and Swift explore tokenised deposits for cross-border payments",null,true],
  ["finextra","The Speed Trap: Why Instant Payments Are Creating a Real-Time Fraud Crisis: By Nanne Parmar",null,false],
  ["finextra","Nomupay joins Amazon Web Services marketplace",null,false],
  ["thebanker","Reg Wrap: Bundesbank says stablecoins jeopardise banks' Basel III compliance",null,true],
  ["thebanker","Revolut put under judicial oversight in Italy over AML failings",null,true],
  ["thebanker","How digital money could make payments faster and simpler",null,true],
  ["thebanker","Regulation - TheBanker.com",null,false],
  ["thebanker","Albania's banks seize growth opportunities",null,false],
  ["thebanker","Top 200 Latin American banks 2026: Highlights",null,false],
  ["expansion-banca","Sabadell reordena su negocio de pagos para impulsar el crecimiento",null,true],
  ["expansion-banca","El 73% de los españoles no usaría el euro digital",null,true],
  ["expansion-banca","La justicia italiana interviene la sucursal de Revolut por fallos en el control antiblanqueo",null,true],
  ["expansion-banca","CaixaBank y la magia de la media móvil de 50 semanas",null,false],
  ["expansion-banca","Unicaja renueva a Rubiales otros tres años",null,false],
  ["expansion-banca","Kutxabank, BBVA y Laboral Kutxa venden cuentas vivienda con derecho a desgravación",null,false],
  ["fed","Federal Reserve Board announces pricing, effective January 1, 2027, for payment services",null,true],
  ["fed","Agencies extend comment period for proposed third-party risk management guidance",null,true],
  ["fed","Federal Reserve issues FOMC statement",null,false],
  ["fed","Federal Reserve Board issues enforcement action with former employee of United Community Bank",null,false],
  ["ecb","Piero Cipollone: Cash and the digital euro: two sides of the same coin",null,true],
  ["ecb","Piero Cipollone: Shaping the future of money",null,true],
  ["ecb","Philip R. Lane: The practice and science of monetary policy communication",null,false],
  ["ecb","ECB wage tracker suggests slightly higher wage growth",null,false],
  ["bis-investigacion","Competing rails for crossborder payments: banks, fintechs, and stablecoins",null,true],
  ["bis-investigacion","The gig economy and digital payments",null,true],
  ["bis-investigacion","Prewar US business cycles under uncertainty: reconstructing quarterly GDP before 1947",null,false],
  ["bis-investigacion","Immigrants' skills and capital deepening: evidence from Chile",null,false],
  ["fsb","G20 Roadmap for Enhancing Cross-border Payments: Consolidated progress report for 2026",null,true],
  ["fsb","FSB recommends Türkiye further strengthens its regulatory framework for crypto-assets and stablecoins",null,true],
  ["fsb","FSB Regional Consultative Group for Sub-Saharan Africa meets in Maseru",null,false],
  ["fsb","Peer Review of Türkiye",null,false],
  ["boe","Project Meridian FX APAC (Bank of England, MAS, Bank of Thailand)",null,true],
  ["boe","Bank of England sets out approach to tokenised collateral in central clearing",null,true],
  ["boe","Minutes of the Meeting of the Court of Directors held on 17 September 2026",null,false],
  ["boe","Bank rate increased to 4% - November 2026 Monetary Policy Summary and Minutes",null,false],
  ["fintech-business-weekly","Kontigo's License Suspended, Cutting The Venezuelan Crypto App Off From Country's Banking System",null,true],
  ["fintech-business-weekly","OCC Issues \"Super Intelligence\" Framework for Bank Examiners",null,true],
  ["fintech-business-weekly","Building An AI-Native Dispute Automation Platform, with Decisionly's Pallavi Kuppa-Apte",null,false],
  ["fintech-business-weekly","I Never Thought It Would Happen To Me",null,false],
  ["ecb-supervision","Anneli Tuominen: Anti-money laundering: how are supervisors tackling the current challenges?",null,true],
  ["ecb-supervision","Patrick Montagner: Stress testing in a changing risk environment",null,true],
  ["ecb-supervision","Frank Elderson: Interview with Die Presse",null,false],
  ["ecb-supervision","Frank Elderson: Taking action for nature - investing in economic resilience and prosperity",null,false],
  ["eba","EBA supports further progress on the Banking Union, including on deposit insurance",null,true],
  ["eba","The EBA streamlines the 2027 EU-wide stress test with more than 55% reduction in requested data",null,true],
  ["eba","The EBA appoints Kristine Cernaja-Mezmale as its new Vice-Chair",null,false],
  ["eba","The EBA extends some consultation deadlines due to website maintenance",null,false],
  ["ft-cripto","NYSE owner’s tokenised stock plan hits hurdle as big companies object",null,true],
  ["ft-cripto","Crypto exchange HTX agrees to exit UK after being sued by watchdog",null,true],
  ["ft-cripto","North Korean hackers expected to take months to launder Binance billions",null,true],
  ["ft-cripto","Trump Media investors learn the Truth about betting on bitcoin",null,false],
  ["ft-cripto","Would you take out a mortgage backed by bitcoin?",null,false],
  ["coindesk","U.S. Fed Governor Waller pitches keeping central bank at the center of tokenization","https://www.coindesk.com/business/2026/11/17/nota",true],
  ["coindesk","Hong Kong, Swift test tokenized deposits as banks chase stablecoin-style speed","https://www.coindesk.com/business/2026/11/17/nota",true],
  ["coindesk","U.S. judge says Ethereum has ‘no terms of use,’ clears MIT brothers of $25 million fraud","https://www.coindesk.com/business/2026/11/17/nota",true],
  ["coindesk","Bitcoin drops as Nvidia earnings report drives stock index futures higher","https://www.coindesk.com/business/2026/11/17/nota",false],
  ["coindesk","Strategy stock could plunge 76% to $23, chart analyst warns","https://www.coindesk.com/business/2026/11/17/nota",false],
  ["coindesk","XRP whales moved $270 million during the selloff","https://www.coindesk.com/business/2026/11/17/nota",false],
  ["theblock","Hong Kong central bank explores agentic AI to detect crypto-related financial crime","https://www.theblock.co/news/business/nota",true],
  ["theblock","World Bank Group taps Circle and Citi to test stablecoin-based fund disbursements","https://www.theblock.co/news/business/nota",true],
  ["theblock","DBS lets eligible institutions in Asia mint and redeem USDC around the clock","https://www.theblock.co/news/business/nota",true],
  ["theblock","‘Gift from the market’: Bitcoin shows signs of a local bottom after six weeks of losses, analyst says","https://www.theblock.co/news/business/nota",false],
  ["theblock","TD Cowen tempers ether outlook, maintains Buy rating on Sharplink","https://www.theblock.co/news/business/nota",false],
  ["theblock","Stablecoin infrastructure firm Avenia raises $25 million in Series A extension","https://www.theblock.co/news/business/nota",false],
  ["reuters-cripto","Global watchdog urges Turkey to strengthen crypto rules",null,true],
  ["reuters-cripto","Deutsche Bank launches digital asset custody service",null,true],
  ["reuters-cripto","Nubank, Mercado Pago halt crypto transfers after external provider disruption",null,true],
  ["reuters-cripto","US aviation shutdown blamed on L3 Harris installed router",null,false],
  ["reuters-cripto","Cryptocurrencies slide to two-month lows after US midterms",null,false],
  ["reuters-cripto","Interest in Trump’s meme coin dinner fades as $TRUMP sinks to record lows",null,false],
  ["criptonoticias","El BCE presiona para aprobar el euro digital mientras negocia los límites a la privacidad","https://www.criptonoticias.com/regulacion/nota/",true],
  ["criptonoticias","MEXC pone fin a su tarjeta global en medio de restricciones de Estados Unidos","https://www.criptonoticias.com/regulacion/nota/",true],
  ["criptonoticias","Por qué EE.UU. no pudo condenar el «saqueo» de USD 25 millones en Ethereum","https://www.criptonoticias.com/regulacion/nota/",true],
  ["criptonoticias","Tras el desplome de noviembre: ¿dónde encontrar rentabilidad más allá de Bitcoin?","https://www.criptonoticias.com/regulacion/nota/",false],
  ["criptonoticias","CISA pide parchear ya Java4Shell, la falla de Java que Oracle acaba de confirmar","https://www.criptonoticias.com/regulacion/nota/",false],
  ["criptonoticias","CoinShares vende todos los ETH y la mitad de SOL de su tesorería","https://www.criptonoticias.com/regulacion/nota/",false],
  ["bloomberg-cripto","El mercado cripto colombiano crece más que la región, pero sigue sin regulación",null,true],
  ["bloomberg-cripto","¿Ley de rescate fiscal en Colombia le pondría impuesto al bitcoin, ether y otras cripto? así lo plantea el Gobierno",null,true],
  ["bloomberg-cripto","Tokenización de acciones busca abrirse paso en el mercado bursátil de EE.UU. pese al rechazo de las empresas",null,true],
  ["bloomberg-cripto","Bitcoin cae por debajo de US$70.000 mientras el alza de los rendimientos presiona a las criptomonedas",null,false],
  ["bloomberg-cripto","Cotización Cemex SAB de CV - CEMEXCPO hoy 2026-11-13",null,false],
  ["bloomberg-cripto","Invertir en bitcoin en 2027: cuánto destinar de la cartera y qué factores moverán el precio, según analistas",null,false],
  ["expansion-cripto","Las ‘stablecoin’, en el centro del debate de la regulación MiCA","https://www.expansion.com/mercados/criptomonedas/2026/11/14/nota.html",true],
  ["expansion-cripto","Deutsche Bank se lanza a la custodia de criptoactivos y explora opciones con DWS","https://www.expansion.com/mercados/criptomonedas/2026/11/14/nota.html",true],
  ["expansion-cripto","JPMorgan lanza depósitos tokenizados para sus clientes institucionales","https://www.expansion.com/mercados/criptomonedas/2026/11/14/nota.html",true],
  ["expansion-cripto","El precio del Bitcoin hoy, 30 de octubre: el Bitcoin asciende hasta los 78.038,63 dólares","https://www.expansion.com/mercados/criptomonedas/2026/11/14/nota.html",false],
  ["expansion-cripto","El bitcoin se adentra en niveles de 'miedo extremo'","https://www.expansion.com/mercados/criptomonedas/2026/11/14/nota.html",false],
  ["expansion-cripto","Strive pisa el acelerador en tesorería de bitcoin","https://www.expansion.com/mercados/criptomonedas/2026/11/14/nota.html",false],
  ["cinco-dias-cripto","Víctor Rodríguez (CNMV): “No podemos aceptar ‘stablecoins’ no conformes a MiCA en la UE”",null,true],
  ["cinco-dias-cripto","Los reguladores europeos quieren acelerar la integración de los mercados tokenizados",null,true],
  ["cinco-dias-cripto","El fondo europeo de rescate emite su primer bono digital en Pontes, la plataforma del BCE",null,true],
  ["cinco-dias-cripto","La tormenta perfecta sobrevuela bitcoin: corrige un 20% en dos semanas",null,false],
  ["cinco-dias-cripto","MSCI cumple con su amenaza y excluye a Strategy de sus índices",null,false],
  ["chainalysis","FinCEN Bars U.S. Institutions From Moving Funds for MEXC Global",null,true],
  ["chainalysis","Sanctioned Canadian Crypto OTCs Served Iran and Drug Cartels",null,true],
  ["chainalysis","The $6.4 Billion Binance Hack: Tracing the North Korea Link",null,true],
  ["chainalysis","Updated Nov 10: Chainalysis Security Incident Information",null,false],
  ["chainalysis","The Shadow Market Behind China’s AI Model Distillation Boom",null,false],
  ["endeavor-prensa","Addi invertirá US$2.000 millones en Colombia para ampliar el crédito y lanzar una cuenta de ahorros",null,true],
  ["endeavor-prensa","La fintech Bold recibió $37.450 millones de Bbva Spark para ampliar los créditos a las Pyme",null,true],
  ["endeavor-prensa","Beatriz Eugenia Fernández recibirá el Premio a la Excelencia Empresarial Forbes Colombia 2026",null,false],
  ["endeavor-prensa","Clara Brugada anuncia apoyo a startups de la Ciudad de México",null,false],
  ["endeavor-prensa","DLocal (NASDAQ:DLO) Stock Price Target Cut by Truist Financial",null,false],
  ["endeavor-prensa","Las acciones de dLocal caen tras decepcionar con sus ingresos",null,false],
  ["endeavor-prensa","Truist Securities mantiene a DLocal en «compra» y recorta su precio objetivo de $17 a $16",null,false],
  ["endeavor-prensa","HYPE Price Jumps as Latin American Exchange Bitso Expands Hyperliquid Access",null,false],
  ["endeavor-prensa","dLocal reports Q3 2026 revenue up 41% and net income",null,true],
  ["endeavor-prensa","Bitso procesa 15% de las remesas de EU a México con stablecoins",null,true],
  ["endeavor-prensa","Belvo y dLocal se alían en México para llevar la domiciliación bancaria a más empresas",null,true],
  // Titulares promocionales reales (ENDEAVOR_PROMO): cupones, 0 % de inicial, «por tiempo limitado», premios a usuarios.
  ["endeavor-prensa","Cashea activa beneficios de su Club en Tiendas Daka con 0% de inicial hasta finales de 2026",null,false],
  ["endeavor-prensa","Famosa tienda de electrodomésticos anunció compras con 0% de inicial en Cashea: Lo que debes saber",null,false],
  ["endeavor-prensa","El cupón que habilitó Cashea hasta el 13Nov y se activa sin costo",null,false],
  ["endeavor-prensa","¡Melendi ahora con Cashea por tiempo limitado!",null,false],
  ["endeavor-prensa","Cashea premiará a usuarios nivel 6 con “Mi pase”",null,false],
  ["endeavor-prensa","Cashea alista nueva etapa para ofrecer financiamiento de vehículos y viviendas en Venezuela: los detalles",null,true],
  ["endeavor-prensa","Buen Fin: las pymes pueden competir con las grandes cadenas sin sacrificar sus márgenes: Kueski",null,true],
  // Auditoría de filtros (19-11-2026): titulares reales que el filtro descartaba (true) y ruido que debe seguir fuera (false),
  // tomados de los descartes de cada fuente. Ecuador: la banca como negocio (crédito informal, bolsa, banca pública).
  ["primicias","Chulco digital crece en Ecuador con tasas de hasta 2.000%; uno de cada tres deudores ha tenido que vender sus bienes para pagar","https://www.primicias.ec/economia/nota/",true],
  ["primicias","Celec reactiva la construcción de hidroeléctrica San Antonio, en Cañar, con un presupuesto de USD 19 millones","https://www.primicias.ec/economia/nota/",false],
  ["primicias","Autoriza a la colombiana Nutresa la compra de La Universal en Ecuador","https://www.primicias.ec/economia/nota/",false],
  ["forbes-ec","Trae nuevos aires a la Bolsa de Valores Guayaquil",null,true],
  ["forbes-ec","El banco que hizo caer al Presidente de Paraguay, Santiago Peña: toda la cronología",null,false],
  ["reguladores-prensa","Créditos de hasta $ 1,5 millones para pymes: CFN aprueba reglamento para canalizar $ 203 millones del BID",null,true],
  ["reguladores-prensa","Biess crea plan CrediCasa con el 7 % de interés para migrantes en el exterior",null,true],
  ["reguladores-prensa","Fundación Ana y Banco Atlántida firman acuerdo para apoyar con microcréditos a mujeres emprendedoras",null,false],
  ["reguladores-prensa","Caso La Reina: dictan prisión preventiva para Navila Dieb por presunto lavado de activos",null,false],
  ["mef","En el gobierno de Daniel Noboa crece el dinamismo económico: USD 5.487 millones en créditos de la banca pública para el sector productivo, inversión pública y desarrollo de los hogares",null,true],
  ["bce-boletines","El crédito del sistema financiero creció 20,9% en octubre y alcanzó USD 4.978 millones",null,true],
  ["bce-boletines","El BCE actualiza normativa aplicable a la recepción y canje de billetes de USD 50 y USD 100",null,true],
  ["bce-boletines","El BCE impulsó la comercialización responsable de oro con jornadas de capacitación en tres provincias del país",null,false],
  ["bce-boletines","Ecuador registró un superávit comercial de USD 3.308 millones entre enero y septiembre de 2026",null,false],
  ["bce-publicaciones","Boletín de Reservas Internacionales. Octubre 2026",null,true],
  ["bce-publicaciones","Perspectivas de Oferta y Demanda de Crédito. III Trimestre 2026",null,true],
  ["bce-publicaciones","Evolución del Monto de Operaciones Activas y Pasivas. Octubre 2026",null,true],
  ["bce-publicaciones","Boletín Analítico de Gestión de Liquidez. Septiembre 2026",null,true],
  ["bce-publicaciones","Boletín Mensual de Inflación. Septiembre 2026",null,false],
  ["bce-publicaciones","Estadísticas de Cemento en el Ecuador. Septiembre 2026",null,false],
  // Fintech LATAM: banca y reguladores de la región, pagos inmediatos, fintech por nombre; fuera política monetaria y mercados.
  ["diario-financiero","Banco Central alista regulación para impulsar el “Pix chileno” y stablecoins",null,true],
  ["diario-financiero","Banco Central mantiene exigencia de capital para la banca, en medio de elevados riesgos financieros",null,true],
  ["diario-financiero","IEF del Banco Central advierte por mayores riesgos financieros y deterioro en capacidad de pago de hogares y empresas",null,true],
  ["diario-financiero","Santander redobla apuesta por el segmento joven y lanza hipotecario con plazo de hasta 40 años",null,true],
  ["diario-financiero","¿Impacto del alza del dólar? Mercado se abre a la posibilidad de que el Banco Central suba la tasa este año",null,false],
  ["diario-financiero","US$ 7.500 millones: Banco Central renueva acuerdo de swaps de monedas con su par de China",null,false],
  ["diario-financiero","Ana Botín vuelve a apostar por Santander y sube su participación en el banco tras compra de acciones",null,false],
  ["diario-financiero","Minutas de la Fed revelan que funcionarios ven necesarias nuevas alzas de tasas para contener la inflación",null,false],
  ["el-economista","Transferencias bancarias con tu celular: qué cambia con las nuevas reglas de Banxico",null,true],
  ["el-economista","Incidentes cibernéticos en el sistema financiero nacional se triplican; van 13 en el 2026",null,true],
  ["el-economista","GAFI termina evaluación a México contra lavado de dinero",null,true],
  ["el-economista","Ganancia MercadoLibre no alcanza expectativas por gasto en logística; ingresos superan estimaciones",null,true],
  ["el-economista","Banco del Bienestar lanza nueva app: Así puedes transferir dinero, pagar y recibir depósitos",null,true],
  ["el-economista","Financieras tradicionales y nuevas no han cerrado la brecha de crédito por falta de información: PayJoy",null,true],
  ["el-economista","Conflicto en Medio Oriente exige cautela monetaria ante riesgos inflacionarios: Galia Borja",null,false],
  ["el-economista","Renta 4 quiere ser Casa de Bolsa en México",null,false],
  ["la-republica","Binance lanza 'Pay Later', la primera línea de pago diferido respaldada por cripto",null,true],
  ["la-republica","Los bancos alcanzaron más de $12,8 billones en utilidades con corte al tercer trimestre del año",null,true],
  ["la-republica","Banco Popular apuesta a duplicar su cartera de tarjetas de crédito con nuevo portafolio",null,true],
  ["la-republica","El dólar cerró en $3.301,87, $4,8 por encima de la TRM del día, que se ubicó en $3.297,07",null,false],
  ["la-republica","Preferencial de Davivienda y Grupo Argos, las acciones más valorizadas de la jornada",null,false],
  ["la-republica","A pesar de crecimiento de la utilidad de Ecopetrol, su acción cae en la Bolsa de Colombia",null,false],
  ["expansion-mx","Deutsche Bank en México: Vendió su licencia a Citi y los fideicomisos a CIBanco",null,true],
  ["expansion-mx","Ganancias de los bancos en México caen 5% al cierre del tercer trimestre de 2026",null,true],
  ["expansion-mx","Subgobernador de Banxico Omar Mejía descarta sorpresa en recorte de tasa a 6.25% y destaca prudencia del banco central",null,false],
  ["expansion-mx","Peso se deprecia por sorpresa de Banxico y analistas prevén mayor debilidad para moneda mexicana",null,false],
  ["bloomberg-negocios","Bancos esperan que México se mantenga fuera de la lista gris contra el lavado de dinero",null,true],
  ["bloomberg-negocios","México inicia cuenta regresiva para decidir los negocios que ya no aceptarán efectivo",null,true],
  ["bloomberg-negocios","El Niño golpeará la estabilidad de los bancos en Latinoamérica y estos son los países con más riesgo",null,true],
  ["bloomberg-negocios","Banco central colombiano no sorprendió al mercado: mantuvo tasas en 12,25%",null,false],
  ["bloomberg-negocios","Cotización Banco de Bogota SA - BOGOTA hoy 2026-11-13",null,false],
  ["bloomberg-negocios","Vaca Muerta: Techint, de Paolo Rocca, gana un contrato clave para Argentina LNG tras perder tres licitaciones",null,false],
  // Pagos y Cripto: huecos de plurales, autoridades y temas regulatorios; fuera rankings, salidas a bolsa y geografías ajenas.
  ["expansion-banca","El Banco de España da a Monei la categoría de entidad de pago",null,true],
  ["expansion-banca","Visa incorpora los proveedores de pago en su programa de agentes",null,true],
  ["expansion-banca","Santander elige al nuevo responsable de Riesgos de su banca de inversión",null,false],
  ["thebanker","ECB president Lagarde to step down in February; Lloyds shares drop 6% despite stronger Q3 earnings",null,true],
  ["thebanker","Lagarde’s early exit: ‘I don’t think I can remain neutral’",null,true],
  ["thebanker","Wall Street banks seek higher Anthropic IPO price despite AI sell-off",null,false],
  ["thebanker","Top 200 Latin American banks 2026: Rankings and performance",null,false],
  ["americanbanker","Fitch downgrades 4 IMBs over high debt levels",null,true],
  ["americanbanker","These are the best places for young professionals to work in 2026",null,false],
  ["americanbanker","What banks have at stake as Anthropic goes public",null,false],
  ["americanbanker","Nvidia says leadership crisis won’t derail AI capacity work",null,false],
  ["pymnts","The Fed Is Drawing a Line Between New Money and Trusted Money",null,true],
  ["pymnts","Snapchat Deploys New AI Tools for Brands and Creators",null,false],
  ["reuters-cripto","EXCLUSIVE: Italian court places Revolut unit under supervision over money-laundering failings",null,true],
  ["reuters-cripto","Israel launches ground operation in central Gaza, dozens flee",null,false],
  ["expansion-cripto","Fazil Crypto consigue el pasaporte europeo para operar en 30 países del EEE","https://www.expansion.com/mercados/criptomonedas/2026/11/06/nota.html",true],
  ["expansion-cripto","El gigante cripto Ripple lanza su propio banco","https://www.expansion.com/mercados/criptomonedas/2026/10/27/nota.html",true],
  ["expansion-cripto","Los máximos del dólar ahondan los mínimos del oro y del bitcoin","https://www.expansion.com/mercados/criptomonedas/2026/11/14/nota.html",false],
  ["coindesk","Circle turns to DBS as banks build rival digital payment systems across Asia","https://www.coindesk.com/business/2026/11/18/nota",true],
  ["coindesk","CFTC nominee questions public benefit of prediction markets as legal fight grows","https://www.coindesk.com/policy/2026/11/18/nota",true],
  ["coindesk","Predictions platform Kalshi complies with order to halt Trump mention contracts","https://www.coindesk.com/business/2026/11/18/nota",false],
  ["theblock","Trump’s CFTC picks face Senate scrutiny as prediction market turf war heats up","https://www.theblock.co/news/regulation/nota",true],
  ["theblock","Robinhood shrugs off Kalshi equities threat as Mizuho sees 86% HOOD upside","https://www.theblock.co/news/business/nota",false],
  ["chainalysis","Disrupting the Mercado Bitcoin Attack: How Chainalysis Led the Freeze of Nearly $10M in Stolen Funds",null,true],
  ["chainalysis","Western Europe’s $2 Trillion Crypto Economy Holds Firm",null,false],
  ["chainalysis","South Africa Leads Sub-Saharan Africa’s 13.4% Crypto Growth",null,false],
  // Fuentes nuevas de Fintech LATAM: iProUP y Latam Fintech Hub (búsquedas de Google News medidas el 19 de noviembre de 2026).
  ["iproup","Pomelo refuerza su equipo directivo con la incorporación de otro exNaranja X",null,true],
  ["iproup","Tres bancos argentinos se unen para pelear con Mercado Pago",null,true],
  ["iproup","Cambian las transferencias y pagos QR tras nueva normativa del BCRA",null,true],
  ["iproup","Supervielle lanza PollenX, su plataforma de banco como servicio",null,true],
  ["iproup","Banco Mundial evalúa usar USDC para enviar dinero a países en desarrollo",null,true],
  ["iproup","Licencias bancarias, crédito y cripto: los pedidos fintech al BCRA",null,true],
  ["iproup","Qué billetera virtual paga más en noviembre 2026",null,false],
  ["iproup","Cuánto ganaron los usuarios de Mercado Pago en 2025",null,false],
  ["iproup","Cuándo es el Argentina Fintech Forum 2026",null,false],
  ["iproup","Mastercard lanza tarjeta ultra exclusiva en Argentina con beneficios clave",null,false],
  ["latamfintech","Fintech Nexu obtiene una línea de crédito de US$55M de BBVA Spark para facilitar el acceso a vehículos en México",null,true],
  ["latamfintech","Fintech colombiana Palomma levanta US$14 millones y busca convertirse en el banco nativo de IA para el sector inmobiliario",null,true],
  ["latamfintech","Las denuncias por fraude en transferencias electrónicas se duplicaron en Bogotá, Cali y Barranquilla",null,true],
  ["latamfintech","El Salvador Fintech Forum 2026",null,false],
  ["latamfintech","🚀 Los 10 neobancos más valiosos de América Latina en 2026",null,false],
  ["latamfintech","Core bancario desde cero: cómo construir un banco desde la base | Mambu",null,false],
  ["latamfintech","Podcast: Endeudados by CallbookAI",null,false],
  ["latamfintech","Equity Link",null,false],
  ["latamfintech","Open Finance Connect Chile 2027",null,false],
  // Fuentes nuevas de Ecuador (búsquedas de Google News y feeds medidos el 19 de noviembre de 2026).
  ["elcomercio-ec","Cinco cambios para los usuarios de tarjetas de crédito y de débito en Ecuador",null,true],
  ["elcomercio-ec","¿Vives fuera de Ecuador? Así puedes acceder al nuevo crédito del Biess para comprar casa",null,true],
  ["elcomercio-ec","Caída de Microsoft paraliza bancos, tribunales e instituciones de Asia-Pacífico",null,false],
  ["elcomercio-ec","El Banco Central Europeo presiona para lanzar el euro digital",null,false],
  ["elcomercio-ec","Cómo atenderán los bancos privados durante el feriado de noviembre",null,false],
  ["teleamazonas","Nueva regulación para tarjetas de crédito en Ecuador: reglas, prohibiciones y plazos",null,true],
  ["teleamazonas","Crédito en Ecuador aumentó más de 20% en octubre de 2026; comercio recibió más financiamiento",null,true],
  ["teleamazonas","Superintendencia alerta sobre 134 entidades no autorizadas para ofrecer créditos en Ecuador",null,true],
  ["teleamazonas","Falla informática afecta a miles de clientes de bancos en Estados Unidos",null,false],
  ["teleamazonas","Senado brasileño aprueba recorte de gastos de Lula para contener la deuda pública",null,false],
  ["teleamazonas","Banco Central de Paraguay devuelve parte de sus ahorros a los clientes de Ueno Bank",null,false],
  ["lahora","Morosidad, $1.266 millones en créditos castigados y el plazo de 2027: el ultimátum del FMI a las cooperativas en Ecuador",null,true],
  ["lahora","Deuda interna al 9%: el sobrecosto de financiarse en Ecuador y más de $7.700 millones previstos para 2027",null,true],
  ["lahora","Banco del Pacífico reactiva créditos para pymes ante el Fenómeno de El Niño",null,true],
  ["lahora","Santiago Peña renuncia a la Presidencia de Paraguay en medio de crisis bancaria",null,false],
  ["cfn","CFN y BID impulsan a las mujeres ecuatorianas con el producto financiero “ELLA”","https://www.cfn.fin.ec/cfn-y-bid-impulsan-a-las-mujeres-ecuatorianas-con-el-producto-financiero-ella/",true],
  ["cfn","LA CFN MANTIENE LA CALIFICACIÓN DE RIESGO “AAA-” Y FORTALECE SU CAPACIDAD PARA IMPULSAR EL DESARROLLO PRODUCTIVO DEL ECUADOR","https://www.cfn.fin.ec/la-cfn-b-p-mantiene-su-solidez/",true],
  ["cfn","SOLICITUD DE OFERTAS FORTALECIMIENTO TECNOLÓGICO DE LA CFN B.P. MEDIANTE LA ADQUISICIÓN DEL LICENCIAMIENTO PERPETUO DE MICROSOFT OFFICE","https://www.cfn.fin.ec/solicitud-de-ofertas/",false],
  ["cfn","GRANDES OPCIONES DE INVERSIÓN Y CRECIMIENTO  EN LA SUBASTA DE BIENES 2026","https://www.cfn.fin.ec/subasta/",false],
  ["cfn","MÁS PRESENTES QUE NUNCA","https://www.cfn.fin.ec/mas-presentes-que-nunca/",false],
  ["uafe","Ecuador y Estados Unidos fortalecen la lucha contra el lavado de activos con tecnología avanzada e inteligencia artificial","https://www.uafe.gob.ec/nota/",true],
  ["uafe","Más control financiero y transparencia: Gobierno Nacional articula a cuatro instituciones para detectar riesgos de corrupción y lavado de activos","https://www.uafe.gob.ec/nota/",true],
  ["uafe","Registro del Manual de Prevención","https://www.uafe.gob.ec/registro-del-manual-de-prevencion/",false],
  ["uafe","Solicitud de Pronunciamiento de Actividad Sujeta a Reporte","https://www.uafe.gob.ec/solicitud/",false],
  ["uafe","Ecuador fortalece el control de sus fronteras con el Segundo Operativo Intensificado de 2026","https://www.uafe.gob.ec/nota/",false],
  ["uafe","UAFE abre convocatoria para reconocer buenas prácticas de transparencia y prevención del lavado de activos","https://www.uafe.gob.ec/nota/",false],
  // Fuentes nuevas de Pagos y Cripto, y Expansión · Banca acotada a pagos y regulación (feeds medidos el 19 de noviembre de 2026).
  ["decrypt","Fed's Waller Calls for 50-Basis-Point Rate Hike, Says Tokenized Finance Still Needs Traditional Banks",null,true],
  ["decrypt","Scattered Spider Hacker Sentenced to 6 Years Over $11.6M in Stolen Crypto",null,true],
  ["decrypt","World Bank Taps Circle and Citi to Test Stablecoins for Development Payments",null,true],
  ["decrypt","Former Robinhood Engineer Pleads Guilty to Crypto Insider Trading Scheme",null,true],
  ["decrypt","Judge Acquits MIT Brothers in $25M Ethereum MEV Case, Ending Prosecution",null,true],
  ["decrypt","Bitcoin Tanks Ahead of Anthropic’s IPO. Should We Really Blame AI?",null,false],
  ["decrypt","Bitcoin Miners Are Selling Their Stacks to Fund the AI Boom",null,false],
  ["decrypt","Lucky Trader Banks 66,000% Profit on GTA 6 Meme Coin Ticker Confusion",null,false],
  ["decrypt","Morning Minute: The CFTC Officially Greenlights Perps in the US, Starting with Backpack",null,false],
  ["decrypt","AI Will Make the Next 12 Months 'a Slaughterhouse' for Crypto Security: Anchorage Exec",null,false],
  ["decrypt","Nvidia Board Shuts Down Jensen Huang Comeback, Launches Search for New CEO",null,false],
  ["decrypt","Bitcoin's $2 Billion Liquidation Weekend Leaves Traders Watching $60,000",null,false],
  ["occ","Comptroller of the Currency Issues Statement on FinCEN Customer Due Diligence","https://www.occ.gov/news-issuances/news-releases/2026/nr-occ-2026-101.html",true],
  ["occ","Agencies Extend Comment Period for Proposed Third-Party Risk Management Guidance","https://www.occ.gov/news-issuances/news-releases/2026/nr-ia-2026-99.html",true],
  ["occ","OCC Issues Supervisory Framework on Bank Use of Super Intelligence","https://www.occ.gov/news-issuances/news-releases/2026/nr-occ-2026-95.html",true],
  ["occ","OCC’s Semiannual Risk Perspective Highlights Key Risks in Federal Banking System","https://www.occ.gov/news-issuances/news-releases/2026/nr-occ-2026-100.html",true],
  ["occ","Comptroller Gould Emphasizes OCC’s Continued Momentum to Rightsize Regulation and Reform Federal Banking System","https://www.occ.gov/news-issuances/news-releases/2026/nr-occ-2026-102.html",false],
  ["occ","OCC Releases CRA Performance Evaluations for 19 National Banks and Federal Savings Associations","https://www.occ.gov/news-issuances/news-releases/2026/nr-occ-2026-94.html",false],
  ["occ","OCC Raises Concerns with California's Climate Disclosure Laws","https://www.occ.gov/news-issuances/news-releases/2026/nr-occ-2026-93.html",false],
  ["occ","OCC Announces Enforcement Actions for October 2026","https://www.occ.gov/news-issuances/news-releases/2026/nr-occ-2026-90.html",false],
  ["thepaypers","Mastercard launches Mastercard Accept for card acceptance on phones",null,true],
  ["thepaypers","Qonto receives credit institution licence from ACPR and ECB",null,true],
  ["thepaypers","DBS and Kinexys by J.P. Morgan launch 24/7 tokenised deposit transfers",null,true],
  ["thepaypers","Wise settles Belgian AML probe without admitting wrongdoing",null,true],
  ["thepaypers","The Paypers",null,false],
  ["thepaypers","AI payment analytics and orchestration | Gr4vy",null,false],
  ["thepaypers","Fragmented payments stack costs | DECTA webinar recap",null,false],
  ["thepaypers","Why AI Model orchestration matters in financial services",null,false],
  ["fintechfutures","French fintech Qonto secures full banking licence",null,true],
  ["fintechfutures","Ripple secures final OCC authorisation to establish Ripple National Trust Bank",null,true],
  ["fintechfutures","Western Union announces termination of $500m Intermex acquisition agreement",null,true],
  ["fintechfutures","Commerzbank, Deutsche Bank and DSGV form anti-financial crime JV",null,true],
  ["fintechfutures","ICYMI fintech funding round-up: Mural, ScribeUp, Vrtx, and more",null,false],
  ["fintechfutures","October 2026: Top five banking technology stories of the month",null,false],
  ["fintechfutures","PayTech Awards USA 2026 shortlist announced",null,false],
  ["fintechfutures","What the FinTech? | S.7 Episode 23 | The next generation of business banking in the US",null,false],
  ["fintechfutures","White paper: One region, many markets - building payments infrastructure for ASEAN scale",null,false],
  ["fintechfutures","Banking Technology Magazine November 2026 issue out now",null,false],
  ["fintechfutures","Why banks won’t change",null,false],
  ["expansion-banca","Monzo ficha en N26 y Revolut para su lanzamiento en España",null,true],
  ["expansion-banca","Qonto dará el salto a la banca con depósitos y anticipo de facturas en 2027",null,true],
  ["expansion-banca","El BCE pide a los bancos que revisen sus modelos de gobernanza para controlar la IA",null,true],
  ["expansion-banca","JPMorgan sufre interrupciones en su servicio de banca online",null,true],
  ["expansion-banca","Bankinter quiere que los negocios de Portugal e Irlanda se autofinancien",null,false],
  ["expansion-banca","DBRS eleva a positiva la perspectiva del rating de Abanca",null,false],
  ["expansion-banca","La Audiencia de A Coruña condena a Abanca a devolver 8.800 euros a una víctima de fraude bancario",null,false],
  ["expansion-banca","Crédit Agricole propone fusionar su filial en Italia con BPM",null,false],
  ["expansion-banca","Santander sube un 5% la oferta en acciones por su filial de Brasil ante la evolución de los mercados",null,false],
  ["expansion-banca","La apuesta de HSBC por los bots podría transformar la batalla por el negocio de la gestión de patrimonios",null,false]
];
test('cada filtro deja pasar las muestras pertinentes del informe y descarta su ruido', () => {
  for (const [id, title, url, expected] of SAMPLES) {
    assert.ok(sourceById(id), `fuente desconocida: ${id}`);
    assert.equal(relevant({ title, excerpt: '', url: url || 'https://example.com/nota' }, sourceById(id)), expected, `${id}: ${title}`);
  }
  // Todas las fuentes aceptadas con muestras en el informe tienen casos.
  const covered = new Set(SAMPLES.map(([id]) => id));
  for (const id of ['bce-boletines', 'bce-publicaciones', 'primicias', 'eluniverso', 'forbes-ec', 'bloomberg-ecuador', 'elcomercio-ec', 'teleamazonas', 'lahora', 'cfn', 'reguladores-prensa', 'seps', 'uafe', 'superbancos', 'mef', 'supercias', 'iupana', 'el-economista', 'la-republica', 'latamlist', 'bloomberg-negocios', 'expansion-mx', 'diario-financiero', 'iproup', 'latamfintech', 'paymentsdive', 'expansion-banca', 'ft-banking', 'finextra', 'thepaypers', 'fintechfutures', 'occ', 'decrypt', 'bankingdive', 'thebanker', 'americanbanker', 'pymnts', 'ecb', 'ft-fintech', 'wsj-markets', 'fsb', 'boe', 'eba', 'ecb-supervision', 'bis-investigacion', 'fintech-business-weekly', 'cinco-dias-cripto', 'reuters-cripto', 'ft-cripto', 'expansion-cripto', 'bloomberg-cripto', 'theblock', 'coindesk', 'criptonoticias', 'chainalysis', 'fed', 'endeavor-ar', 'endeavor-prensa']) assert.ok(covered.has(id), `sin muestras: ${id}`);
});

test('las reglas de ruta y las exclusiones añadidas se aplican', () => {
  const ok = (id, title, url) => relevant({ title, excerpt: '', url }, sourceById(id));
  assert.equal(ok('primicias', 'Banco Pichincha amplía su crédito', 'https://www.primicias.ec/entretenimiento/banco/'), false);
  assert.equal(ok('primicias', 'Banco Pichincha amplía su crédito', 'https://www.primicias.ec/economia/empresas/banco/'), true);
  assert.equal(ok('theblock', 'SEC drops case against stablecoin issuer', 'https://www.theblock.co/news/markets/x'), false);
  assert.equal(ok('theblock', 'SEC sues stablecoin issuer', 'https://www.theblock.co/news/regulation/x'), true);
  assert.equal(ok('coindesk', 'U.S. judge clears fraud case', 'https://www.coindesk.com/policy/2026/11/17/x'), true);
  assert.equal(ok('criptonoticias', 'Nueva ley de criptoactivos en Brasil', 'https://www.criptonoticias.com/comunidad/adopcion/ley/'), true);
  assert.equal(ok('expansion-cripto', 'La CNMV avisa sobre stablecoins', 'https://www.expansion.com/mercados/bitcoin/x.html'), false);
  assert.equal(ok('finextra', 'Nomupay joins Amazon Web Services marketplace'), false);
  assert.equal(ok('finextra', 'Pliant joins UK banks on government payments framework'), true);
  assert.equal(relevant({ title: 'Banco nuevo', excerpt: '', url: 'no es una url' }, sourceById('primicias')), false);
});

test('auditoría de filtros: extracto de LatamList, ruta de Reuters a Pagos y contrataciones del Registro Oficial', () => {
  // LatamList lee titular y extracto: la ronda de una fintech entra aunque el titular solo diga «raises»; una proptech no.
  const latamlist = sourceById('latamlist');
  assert.equal(relevant({ title: 'Nova raises $24M Series A led by Canaan', excerpt: 'Brazilian fintech Nova raised $24M in a Series A round led by Canaan, with participation from Propel Venture…', url: 'https://latamlist.com/nota' }, latamlist), true);
  assert.equal(relevant({ title: 'Vuun raises $525K pre-seed round led by 500 Global', excerpt: 'Colombian proptech Vuun raised $525K in a pre-seed round led by 500 Global, with participation from Reach and…', url: 'https://latamlist.com/nota' }, latamlist), false);
  // Reuters · Cripto: la supervisión de Revolut va a Pagos; lo que nombra algo cripto se queda en Cripto.
  const reuters = sourceById('reuters-cripto');
  assert.equal(channelFor({ title: 'EXCLUSIVE: Italian court places Revolut unit under supervision over money-laundering failings' }, reuters), 'pagos');
  assert.equal(channelFor({ title: 'UAE court orders freeze on crypto tokens stolen from Binance wallets' }, reuters), 'cripto');
  assert.equal(channelFor({ title: 'PNC to offer stablecoin payments to clients in Coinbase partnership' }, reuters), 'cripto');
  // Registro Oficial: la selección de una firma auditora es trámite aunque la emita un órgano financiero.
  const norm = text => registroOficialRelevant({ organ: 'Corporación del Seguro de Depósitos (COSEDE)', code: 'COSEDE-DIR-2026-031', text });
  assert.equal(norm('Se selecciona como primera opción a la firma HLB Consultores para la auditoría externa'), false);
  assert.equal(norm('Se actualizan los valores de la cobertura del seguro de depósitos'), true);
});

test('Google News: las consultas con intitle: no pasan de 9 términos y todas piden un período', () => {
  for (const item of SOURCES.filter(source => source.adapter === 'google' && !source.search)) {
    const query = new URL(item.url).searchParams.get('q');
    assert.match(query, /\bwhen:\d+d\b/, `${item.id}: sin when:`);
    // Con más de 9 términos intitle: Google deja de respetar when: (medido en noviembre de 2026).
    assert.ok((query.match(/intitle:/g) || []).length <= 9, `${item.id}: demasiados intitle:`);
  }
  // Las fuentes que estaban saturadas o mal apuntadas: Bloomberg Línea por búsqueda (ya no la sección Negocios), Ecuador en el
  // titular y sin Expreso, Reuters con los términos en el titular.
  assert.equal(sourceById('bloomberg-negocios').adapter, 'google');
  assert.deepEqual(sourceById('bloomberg-negocios').allowHosts, ['bloomberglinea.com']);
  const q = id => new URL(sourceById(id).url).searchParams.get('q');
  assert.match(q('bloomberg-ecuador'), /intitle:Ecuador/);
  assert.doesNotMatch(q('bloomberg-ecuador'), /expreso/);
  assert.match(q('reuters-cripto'), /intitle:crypto/);
  assert.match(q('reguladores-prensa'), /when:7d/);
});

test('el catálogo de fuentes cumple el contrato y no quedan filtros de fuentes retiradas', () => {
  const ids = new Set();
  for (const item of SOURCES) {
    assert.ok(!ids.has(item.id), `id repetido: ${item.id}`); ids.add(item.id);
    assert.ok(CHANNELS.includes(item.category), `${item.id}: canal`);
    assert.ok(['official', 'news', 'company', 'organization'].includes(item.kind), `${item.id}: tipo`);
    assert.ok([1, 2, 3].includes(item.tier), `${item.id}: nivel`);
    assert.ok(['open', 'paywall', 'mixed'].includes(item.access), `${item.id}: acceso`);
    assert.ok(['es', 'en'].includes(item.language), `${item.id}: idioma`);
    // Toda fuente de Google News se limita a sus medios; la búsqueda Endeavor, a la lista ENDEAVOR_PRESS_HOSTS.
    if (item.adapter === 'google') assert.ok(item.allowHosts?.length, `${item.id}: Google News sin allowHosts`);
  }
  for (const id of Object.keys(FILTERS)) assert.ok(ids.has(id), `filtro sin fuente: ${id}`);
  for (const id of ['bce-boletines', 'bce-publicaciones', 'bce-junta-resoluciones', 'bce-resoluciones-admin']) assert.equal(sourceById(id).tier, 1);
  assert.equal(sourceById('bce-publicaciones').limit, 3);
  assert.deepEqual([sourceById('endeavor-ar').kind, sourceById('endeavor-ar').tier, sourceById('endeavor-ar').limit], ['organization', 3, 2]);
  assert.deepEqual([sourceById('fed').kind, sourceById('fed').tier, sourceById('fed').limit], ['official', 1, 2]);
  for (const retired of ['asobanca', 'banecuador', 'contxto', 'ecuador-news', 'regulatory-news', 'latam-fintech-hub', 'latam-bloomberg', 'valora-analitik', 'colombia-fintech', 'lavca', 'felaban', 'digitaltransactions', 'epi', 'pcm', 'finextra-payments', 'finextra-crypto', 'trmlabs', 'coincenter']) assert.equal(sourceById(retired), undefined, retired);
});

// ---------------------------------------------------------------------------------------------------------
const make = (sourceId, hoursAgo, extra = {}) => ({ id: `${sourceId}-${hoursAgo}`, sourceId, category: 'pagos', kind: 'news', title: `Nota ${sourceId} ${hoursAgo}`, excerpt: '', url: `https://example.com/${sourceId}/${hoursAgo}`, source: sourceId, sourceUrl: 'https://example.com', via: '', language: 'en', publishedAt: new Date(now - hoursAgo * 3600 * 1000).toISOString(), ...extra });

test('acumulación: se conservan las notas anteriores de la fuente que siguen vigentes y pasan el filtro', () => {
  const feed = { id: 'medio', name: 'Medio', category: 'pagos', kind: 'news', tier: 2, access: 'open' };
  const fresh = [make('medio', 1, { tier: 2, access: 'open' }), make('medio', 2, { tier: 2, access: 'open' })];
  const previous = [
    { ...make('medio', 2), title: 'Versión anterior' }, // mismo id que una nueva: gana la nueva
    make('medio', 72), make('medio', 24 * 20), // vigentes
    make('medio', 24 * 31), // fuera de los 30 días
    { ...make('medio', 50), title: 'Black Friday' }, // ya no pasa el filtro actual
    make('otra', 5), // de otra fuente
    { ...make('medio', 80), stale: true }, // venía marcada; la fuente respondió, se quita la marca
  ];
  const keep = story => !/black friday/i.test(story.title);
  const result = accumulate(fresh, previous, feed, { ok: true, now, keep });
  assert.deepEqual(result.map(story => story.id).sort(), ['medio-1', 'medio-2', 'medio-480', 'medio-72', 'medio-80'].sort());
  assert.equal(result.find(story => story.id === 'medio-2').title, 'Nota medio 2');
  assert.ok(result.every(story => !('stale' in story)));
  assert.ok(result.every(story => story.tier === 2 && story.access === 'open'));
  assert.equal(new Set(result.map(story => story.id)).size, result.length);
});

test('acumulación: si la fuente falló, sus notas conservadas se marcan stale; si la fuente ya no existe, no se conservan', () => {
  const feed = { id: 'medio', name: 'Medio', category: 'pagos', kind: 'news', tier: 1, access: 'paywall' };
  const previous = [make('medio', 3), make('medio', 30), make('retirada', 3)];
  const failed = accumulate([], previous, feed, { ok: false, now });
  assert.deepEqual(failed.map(story => [story.id, story.stale, story.access]), [['medio-3', true, 'paywall'], ['medio-30', true, 'paywall']]);
  // Al volver a responder, las mismas notas pierden la marca.
  assert.ok(accumulate([], failed, feed, { ok: true, now }).every(story => !('stale' in story)));
  // Ninguna fuente actual reclama las notas de «retirada»: run() solo acumula por cada fuente de SOURCES.
  assert.equal(SOURCES.some(item => item.id === 'retirada'), false);
  // Si una fuente cambia de canal por tema, las notas conservadas se reasignan.
  const bce = sourceById('bce-boletines');
  const old = { ...make('bce-boletines', 5), url: 'https://www.bce.fin.ec/boletin-junta/', title: 'Resolución de la Junta de Política y Regulación', category: 'ecuador' };
  assert.equal(accumulate([], [old], bce, { now })[0].category, 'regulacion');
});

test('composición: reparto por períodos, espaciado y cuotas', () => {
  assert.deepEqual(PERIODS(), [0, 1, 2, 3]);
  assert.deepEqual(spaced([1, 2, 3, 4, 5], 3), [1, 3, 5]);
  assert.deepEqual(spaced([1, 2, 3], 5), [1, 2, 3]);
  assert.deepEqual(spaced([1, 2, 3], 1), [1]);
  assert.deepEqual(shares([100, 100, 100, 100], 80), [20, 20, 20, 20]);
  assert.deepEqual(shares([5, 100, 0, 100], 80), [5, 38, 0, 37]);
  assert.deepEqual(shares([3, 2], 80), [3, 2]);
  function PERIODS() { return [12, 24 * 3, 24 * 10, 24 * 20].map(hours => periodIndex(make('x', hours), now)); }
});

test('composición del canal: tope por fuente en cada período, tope de canal y nivel 3 limitado al 20 %', () => {
  // Una fuente prolífica: 30 notas por día durante 30 días.
  const prolific = Array.from({ length: 30 * 30 }, (_, i) => make('prolifica', i * 0.8 + 0.1, { tier: 1 }));
  const result = composeChannel(prolific, { cap: 80, limitFor: () => 6, now });
  const perPeriod = [0, 1, 2, 3].map(index => result.filter(story => periodIndex(story, now) === index).length);
  assert.deepEqual(perPeriod, [6, 6, 6, 6]);
  // Muchas fuentes: el canal no pasa de 80 y quedan notas en los cuatro períodos.
  const many = Array.from({ length: 12 }, (_, s) => Array.from({ length: 200 }, (_, i) => make(`f${s}`, i * 3.6 + s / 10, { tier: s < 4 ? 3 : 1 }))).flat();
  const channel = composeChannel(many, { cap: 80, limitFor: () => 5, now });
  assert.equal(channel.length, 80);
  const tier3 = channel.filter(story => story.tier === 3).length;
  assert.ok(tier3 <= 16, `nivel 3: ${tier3}`);
  assert.equal(tier3, 16);
  for (const index of [0, 1, 2, 3]) assert.ok(channel.filter(story => periodIndex(story, now) === index).length >= 15, `período ${index}`);
  assert.deepEqual(channel, [...channel].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)));
  // Solo nivel 3 no puede llenar un canal.
  assert.equal(composeChannel([make('blog', 1, { tier: 3 })], { now }).length, 0);
  // Pocas notas: se publican todas.
  const few = [make('a', 1), make('a', 30), make('b', 24 * 12)];
  assert.equal(composeChannel(few, { now }).length, 3);
  // composeEdition compone cada canal por separado.
  const edition = composeEdition([...few, { ...make('c', 2), category: 'cripto' }], { now });
  assert.deepEqual([...new Set(edition.map(story => story.category))].sort(), ['cripto', 'pagos']);
});

test('tope por tema: el hackeo de Binance no ocupa el canal de Cripto; las notas oficiales no cuentan', () => {
  const crypto = (sourceId, hoursAgo, title, extra = {}) => make(sourceId, hoursAgo, { id: `${sourceId}-${hoursAgo}`, category: 'cripto', tier: 1, title, source: sourceId, ...extra });
  const days = 24;
  // Titulares reales de la edición publicada el 19 de noviembre de 2026, en el período de 15 a 30 días.
  const heist = [
    crypto('reuters-cripto', 20 * days, 'Binance freezes assets after $6.3 bln heist, crypto industry\'s biggest', { via: 'Vía Google News' }),
    crypto('reuters-cripto', 20 * days + 1, 'Blockchain analysis firm TRM says North Korea behind Binance crypto theft', { via: 'Vía Google News' }),
    crypto('cinco-dias-cripto', 20 * days + 2, 'Robo histórico de 6.300 millones de dólares en 20 minutos: jaque a Binance', { excerpt: 'El robo.' }),
    crypto('cinco-dias-cripto', 19 * days, 'Las claves del robo del siglo en Binance: qué ocurrió, quién está detrás', { excerpt: 'Las claves.' }),
    crypto('expansion-cripto', 20 * days + 3, 'El robo a Binance dispara la alarma sobre la seguridad cripto', { excerpt: 'La alarma.' }),
    crypto('expansion-cripto', 20 * days + 4, 'Acusan a Corea del Norte de estar detrás del hackeo a Binance'),
    crypto('ft-cripto', 17 * days, 'What caused the $6.3bn Binance hack?', { excerpt: 'The hack.' }),
    crypto('ft-cripto', 17 * days + 5, 'Binance users pull $5bn as crypto exchange restarts services after heist'),
    crypto('bloomberg-cripto', 18 * days, 'Binance reanuda los retiros mientras persisten las dudas sobre el ataque informático', { via: 'Vía Google News' }),
  ];
  const others = [
    crypto('reuters-cripto', 17 * days + 2, 'Gone in 20 minutes: How the biggest heist in crypto history unfolded'),
    crypto('reuters-cripto', 16 * days, 'PNC to offer stablecoin payments to clients in Coinbase partnership'),
    crypto('bis-discursos', 18 * days, 'Piero Cipollone: What the Binance heist teaches central banks', { kind: 'official' }),
    crypto('reuters-cripto', 10, 'UAE court orders freeze on crypto tokens stolen from Binance wallets'),
    crypto('reuters-cripto', 12, 'After $6.3 billion crypto heist, Binance plans Asia expansion'),
  ];
  const options = { now, cap: 80, limitFor: () => 25, perTopic: 3 };
  const edition = composeEdition([...heist, ...others], options);
  const named = edition.filter(story => /Binance/.test(story.title) && story.kind !== 'official');
  // Como mucho tres por período: tres del período de 15 a 30 días (con extracto y enlace directo primero) y las dos de hoy.
  assert.equal(named.filter(story => periodIndex(story, now) === 3).length, 3);
  assert.ok(named.filter(story => periodIndex(story, now) === 3).every(story => story.excerpt));
  assert.equal(named.filter(story => periodIndex(story, now) === 0).length, 2);
  // Lo que no nombra a Binance y la nota oficial siguen.
  for (const story of others) assert.ok(edition.includes(story), story.title);
  // Sin tope por tema, todo entra.
  assert.equal(composeEdition([...heist, ...others], { now, cap: 80, limitFor: () => 25 }).length, heist.length + others.length);
});

test('reserva oficial: el tope de canal no expulsa a la Reserva Federal ni al FSB frente a medios prolíficos', () => {
  const judgedAt = new Date(now).toISOString();
  const judged = score => ({ score, why: '', cluster: 'x', model: 'claude-opus-5-5', at: judgedAt });
  const media = Array.from({ length: 20 }, (_, s) => Array.from({ length: 5 }, (_, i) => make(`medio${s}`, 1 + i + s / 100, { tier: 2, editorial: judged(80) }))).flat();
  const fed = make('fed', 3, { kind: 'official', tier: 1, title: 'Federal Reserve Board announces pricing, effective January 1, 2027, for payment services', editorial: judged(40) });
  const fsb = make('fsb', 4, { kind: 'official', tier: 1, title: 'Further work by jurisdictional authorities and private sector necessary to enhance cross-border payments', editorial: judged(40) });
  const base = { now, cap: 80, limitFor: () => 5, threshold: 30 };
  const without = composeChannel([...media, fed, fsb], base);
  assert.equal(without.length, 80);
  assert.ok(!without.includes(fed) && !without.includes(fsb));
  const reserve = story => story.kind === 'official' && story.tier === 1;
  const withReserve = composeChannel([...media, fed, fsb], { ...base, reserve, reserveShare: 0.25 });
  assert.equal(withReserve.length, 80);
  assert.ok(withReserve.includes(fed) && withReserve.includes(fsb));
  // Lo que la reserva no usa vuelve al canal: sin oficiales, 80 notas de medios.
  assert.equal(composeChannel(media, { ...base, reserve, reserveShare: 0.25 }).length, 80);
});

test('relleno: si el canal tiene sitio, el tope por fuente no deja fuera notas que pasaron el filtro', () => {
  const list = ['df', 'la-republica'].flatMap(id => Array.from({ length: 6 }, (_, i) => make(id, 1 + i * 2 + (id === 'df' ? 0 : 1))));
  const blog = Array.from({ length: 4 }, (_, i) => make('blog', 2 + i, { tier: 3 }));
  const base = { now, cap: 10, limitFor: () => 2 };
  assert.equal(composeChannel(list, base).length, 4);
  const filled = composeChannel([...list, ...blog], { ...base, refill: true });
  assert.equal(filled.filter(story => story.tier !== 3).length, filled.length - filled.filter(story => story.tier === 3).length);
  assert.ok(filled.length <= 10);
  assert.equal(filled.filter(story => story.sourceId !== 'blog').length, filled.length - filled.filter(story => story.sourceId === 'blog').length);
  // El relleno no suma nivel 3: solo vuelven notas de las fuentes cortadas por su tope.
  assert.equal(filled.filter(story => story.sourceId === 'blog').length, composeChannel([...list, ...blog], base).filter(story => story.sourceId === 'blog').length);
  assert.equal(composeChannel(list, { ...base, refill: true }).length, 10);
});

test('tope por edición: los datos del BCE dejan una nota por serie, la más reciente', () => {
  assert.equal(editionSeries('Boletín Monetario Semanal. 13 de Noviembre 2026'), 'boletin monetario semanal');
  assert.equal(editionSeries('Boletín Monetario Semanal 6 de noviembre de 2026'), 'boletin monetario semanal');
  assert.equal(editionSeries('Boletín de Reservas Internacionales. Octubre 2026'), 'boletin de reservas internacionales');
  assert.equal(editionSeries('Perspectivas de Oferta y Demanda de Crédito. III Trimestre 2026'), 'perspectivas de oferta y demanda de credito');
  assert.equal(editionSeries('Reporte Interactivo Mensual de Tasas de Interés'), 'reporte interactivo mensual de tasas de interes');
  const data = (hoursAgo, title) => make('bce-publicaciones', hoursAgo, { category: 'regulacion', kind: 'official', title });
  const list = [
    data(48, 'Boletín Monetario Semanal. 13 de Noviembre 2026'), data(220, 'Boletín Monetario Semanal. 6 de Noviembre 2026'),
    data(60, 'Reporte Interactivo Mensual de Tasas de Interés'), data(400, 'Reporte Interactivo Mensual de Tasas de Interés'),
    data(100, 'Boletín de Reservas Internacionales. Octubre 2026'), make('seps', 5, { category: 'regulacion' }),
  ];
  const perEdition = story => (story.sourceId === 'bce-publicaciones' ? 1 : undefined);
  assert.deepEqual(capPerEdition(list, perEdition).map(story => story.id).sort(), ['bce-publicaciones-100', 'bce-publicaciones-48', 'bce-publicaciones-60', 'seps-5']);
});

test('notas sin juicio: valen lo que suelen valer las de su fuente o el canal, no 50 fijos', () => {
  const judgedAt = new Date(now).toISOString();
  const judged = score => ({ score, why: '', cluster: `c${score}`, model: 'claude-opus-5-5', at: judgedAt });
  const channel = [40, 45, 52, 70, 75].map((score, i) => make(`s${i}`, 2 + i, { editorial: judged(score) }));
  const expected = expectedScore(channel);
  assert.equal(expected(make('nueva', 1)), 52);
  const weak = [35, 38, 40].map((score, i) => make('debil', 10 + i, { id: `debil-${i}`, editorial: judged(score) }));
  assert.equal(expectedScore([...channel, ...weak])(make('debil', 1)), 38);
  assert.equal(expectedScore([make('a', 1, { editorial: judged(90) })], 50)(make('b', 1)), 50);
  // En la composición, la nota nueva de una fuente que suele puntuar bajo no pasa por delante de una juzgada con 45.
  const fresh = make('debil', 1, { id: 'debil-nueva' });
  const order = composeChannel([...channel, ...weak, fresh], { now, threshold: 30 }).map(story => story.id);
  assert.ok(order.indexOf('s1-3') < order.indexOf('debil-nueva'), order.join(' '));
  assert.ok(order.indexOf('debil-nueva') < order.indexOf('debil-0'), order.join(' '));
});

test('acumulación: la copia nueva de una nota ya publicada conserva su juicio y su cobertura', () => {
  const feed = { id: 'medio', name: 'Medio', category: 'pagos', kind: 'news', tier: 2, access: 'open' };
  const editorial = { score: 72, why: '', cluster: 'hecho', model: 'claude-opus-5-5', at: new Date(now).toISOString() };
  const previous = [{ ...make('medio', 2), editorial, coverage: ['Reuters'] }, { ...make('medio', 3), title: 'Titular anterior', editorial }];
  const fresh = [make('medio', 2), make('medio', 3)];
  const result = accumulate(fresh, previous, feed, { now });
  const same = result.find(story => story.id === 'medio-2'), changed = result.find(story => story.id === 'medio-3');
  assert.deepEqual([same.editorial, same.coverage], [editorial, ['Reuters']]);
  // Si el titular cambió, el juicio se vuelve a pedir.
  assert.deepEqual([changed.title, changed.editorial], ['Nota medio 3', undefined]);
});

test('con ejecuciones diarias de feeds cortos, la acumulación deja material en 24 horas, 7, 15 y 30 días', () => {
  // Tres fuentes cuyo feed solo conserva dos días, con 10 notas diarias; 40 días de ejecuciones.
  const feeds = ['uno', 'dos', 'tres'].map(id => ({ id, name: id, category: 'pagos', kind: 'news', tier: 1, access: 'open', limit: 4 }));
  let edition = [];
  const start = now - 40 * DAY;
  for (let day = 0; day <= 40; day++) {
    const runAt = start + day * DAY;
    const stories = feeds.flatMap(feed => {
      const fresh = Array.from({ length: 20 }, (_, i) => ({ ...make(feed.id, 0), id: `${feed.id}-${day}-${i}`, title: `${feed.id} ${day} ${i}`, url: `https://example.com/${feed.id}/${day}/${i}`, publishedAt: new Date(runAt - i * 2.4 * 3600 * 1000).toISOString() }));
      const ok = day % 7 !== 3 || feed.id !== 'dos';
      return accumulate(ok ? fresh : [], edition, feed, { ok, now: runAt });
    });
    edition = composeEdition(deduplicate(stories), { cap: 80, limitFor: story => feeds.find(feed => feed.id === story.sourceId).limit, now: runAt });
  }
  const counts = [0, 1, 2, 3].map(index => edition.filter(story => periodIndex(story, now) === index).length);
  assert.ok(counts.every(count => count > 0), `por período: ${counts}`);
  assert.ok(edition.length <= 80);
  assert.ok(edition.every(story => recent(story.publishedAt, now)));
});

// ---------------------------------------------------------------------------------------------------------
// Empresas Endeavor: directorio, cruce con las notas, lotes de búsqueda y rotación.
const company = (name, extra = {}) => ({ name, slug: name.toLowerCase().replace(/\W+/g, '-'), offices: ['mexico'], vertical: 'fintech', subVertical: null, url: `https://endeavor.org/entrepreneur-companies/?_search=${name.toLowerCase()}`, ...extra });
const byName = name => ENDEAVOR_COMPANIES.find(item => item.name === name);
const tagOf = (title, extra = {}) => matchEndeavor({ title, excerpt: '', category: 'pagos', ...extra })?.company ?? null;

test('Endeavor: el directorio se lee de la API (entidades, etiquetas, región y repetidos) y la lista versionada viene de ahí', () => {
  assert.equal(decodeEntities('Doce d&#8217;ocê &#038; Ben &amp; Frank'), 'Doce d’ocê & Ben & Frank');
  const item = { slug: 'clara', link: 'https://endeavor.org/entrepreneur-companies/?_search=clara#clara', title: { rendered: 'Clara' }, class_list: ['post-1', 'company', 'vertical-fintech', 'sub-vertical-consumer-payments', 'region-latin-america', 'local-office-mexico'] };
  assert.deepEqual(toCompany(item), { name: 'Clara', slug: 'clara', regions: ['latin-america'], offices: ['mexico'], vertical: 'fintech', subVertical: 'consumer-payments', url: item.link });
  const twin = { ...item, slug: 'clara-2', class_list: [...item.class_list.slice(0, -1), 'local-office-colombia'] };
  const other = { ...item, slug: 'swap', title: { rendered: 'Swap' } };
  const asia = { ...item, slug: 'patsnap', title: { rendered: 'Patsnap' }, class_list: ['region-asia', 'local-office-malaysia'] };
  const list = latamCompanies([item, twin, other, asia]);
  assert.deepEqual(list.map(entry => [entry.name, entry.offices.join('+')]), [['Clara', 'mexico+colombia'], ['Swap', 'mexico']]);
  // La lista versionada: más de 500 empresas de la región, cada una con ficha en endeavor.org; incluye las de oficina Ecuador.
  assert.ok(ENDEAVOR_COMPANIES.length > 500);
  for (const entry of ENDEAVOR_COMPANIES) assert.ok(entry.name && entry.slug && entry.url.startsWith('https://endeavor.org/'), entry.slug);
  for (const name of ['Construex', 'AltScore', 'Tipti', 'Paccari', 'Contifico']) assert.deepEqual(byName(name)?.offices, ['ecuador'], name);
});

test('Endeavor: aciertos reales en titulares, sin distinguir mayúsculas ni tildes en nombres no ambiguos', () => {
  assert.equal(tagOf('Clara raises $105M Series C round'), 'Clara');
  assert.equal(tagOf('Addi invertirá US$2.000 millones en Colombia para ampliar el crédito'), 'ADDI');
  assert.equal(tagOf('Uala obtiene licencia bancaria en México'), 'Ualá');
  assert.equal(tagOf('Mercado Libre amplía su negocio de crédito'), 'MercadoLibre.com');
  assert.equal(tagOf('La fintech Bold recibió $37.450 millones de Bbva Spark'), 'Bold');
  assert.equal(tagOf('Kueski y Clara se alían para pagos a meses'), 'Kueski');
  const tag = matchEndeavor({ title: 'Addi lanza una cuenta de ahorros', excerpt: '' });
  assert.deepEqual(tag, { company: 'ADDI', country: 'Colombia', vertical: 'Fintech', url: byName('ADDI').url });
  // Los nombres largos ganan a los cortos que contienen («Lemon Studios» no es Lemon).
  assert.equal(tagOf('Lemon Studios estrena serie y levanta inversión'), 'Lemon Studios');
});

test('Endeavor: los nombres ambiguos y cortos exigen mayúscula, titular y contexto, y no son personas', () => {
  for (const name of ['Clara', 'Clip', 'Bold', 'Cora', 'Neon', 'Pier', 'Tala', 'Lemon', 'Cobre', 'Contigo', 'Comun', 'Swap', 'Klar', 'Nomad', 'Prex']) assert.ok(ENDEAVOR_AMBIGUOUS.has(name), name);
  assert.equal(tagOf('Una señal clara para los bancos y las fintech'), null);
  assert.equal(tagOf('Clara Brugada anuncia crédito para pequeñas empresas'), null);
  assert.equal(tagOf('Gana María Clara el premio de periodismo financiero'), null);
  assert.equal(tagOf('Cobre alcanza un máximo: Chile producirá 5 millones de toneladas'), null);
  assert.equal(tagOf('Clara amplía su tarjeta corporativa a Colombia'), 'Clara');
  // Nombres cortos (R2, R5): solo con contexto; y en minúscula no valen.
  assert.equal(tagOf('R2 y R5: así quedó la temporada'), null);
  assert.equal(tagOf('R2 levanta US$ 20 millones en una ronda serie B'), 'R2');
  assert.equal(tagOf('Se presentó el informe r2 de la fintech'), null);
  // En el canal latam basta el canal como contexto; en el extracto los ambiguos no cuentan.
  assert.equal(tagOf('Pomelo llega a Brasil', { category: 'latam' }), 'Pomelo');
  assert.equal(tagOf('Pomelo llega a Brasil'), null);
  assert.equal(matchEndeavor({ title: 'Startups del año', excerpt: 'Clara levanta una ronda', category: 'latam' }), null);
  assert.equal(matchEndeavor({ title: 'Startups del año', excerpt: 'La mexicana Kueski levanta una ronda' })?.company, 'Kueski');
  assert.equal(matchEndeavor({ title: 'Startups del año', excerpt: 'La mexicana Kueski levanta una ronda' }, { titleOnly: true }), null);
  // Falsos positivos vistos en feeds reales: palabra en un titular en inglés, minería, tilde distintiva y sigla de otra empresa.
  assert.equal(tagOf('Optimizely Hack Hijacked Ledger, BBC and 176 Other Sites to Swap Crypto Wallet Addresses'), null);
  assert.equal(tagOf('Meet the Agent: How Our Team Built Clara to Scale With Our Customers'), null);
  assert.equal(tagOf('Brazil’s Loft Raises a16z-Led $175M Series C For Digital Real Estate Platform'), 'Loft');
  assert.equal(tagOf('Clip Acquires Pulpos'), 'Clip');
  assert.equal(tagOf('Cobre en Perú: Latin Explore levanta US$ 1.7 millones y alista perforación'), null);
  assert.equal(tagOf('Cobre acelera pagos digitales en exportaciones en México'), 'Cobre');
  assert.equal(tagOf('Ecuador lanza una estrategia de comercio justo para ampliar su oferta exportable'), null);
  assert.equal(tagOf('Jüsto, Mexico’s First Online Supermarket, Raises $10M Seed From Global Investors'), 'Jüsto');
  assert.equal(tagOf('ISA reportó aumento del 8 % en sus ingresos operacionales'), null);
  assert.equal(tagOf('‘Can anybody guard Addi Mack?’: One Terp kept Maryland basketball afloat in opening loss'), null);
  assert.equal(tagOf('Addi Hayes'), null);
  assert.equal(tagOf('Addi, el modelo de financiación que ayuda a crecer sin sobreendeudar'), 'ADDI');
  assert.equal(tagOf('Toulon lose Juan Ignacio Brex for several months after biceps surgery'), null);
  assert.equal(tagOf('Balancing the grid: Decoding CERC’s DSM amendment'), null);
  assert.equal(tagOf('¿Pagaste tu deuda y todavía aparece en Infocorp? Esto debes revisar en tu reporte crediticio'), null);
  assert.equal(tagOf('Babu Azgaonkar Receives Support at Corner Meeting in Devsu-Korgao Ahead of 2027 Elections'), null);
  assert.equal(tagOf('Bal.azos en “Topón” entre ministeriales y criminales'), null);
  assert.equal(tagOf('AIL wrap: Belvo and Nure share spoils, Con drop to bottom'), null);
  assert.equal(tagOf('Belvo y dLocal se alían en México para llevar la domiciliación bancaria'), 'dLocal');
  assert.equal(tagOf('Belvo se alía con bancos de Brasil'), 'Belvo');
  assert.equal(tagOf('Devsu abre oficinas en Quito'), 'Devsu');
  // «tapi» (pagos de servicios, Argentina) frente al gasoducto TAPI, el río Tapi y Tapi Aike.
  assert.equal(tagOf('Pakistan and Turkmenistan Agree to Fast-Track TAPI Gas Pipeline Project'), null);
  assert.equal(tagOf('Religious Waste Piles Up on Tapi Bridges and Riverbanks'), null);
  assert.equal(tagOf('Ruta 40: realizan trabajos de bacheo entre Tapi Aike y el valle de Primavera'), null);
  assert.equal(tagOf('Rining’s dedication keeps Lun Bawang musical tapi tradition alive'), null);
  assert.equal(tagOf('BanCoppel lleva el pago de luz y agua a su app con tapi'), 'tapi');
  assert.equal(tagOf('Klar suma pago de luz, agua y recargas con tapi'), 'Klar');
  // Las excluidas no se etiquetan nunca.
  assert.equal(tagOf('Insider: fintech raises funding round'), null);
});

test('Endeavor: los nombramientos y el equipo directivo cuentan como contexto de un nombre ambiguo', () => {
  const titleOnly = title => matchEndeavor({ title, excerpt: '', category: 'endeavor' }, { titleOnly: true })?.company ?? null;
  // Titulares reales (Revista Mercado e iProUP) que antes no entraban al canal Endeavor.
  assert.equal(titleOnly('Pomelo nombró a Martín Zanella como nuevo Chief Financial Officer en su equipo directivo'), 'Pomelo');
  assert.equal(titleOnly('Pomelo refuerza su equipo directivo con la incorporación de otro exNaranja X'), 'Pomelo');
  assert.equal(titleOnly('Pomelo y DiDi Shop lanzan tarjetas de pago en México'), 'Pomelo');
  // Otros nombres ambiguos con vocabulario de nombramiento, en español, inglés y portugués.
  assert.equal(titleOnly('Clara nombra a una nueva directora financiera'), 'Clara');
  assert.equal(titleOnly('Bold designa nuevo gerente general para Colombia'), 'Bold');
  assert.equal(titleOnly('Klar Appoints Former Banamex Executive as Chief Operating Officer'), 'Klar');
  assert.equal(titleOnly('Cora contrata ex-executivo do Itaú como novo CFO'), 'Cora');
  assert.equal(titleOnly('Pomelo: Martín Zanella asume como CFO'), 'Pomelo');
  // El vocabulario de nombramientos no abre falsos positivos: la fruta, un verbo sin complemento, «named» y «head of» sueltos,
  // y una persona junto al nombre siguen fuera.
  assert.equal(titleOnly('Pomelo: el cítrico que el chef incorpora a sus postres'), null);
  assert.equal(titleOnly('Pomelo: beneficios de incorporar esta fruta a tu dieta'), null);
  assert.equal(titleOnly('Pomelo, la fruta rica en vitamina C que conviene comer en invierno'), null);
  assert.equal(titleOnly('Jugo de pomelo: el CEO de una cadena explica su éxito'), null);
  assert.equal(titleOnly('A cat named Pomelo wins hearts online'), null);
  assert.equal(titleOnly('Head of State visits Tala region'), null);
  assert.equal(titleOnly('Clara López asume como directora general del instituto'), null);
  assert.equal(ENDEAVOR_NOISE.test('Pomelo: el cítrico que el chef incorpora a sus postres'), true);
  assert.equal(ENDEAVOR_CONTEXT.test('Pomelo: beneficios de incorporar esta fruta a tu dieta'), false);
});

test('Endeavor: la empresa al final tras el nombre de una persona, altas y salidas con su cargo, y los falsos positivos que siguen fuera', () => {
  const titleOnly = title => matchEndeavor({ title, excerpt: '', category: 'endeavor' }, { titleOnly: true })?.company ?? null;
  // La empresa al final, tras una persona y una preposición (nota real de noviembre de 2026).
  assert.equal(titleOnly('Martín Zanella, nuevo CFO de Pomelo'), 'Pomelo');
  assert.equal(titleOnly('Nueva Alianza Regional con Klar Para Pagos'), 'Klar');
  // Altas, ascensos y salidas, siempre con su cargo o su equipo.
  assert.equal(titleOnly('Una ex Nubank se suma al equipo de Klar'), 'Klar');
  assert.equal(titleOnly('Exdirectiva de Visa se suma a Pomelo como líder de riesgos'), 'Pomelo');
  assert.equal(titleOnly('Bold elige a su nuevo CEO para la región'), 'Bold');
  assert.equal(titleOnly('Tala: su jefa de producto asciende a vicepresidenta'), 'Tala');
  assert.equal(titleOnly('Clip: renuncia su cofundador tras diez años'), 'Clip');
  assert.equal(titleOnly('Ripio: el presidente deja el cargo'), 'Ripio');
  assert.equal(titleOnly('Mendel transforma los viajes corporativos en Latam'), 'Mendel');
  // Una palabra de producto junto al nombre no es un apellido; Mercado Bitcoin, con sus mayúsculas, no necesita contexto.
  assert.equal(titleOnly('En seis meses, Klar Empresarial colocó 1,900 millones de pesos en líneas de crédito'), 'Klar');
  assert.equal(titleOnly('Mercado Bitcoin sufre ataque de hacker y suspende depósitos y retiros'), 'Mercado Bitcoin');
  assert.equal(titleOnly('El mercado bitcoin vuelve a caer'), null);
  // Falsos positivos medidos en la búsqueda: lugar, metal, apodo entre comillas, persona y verbos sin cargo.
  assert.equal(titleOnly('Santa Clara contratará a un gerente de sostenibilidad para dar seguimiento a los objetivos'), null);
  assert.equal(titleOnly('San Clemente y Puerto Cobre contratan nuevo gerente'), null);
  assert.equal(titleOnly('Cobre se desploma 5% mientras inversionistas abandonan apuesta por la IA'), null);
  assert.equal(titleOnly('Cobre asciende a máximos del año en la LME'), null);
  assert.equal(titleOnly('Jorge Campos explota contra las críticas al ‘Tala’ Rangel y lanza contundente mensaje'), null);
  assert.equal(titleOnly('Clara Brugada renuncia a su cargo para buscar la candidatura'), null);
  assert.equal(titleOnly('Clara Brugada, jefa de gobierno, deja el cargo'), null);
  assert.equal(titleOnly('Mi vecina Clara se suma a la protesta'), null);
  assert.equal(titleOnly('Clara renuncia a la final del torneo'), null);
  assert.equal(titleOnly('Clara elige a sus amigas para el viaje'), null);
  assert.equal(titleOnly('Lemon se suma a la dieta de los deportistas'), null);
  assert.equal(titleOnly('Bitcoin Holders Face a Swap Deadline as Platform Launches Upgrade'), null);
});

test('Endeavor LATAM: las notas de nombramientos de Pomelo pasan el filtro de punta a punta', () => {
  const prensa = sourceById('endeavor-prensa');
  const rss = '<rss><channel>'
    + '<item><title>Pomelo nombró a Martín Zanella como nuevo Chief Financial Officer en su equipo directivo - Revista Mercado</title><link>https://news.google.com/rss/articles/p1</link><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate><source url="https://mercado.com.ar">Revista Mercado</source></item>'
    + '<item><title>Pomelo refuerza su equipo directivo con la incorporación de otro exNaranja X - iProUP</title><link>https://news.google.com/rss/articles/p2</link><pubDate>Tue, 29 Sep 2026 11:00:00 GMT</pubDate><source url="https://www.iproup.com">iProUP</source></item>'
    + '<item><title>Pomelo: beneficios de incorporar esta fruta a tu dieta - Clarín</title><link>https://news.google.com/rss/articles/p3</link><pubDate>Tue, 29 Sep 2026 12:00:00 GMT</pubDate><source url="https://www.clarin.com">Clarín</source></item>'
    + '</channel></rss>';
  const stories = parseFeed(rss, prensa).map(row => normalize(row, prensa, now)).filter(story => story && allowedHost(story, prensa) && relevant(story, prensa));
  assert.deepEqual(stories.map(story => story.source).sort(), ['Revista Mercado', 'iProUP']);
  for (const story of stories) {
    assert.equal(ENDEAVOR_PROMO.test(story.title) || ENDEAVOR_MARKET_NOISE.test(story.title), false, story.title);
    assert.equal(tagEndeavor(story).endeavor.company, 'Pomelo', story.title);
  }
});

test('Endeavor: nombres del directorio sin aclaraciones y etiqueta recalculada en cada nota', () => {
  assert.deepEqual(endeavorNames({ name: 'Galgo (formerly Migrante)', slug: 'migrante' }), ['Galgo', 'Migrante']);
  assert.deepEqual(endeavorNames({ name: 'Wellhub (fmr. GymPass)', slug: 'wellhub' }), ['Wellhub', 'GymPass']);
  assert.deepEqual(endeavorNames({ name: 'Zippedi Inc.', slug: 'zippedi-inc' }), ['Zippedi']);
  assert.deepEqual(endeavorNames({ name: 'GIINT / Storeacell', slug: 'giint' }), ['GIINT', 'Storeacell']);
  assert.deepEqual(endeavorNames({ name: 'Caramba!', slug: 'caramba' }), ['Caramba']);
  const index = endeavorIndex([company('Tipti', { offices: ['ecuador'], vertical: 'commerce' }), company('Clara')]);
  assert.equal(matchEndeavor({ title: 'TIPTI abre centro logístico en Quito' }, { index }).country, 'Ecuador');
  assert.equal(matchEndeavor({ title: 'TIPTI abre centro logístico en Quito' }, { index }).vertical, 'Comercio');
  const tagged = tagEndeavor({ id: 'a', title: 'Tipti abre centro en Quito', excerpt: '', endeavor: { company: 'Vieja' } }, { index });
  assert.equal(tagged.endeavor.company, 'Tipti');
  assert.equal('endeavor' in tagEndeavor({ id: 'b', title: 'Sin empresas', excerpt: '', endeavor: { company: 'Vieja' } }, { index }), false);
});

test('Endeavor: lotes de búsqueda por nombres con OR, rotación entre ejecuciones y canal propio', () => {
  const companies = searchCompanies();
  assert.ok(companies.length >= 110 && companies.length <= 130, String(companies.length));
  assert.ok(companies.every(item => item.vertical === 'fintech' || item.offices.includes('ecuador') || ENDEAVOR_SEARCH.slugs.includes(item.slug)));
  // Todas las fintech de la red, las de Ecuador y las de pagos y comercio digital de otros sectores.
  assert.equal(companies.filter(item => item.vertical === 'fintech').length, new Set(ENDEAVOR_COMPANIES.filter(item => item.vertical === 'fintech' && endeavorNames(item).length).map(item => endeavorNames(item)[0].toLowerCase())).size);
  for (const slug of ['mercadolibre-com', 'rappi', 'kavak', 'vtex']) assert.ok(companies.some(item => item.slug === slug), slug);
  assert.ok(companies.some(item => item.name === 'Tipti') && !companies.some(item => item.name === 'Globant'));
  assert.ok(!companies.some(item => item.name === 'Infocorp'), 'las excluidas no se buscan');
  for (const slug of [...ENDEAVOR_SEARCH.slugs, ...ENDEAVOR_SEARCH.quiet, ...Object.keys(ENDEAVOR_SEARCH.solo)]) assert.ok(ENDEAVOR_COMPANIES.some(item => item.slug === slug), `slug inexistente: ${slug}`);
  // El nombre va en el titular: el filtro de endeavor-prensa solo acepta titulares que nombran a la empresa.
  assert.equal(searchTerm(byName('Kueski')), 'intitle:"Kueski"');
  assert.equal(searchQualifier(byName('Kueski')), '');
  // Sin calificador los ambiguos con poco ruido (caso del CFO de Pomelo, que «fintech» dejaba fuera); con él, los ruidosos.
  assert.equal(searchQualifier(byName('Pomelo')), '');
  assert.equal(searchQualifier(byName('Klar')), '');
  assert.equal(searchQualifier(byName('Clara')), 'fintech');
  assert.equal(searchQualifier(byName('R2')), 'fintech');
  const batches = searchBatches(companies);
  assert.equal(batches.filter(batch => !batch.terms.some(term => /Mercado (Libre|Pago)/.test(term))).flatMap(batch => batch.terms).length, companies.length - 1);
  for (const batch of batches) {
    const query = searchQuery(batch);
    // Con más de 9 intitle: Google ignora when:30d.
    assert.ok(batch.terms.length <= 9 && (query.match(/intitle:/g) || []).length <= 9, query);
    assert.match(query, / when:30d$/);
    // Nunca hay grupos anidados: Google los interpreta mal dentro de un OR.
    assert.equal((query.match(/\(/g) || []).length, 1, query);
    if (batch.terms.some(term => ['intitle:"Clara"', 'intitle:"Swap"'].includes(term))) assert.equal(batch.qualifier, 'fintech');
    if (batch.terms.some(term => ['intitle:"Pomelo"', 'intitle:"Klar"', 'intitle:"Bitso"'].includes(term))) assert.equal(batch.qualifier, '');
  }
  // Mercado Libre y Mercado Pago, en lotes propios; las empresas que solo entran por Ecuador, en español.
  assert.deepEqual(batches.filter(batch => batch.terms.some(term => /Mercado (Libre|Pago)/.test(term))).map(batch => batch.terms), [['intitle:"Mercado Libre"', 'intitle:"MercadoLibre"'], ['intitle:"Mercado Pago"']]);
  assert.deepEqual(batches.find(batch => batch.terms.includes('intitle:"Tipti"')).languages, ['es']);
  assert.deepEqual(batches.find(batch => batch.terms.includes('intitle:"Bitso"')).languages, ['es', 'en']);
  const config = { ...ENDEAVOR_SEARCH, maxTerms: 2, quiet: ['klar'] };
  assert.deepEqual(searchBatches([company('Aaa1'), company('Bbb2'), company('Ccc3')], config), [{ terms: ['intitle:"Aaa1"', 'intitle:"Bbb2"'], qualifier: '', languages: ['es', 'en'] }, { terms: ['intitle:"Ccc3"'], qualifier: '', languages: ['es', 'en'] }]);
  assert.deepEqual(searchBatches([company('Aaa1'), company('Clara'), company('Klar'), company('Bbb2')], config), [{ terms: ['intitle:"Aaa1"', 'intitle:"Klar"'], qualifier: '', languages: ['es', 'en'] }, { terms: ['intitle:"Bbb2"'], qualifier: '', languages: ['es', 'en'] }, { terms: ['intitle:"Clara"'], qualifier: 'fintech', languages: ['es', 'en'] }]);
  assert.equal(searchQuery({ terms: ['intitle:"Clara"', 'intitle:"Cobre"'], qualifier: 'fintech' }), '(intitle:"Clara" OR intitle:"Cobre") fintech when:30d');
  const lots = searchLots([{ terms: ['intitle:"Aaa1"', 'intitle:"Bbb2"'], qualifier: '' }, { terms: ['intitle:"Ccc3"'], qualifier: '' }]);
  assert.deepEqual(lots.map(lot => [lot.index, lot.language]), [[0, 'es'], [1, 'en'], [2, 'es'], [3, 'en']]);
  assert.equal(new URL(lots[0].url).searchParams.get('q'), '(intitle:"Aaa1" OR intitle:"Bbb2") when:30d');
  assert.equal(new URL(lots[3].url).searchParams.get('hl'), 'en-US');
  assert.deepEqual(searchLots([{ terms: ['intitle:"Tipti"'], qualifier: '', languages: ['es'] }]).map(lot => lot.language), ['es']);
  // Presupuesto de Google: la vuelta completa en un día (3 ejecuciones reales) y no más de 30 consultas por ejecución,
  // contando las demás fuentes de Google News.
  const all = searchLots(batches);
  assert.ok(searchPerRun(all) * ENDEAVOR_SEARCH.runsPerDay >= all.length);
  assert.equal(rotation(all, 0).picked.length, searchPerRun(all));
  const googleQueries = SOURCES.filter(item => item.adapter === 'google' && !item.search).length + searchPerRun(all);
  assert.ok(googleQueries <= 30, `${googleQueries} consultas a Google por ejecución`);
  // La rotación toma `count` lotes desde el cursor, da la vuelta y no repite un lote en la misma ejecución.
  assert.deepEqual(rotation(lots, 0, 3).picked.map(lot => lot.index), [0, 1, 2]);
  assert.deepEqual(rotation(lots, 3, 3), { picked: [lots[3], lots[0], lots[1]], next: 2 });
  assert.equal(rotation(lots, undefined, 9).picked.length, 4);
  assert.equal(rotation(lots, 'x', 1).next, 1);
  assert.deepEqual(rotation([], 5, 2), { picked: [], next: 0 });
  // Varias ejecuciones seguidas recorren todos los lotes antes de repetir.
  let cursor = 0; const seen = [];
  for (let run = 0; run < 2; run++) { const step = rotation(lots, cursor, 2); seen.push(...step.picked.map(lot => lot.index)); cursor = step.next; }
  assert.deepEqual(seen, [0, 1, 2, 3]);
  // Fuentes del canal: la búsqueda es prensa (no contenido de Endeavor) y el blog de Endeavor Argentina sigue siendo organización.
  assert.ok(CHANNELS.includes('endeavor'));
  const prensa = sourceById('endeavor-prensa');
  assert.deepEqual([prensa.category, prensa.kind, prensa.adapter, prensa.search], ['endeavor', 'news', 'google', 'endeavor']);
  assert.deepEqual([sourceById('endeavor-ar').category, sourceById('endeavor-ar').kind], ['endeavor', 'organization']);
});

test('Endeavor: la nota de Google conserva su medio, lleva «Vía Google News» y solo entra si el titular nombra a la empresa', () => {
  const prensa = sourceById('endeavor-prensa');
  const rss = '<rss><channel>'
    + '<item><title>Addi invertirá US$2.000 millones en Colombia - Valora Analitik</title><link>https://news.google.com/rss/articles/a</link><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate><source url="https://www.valoraanalitik.com">Valora Analitik</source></item>'
    + '<item><title>Beatriz Eugenia Fernández recibirá el Premio Forbes Colombia - Forbes Colombia</title><link>https://news.google.com/rss/articles/b</link><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate><source url="https://forbes.co">Forbes Colombia</source></item>'
    + '</channel></rss>';
  const stories = parseFeed(rss, prensa).map(row => normalize(row, prensa, now)).filter(story => story && relevant(story, prensa));
  assert.equal(stories.length, 1);
  assert.deepEqual([stories[0].source, stories[0].sourceUrl, stories[0].via, stories[0].kind, stories[0].category, stories[0].title], ['Valora Analitik', 'https://www.valoraanalitik.com/', 'Vía Google News', 'news', 'endeavor', 'Addi invertirá US$2.000 millones en Colombia']);
  assert.equal(tagEndeavor(stories[0]).endeavor.company, 'ADDI');
  // Las páginas de la propia Endeavor no entran como prensa por la búsqueda.
  assert.equal(allowedHost({ sourceUrl: 'https://www.endeavor.org.ar' }, prensa), false);
  assert.equal(allowedHost({ sourceUrl: 'https://endeavor.org' }, prensa), false);
  assert.equal(allowedHost({ sourceUrl: 'https://www.valoraanalitik.com' }, prensa), true);
});

test('Endeavor LATAM: solo entran medios de la lista; las notas conservadas que no la cumplen salen al regenerar', () => {
  const prensa = sourceById('endeavor-prensa');
  assert.equal(prensa.allowHosts, ENDEAVOR_PRESS_HOSTS);
  assert.equal(new Set(ENDEAVOR_PRESS_HOSTS).size, ENDEAVOR_PRESS_HOSTS.length, 'dominios repetidos');
  for (const host of ENDEAVOR_PRESS_HOSTS) assert.match(host, /^[a-z0-9.-]+\.[a-z]{2,}$/, host);
  // Dominios reales (sourceUrl de Google News) de la última edición.
  const yes = ['https://www.cronista.com', 'https://www.forbesargentina.com', 'https://gestion.pe', 'https://www.larepublica.co', 'https://www.eluniversal.com', 'https://www.elnacional.com', 'https://www.razon.com.mx', 'https://elceo.com', 'https://www.iproup.com', 'https://mercado.com.ar', 'https://www.mercado.com.ar', 'https://dplnews.com', 'https://www.pymnts.com', 'https://thepaypers.com', 'https://www.coindesk.com', 'https://www.latamfintech.co', 'https://app.dealroom.co', 'https://www.lexology.com', 'https://www.valoraanalitik.com', 'https://www.fintechexpert.mx', 'https://www.xataka.com.mx', 'https://www.mobiletime.la', 'https://lexlatin.com', 'https://www.enter.co', 'https://www.itsitio.com', 'https://mexicobusiness.news', 'https://decrypt.co', 'https://www.fintechfutures.com'];
  const no = ['https://www.binance.com', 'https://wintorabc.com.co', 'https://portalinnova.cl', 'https://albertonews.com', 'https://tenemosnoticias.com', 'https://alnavio.es', 'https://www.tendenciainternacional.com', 'https://www.noticias24hrs.com.ve', 'https://www.globenewswire.com', 'https://pluang.com', 'https://www.tradingview.com', 'https://www.manilatimes.net', 'https://revistaq.mx', 'https://es.investing.com', 'https://www.endeavor.org.ar', 'https://endeavor.org', 'https://cronista.com.falso.example', 'https://supermercado.com.ar', 'https://ecosistemastartup.com', 'https://estrelladigital.com.co', 'https://es.tradingview.com', 'https://edomexaldia.com', 'nada'];
  for (const url of yes) assert.equal(allowedHost({ sourceUrl: url }, prensa), true, url);
  for (const url of no) assert.equal(allowedHost({ sourceUrl: url }, prensa), false, url);
  // Incluye los medios que el proyecto ya usa como fuentes de nivel 1 y 2.
  for (const item of SOURCES.filter(entry => entry.kind === 'news' && entry.tier <= 2 && !entry.search)) {
    for (const host of item.allowHosts || [new URL(item.site).hostname]) assert.equal(allowedHost({ sourceUrl: `https://${host}` }, prensa), true, `${item.id}: ${host}`);
  }
  // Exclusión de titulares promocionales, editable y aparte de la lista de medios.
  assert.equal(ENDEAVOR_PROMO.test('Kueski Pay: cupones de descuento por tiempo limitado'), true);
  assert.equal(ENDEAVOR_PROMO.test('Clip sortea terminales entre sus clientes'), true);
  assert.equal(ENDEAVOR_PROMO.test('Ualá premia a sus usuarios con reintegros'), true);
  assert.equal(ENDEAVOR_PROMO.test('Kueski insta a revisar compras ante aumento de ciberfraudes'), false);
  assert.equal(ENDEAVOR_PROMO.test('De vetar el crédito a monopolizar Cashea en Venezuela'), false);
  // Fugas que abren Mercado Libre, Kavak y las demás empresas sumadas a la búsqueda (titulares reales del 19 de noviembre).
  for (const title of ['¿Quieres ir a la NFL en México GRATIS? Kavak regalará cinco pases dobles', 'Mercado Libre acelera su apuesta por El Buen Fin 2026 con descuentos de hasta 65%', '¿Qué OFERTAS tendrá Mercado Libre por El Buen Fin? Esto debes saber', 'Prestamype: la fintech que ofrece una rentabilidad garantizada de hasta 10% anual para tu CTS']) assert.equal(ENDEAVOR_PROMO.test(title), true, title);
  for (const title of ['Mercado Libre profundiza su caída en Wall Street: sus acciones pierden más de 13%', 'Mercado Libre cayó 13%, pero Wall Street espera que suba la acción', 'Mercado Libre se desploma casi 14% en Wall Street pese a ingresos récord']) assert.equal(ENDEAVOR_MARKET_NOISE.test(title), true, title);
  for (const title of ['Mercado Libre y Sectur impulsan a pymes y artesanos mexicanos en el e-commerce', 'Un ejecutivo de Mercado Libre fue elegido CFO del año', 'Bold lanza cuenta digital gratis en Colombia', 'Addi invertirá US$2.000 millones en Colombia para ampliar el crédito']) assert.equal(ENDEAVOR_PROMO.test(title) || ENDEAVOR_MARKET_NOISE.test(title), false, title);
  // Mercado Libre y Mercado Pago solo cuentan escritos con mayúsculas: «un mercado libre» es otra cosa.
  assert.equal(matchEndeavor({ title: 'Mercado Pago lanza una cuenta remunerada en Colombia' })?.company, 'MercadoLibre.com');
  assert.equal(matchEndeavor({ title: 'Mercado Libre construye una nueva nave clave para la región' })?.company, 'MercadoLibre.com');
  assert.equal(matchEndeavor({ title: 'MercadoLibre suma vendedores' })?.company, 'MercadoLibre.com');
  assert.equal(matchEndeavor({ title: 'Un Estado fuerte para un mercado libre' }), null);
  assert.equal(matchEndeavor({ title: 'Inflación', excerpt: 'Cuando el mercado pagó más por los bonos del Tesoro' }), null);
  // Al regenerar, la acumulación vuelve a aplicar medio y tema (passes): lo anterior que no cumple sale.
  const old = (title, sourceUrl, sourceName) => ({ ...make('endeavor-prensa', 30), id: title, category: 'endeavor', title, source: sourceName, sourceUrl, via: 'Vía Google News' });
  const previous = [
    old('De vetar el crédito a monopolizar Cashea en Venezuela', 'https://www.elnacional.com/', 'El Nacional'),
    old('🚨 Money Laundering and Crypto Scandal: Is This the End of Cashea? 🚨', 'https://www.binance.com/', 'Binance'),
    old('Pix to cross USD 200 billion in Brazilian e-commerce for the first time in 2027, EBANX projects', 'https://www.globenewswire.com/', 'GlobeNewswire'),
    old('El cupón que habilitó Cashea hasta el 13Nov y se activa sin costo', 'https://www.cronista.com/', 'El Cronista'),
  ];
  const kept = accumulate([], previous, prensa, { now, keep: story => passes(story, prensa) });
  assert.deepEqual(kept.map(story => story.source), ['El Nacional']);
});

// ---------------------------------------------------------------------------------------------------------
// Revisión de seguridad: dominios de las fuentes oficiales, edición anterior, tamaños y validador.
const official = SOURCES.filter(item => item.kind === 'official' && item.adapter !== 'google');

test('fuentes oficiales: cada una tiene su lista de dominios y solo acepta enlaces de ella', () => {
  assert.ok(official.length >= 17);
  for (const item of official) {
    assert.ok(Array.isArray(item.linkHosts) && item.linkHosts.length, `${item.id} sin linkHosts`);
    for (const host of item.linkHosts) assert.match(host, /^[a-z0-9.-]+\.[a-z]{2,}$/, `${item.id}: ${host}`);
    assert.equal(inHosts(item.url, item.linkHosts), true, `${item.id}: la URL de la fuente no está en su lista`);
  }
  // Google News no usa esta regla: su enlace es siempre de news.google.com y el medio se controla con allowHosts.
  for (const item of SOURCES.filter(entry => entry.adapter === 'google')) assert.equal(item.linkHosts, undefined, item.id);
  const junta = sourceById('bce-junta-resoluciones');
  // Los enlaces relativos (y el vacío, que normalize convierte en la página de la fuente) se resuelven contra la URL de la fuente.
  const yes = ['https://www.bce.fin.ec/storage/JPRFM/resoluciones/JPRFM-2026-048-T.pdf', 'https://contenido.bce.fin.ec/documentos/a.pdf', '/storage/JPRFM/resoluciones/relativa.pdf', ''];
  const no = ['https://otro.example/storage/JPRFM/resoluciones/JPRFM-2026-048-T.pdf', 'https://bce.fin.ec.otro.example/storage/x/resoluciones/a.pdf', 'https://falsobce.fin.ec/a.pdf', 'javascript:alert(1)', 'ftp://www.bce.fin.ec/a.pdf', '//otro.example/a.pdf'];
  for (const url of yes) assert.equal(linkAllowed({ url }, junta), true, url);
  for (const url of no) assert.equal(linkAllowed({ url }, junta), false, String(url));
  // El Ministerio de Economía publica en economicoproductivo.gob.ec (su feed redirige allí).
  assert.equal(linkAllowed({ url: 'https://www.economicoproductivo.gob.ec/nota/' }, sourceById('mef')), true);
  assert.equal(linkAllowed({ url: 'https://www.bce.fin.ec/nota/' }, sourceById('mef')), false);
  // Una fuente sin lista (prensa) acepta cualquier enlace.
  assert.equal(linkAllowed({ url: 'https://cualquiera.example/nota' }, sourceById('primicias')), true);
  // Una resolución «oficial» que apunta a otro sitio: el analizador la lee, pero no pasa ni se conserva.
  const html = '<table><tr><td>JPRFM-2026-050-M</td><td>Aprueba la norma de pagos.</td><td><a href="https://otro.example/storage/JPRFM/resoluciones/JPRFM-2026-050-M.pdf">VER</a></td></tr></table>';
  const [row] = parseBceResolutions(html, junta.url);
  assert.equal(linkAllowed(row, junta), false);
  const story = normalize({ ...row, publishedAt: '2026-09-27T16:45:32.000Z' }, junta, now);
  assert.equal(passes(story, junta), false);
  assert.deepEqual(accumulate([], [story], junta, { now }), []);
});

test('resoluciones del BCE: no se pide la fecha (HEAD) de documentos fuera de los dominios de la fuente', async () => {
  const junta = sourceById('bce-junta-resoluciones');
  const html = '<table><tr><td>JPRFM-2026-050-M</td><td>Aprueba la norma de pagos.</td><td><a href="https://www.bce.fin.ec/storage/JPRFM/resoluciones/JPRFM-2026-050-M.pdf">VER</a></td></tr><tr><td>JPRFM-2026-051-M</td><td>Aprueba la norma de tarjetas.</td><td><a href="https://otro.example/storage/JPRFM/resoluciones/JPRFM-2026-051-M.pdf">VER</a></td></tr></table>';
  const rows = parseBceResolutions(html, junta.url);
  assert.equal(rows.length, 2);
  const original = globalThis.fetch; const asked = [];
  globalThis.fetch = async url => { asked.push(String(url)); return new Response(null, { status: 200, headers: { 'last-modified': 'Sun, 27 Sep 2026 16:45:32 GMT' } }); };
  try {
    const { tracked, rows: dated } = await dateResolutions(rows, junta, null, new Date(now));
    assert.deepEqual(asked, ['https://www.bce.fin.ec/storage/JPRFM/resoluciones/JPRFM-2026-050-M.pdf']);
    assert.deepEqual(Object.keys(tracked), asked);
    assert.equal(dated.length, 1);
  } finally { globalThis.fetch = original; }
});

test('edición anterior: si no tiene la forma esperada se trata como vacía, y las notas malformadas se descartan contando cuántas', () => {
  for (const bad of [null, 'texto', [], { stories: {}, sources: [] }, { stories: [], sources: {} }, { stories: [], sources: [], tracked: [] }, { stories: [], sources: [], tracked: 'x' }]) {
    assert.equal(editionShape(bad), false, JSON.stringify(bad));
    const { previous, shapeOk } = loadPrevious(bad);
    assert.equal(shapeOk, false);
    assert.deepEqual(previous, { stories: [], sources: [] });
  }
  assert.equal(editionShape({ stories: [], sources: [] }), true);
  assert.equal(editionShape({ stories: [], sources: [], tracked: {} }), true);
  const bce = sourceById('bce-junta-resoluciones');
  const good = { ...make('bce-junta-resoluciones', 5), url: 'https://www.bce.fin.ec/storage/JPRFM/resoluciones/JPRFM-2026-048-T.pdf', excerpt: 'Resolución JPRFM-2026-048-T. Fecha de carga.' };
  const prensa = make('primicias', 6);
  const corrupt = [
    null, 'nota', 42,
    { ...good, id: 'otra-dominio', url: 'https://otro.example/storage/JPRFM/resoluciones/JPRFM-2026-048-T.pdf' },
    { ...prensa, id: 'js', url: 'javascript:alert(1)' },
    { ...prensa, id: '' }, { ...prensa, id: 'sin-titulo', title: '  ' }, { ...prensa, id: 'sin-medio', source: undefined },
    { ...prensa, id: 'medio-malo', sourceUrl: 'javascript:alert(1)' }, { ...prensa, id: 'fecha-mala', publishedAt: 'ayer' },
    { ...prensa, id: 'retirada', sourceId: 'retirada' }, { ...prensa, id: 'extracto-raro', excerpt: { a: 1 } },
  ];
  const { previous, shapeOk, dropped } = loadPrevious({ stories: [good, prensa, ...corrupt], sources: [null, { id: 'seps' }], tracked: {} });
  assert.equal(shapeOk, true);
  assert.equal(dropped, corrupt.length);
  assert.deepEqual(previous.stories.map(story => story.id), [good.id, prensa.id]);
  // accumulate revalida también por su cuenta.
  assert.equal(carryable(good, bce), true);
  assert.deepEqual(accumulate([], [good, ...corrupt], bce, { now }).map(story => story.id), [good.id]);
});

test('una nota malformada no hace lanzar a los filtros: cuenta como que no pasa', () => {
  const theblock = sourceById('theblock');
  const junta = sourceById('bce-junta-resoluciones');
  const odd = [{ title: 'Stablecoin regulation', url: 'no es una url' }, { title: 'Stablecoin regulation' }, {}, { title: 42, url: 42 }];
  for (const story of odd) {
    assert.doesNotThrow(() => relevant(story, theblock));
    assert.equal(relevant(story, theblock), false);
    assert.equal(passes(story, theblock), false);
  }
  // El filtro de la Junta lee el extracto: sin extracto, antes lanzaba.
  assert.equal(relevant({ title: 'Aprueba la norma de pagos.' }, junta), false);
  assert.equal(passes({ title: 'Aprueba la norma de pagos.', url: 'https://www.bce.fin.ec/a.pdf' }, junta), false);
  // Un `keep` que lanza tampoco rompe la acumulación.
  const feed = { id: 'medio', name: 'Medio', category: 'pagos', kind: 'news' };
  assert.deepEqual(accumulate([], [make('medio', 3)], feed, { now, keep: () => { throw new Error('roto'); } }), []);
});

test('el extracto con miles de «The post » se procesa en milisegundos y sin cambiar el recorte', () => {
  const big = 'Inicio del extracto. ' + 'The post '.repeat(60000) + 'final';
  assert.ok(big.length > 500_000);
  const started = performance.now();
  const story = normalize({ title: 'Nota larga', url: 'https://example.com/larga', publishedAt: '2026-09-29T10:00:00Z', excerpt: big }, source, now);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1000, `${Math.round(elapsed)} ms`);
  assert.equal(story.excerpt, clipExcerpt(big));
  // La coletilla de WordPress se sigue quitando en extractos normales.
  const wp = normalize({ title: 'Nota', url: 'https://example.com/wp', publishedAt: '2026-09-29T10:00:00Z', excerpt: 'Texto de la nota. The post Nota appeared first on Medio.' }, source, now);
  assert.equal(wp.excerpt, 'Texto de la nota.');
});

test('Endeavor: toda ficha del directorio es https de endeavor.org, y un enlace ajeno deja a la empresa sin enlace', () => {
  for (const entry of endeavorDirectory.companies) {
    assert.equal(typeof entry.url, 'string', entry.slug);
    assert.equal(endeavorUrl(entry.url), entry.url, `${entry.slug}: ${entry.url}`);
  }
  assert.equal(endeavorUrl('https://endeavor.org/entrepreneur-companies/'), 'https://endeavor.org/entrepreneur-companies/');
  assert.equal(endeavorUrl('https://www.endeavor.org/x'), 'https://www.endeavor.org/x');
  for (const bad of ['http://endeavor.org/x', 'https://endeavor.org.otro.example/x', 'https://falsoendeavor.org/x', 'https://otro.example/?endeavor.org', 'javascript:alert(1)', '', null]) assert.equal(endeavorUrl(bad), null, String(bad));
  const item = { slug: 'kueski', link: 'https://otro.example/kueski', title: { rendered: 'Kueski' }, class_list: ['vertical-fintech', 'region-latin-america', 'local-office-mexico'] };
  assert.equal('url' in toCompany(item), false);
  assert.equal(toCompany({ ...item, link: 'https://endeavor.org/kueski' }).url, 'https://endeavor.org/kueski');
  // Al etiquetar, tampoco se publica un enlace ajeno.
  const index = endeavorIndex([company('Kueski', { url: 'https://otro.example/kueski' }), company('Konfío', { url: 'https://endeavor.org/konfio' })]);
  const foreign = matchEndeavor({ title: 'Kueski levanta una ronda de inversión', excerpt: '' }, { index });
  assert.equal(foreign.company, 'Kueski');
  assert.equal('url' in foreign, false);
  assert.equal(matchEndeavor({ title: 'Konfío levanta una ronda de inversión', excerpt: '' }, { index }).url, 'https://endeavor.org/konfio');
});

test('lectura con tope: se rechaza por Content-Length o al pasar el límite mientras se lee', async () => {
  assert.equal(await readBody(new Response('hola')), 'hola');
  assert.equal(await readBody(new Response('ñandú')), 'ñandú');
  await assert.rejects(readBody(new Response('x', { headers: { 'content-length': '5000000' } }), 3_000_000), /demasiado grande/);
  let pulls = 0;
  const endless = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(64 * 1024)); } });
  await assert.rejects(readBody(new Response(endless), 1_000_000), /demasiado grande/);
  assert.ok(pulls < 40, `partes leídas: ${pulls}`);
});

test('validador: enlaces del medio y de las fuentes, dominios de las fuentes oficiales y fichas Endeavor', () => {
  const at = new Date(now - 3600 * 1000).toISOString();
  const base = () => ({
    version: 1,
    sources: [{ id: 'bce-junta-resoluciones', status: 'ok', tier: 1, access: 'open', language: 'es', url: 'https://www.bce.fin.ec/' }],
    stories: [
      { id: 'a', sourceId: 'bce-junta-resoluciones', category: 'regulacion', title: 'Resolución', source: 'BCE', url: 'https://www.bce.fin.ec/storage/JPRFM/resoluciones/a.pdf', sourceUrl: 'https://www.bce.fin.ec/', publishedAt: at },
      { id: 'b', sourceId: 'primicias', category: 'ecuador', title: 'Nota', source: 'Primicias', url: 'https://www.primicias.ec/economia/b/', sourceUrl: 'https://www.primicias.ec/', publishedAt: at, endeavor: { company: 'Kushki', url: 'https://endeavor.org/kushki' } },
    ],
  });
  assert.deepEqual(validateEdition(base(), { now }), { stories: 2, available: 1 });
  const broken = [
    [data => { data.stories[0].url = 'https://otro.example/storage/JPRFM/resoluciones/a.pdf'; }, /fuera de los dominios de bce-junta-resoluciones/],
    [data => { data.stories[1].sourceUrl = 'javascript:alert(1)'; }, /enlace del medio inválido/],
    [data => { data.sources[0].url = 'javascript:alert(1)'; }, /enlace inválido en la fuente/],
    [data => { data.stories[1].endeavor.url = 'https://otro.example/kushki'; }, /empresa Endeavor inválida/],
    [data => { data.stories[1].endeavor.url = 'http://endeavor.org/kushki'; }, /empresa Endeavor inválida/],
    [data => { data.stories[1].url = 'javascript:alert(1)'; }, /noticia inválida/],
  ];
  for (const [damage, message] of broken) {
    const data = base(); damage(data);
    assert.throws(() => validateEdition(data, { now }), message);
  }
  // Sin sourceUrl ni enlace Endeavor, la nota sigue siendo válida (son opcionales).
  const optional = base(); delete optional.stories[1].sourceUrl; delete optional.stories[1].endeavor.url;
  assert.doesNotThrow(() => validateEdition(optional, { now }));
});

// ---------------------------------------------------------------------------------------------------------
// Registro de descartes: motivo de cada regla, embudo por fuente y descartes.json junto a la edición.
test('rejectReason dice qué regla de FILTERS descartó la nota, y relevant es su negación', () => {
  const why = (id, title, url = 'https://example.com/nota', excerpt = '') => rejectReason({ title, excerpt, url }, sourceById(id));
  assert.equal(why('primicias', 'Banco Pichincha amplía su crédito', 'https://www.primicias.ec/economia/nota/'), null);
  assert.equal(why('primicias', 'China Mall se expande en Ecuador', 'https://www.primicias.ec/economia/nota/'), 'include');
  assert.equal(why('primicias', '¿Va a renovar electrodomésticos en Black Friday? Pague con tarjeta', 'https://www.primicias.ec/economia/nota/'), 'exclude: Black Friday');
  assert.equal(why('primicias', 'Banco Pichincha amplía su crédito', 'https://www.primicias.ec/entretenimiento/banco/'), 'path');
  assert.equal(why('paymentsdive', 'Embedded finance in 2026: What merchants want', 'https://www.paymentsdive.com/spons/nota/1/'), 'skipPath');
  assert.equal(why('bce-junta-resoluciones', 'Designa a los miembros', 'https://www.bce.fin.ec/a.pdf', 'Resolución JPRFM-2026-001-M.'), 'test');
  // La búsqueda Endeavor dice qué parte de su prueba falló.
  assert.equal(why('endeavor-prensa', 'DLocal (NASDAQ:DLO) Stock Price Target Cut by Truist Financial'), 'test: ruido bursátil');
  assert.equal(why('endeavor-prensa', 'El cupón que habilitó Cashea hasta el 13Nov y se activa sin costo'), 'test: promoción');
  assert.equal(why('endeavor-prensa', 'Una mañana clara en Quito'), 'test: sin empresa Endeavor en el titular');
  // Sin filtro, todo pasa; una nota malformada no lanza.
  assert.equal(rejectReason({ title: 'Lo que sea' }, { id: 'sin-filtro' }), null);
  assert.equal(rejectReason({ title: 'Stablecoin regulation', url: 'no es una url' }, sourceById('theblock')), 'path');
  assert.equal(rejectReason({ title: 'Aprueba la norma de pagos.' }, sourceById('bce-junta-resoluciones')), 'error');
  for (const [id, title, url, expected] of SAMPLES) assert.equal(rejectReason({ title, excerpt: '', url: url || 'https://example.com/nota' }, sourceById(id)) === null, expected, `${id}: ${title}`);
});

test('embudo: cada fila cae en una sola etapa y los descartes por medio y por tema se registran con su motivo', () => {
  const google = { id: 'prueba-google', name: 'Prueba', category: 'latam', kind: 'news', tier: 2, adapter: 'google', url: 'https://news.google.com/rss/search', allowHosts: ['medio.example'], denyHosts: ['bloqueado.medio.example'] };
  FILTERS['prueba-google'] = { include: /fintech/i, exclude: /casino/i };
  try {
    const at = new Date(now - 2 * 3600 * 1000).toISOString();
    const row = (title, host, extra = {}) => ({ title, url: `https://news.google.com/articles/${encodeURIComponent(title)}`, publishedAt: at, source: 'Medio', sourceUrl: `https://${host}/`, via: 'Vía Google News', ...extra });
    const rows = [
      row('Fintech levanta una ronda', 'medio.example'),
      row('Fintech fuera de la lista', 'otro.example'),
      row('Fintech en un subdominio bloqueado', 'bloqueado.medio.example'),
      row('Fintech sin medio', 'medio.example', { sourceUrl: 'no es una url' }),
      row('Fintech antigua fuera de la lista', 'otro.example', { publishedAt: '2026-08-01T00:00:00Z' }),
      row('Fintech antigua', 'medio.example', { publishedAt: '2026-08-01T00:00:00Z' }),
      row('', 'medio.example'),
      row('Los mejores casinos fintech', 'medio.example'),
      row('Minería en Perú', 'medio.example'),
    ];
    const { stories, funnel, discards } = screen(rows, google, now);
    assert.deepEqual(stories.map(story => story.title), ['Fintech levanta una ronda']);
    assert.deepEqual(funnel, { host: 4, normalize: 2, topic: 2, accepted: 1 });
    assert.equal(funnel.host + funnel.normalize + funnel.topic + funnel.accepted, rows.length);
    // La nota antigua fuera de la lista cuenta como caída por medio, pero no se registra: no habría entrado de todos modos.
    assert.deepEqual(discards.map(entry => [entry.stage, entry.reason, entry.host, entry.title]), [
      ['medio', 'allowHosts', 'otro.example', 'Fintech fuera de la lista'],
      ['medio', 'denyHosts', 'bloqueado.medio.example', 'Fintech en un subdominio bloqueado'],
      ['medio', 'medio sin dominio', undefined, 'Fintech sin medio'],
      ['tema', 'exclude: casino', undefined, 'Los mejores casinos fintech'],
      ['tema', 'include', undefined, 'Minería en Perú'],
    ]);
    for (const entry of discards) {
      assert.equal(entry.sourceId, 'prueba-google');
      assert.ok(safeUrl(entry.url));
      assert.equal(entry.publishedAt, at);
    }
    // El mismo resultado que el embudo anterior: allowedHost, normalize y relevant.
    const legacy = rows.filter(item => allowedHost(item, google)).map(item => normalize(item, google, now)).filter(Boolean).filter(story => relevant(story, google));
    assert.deepEqual(stories, legacy);
  } finally { delete FILTERS['prueba-google']; }
  assert.equal(hostRejection({ sourceUrl: 'https://cualquiera.example/' }, { id: 'abierta' }), null);
});

test('descartes.json: por fuente, los más recientes, sin repetir titular y con tope; el validador lo acepta', () => {
  const at = hours => new Date(now - hours * 3600 * 1000).toISOString();
  const entry = (sourceId, title, hours, extra = {}) => ({ sourceId, stage: 'tema', reason: 'include', title, url: `https://example.com/${encodeURIComponent(title)}`, source: 'Medio', publishedAt: at(hours), ...extra });
  const many = Array.from({ length: 45 }, (_, i) => entry('la-republica', `Nota ${i}`, i + 1));
  const log = discardLog([...many, entry('la-republica', 'NOTA 0', 0.5), entry('primicias', 'Otra', 3, { stage: 'medio', reason: 'allowHosts', host: 'otro.example' })], { generatedAt: at(0) });
  assert.equal(log.version, 1);
  assert.equal(log.perSource, MAX_DISCARDS_PER_SOURCE);
  const republica = log.discards.filter(item => item.sourceId === 'la-republica');
  assert.equal(republica.length, MAX_DISCARDS_PER_SOURCE);
  // Gana la copia más reciente del titular repetido (sin distinguir mayúsculas) y sale lo más antiguo.
  assert.equal(republica[0].title, 'NOTA 0');
  assert.ok(!republica.some(item => item.title === 'Nota 0'));
  assert.deepEqual(log.omitted, { 'la-republica': 5 });
  assert.deepEqual(validateDiscards(log), { discards: MAX_DISCARDS_PER_SOURCE + 1 });
  const broken = [
    [data => { data.discards[0].url = 'javascript:alert(1)'; }, /descarte inválido/],
    [data => { data.discards[0].sourceId = 'retirada'; }, /fuente desconocida/],
    [data => { data.discards[0].stage = 'tope'; }, /etapa o motivo/],
    [data => { data.discards[0].reason = ''; }, /etapa o motivo/],
    [data => { data.discards.push(...many.slice(0, 1)); }, /demasiados descartes/],
    [data => { data.omitted = { primicias: 0 }; }, /omitidos inválidos/],
    [data => { delete data.generatedAt; }, /estructura/],
  ];
  for (const [damage, message] of broken) {
    const data = structuredClone(log); damage(data);
    assert.throws(() => validateDiscards(data), message);
  }
});

test('validador: el embudo de cada fuente es opcional y, si está, cuadra', () => {
  const at = new Date(now - 3600 * 1000).toISOString();
  const funnel = { read: 12, foreign: 1, undated: 0, host: 2, normalize: 3, topic: 4, accepted: 2 };
  const base = () => ({ version: 1, sources: [{ id: 'primicias', status: 'ok', funnel: { ...funnel } }, { id: 'mef', status: 'error' }], stories: [{ id: 'a', sourceId: 'primicias', category: 'ecuador', title: 'Nota', source: 'Primicias', url: 'https://www.primicias.ec/economia/a/', publishedAt: at }] });
  assert.doesNotThrow(() => validateEdition(base(), { now }));
  const saturated = base(); saturated.sources[0].funnel.saturated = true;
  assert.doesNotThrow(() => validateEdition(saturated, { now }));
  assert.equal(validFunnel(funnel), true);
  for (const damage of [
    data => { data.sources[0].funnel.saturated = false; },
    data => { data.sources[0].funnel.read = 13; },
    data => { data.sources[0].funnel.topic = -1; },
    data => { data.sources[0].funnel.extra = 1; },
    data => { delete data.sources[0].funnel.accepted; },
    data => { data.sources[0].funnel = [1, 2]; },
  ]) {
    const data = base(); damage(data);
    assert.throws(() => validateEdition(data, { now }), /embudo inválido en la fuente primicias/);
  }
});

test('el registro de descartes se escribe junto a la edición y de forma atómica', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'news-tv-'));
  try {
    const edition = join(dir, 'sub', 'edicion.json');
    assert.equal(discardsPath(edition), join(dir, 'sub', 'descartes.json'));
    await writeJson(discardsPath(edition), { version: 1 });
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'sub', 'descartes.json'), 'utf8')), { version: 1 });
    assert.deepEqual((await readdir(join(dir, 'sub'))).sort(), ['descartes.json']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
