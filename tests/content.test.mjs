import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parseBce, parseBcePublications, parseBceResolutions, parseSupercias, resolutionYear, coverageSignature, parseFeed, parseDate, deduplicate, safeUrl, recent, relevant } from '../scripts/content.mjs';

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

test('Endeavor Argentina omite notas institucionales y los extractos pierden la coletilla del feed', () => {
  assert.equal(relevant({ title: 'Giraffe Bio levanta USD 6,4 millones', excerpt: '' }, { id: 'endeavor-ar' }), true);
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
  const spanish = story('Fintech argentina Cocos levantó US$34M para escalar su banco digital', 'Latam Fintech Hub', '2026-09-28T10:00:00Z', { via: 'Vía Google News' });
  const partners = story('Paytech Akua recibe inversión de Itaú Ventures', 'Latam Fintech Hub', '2026-09-28T09:00:00Z', { via: 'Vía Google News' });
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

test('las fuentes directas de Ecuador, la región, pagos y cripto aplican su propio filtro', () => {
  const ok = (id, title, url, excerpt = '') => relevant({ title, excerpt, url }, { id });
  assert.equal(ok('primicias', 'Superintendencia autoriza a GIA Holding la compra de acciones de AIG Metropolitana'), true);
  assert.equal(ok('primicias', 'Mujeres empresarias en Ecuador podrán acceder a créditos de hasta USD 1,5 millones'), true);
  assert.equal(ok('primicias', 'CyberDay Ecuador 2026 empezó: descuentos con tarjetas de crédito'), false);
  assert.equal(ok('primicias', 'Oro y cobre impulsan las exportaciones mineras'), false);
  assert.equal(ok('banecuador', 'BanEcuador entrega USD 124,5 millones en créditos para las pequeñas empresas'), true);
  assert.equal(ok('banecuador', 'CONVOCATORIA PARA EL PROCESO DE SELECCIÓN DE CONTRATOS DE CRÉDITO'), false);
  assert.equal(ok('cfn', 'GRANDES OPCIONES DE INVERSIÓN Y CRECIMIENTO EN LA SUBASTA DE BIENES 2026'), false);
  assert.equal(ok('mef', 'El Gobierno alcanza acuerdo técnico con el FMI previo a la sexta revisión'), true);
  assert.equal(ok('mef', 'EN EL GOBIERNO AUMENTA EL CONSUMO DE LAS FAMILIAS ECUATORIANAS'), false);
  assert.equal(ok('uafe', 'Ecuador y Estados Unidos fortalecen la lucha contra el lavado de activos'), true);
  assert.equal(ok('uafe', 'Registro del Manual de Prevención'), false);
  assert.equal(ok('valora-analitik', 'Addi invertirá US$2.000 millones en Colombia para ampliar el crédito'), true);
  assert.equal(ok('valora-analitik', 'Antioquia Gold invierte más de US$6 millones para modernizar su operación minera'), false);
  assert.equal(ok('contxto', 'Clara cierra una ronda Serie C para expandir su plataforma financiera'), true);
  assert.equal(ok('contxto', 'La edtech hackÜ refuerza su apuesta por el mercado mexicano'), false);
  assert.equal(ok('lavca', 'Clip Acquires Pulpos', undefined, 'Mexican payments company Clip acquired Pulpos.'), true);
  assert.equal(ok('lavca', 'LAVCA Women Submissions Open; Clara Secures USD105m', undefined, 'Fintech news.'), false);
  assert.equal(ok('felaban', 'Informe Económico Bancario Trimestral No. 39'), true);
  assert.equal(ok('felaban', 'Palabras de apertura del Presidente de FELABAN en la 60ª Asamblea Anual'), false);
  assert.equal(ok('epi', 'Mastercard enables smartphone payment acceptance', 'https://www.electronicpaymentsinternational.com/news/mastercard-accept/'), true);
  assert.equal(ok('epi', 'Huawei Cloud sets out AI roadmap', 'https://www.electronicpaymentsinternational.com/sponsored/huawei-cloud/'), false);
  assert.equal(ok('fed', 'Federal Reserve Board announces pricing for payment services'), true);
  assert.equal(ok('fed', 'Federal Reserve announces revised tentative schedule of Federal Open Market Committee meetings'), false);
  assert.equal(ok('ecb', 'Piero Cipollone: Cash and the digital euro: two sides of the same coin'), true);
  assert.equal(ok('ecb', 'Christine Lagarde: Interview with Yomiuri Shimbun'), false);
  assert.equal(ok('theblock', 'World Bank Group taps Circle and Citi to test stablecoin-based fund disbursements', 'https://www.theblock.co/news/business/2026-11-17-world-bank'), true);
  assert.equal(ok('theblock', 'Bitcoin slips as banks sell', 'https://www.theblock.co/news/markets/2026-11-17-bitcoin'), false);
  assert.equal(ok('theblock', 'Fomo pays creators $30 million', 'https://www.theblock.co/news/business/2026-11-17-fomo'), false);
  assert.equal(ok('digitaltransactions', 'PaysafeGo Debuts and other Digital Transactions News briefs from 11/17/26'), false);
  assert.equal(ok('colombia-fintech', 'Bancaplus se une a Colombia Fintech para impulsar la liquidez'), false);
  assert.equal(ok('banecuador', 'El Gobierno impulsa el desarrollo de 83.730 mujeres con créditos'), false);
  assert.equal(ok('criptonoticias', 'Alemania incautará criptomonedas sin necesidad de un proceso penal', 'https://www.criptonoticias.com/regulacion/alemania-incautara/'), true);
  assert.equal(ok('criptonoticias', 'Bitcoin reacciona al alza', 'https://www.criptonoticias.com/mercados/bitcoin-reacciona/'), false);
  assert.equal(ok('trmlabs', 'TRM Labs Launches Beacon Concierge to Help Law Enforcement'), false);
  const trm = normalize({ title: 'OFAC Designates Eight Canadian Money Services Businesses | TRM Labs', url: 'https://www.trmlabs.com/resources/blog/ofac', publishedAt: '2026-09-29T10:00:00Z' }, { ...source, id: 'trmlabs', name: 'TRM Labs' }, now);
  assert.equal(trm.title, 'OFAC Designates Eight Canadian Money Services Businesses');
  assert.equal(relevant(trm, { id: 'trmlabs' }), true);
});

test('las categorías temáticas filtran artículos ajenos al sector', () => {
  assert.equal(relevant({ title: 'ChatGPT podrá comprar por usted usando su tarjeta: así funciona la nueva billetera de OpenAI', excerpt: '' }, { id: 'latam-bloomberg' }), false);
  assert.equal(relevant({ title: 'Calificación de Riesgo Instituciones Financieras 2026', excerpt: '' }, { id: 'superbancos' }), true);
  assert.equal(relevant({ title: 'Superintendencia de Bancos realizó su tercer Media Day', excerpt: 'Supervisión y control del sector financiero.' }, { id: 'superbancos' }), false);
  assert.equal(relevant({ title: 'La SEPS alerta sobre 134 entidades no autorizadas', excerpt: '' }, { id: 'seps' }), true);
  assert.equal(relevant({ title: 'Más de 700 funcionarios de cooperativas fortalecieron sus capacidades', excerpt: 'Control y supervisión.' }, { id: 'seps' }), false);
  assert.equal(relevant({ title: 'Fed to boost payment service fees', excerpt: '', url: 'https://www.paymentsdive.com/news/fed-fees/874911/' }, { id: 'paymentsdive' }), true);
  assert.equal(relevant({ title: 'Why faster cash flow sells embedded payments', excerpt: '', url: 'https://www.paymentsdive.com/spons/why-faster/874000/' }, { id: 'paymentsdive' }), false);
  assert.equal(relevant({ title: 'Hong Kong, Swift test tokenized deposits', excerpt: '', url: 'https://www.coindesk.com/business/2026/11/17/hong-kong' }, { id: 'coindesk' }), true);
  assert.equal(relevant({ title: 'Bitcoin remains penned in near $64,000 as stablecoin supply grows', excerpt: '', url: 'https://www.coindesk.com/markets/2026/11/17/bitcoin' }, { id: 'coindesk' }), false);
  assert.equal(relevant({ title: 'Sanctioned Canadian Crypto OTCs Served Iran and Drug Cartels', excerpt: '' }, { id: 'chainalysis' }), true);
  assert.equal(relevant({ title: 'Chainalysis Supports HyperEVM with Automatic Token Support', excerpt: 'Crypto compliance.' }, { id: 'chainalysis' }), false);
  assert.equal(relevant({ title: 'The Shadow Market Behind China’s AI Model Distillation Boom', excerpt: '' }, { id: 'chainalysis' }), false);
  assert.equal(relevant({ title: 'Outages at Microsoft Show the Real Cost of Downtime', excerpt: 'Payments were delayed.' }, { id: 'pymnts' }), false);
  assert.equal(relevant({ title: 'Tarjetas de crédito en Ecuador: advierten sobre el riesgo de aumentar su uso', excerpt: '' }, { id: 'ecuador-news' }), true);
  assert.equal(relevant({ title: 'Pacientes renales en Ecuador: dializadora exige un acuerdo de pagos', excerpt: '' }, { id: 'ecuador-news' }), false);
  assert.equal(relevant({ title: 'Análisis de la banca digital', excerpt: '' }, { id: 'latamlist' }), true);
  assert.equal(relevant({ title: 'Software de restaurantes', excerpt: '' }, { id: 'latamlist' }), false);
  assert.equal(relevant({ title: 'Seguridad en cajeros', excerpt: '', url: 'https://www.finextra.com/blogposting/100' }, { id: 'finextra-crypto' }), false);
  assert.equal(relevant({ title: 'Growth en Fintech: webinar', excerpt: '' }, { id: 'latam-fintech-hub' }), false);
  assert.equal(relevant({ title: 'Fintechs en Perú piden un ecosistema financiero abierto', excerpt: '' }, { id: 'iupana' }), true);
  assert.equal(relevant({ title: 'Fintech Forum 2026 revela su agenda', excerpt: '' }, { id: 'iupana' }), false);
  assert.equal(relevant({ title: 'Mercado Pago y Revolut obtendrán licencia bancaria en Argentina', excerpt: '' }, { id: 'latam-bloomberg' }), true);
  assert.equal(relevant({ title: 'Cotización Banco Macro SA', excerpt: '' }, { id: 'latam-bloomberg' }), false);
  assert.equal(relevant({ title: 'Superintendencia de Bancos advierte sobre entidades no autorizadas', excerpt: '' }, { id: 'regulatory-news' }), true);
});
