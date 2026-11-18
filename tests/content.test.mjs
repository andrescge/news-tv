import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parseBce, parseBcePublications, parseBceResolutions, parseRegistroOficial, parseRegistroOficialIndex, parseSupercias, resolutionYear, coverageSignature, parseFeed, parseDate, deduplicate, safeUrl, recent, relevant, allowedHost, channelFor, limitFor, accumulate, composeChannel, composeEdition, periodIndex, spaced, shares, FILTERS, CHANNELS, matchEndeavor, tagEndeavor, endeavorIndex, endeavorNames, searchCompanies, searchTerm, searchQualifier, searchQuery, searchBatches, searchLots, rotation, ENDEAVOR_COMPANIES, ENDEAVOR_AMBIGUOUS, ENDEAVOR_SEARCH } from '../scripts/content.mjs';
import { decodeEntities, toCompany, latamCompanies } from '../scripts/endeavor.mjs';
import { SOURCES } from '../scripts/collect.mjs';

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

test('en Fintech LATAM la misma operación contada por varios medios queda en una nota', () => {
  const latam = { ...source, category: 'latam' };
  const story = (title, medium, publishedAt, extra = {}) => normalize({ title, url: `https://example.com/${encodeURIComponent(`${medium}/${title}`)}`, publishedAt, source: medium, ...extra }, latam, now);
  const english = story('Cocos raises $34M at $508M valuation', 'LatamList', '2026-09-27T10:00:00Z', { excerpt: 'Cocos closed a new round.' });
  const spanish = story('Fintech argentina Cocos levantó US$34M para escalar su banco digital', 'El Economista', '2026-09-28T10:00:00Z', { via: 'Vía Google News' });
  const partners = story('Paytech Akua recibe inversión de Itaú Ventures', 'El Economista', '2026-09-28T09:00:00Z', { via: 'Vía Google News' });
  const partnersEnglish = story('Colombian fintech Akua secures investment from Itaú Unibanco', 'LatamList', '2026-09-28T08:00:00Z');
  const other = story('Revolut prevé lanzar su banco en Argentina', 'Bloomberg Línea', '2026-09-28T07:00:00Z');
  const later = story('Cocos compra una sociedad de bolsa por US$34M', 'iupana', '2026-09-10T07:00:00Z');
  assert.deepEqual([...coverageSignature('Cocos raises $34M at $508M valuation').amounts], ['34m', '508m']);
  assert.deepEqual([...coverageSignature('Fintech argentina levanta USD 6,4 millones').amounts], ['6.4m']);
  const result = deduplicate([spanish, english, partners, partnersEnglish, other, later]);
  assert.deepEqual(result.map(item => item.title), [english.title, partnersEnglish.title, other.title, later.title]);
  const payments = [english, spanish].map(item => ({ ...item, category: 'pagos' }));
  assert.equal(deduplicate(payments).length, 2);
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

test('Registro Oficial: se compone el titular con órgano y código, y solo entran normas de órganos financieros', () => {
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
  assert.deepEqual(rows.map(row => row.title), [
    'Junta de Política y Regulación Financiera y Monetaria: JPRFM-2026-051-F Se reforma la Codificación de Resoluciones Monetarias, Financieras, de Valores y Seguros',
    'Superintendencia de Economía Popular y Solidaria: SEPS-IGT-IGS-IGJ-INSESF-INR-INGINT-INSEPS-2026-0157 Se expide la Norma de control de seguridades en el uso de canales electrónicos',
    'Servicio de Rentas Internas: NAC-DGERCGC26-00000038 Se expiden las normas para el intercambio automático de información de la SCVS y el SRI',
    'Banco Central del Ecuador: BCE-GG-021-2026 Se reforma la Norma para depósitos y retiros de especies monetarias',
  ]);
  assert.equal(rows[0].excerpt, 'Registro Oficial, Quinto Suplemento No. 410.');
  assert.equal(rows[1].excerpt, 'Registro Oficial, Segundo Suplemento No. 395. También: Corporación del Seguro de Depósitos (COSEDE): COSEDE-COSEDE-2026-0068-R Se actualizan los valores de benchmark aplicables al sector financiero privado.');
  const stories = rows.map(row => normalize(row, ro, now));
  assert.deepEqual(stories.map(story => relevant(story, ro)), [true, true, true, false]);
  assert.equal(stories[0].category, 'regulacion');
  assert.equal(stories[0].kind, 'official');
  assert.equal(parseRegistroOficialIndex('<p>MINISTERIO DE SALUD PÚBLICA:<br>MSP-2026-1 Se concede personalidad jurídica</p>')[0].organ, null);
  assert.throws(() => parseRegistroOficial('<html></html>'));
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
  ["la-republica","Banco Popular tuvo una utilidad neta acumulada de $50.000 hasta septiembre",null,false],
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
  ["contxto","FinMaq recibe $6,5 millones de dólares para financiar maquinaria a pequeñas empresas en Colombia",null,true],
  ["contxto","Las fintech se abren paso en Venezuela en medio del proceso de reconstrucción",null,true],
  ["contxto","Clara cierra una ronda Serie C de $65 millones de dólares para expandir su plataforma financiera en Latinoamérica",null,true],
  ["contxto","La edtech hackÜ refuerza su apuesta por el mercado mexicano",null,false],
  ["contxto","Rappi y bebbia se alían en México para llevar la purificación de agua a su plataforma",null,false],
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
  ["endeavor-prensa","Belvo y dLocal se alían en México para llevar la domiciliación bancaria a más empresas",null,true]
];
test('cada filtro deja pasar las muestras pertinentes del informe y descarta su ruido', () => {
  for (const [id, title, url, expected] of SAMPLES) {
    assert.ok(sourceById(id), `fuente desconocida: ${id}`);
    assert.equal(relevant({ title, excerpt: '', url: url || 'https://example.com/nota' }, sourceById(id)), expected, `${id}: ${title}`);
  }
  // Todas las fuentes aceptadas con muestras en el informe tienen casos.
  const covered = new Set(SAMPLES.map(([id]) => id));
  for (const id of ['primicias', 'eluniverso', 'forbes-ec', 'bloomberg-ecuador', 'reguladores-prensa', 'seps', 'superbancos', 'mef', 'supercias', 'iupana', 'el-economista', 'la-republica', 'latamlist', 'bloomberg-negocios', 'expansion-mx', 'diario-financiero', 'contxto', 'paymentsdive', 'expansion-banca', 'ft-banking', 'finextra', 'bankingdive', 'thebanker', 'americanbanker', 'pymnts', 'ecb', 'ft-fintech', 'wsj-markets', 'fsb', 'boe', 'eba', 'ecb-supervision', 'bis-investigacion', 'fintech-business-weekly', 'cinco-dias-cripto', 'reuters-cripto', 'ft-cripto', 'expansion-cripto', 'bloomberg-cripto', 'theblock', 'coindesk', 'criptonoticias', 'chainalysis', 'fed', 'endeavor-ar', 'endeavor-prensa']) assert.ok(covered.has(id), `sin muestras: ${id}`);
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

test('el catálogo de fuentes cumple el contrato y no quedan filtros de fuentes retiradas', () => {
  const ids = new Set();
  for (const item of SOURCES) {
    assert.ok(!ids.has(item.id), `id repetido: ${item.id}`); ids.add(item.id);
    assert.ok(CHANNELS.includes(item.category), `${item.id}: canal`);
    assert.ok(['official', 'news', 'company', 'organization'].includes(item.kind), `${item.id}: tipo`);
    assert.ok([1, 2, 3].includes(item.tier), `${item.id}: nivel`);
    assert.ok(['open', 'paywall', 'mixed'].includes(item.access), `${item.id}: acceso`);
    assert.ok(['es', 'en'].includes(item.language), `${item.id}: idioma`);
    // Las búsquedas por nombres (`search`) no se limitan a un medio: las filtra el cruce con el directorio Endeavor.
    if (item.adapter === 'google' && !item.search) assert.ok(item.allowHosts?.length, `${item.id}: Google News sin allowHosts`);
  }
  for (const id of Object.keys(FILTERS)) assert.ok(ids.has(id), `filtro sin fuente: ${id}`);
  for (const id of ['bce-boletines', 'bce-publicaciones', 'bce-junta-resoluciones', 'bce-resoluciones-admin']) assert.equal(sourceById(id).tier, 1);
  assert.equal(sourceById('bce-publicaciones').limit, 3);
  assert.deepEqual([sourceById('endeavor-ar').kind, sourceById('endeavor-ar').tier, sourceById('endeavor-ar').limit], ['organization', 3, 2]);
  assert.deepEqual([sourceById('fed').kind, sourceById('fed').tier, sourceById('fed').limit], ['official', 1, 2]);
  for (const retired of ['asobanca', 'banecuador', 'cfn', 'uafe', 'ecuador-news', 'regulatory-news', 'latam-fintech-hub', 'latam-bloomberg', 'valora-analitik', 'colombia-fintech', 'lavca', 'felaban', 'digitaltransactions', 'epi', 'pcm', 'finextra-payments', 'finextra-crypto', 'trmlabs', 'coincenter']) assert.equal(sourceById(retired), undefined, retired);
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
  const old = { ...make('bce-boletines', 5), title: 'Resolución de la Junta de Política y Regulación', category: 'ecuador' };
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
  assert.ok(companies.length >= 100 && companies.length <= 120, String(companies.length));
  assert.ok(companies.every(item => item.vertical === 'fintech' || item.offices.includes('ecuador')));
  assert.ok(companies.some(item => item.name === 'Tipti') && !companies.some(item => item.name === 'Globant'));
  assert.ok(!companies.some(item => item.name === 'Infocorp'), 'las excluidas no se buscan');
  assert.equal(searchTerm(byName('Kueski')), '"Kueski"');
  assert.equal(searchQualifier(byName('Kueski')), '');
  assert.equal(searchQualifier(byName('Clara')), 'fintech');
  assert.equal(searchQualifier(byName('R2')), 'fintech');
  const batches = searchBatches(companies);
  assert.equal(batches.flatMap(batch => batch.terms).length, companies.length);
  for (const batch of batches) {
    const query = searchQuery(batch);
    const words = query.replace(/[()"]/g, ' ').split(/\s+/).filter(Boolean).filter(word => word !== 'OR').length + batch.terms.length - 1;
    assert.ok(words <= ENDEAVOR_SEARCH.maxWords, `lote de ${words} palabras`);
    // Nunca hay grupos anidados: Google los interpreta mal dentro de un OR.
    assert.equal((query.match(/\(/g) || []).length, 1, query);
    assert.equal(batch.terms.some(term => ['"Clara"', '"Klar"', '"Swap"'].includes(term)), batch.qualifier === 'fintech' && batch.terms.some(term => ['"Clara"', '"Klar"', '"Swap"'].includes(term)));
  }
  assert.deepEqual(searchBatches([company('Aaa1'), company('Bbb2'), company('Ccc3')], 5), [{ terms: ['"Aaa1"', '"Bbb2"'], qualifier: '' }, { terms: ['"Ccc3"'], qualifier: '' }]);
  assert.deepEqual(searchBatches([company('Aaa1'), company('Clara'), company('Bbb2')]), [{ terms: ['"Aaa1"', '"Bbb2"'], qualifier: '' }, { terms: ['"Clara"'], qualifier: 'fintech' }]);
  assert.equal(searchQuery({ terms: ['"Clara"', '"Klar"'], qualifier: 'fintech' }), '("Clara" OR "Klar") fintech when:30d');
  const lots = searchLots([{ terms: ['"Aaa1"', '"Bbb2"'], qualifier: '' }, { terms: ['"Ccc3"'], qualifier: '' }]);
  assert.deepEqual(lots.map(lot => [lot.index, lot.language]), [[0, 'es'], [1, 'en'], [2, 'es'], [3, 'en']]);
  assert.equal(new URL(lots[0].url).searchParams.get('q'), '("Aaa1" OR "Bbb2") when:30d');
  assert.equal(new URL(lots[3].url).searchParams.get('hl'), 'en-US');
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
