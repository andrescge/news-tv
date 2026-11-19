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

test('pantalla: no muestra traducción automática ni lee editorial.es (las ediciones que lo traen se muestran igual)', async () => {
  const [html, js, css] = await Promise.all([leer('index.html'), leer('app.js'), leer('styles.css')]);
  assert.doesNotMatch(html, /Traducción automática|nota-traduccion|traducciones/i);
  assert.doesNotMatch(js, /editorial\?\.es|\.es\b|translationOf|nota-traduccion|con-traduccion/);
  assert.doesNotMatch(css, /traduccion/);
  // La marca de idioma de la línea de datos se queda.
  assert.match(js, /'en inglés'/);
});

test('pantalla: la fila de acciones es «Leer en la fuente» y una flecha «→» para la siguiente, sin Anterior, Pausar ni «A continuación»', async () => {
  const [html, js, css] = await Promise.all([leer('index.html'), leer('app.js'), leer('styles.css')]);
  assert.match(html, /Leer en la fuente/);
  // La flecha: nombre accesible y título, la misma tecla, sin la palabra «Siguiente» como texto visible.
  const boton = html.match(/<button id="adelante"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(boton, 'falta el botón #adelante');
  assert.match(boton[0], /aria-label="Siguiente noticia"/);
  assert.match(boton[0], /title="Siguiente noticia[^"]*"/);
  assert.match(boton[0], /aria-keyshortcuts="ArrowRight"/);
  assert.equal(boton[1].replace(/<[^>]+>/g, '').trim(), '→');
  assert.doesNotMatch(html, />Siguiente</);
  // Zona táctil de 44 × 44 px que no se parte de línea.
  const flecha = css.match(/\.accion-flecha \{[^}]*\}/)?.[0] ?? '';
  assert.match(flecha, /min-width: 44px/);
  assert.match(flecha, /white-space: nowrap/);
  assert.match(css, /\.accion-enlace, \.accion, \.sin-enlace \{[^}]*min-height: 44px/);
  assert.match(js, /\$\('#adelante'\)\.addEventListener\('click', \(\) => moveStory\(1, true\)\)/);
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
