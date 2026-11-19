import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// La pantalla no tiene DOM en pruebas: se vigila por texto que el contrato con la capa editorial y las quejas del dueño sigan cumplidas.
const leer = ruta => readFile(new URL(`../site/${ruta}`, import.meta.url), 'utf8');

test('pantalla: ya no muestra «Por qué importa» ni lee editorial.why', async () => {
  const [html, js, css] = await Promise.all([leer('index.html'), leer('app.js'), leer('styles.css')]);
  assert.doesNotMatch(html, /Por qué importa|resumen automático|nota-porque/i);
  assert.doesNotMatch(js, /\.why\b|whyOf|nota-porque/);
  assert.doesNotMatch(css, /\.porque/);
});

test('pantalla: la traducción se rotula «Traducción automática» y solo sale de editorial.es en notas en inglés', async () => {
  const [html, js] = await Promise.all([leer('index.html'), leer('app.js')]);
  assert.match(html, /Traducción automática/);
  assert.match(js, /editorial\?\.es/);
  assert.match(js, /langOf\(story\) !== 'en'\) return ''/);
  assert.match(js, /length <= 240/);
  assert.match(js, /textContent = translation/);
});

test('pantalla: la fila de acciones es «Leer en la fuente» y «Siguiente», sin Anterior, Pausar ni «A continuación»', async () => {
  const [html, js, css] = await Promise.all([leer('index.html'), leer('app.js'), leer('styles.css')]);
  assert.match(html, /Leer en la fuente/);
  assert.match(html, />Siguiente</);
  assert.doesNotMatch(html, />Anterior<|>Pausar<|A continuación|id="siguientes"|class="mandos"/);
  assert.doesNotMatch(js, /togglePlayback|requestAnimationFrame\(tick\)|durationFor/);
  assert.doesNotMatch(css, /\.mandos|\.siguientes/);
  // La navegación por teclado sigue: flechas y números de canal.
  assert.match(js, /ArrowLeft/);
  assert.match(js, /ArrowRight/);
  assert.match(js, /\/\^\[1-9\]\$\//);
});

test('pantalla: sin etiquetas de sistema en la línea de estado y con marca de idioma solo en inglés', async () => {
  const js = await leer('app.js');
  assert.match(js, /story\.kind !== 'news'/);
  assert.match(js, /lang === 'en'\) facts\.push\(el\('li', 'dato-idioma', 'en inglés'\)\)/);
  assert.doesNotMatch(js, /avance en|en espera/);
  assert.match(js, /heading\.lang = lang/);
  assert.match(js, /excerptNode\.lang = lang/);
});

test('pantalla: el período marcado es el que se muestra (ampliado incluido)', async () => {
  const js = await leer('app.js');
  assert.match(js, /state\.view\.periodIndex : state\.period/);
});

test('pantalla: contenido de terceros solo por textContent, enlaces por safeUrl y CSP intacta', async () => {
  const [html, js] = await Promise.all([leer('index.html'), leer('app.js')]);
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(js, /safeUrl\(story\.url\)/);
  assert.match(html, /default-src 'none'; script-src 'self'; style-src 'self'/);
});

test('pantalla: sin círculos, sombras ni degradados en la hoja de estilos', async () => {
  const css = await leer('styles.css');
  assert.doesNotMatch(css, /border-radius:\s*50%|box-shadow|gradient\(/);
});
