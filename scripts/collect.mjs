import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed, parseDate, parseBce, parseBcePublications, parseBceResolutions, parseRegistroOficial, parseSupercias, resolutionYear, deduplicate, relevant, linkAllowed, passes, screen, discardLog, carryable, editionShape, accumulate, composeEdition, limitFor, periodIndex, tagEndeavor, searchCompanies, searchBatches, searchLots, rotation, CHANNELS, PERIOD_DAYS, ENDEAVOR_PRESS_HOSTS } from './content.mjs';
import { EDITORIAL, applyEditorial, cleanStory, editorialClient, groupClusters, readMemo, writeMemo } from './editorial.mjs';

// Cada fuente: `category` (canal), `kind` (official | news | company | organization), `tier` (1 referencia,
// 2 especializada, 3 interesada o de análisis), `access` (open | paywall | mixed), `language` y `adapter`.
// `limit` es el tope de notas de la fuente en cada período del sitio (24 h, 7, 15 y 30 días); `limits` lo cambia por canal.
// Los filtros por tema están en FILTERS (content.mjs), con la misma clave `id`.
// `linkHosts` (fuentes oficiales con página o feed propio): dominios aceptados para el enlace de cada nota, con sus subdominios.
// Las notas con enlace fuera de la lista se descartan antes de cualquier petición (ver linkAllowed en content.mjs). Las listas
// salen de los enlaces reales de cada fuente; el feed del Ministerio de Economía redirige a economicoproductivo.gob.ec.
// Capa editorial (scripts/editorial.mjs): `primary` marca los documentos oficiales primarios (resoluciones del BCE, Registro
// Oficial), que se puntúan pero no caen por el umbral y ganan al agrupar; `perEdition` limita las notas de la fuente en toda
// la edición (los boletines y reportes periódicos de datos del BCE: una).
export const SOURCES = [
  // Ecuador financiero.
  { id: 'bce-boletines', name: 'Banco Central del Ecuador', category: 'ecuador', kind: 'official', tier: 1, access: 'open', language: 'es', adapter: 'bce', url: 'https://www.bce.fin.ec/banco-central-del-ecuador/boletines-de-prensa/', site: 'https://www.bce.fin.ec/', linkHosts: ['bce.fin.ec'] },
  { id: 'primicias', name: 'Primicias', category: 'ecuador', kind: 'news', tier: 1, access: 'open', language: 'es', adapter: 'rss', url: 'https://www.primicias.ec/rss/economia.xml', extraUrls: ['https://www.primicias.ec/rss/economia/empresas.xml'], site: 'https://www.primicias.ec/economia/', limit: 8 },
  { id: 'eluniverso', name: 'El Universo', category: 'ecuador', kind: 'news', tier: 1, access: 'mixed', language: 'es', adapter: 'rss', url: 'https://www.eluniverso.com/arc/outboundfeeds/rss/category/economia/?outputType=xml', site: 'https://www.eluniverso.com/economia/', limit: 8 },
  { id: 'forbes-ec', name: 'Forbes Ecuador', category: 'ecuador', kind: 'news', tier: 2, access: 'open', language: 'es', adapter: 'google', url: 'https://news.google.com/rss/search?q=site%3Aforbes.com.ec%20(banco%20OR%20bancos%20OR%20banca%20OR%20cr%C3%A9dito%20OR%20cooperativas%20OR%20seguros%20OR%20aseguradora%20OR%20deuda%20OR%20FMI%20OR%20%22riesgo%20pa%C3%ADs%22%20OR%20fintech%20OR%20tarjetas)%20when%3A30d&hl=es-419&gl=EC&ceid=EC%3Aes-419', site: 'https://www.forbes.com.ec/', allowHosts: ['forbes.com.ec'], limit: 4 },
  { id: 'bloomberg-ecuador', name: 'Bloomberg Línea · Ecuador', category: 'ecuador', kind: 'news', tier: 1, access: 'open', language: 'es', adapter: 'google', url: 'https://news.google.com/rss/search?q=(site%3Aexpreso.ec%20OR%20site%3Abloomberglinea.com)%20Ecuador%20(banco%20OR%20bancos%20OR%20banca%20OR%20cr%C3%A9dito%20OR%20cooperativas%20OR%20seguros%20OR%20aseguradora%20OR%20deuda%20OR%20FMI%20OR%20%22riesgo%20pa%C3%ADs%22%20OR%20fintech%20OR%20tarjetas)%20when%3A30d&hl=es-419&gl=EC&ceid=EC%3Aes-419', site: 'https://www.bloomberglinea.com/', allowHosts: ['bloomberglinea.com'], limit: 3 },

  // Autoridades EC.
  { id: 'bce-publicaciones', name: 'BCE · Datos financieros', category: 'regulacion', kind: 'official', tier: 1, access: 'open', language: 'es', adapter: 'bce-publications', url: 'https://contenido.bce.fin.ec/ultimas-publicaciones/', site: 'https://contenido.bce.fin.ec/ultimas-publicaciones/', linkHosts: ['bce.fin.ec'], limit: 3, perEdition: 1 },
  { id: 'bce-junta-resoluciones', name: 'BCE · Resoluciones de la Junta', category: 'regulacion', kind: 'official', tier: 1, access: 'open', language: 'es', adapter: 'bce-resolutions', url: 'https://www.bce.fin.ec/junta-de-politica-y-regulacion-financiera-y-monetaria/resoluciones/resoluciones-emitidas/', site: 'https://www.bce.fin.ec/junta-de-politica-y-regulacion-financiera-y-monetaria/resoluciones/resoluciones-emitidas/', linkHosts: ['bce.fin.ec'], primary: true },
  { id: 'bce-resoluciones-admin', name: 'BCE · Resoluciones administrativas', category: 'regulacion', kind: 'official', tier: 1, access: 'open', language: 'es', adapter: 'bce-resolutions', url: 'https://www.bce.fin.ec/banco-central-del-ecuador/resoluciones-administrativas/', site: 'https://www.bce.fin.ec/banco-central-del-ecuador/resoluciones-administrativas/', linkHosts: ['bce.fin.ec'], primary: true },
  { id: 'reguladores-prensa', name: 'Prensa sobre reguladores (El Universo y Primicias)', category: 'regulacion', kind: 'news', tier: 1, access: 'mixed', language: 'es', adapter: 'google', url: 'https://news.google.com/rss/search?q=(site%3Aprimicias.ec%20OR%20site%3Aeluniverso.com)%20(superintendencia%20OR%20%22Junta%20de%20Pol%C3%ADtica%22%20OR%20SEPS%20OR%20UAFE%20OR%20SRI%20OR%20%22Banco%20Central%22%20OR%20Cosede)%20when%3A30d&hl=es-419&gl=EC&ceid=EC%3Aes-419', site: 'https://news.google.com/', allowHosts: ['eluniverso.com', 'primicias.ec'], limit: 8 },
  // Registro Oficial: feed de ediciones; `pages` se leen en cada ejecución y `backfillPages` cuando no hay historial.
  { id: 'registro-oficial', name: 'Registro Oficial', category: 'regulacion', kind: 'official', tier: 1, access: 'open', language: 'es', adapter: 'registro-oficial', url: 'https://www.registroficial.gob.ec/feed/', site: 'https://www.registroficial.gob.ec/', linkHosts: ['registroficial.gob.ec'], limit: 5, pages: 3, backfillPages: 16, primary: true },
  { id: 'seps', name: 'SEPS', category: 'regulacion', kind: 'official', tier: 1, access: 'open', language: 'es', adapter: 'rss', url: 'https://www.seps.gob.ec/feed/', site: 'https://www.seps.gob.ec/', linkHosts: ['seps.gob.ec'], limit: 2 },
  { id: 'superbancos', name: 'Superintendencia de Bancos', category: 'regulacion', kind: 'official', tier: 1, access: 'open', language: 'es', adapter: 'rss', url: 'https://www.superbancos.gob.ec/bancos/feed/', site: 'https://www.superbancos.gob.ec/', linkHosts: ['superbancos.gob.ec'], limit: 2 },
  { id: 'supercias', name: 'Supercias', category: 'regulacion', kind: 'official', tier: 1, access: 'open', language: 'es', adapter: 'supercias', url: 'https://www.supercias.gob.ec/portalscvs/', site: 'https://www.supercias.gob.ec/portalscvs/Noticias/Noticias.php', linkHosts: ['supercias.gob.ec'], limit: 2 },
  { id: 'mef', name: 'Ministerio de Economía y Finanzas', category: 'regulacion', kind: 'official', tier: 1, access: 'open', language: 'es', adapter: 'rss', url: 'https://www.finanzas.gob.ec/feed/', site: 'https://www.finanzas.gob.ec/', linkHosts: ['finanzas.gob.ec', 'economicoproductivo.gob.ec'], limit: 2 },

  // Fintech LATAM.
  { id: 'iupana', name: 'iupana', category: 'latam', kind: 'news', tier: 2, access: 'mixed', language: 'es', adapter: 'rss', url: 'https://iupana.com/feed/', site: 'https://iupana.com/', limit: 6 },
  { id: 'el-economista', name: 'El Economista (México)', category: 'latam', kind: 'news', tier: 1, access: 'open', language: 'es', adapter: 'google', url: 'https://news.google.com/rss/search?q=site%3Aeleconomista.com.mx%20(fintech%20OR%20neobanco%20OR%20sofipo%20OR%20%22banca%20digital%22%20OR%20CNBV%20OR%20Nu%20OR%20%22Mercado%20Pago%22%20OR%20CoDi)%20when%3A30d&hl=es-419&gl=EC&ceid=EC%3Aes-419', site: 'https://www.eleconomista.com.mx/', allowHosts: ['eleconomista.com.mx'], limit: 6 },
  { id: 'la-republica', name: 'La República (Colombia)', category: 'latam', kind: 'news', tier: 1, access: 'mixed', language: 'es', adapter: 'rss', url: 'https://www.larepublica.co/rss/finanzas', site: 'https://www.larepublica.co/finanzas', limit: 5 },
  { id: 'latamlist', name: 'LatamList', category: 'latam', kind: 'news', tier: 2, access: 'open', language: 'en', adapter: 'rss', url: 'https://latamlist.com/feed/', site: 'https://latamlist.com/', limit: 5 },
  { id: 'bloomberg-negocios', name: 'Bloomberg Línea', category: 'latam', kind: 'news', tier: 1, access: 'open', language: 'es', adapter: 'rss', url: 'https://www.bloomberglinea.com/arc/outboundfeeds/rss/category/negocios/?outputType=xml', site: 'https://www.bloomberglinea.com/negocios/', limit: 4 },
  { id: 'expansion-mx', name: 'Expansión (México)', category: 'latam', kind: 'news', tier: 1, access: 'open', language: 'es', adapter: 'rss', url: 'https://expansion.mx/rss/economia', site: 'https://expansion.mx/economia', limit: 4 },
  { id: 'diario-financiero', name: 'Diario Financiero (Chile)', category: 'latam', kind: 'news', tier: 1, access: 'paywall', language: 'es', adapter: 'google', url: 'https://news.google.com/rss/search?q=site%3Adf.cl%20(fintech%20OR%20neobanco%20OR%20%22banco%20digital%22%20OR%20billetera)%20when%3A30d&hl=es-419&gl=EC&ceid=EC%3Aes-419', site: 'https://www.df.cl/', allowHosts: ['df.cl'], limit: 4 },
  { id: 'contxto', name: 'Contxto', category: 'latam', kind: 'news', tier: 2, access: 'open', language: 'es', adapter: 'rss', url: 'https://contxto.com/es/feed/', site: 'https://contxto.com/es/', limit: 3 },

  // Endeavor LATAM: prensa sobre empresas de la red Endeavor (lista en scripts/data/endeavor-latam.json, ver scripts/endeavor.mjs).
  // `search`: la fuente no tiene una URL fija; consulta en cada ejecución unos lotes de la búsqueda por nombres (ENDEAVOR_SEARCH)
  // y solo deja las notas cuyo titular nombra a una empresa del directorio (FILTERS). Cada nota conserva su medio real, que debe
  // estar en la lista de medios aceptados ENDEAVOR_PRESS_HOSTS (content.mjs). `denyHosts` queda como salvaguarda.
  { id: 'endeavor-prensa', name: 'Prensa sobre empresas Endeavor', category: 'endeavor', kind: 'news', tier: 2, access: 'mixed', language: 'es', adapter: 'google', search: 'endeavor', url: 'https://news.google.com/rss/search', site: 'https://endeavor.org/entrepreneur-companies/', allowHosts: ENDEAVOR_PRESS_HOSTS, denyHosts: ['endeavor.org', 'endeavor.org.ar', 'endeavor.org.br', 'endeavor.org.mx', 'endeavor.cl', 'endeavor.org.co', 'endeavor.org.uy', 'endeavor.org.pe', 'endeavor.ec'], limit: 20 },
  // El blog de Endeavor Argentina sí es contenido de la organización: conserva ese rótulo y el nivel 3.
  { id: 'endeavor-ar', name: 'Endeavor Argentina', category: 'endeavor', kind: 'organization', tier: 3, access: 'open', language: 'es', adapter: 'rss', url: 'https://www.endeavor.org.ar/feed/', site: 'https://www.endeavor.org.ar/', limit: 2 },

  // Pagos globales.
  { id: 'paymentsdive', name: 'Payments Dive', category: 'pagos', kind: 'news', tier: 2, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.paymentsdive.com/feeds/news/', site: 'https://www.paymentsdive.com/', limit: 6 },
  { id: 'expansion-banca', name: 'Expansión · Banca', category: 'pagos', kind: 'news', tier: 1, access: 'mixed', language: 'es', adapter: 'rss', url: 'https://e00-expansion.uecdn.es/rss/empresas/banca.xml', site: 'https://www.expansion.com/empresas/banca.html', limit: 6 },
  { id: 'ft-banking', name: 'Financial Times · Banking', category: 'pagos', kind: 'news', tier: 1, access: 'paywall', language: 'en', adapter: 'rss', url: 'https://www.ft.com/banking?format=rss', site: 'https://www.ft.com/banking', limit: 5 },
  { id: 'finextra', name: 'Finextra', category: 'pagos', kind: 'news', tier: 2, access: 'open', language: 'en', adapter: 'google', url: 'https://news.google.com/rss/search?q=site%3Afinextra.com%20payments%20when%3A30d&hl=en-US&gl=US&ceid=US%3Aen', site: 'https://www.finextra.com/', allowHosts: ['finextra.com'], limit: 5 },
  { id: 'bankingdive', name: 'Banking Dive', category: 'pagos', kind: 'news', tier: 2, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.bankingdive.com/feeds/news/', site: 'https://www.bankingdive.com/', limit: 4 },
  { id: 'thebanker', name: 'The Banker', category: 'pagos', kind: 'news', tier: 2, access: 'paywall', language: 'en', adapter: 'google', url: 'https://news.google.com/rss/search?q=site%3Athebanker.com%20banks%20OR%20payments%20when%3A30d&hl=en-US&gl=US&ceid=US%3Aen', site: 'https://www.thebanker.com/', allowHosts: ['thebanker.com'], limit: 4 },
  { id: 'americanbanker', name: 'American Banker', category: 'pagos', kind: 'news', tier: 2, access: 'paywall', language: 'en', adapter: 'rss', url: 'https://www.americanbanker.com/feed?rss=true', site: 'https://www.americanbanker.com/', limit: 3 },
  { id: 'pymnts', name: 'PYMNTS', category: 'pagos', kind: 'news', tier: 2, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.pymnts.com/feed/', site: 'https://www.pymnts.com/', limit: 3 },
  { id: 'ecb', name: 'Banco Central Europeo', category: 'pagos', kind: 'official', tier: 1, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.ecb.europa.eu/rss/press.html', site: 'https://www.ecb.europa.eu/press/html/index.en.html', linkHosts: ['ecb.europa.eu'], limit: 3 },
  // Un solo feed para dos canales: cada discurso se lee una vez y va a cripto o a pagos según su tema (ROUTES).
  { id: 'bis-discursos', name: 'BIS · Discursos de banqueros centrales', category: 'pagos', kind: 'official', tier: 1, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.bis.org/doclist/cbspeeches.rss', site: 'https://www.bis.org/cbspeeches/', linkHosts: ['bis.org'], limit: 3, limits: { cripto: 2 }, byline: true },
  { id: 'ft-fintech', name: 'Financial Times · Fintech', category: 'pagos', kind: 'news', tier: 1, access: 'paywall', language: 'en', adapter: 'rss', url: 'https://www.ft.com/fintech?format=rss', site: 'https://www.ft.com/fintech', limit: 2 },
  { id: 'wsj-markets', name: 'The Wall Street Journal · Markets', category: 'pagos', kind: 'news', tier: 1, access: 'paywall', language: 'en', adapter: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain', site: 'https://www.wsj.com/finance', limit: 2 },
  { id: 'fsb', name: 'Financial Stability Board', category: 'pagos', kind: 'official', tier: 1, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.fsb.org/feed/', site: 'https://www.fsb.org/', linkHosts: ['fsb.org'], limit: 2 },
  { id: 'boe', name: 'Banco de Inglaterra', category: 'pagos', kind: 'official', tier: 1, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.bankofengland.co.uk/rss/news', site: 'https://www.bankofengland.co.uk/news', linkHosts: ['bankofengland.co.uk'], limit: 2 },
  { id: 'eba', name: 'Autoridad Bancaria Europea', category: 'pagos', kind: 'official', tier: 1, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.eba.europa.eu/news-press/news/rss.xml', site: 'https://www.eba.europa.eu/', linkHosts: ['eba.europa.eu'], limit: 2 },
  { id: 'ecb-supervision', name: 'BCE · Supervisión bancaria', category: 'pagos', kind: 'official', tier: 1, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.bankingsupervision.europa.eu/rss/press.html', site: 'https://www.bankingsupervision.europa.eu/', linkHosts: ['bankingsupervision.europa.eu'], limit: 2 },
  { id: 'bis-investigacion', name: 'BIS · Investigación', category: 'pagos', kind: 'official', tier: 1, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.bis.org/doclist/bis_fsi_publs.rss', site: 'https://www.bis.org/', linkHosts: ['bis.org'], limit: 2 },
  { id: 'fintech-business-weekly', name: 'Fintech Business Weekly', category: 'pagos', kind: 'organization', tier: 3, access: 'mixed', language: 'en', adapter: 'rss', url: 'https://fintechbusinessweekly.substack.com/feed', site: 'https://fintechbusinessweekly.substack.com/', limit: 2 },
  { id: 'fed', name: 'Reserva Federal de EE. UU.', category: 'pagos', kind: 'official', tier: 1, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.federalreserve.gov/feeds/press_all.xml', site: 'https://www.federalreserve.gov/newsevents/pressreleases.htm', linkHosts: ['federalreserve.gov'], limit: 2 },

  // Cripto.
  { id: 'cinco-dias-cripto', name: 'Cinco Días · Criptoactivos', category: 'cripto', kind: 'news', tier: 1, access: 'mixed', language: 'es', adapter: 'rss', url: 'https://feeds.elpais.com/mrss-s/list/ep/site/cincodias.elpais.com/section/criptoactivos', site: 'https://cincodias.elpais.com/criptoactivos/', limit: 6 },
  { id: 'reuters-cripto', name: 'Reuters · Cripto', category: 'cripto', kind: 'news', tier: 1, access: 'mixed', language: 'en', adapter: 'google', url: 'https://news.google.com/rss/search?q=site%3Areuters.com%20(crypto%20OR%20stablecoin%20OR%20tokenization%20OR%20%22digital%20assets%22)%20when%3A30d&hl=en-US&gl=US&ceid=US%3Aen', site: 'https://www.reuters.com/', allowHosts: ['reuters.com'], limit: 6 },
  { id: 'ft-cripto', name: 'Financial Times · Cryptofinance', category: 'cripto', kind: 'news', tier: 1, access: 'paywall', language: 'en', adapter: 'rss', url: 'https://www.ft.com/cryptofinance?format=rss', site: 'https://www.ft.com/cryptofinance', limit: 5 },
  { id: 'expansion-cripto', name: 'Expansión · Criptomonedas', category: 'cripto', kind: 'news', tier: 1, access: 'mixed', language: 'es', adapter: 'rss', url: 'https://e00-expansion.uecdn.es/rss/mercados/criptomonedas.xml', site: 'https://www.expansion.com/mercados/criptomonedas.html', limit: 5 },
  { id: 'bloomberg-cripto', name: 'Bloomberg Línea · Cripto', category: 'cripto', kind: 'news', tier: 1, access: 'open', language: 'es', adapter: 'google', url: 'https://news.google.com/rss/search?q=site%3Abloomberglinea.com%20(cripto%20OR%20criptomonedas%20OR%20stablecoin%20OR%20stablecoins%20OR%20tokenizaci%C3%B3n%20OR%20bitcoin)%20when%3A30d&hl=es-419&gl=EC&ceid=EC%3Aes-419', site: 'https://www.bloomberglinea.com/', allowHosts: ['bloomberglinea.com'], limit: 4 },
  { id: 'theblock', name: 'The Block', category: 'cripto', kind: 'news', tier: 2, access: 'mixed', language: 'en', adapter: 'rss', url: 'https://www.theblock.co/rss.xml', site: 'https://www.theblock.co/', limit: 4 },
  { id: 'coindesk', name: 'CoinDesk', category: 'cripto', kind: 'news', tier: 2, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', site: 'https://www.coindesk.com/', limit: 4 },
  { id: 'criptonoticias', name: 'CriptoNoticias', category: 'cripto', kind: 'news', tier: 2, access: 'open', language: 'es', adapter: 'rss', url: 'https://www.criptonoticias.com/feed/', site: 'https://www.criptonoticias.com/', limit: 3 },
  { id: 'chainalysis', name: 'Chainalysis', category: 'cripto', kind: 'company', tier: 3, access: 'open', language: 'en', adapter: 'rss', url: 'https://www.chainalysis.com/blog/feed/', site: 'https://www.chainalysis.com/blog/', limit: 3 },
];
const SOURCE_BY_ID = new Map(SOURCES.map(source => [source.id, source]));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputArg = process.argv.indexOf('--output');
const output = outputArg === -1 ? resolve(root, 'site/data/news.json') : resolve(process.argv[outputArg + 1]);
// Registro de descartes de cada ejecución: junto a la edición, en el mismo directorio (ver discardLog en content.mjs).
export const DISCARDS_FILE = 'descartes.json';
export const discardsPath = edition => resolve(dirname(edition), DISCARDS_FILE);

// Escritura atómica: se escribe en `.tmp` y se renombra, así un lector nunca ve un archivo a medias.
export async function writeJson(file, payload) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(payload, null, 2) + '\n', 'utf8'); await rename(temp, file);
}

const USER_AGENT = 'NEWS-TV/1.0 (+https://github.com/andrescge/news-tv)';
const MAX_DATE_LOOKUPS = 200;
// Tope por canal. Con la acumulación cada canal reúne hasta 30 días; composeEdition reparte este tope entre períodos.
const MAX_PER_CHANNEL = 80;
// Google News responde 429 a ráfagas: sus fuentes se piden de una en una, con pausa y un reintento.
const GOOGLE_PAUSE_MS = 2500;
const GOOGLE_RETRY_MS = 10000;
// Google News devuelve como mucho 100 resultados por consulta: llegar ahí marca la fuente como saturada en su embudo.
const GOOGLE_MAX_RESULTS = 100;
const sleep = ms => new Promise(done => setTimeout(done, ms));

async function fetchText(url, adapter) {
  const accept = /^(bce|supercias)/.test(adapter) ? 'text/html' : 'application/rss+xml, application/xml, text/xml';
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(14000) });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.retryAfter = Number(response.headers.get('retry-after')) || 0;
    throw error;
  }
  return readBody(response);
}

// Cuerpo de la respuesta con tope de tamaño aplicado mientras se lee: se rechaza de entrada si Content-Length lo supera y,
// si no viene (o miente, o el cuerpo llega comprimido), se lee por partes y se aborta al pasar el tope.
const MAX_BODY_BYTES = 3_000_000;
export async function readBody(response, max = MAX_BODY_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) { await response.body?.cancel().catch(() => {}); throw new Error('Respuesta demasiado grande'); }
  if (!response.body) return '';
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > max) throw new Error('Respuesta demasiado grande'); // Salir del bucle cancela la lectura del resto.
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Fecha de carga de cada PDF de resolución. Se consulta una sola vez por documento y se guarda
// en `tracked` dentro de news.json, de modo que las ejecuciones siguientes solo consultan los nuevos.
export async function dateResolutions(entries, source, known, now = new Date()) {
  const minYear = now.getUTCFullYear() - (now.getUTCMonth() === 0 ? 1 : 0);
  // Solo se consultan documentos de los dominios de la fuente (fetchSource ya los filtró; se comprueba otra vez aquí).
  const candidates = entries.filter(entry => linkAllowed(entry, source) && (resolutionYear(entry) ?? minYear) >= minYear && relevant(entry, source));
  const tracked = {};
  const cache = known && typeof known === 'object' ? known : {};
  for (const entry of candidates) if (typeof cache[entry.url] === 'string' && parseDate(cache[entry.url])) tracked[entry.url] = cache[entry.url];
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

function parse(body, source, url) {
  switch (source.adapter) {
    case 'bce': return parseBce(body);
    case 'bce-publications': return parseBcePublications(body);
    case 'bce-resolutions': return parseBceResolutions(body, url);
    case 'supercias': return parseSupercias(body, url);
    case 'registro-oficial': return parseRegistroOficial(body);
    default: return parseFeed(body, source);
  }
}

// La URL principal debe responder; las secundarias (`extraUrls`, páginas del Registro Oficial) son complementarias.
function urlsFor(source, hasHistory) {
  const urls = [source.url, ...(source.extraUrls || [])];
  const pages = hasHistory ? source.pages : source.backfillPages ?? source.pages;
  for (let page = 2; page <= (pages || 1); page++) urls.push(`${source.url}?paged=${page}`);
  return urls;
}

// Búsqueda por lotes (`search`): consulta los lotes que tocan según la rotación guardada en `tracked`, de uno en uno y con
// pausa. Basta con que responda un lote; si Google responde 429 se deja de pedir y la rotación sigue desde el lote pendiente.
async function fetchSearch(source, known = {}) {
  const lots = searchLots(searchBatches(searchCompanies()));
  const { picked } = rotation(lots, known?.cursor);
  const raw = []; let consumed = 0, answered = 0, saturated = false, lastError;
  for (const lot of picked) {
    if (consumed) await sleep(GOOGLE_PAUSE_MS);
    try {
      const body = await fetchText(lot.url, source.adapter);
      // Una búsqueda sin resultados es un RSS válido sin <item>: cuenta como respuesta, no como error.
      if (/<channel[\s>]/.test(body) && !/<item[\s>]/.test(body)) { answered++; consumed++; continue; }
      const rows = parseFeed(body, { ...source, language: lot.language });
      if (rows.length >= GOOGLE_MAX_RESULTS) saturated = true;
      raw.push(...rows); answered++; consumed++;
    }
    catch (error) {
      lastError = error;
      console.warn(`${source.name}: lote ${lot.index + 1}/${lots.length} no respondió (${error.message}).`);
      if (/HTTP 429/.test(error.message)) break;
      consumed++;
    }
  }
  if (!answered) throw lastError || new Error('Sin lotes de búsqueda');
  const tracked = { cursor: rotation(lots, known?.cursor, consumed).next, lots: lots.length };
  console.log(`${source.name}: lotes ${picked.slice(0, consumed).map(lot => lot.index + 1).join(', ')} de ${lots.length} (${raw.length} resultados).`);
  return { raw, tracked, saturated };
}

// Embudo de la fuente (`funnel`, en sources[] de la edición): filas leídas (`read`), fuera por enlace ajeno a sus dominios
// (`foreign`), resoluciones del BCE que no llegan a tener fecha (`undated`: de años anteriores, fuera de tema o con la consulta
// pendiente), fuera por medio (`host`), por normalize (`normalize`: sin titular, enlace o fecha, o con más de 30 días), por tema
// (`topic`) y aceptadas (`accepted`); siempre read = foreign + undated + host + normalize + topic + accepted. `saturated`: una
// consulta de Google devolvió el máximo de resultados, así que pudo quedar fuera lo peor posicionado sin aviso.
async function fetchSource(source, { known = {}, hasHistory = false } = {}) {
  if (source.search) {
    const { raw, tracked, saturated } = await fetchSearch(source, known);
    const { stories, funnel, discards } = screen(raw, source);
    return { stories, tracked, discards, funnel: { read: raw.length, foreign: 0, undated: 0, ...funnel, ...(saturated ? { saturated } : {}) } };
  }
  let raw = [], saturated = false;
  for (const [index, url] of urlsFor(source, hasHistory).entries()) {
    try {
      const rows = parse(await fetchText(url, source.adapter), source, url);
      if (source.adapter === 'google' && rows.length >= GOOGLE_MAX_RESULTS) saturated = true;
      raw.push(...rows);
    }
    catch (error) { if (!index) throw error; console.warn(`${source.name}: ${url} no respondió (${error.message}).`); break; }
  }
  const read = raw.length;
  // Enlaces fuera de los dominios de la fuente (`linkHosts`): fuera antes de cualquier otra petición.
  const foreign = raw.filter(row => !linkAllowed(row, source));
  if (foreign.length) {
    console.warn(`${source.name}: ${foreign.length} enlaces fuera de los dominios de la fuente (${[...new Set(foreign.map(row => { try { return new URL(row.url, source.url).hostname; } catch { return String(row.url).slice(0, 60); } }))].join(', ')}).`);
    raw = raw.filter(row => linkAllowed(row, source));
  }
  let tracked, undated = 0;
  if (source.adapter === 'bce-resolutions') { const before = raw.length; ({ tracked, rows: raw } = await dateResolutions(raw, source, known)); undated = before - raw.length; }
  const { stories, funnel, discards } = screen(raw, source);
  return { stories, tracked, discards, funnel: { read, foreign: foreign.length, undated, ...funnel, ...(saturated ? { saturated } : {}) } };
}

const settle = promise => promise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
async function withRetry(load) {
  try { return await load(); }
  catch (error) { await sleep(Math.min(30, error.retryAfter || 0) * 1000 || GOOGLE_RETRY_MS); return load(); }
}
async function fetchAll(sources, previous) {
  const load = source => fetchSource(source, { known: previous.tracked?.[source.id], hasHistory: (previous.stories || []).some(story => story.sourceId === source.id) });
  const google = sources.filter(source => source.adapter === 'google');
  const sequential = (async () => {
    const results = [];
    for (const [index, source] of google.entries()) {
      if (index) await sleep(GOOGLE_PAUSE_MS);
      results.push([source.id, await settle(withRetry(() => load(source)))]);
    }
    return results;
  })();
  // El resto va en paralelo, también con un reintento: algunos medios (CriptoNoticias) agotan el tiempo de forma intermitente.
  const parallel = Promise.all(sources.filter(source => source.adapter !== 'google').map(async source => [source.id, await settle(withRetry(() => load(source)))]));
  const byId = new Map([...(await parallel), ...(await sequential)]);
  return sources.map(source => byId.get(source.id));
}

function report(stories, sources, now) {
  for (const channel of CHANNELS) {
    const list = stories.filter(story => story.category === channel);
    const count = test => list.filter(test).length;
    const periods = PERIOD_DAYS.map((days, index) => `${days === 1 ? '24 h' : `${days} d`}: ${count(story => periodIndex(story, now) <= index)}`).join(', ');
    console.log(`${channel}: ${list.length} notas · nivel 1/2/3: ${[1, 2, 3].map(tier => count(story => story.tier === tier)).join('/')} · es/en: ${count(story => story.language === 'es')}/${count(story => story.language === 'en')} · de pago: ${count(story => story.access === 'paywall')} · conservadas sin respuesta: ${count(story => story.stale)} · ${periods}`);
  }
  const judged = stories.filter(story => story.editorial);
  console.log(`Juicio editorial: ${judged.length} de ${stories.length} notas de la edición (${judged.filter(story => story.editorial.why).length} con «por qué importa»); ${stories.filter(story => story.coverage).length} con cobertura agrupada.`);
  const tagged = stories.filter(story => story.endeavor);
  console.log(`Empresas Endeavor: ${tagged.length} notas etiquetadas (${CHANNELS.map(channel => `${channel}: ${tagged.filter(story => story.category === channel).length}`).join(', ')}).`);
  const failed = sources.filter(source => source.status === 'error').map(source => source.name);
  const empty = sources.filter(source => source.status === 'ok' && !source.recentCount).map(source => source.name);
  if (failed.length) console.log(`Fuentes sin respuesta: ${failed.join(', ')}.`);
  if (empty.length) console.log(`Fuentes sin notas: ${empty.join(', ')}.`);
  const saturated = sources.filter(source => source.funnel?.saturated).map(source => source.name);
  if (saturated.length) console.log(`Consultas de Google en el máximo de resultados (puede faltar lo peor posicionado): ${saturated.join(', ')}.`);
}

// Edición anterior leída de disco: si no tiene la forma esperada se trata como si no hubiera (`shapeOk: false`). Si la tiene,
// cada nota se revalida (forma, enlaces, fecha, fuente vigente y dominios) y las que no cumplen se descartan (`dropped`).
export function loadPrevious(data) {
  if (!editionShape(data)) return { previous: { stories: [], sources: [] }, shapeOk: false, dropped: 0 };
  const stories = data.stories.filter(story => carryable(story, SOURCE_BY_ID.get(story?.sourceId)));
  return { previous: { ...data, stories }, shapeOk: true, dropped: data.stories.length - stories.length };
}

const isPrimary = story => !!SOURCE_BY_ID.get(story?.sourceId)?.primary;
// La capa editorial nunca hace fallar la edición: ante cualquier error inesperado, las notas siguen con el juicio que ya
// traían (saneado) y sin juicio nuevo.
async function editorialPass(stories, saved, now) {
  const memo = readMemo(saved, now);
  try {
    const { client, sdk, reason } = await editorialClient();
    const { stories: pool } = await applyEditorial(stories, { client, sdk, reason, memo, now, primary: isPrimary });
    return { pool, memo };
  } catch {
    console.warn('Capa editorial: error inesperado; la edición se publica sin juicio editorial nuevo.');
    return { pool: stories.map(cleanStory), memo };
  }
}

async function run() {
  let data;
  try { data = JSON.parse(await readFile(output, 'utf8')); } catch { /* Primera edición. */ }
  const { previous, shapeOk, dropped } = loadPrevious(data ?? { stories: [], sources: [] });
  if (!shapeOk) console.warn('La edición anterior no tiene la forma esperada (stories y sources arreglos, tracked objeto o ausente): se trata como sin edición anterior.');
  if (dropped) console.warn(`Edición anterior: ${dropped} notas descartadas por no cumplir la forma o los dominios de su fuente.`);
  const checkedAt = new Date().toISOString(); const now = Date.parse(checkedAt);
  const results = await fetchAll(SOURCES, previous);
  const stories = []; const states = []; const tracked = {}; const discards = []; let successful = 0;
  for (let i = 0; i < SOURCES.length; i++) {
    const source = SOURCES[i], result = results[i], ok = result.status === 'fulfilled';
    if (ok) { successful++; if (result.value.tracked) tracked[source.id] = result.value.tracked; discards.push(...(result.value.discards || [])); }
    else { if (previous.tracked?.[source.id]) tracked[source.id] = previous.tracked[source.id]; console.error(`${source.name}: ${result.reason?.message || result.reason}`); }
    // Acumulación: lo nuevo más lo que la edición anterior ya tenía de esta fuente y sigue siendo válido.
    stories.push(...accumulate(ok ? result.value.stories : [], previous.stories, source, { ok, now, keep: story => passes(story, source) }));
    states.push({ source, ok, funnel: ok ? result.value.funnel : undefined, oldState: previous.sources.find(s => s?.id === source.id) });
  }
  if (!successful) { console.error('Ninguna fuente respondió; se conserva la edición anterior.'); process.exitCode = 1; return; }
  // Capa editorial: juicio para las notas que aún no lo tienen. Sin credenciales o con cualquier fallo, la edición sigue igual.
  const { pool, memo } = await editorialPass(deduplicate(stories), previous.tracked?.editorial, now);
  // Todas las notas, de todos los canales, llevan `endeavor` si su titular (o su extracto) nombra a una empresa del directorio.
  const edition = composeEdition(groupClusters(pool, { primary: isPrimary }), { cap: MAX_PER_CHANNEL, limitFor: story => limitFor(SOURCE_BY_ID.get(story.sourceId), story.category), now, threshold: EDITORIAL.threshold, neutral: EDITORIAL.neutralScore, primary: isPrimary, perEdition: story => SOURCE_BY_ID.get(story.sourceId)?.perEdition }).map(story => tagEndeavor(story));
  const notes = writeMemo({ pool, edition, memo, now });
  if (Object.keys(notes.notes).length) tracked.editorial = notes;
  const sources = states.map(({ source, ok, funnel, oldState }) => ({ id: source.id, name: source.name, category: source.category, kind: source.kind, tier: source.tier, access: source.access, language: source.language, url: source.site, status: ok ? 'ok' : 'error', checkedAt, lastSuccessAt: ok ? checkedAt : (typeof oldState?.lastSuccessAt === 'string' && parseDate(oldState.lastSuccessAt)) || null, recentCount: edition.filter(story => story.sourceId === source.id).length, ...(funnel ? { funnel } : {}) }));
  const payload = { version: 1, generatedAt: checkedAt, stories: edition, sources, tracked };
  await writeJson(output, payload);
  console.log(`Edición generada: ${edition.length} publicaciones, ${successful}/${SOURCES.length} fuentes disponibles.`);
  // El registro de descartes es un diagnóstico: si no se puede escribir, la edición ya publicada sigue valiendo.
  const log = discardLog(discards, { generatedAt: checkedAt });
  try { await writeJson(discardsPath(output), log); console.log(`Descartes: ${discards.filter(entry => entry.stage === 'tema').length} por tema y ${discards.filter(entry => entry.stage === 'medio').length} por medio; ${log.discards.length} en ${DISCARDS_FILE}.`); }
  catch (error) { console.warn(`No se pudo escribir ${DISCARDS_FILE} (${error.code || error.name}).`); }
  report(edition, sources, now);
}
// Solo se ejecuta como programa; las pruebas importan SOURCES sin recopilar.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run().catch(error => { console.error(error); process.exitCode = 1; });
