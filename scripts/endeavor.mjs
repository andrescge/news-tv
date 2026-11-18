import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Directorio oficial de Emprendedores Endeavor: API pública de WordPress de endeavor.org (100 empresas por página).
// Uso: npm run endeavor (o node scripts/endeavor.mjs [--output <ruta>]). Escribe scripts/data/endeavor-latam.json
// con las empresas de la región América Latina. La lista no se edita a mano: se regenera desde la API.
export const ENDEAVOR_API = 'https://endeavor.org/wp-json/wp/v2/company';
const USER_AGENT = 'NEWS-TV/1.0 (+https://github.com/andrescge/news-tv)';
const MAX_PAGES = 40;

const ENTITIES = { amp: '&', quot: '"', apos: '\'', lt: '<', gt: '>', nbsp: ' ' };
export function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

// Una empresa del directorio: etiquetas de `class_list` (region-…, local-office-…, vertical-…, sub-vertical-…).
export function toCompany(item) {
  const classes = item.class_list || [];
  const tagged = prefix => classes.filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length));
  return {
    name: decodeEntities(item.title?.rendered),
    slug: item.slug,
    regions: tagged('region-'),
    offices: tagged('local-office-'),
    vertical: tagged('vertical-')[0] || null,
    subVertical: tagged('sub-vertical-')[0] || null,
    url: item.link,
  };
}

// América Latina, sin repetidos: el directorio trae algunas empresas dos veces con slugs distintos (mismo nombre y
// sector): se unen sus oficinas. Dos empresas distintas con el mismo nombre (Swap de Brasil y de México) se conservan.
export function latamCompanies(items) {
  const byName = new Map();
  for (const company of items.map(toCompany)) {
    if (!company.name || !company.slug || !company.regions.includes('latin-america')) continue;
    const key = [company.name.toLowerCase(), company.vertical, company.subVertical].join('|');
    const known = byName.get(key);
    if (known) { known.offices = [...new Set([...known.offices, ...company.offices])]; continue; }
    const { regions, ...rest } = company;
    byName.set(key, rest);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'es') || a.slug.localeCompare(b.slug));
}

async function fetchAll() {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${ENDEAVOR_API}?per_page=100&page=${page}&_fields=id,slug,title,class_list,link`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    // WordPress responde 400 cuando se pide una página después de la última.
    if (response.status === 400 && page > 1) break;
    if (!response.ok) throw new Error(`HTTP ${response.status} en la página ${page}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error(`La página ${page} no es una lista de empresas`);
    items.push(...batch);
    const pages = Number(response.headers.get('x-wp-totalpages'));
    if (!batch.length || (Number.isFinite(pages) && page >= pages)) break;
  }
  return items;
}

async function run() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outputArg = process.argv.indexOf('--output');
  const output = outputArg === -1 ? resolve(root, 'scripts/data/endeavor-latam.json') : resolve(process.argv[outputArg + 1]);
  const items = await fetchAll();
  const companies = latamCompanies(items);
  if (companies.length < 100) throw new Error(`Solo ${companies.length} empresas de América Latina: no se reemplaza la lista.`);
  const payload = { source: ENDEAVOR_API, generatedAt: new Date().toISOString(), totalCompanies: items.length, count: companies.length, companies };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(`${output}.tmp`, JSON.stringify(payload, null, 1) + '\n', 'utf8');
  await rename(`${output}.tmp`, output);
  console.log(`Directorio Endeavor: ${items.length} empresas, ${companies.length} de América Latina → ${output}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run().catch(error => { console.error(error.message || error); process.exitCode = 1; });
