// News TV — señal sin televisor, con la marca de Catalystica. Todo el contenido de la edición se inserta con textContent
// y todos los enlaces pasan por safeUrl (solo http/https): los datos vienen de fuentes de terceros.

// `short` es la palabra visible en la lista; `name`, el nombre completo para lectores de pantalla y estados.
const channels = [
  { id: 'ecuador', short: 'Ecuador', name: 'Ecuador financiero' },
  { id: 'regulacion', short: 'Autoridades', name: 'Autoridades EC' },
  { id: 'latam', short: 'Fintech', name: 'Fintech LATAM' },
  { id: 'pagos', short: 'Pagos', name: 'Pagos globales' },
  { id: 'cripto', short: 'Cripto', name: 'Cripto' },
  { id: 'endeavor', short: 'Endeavor', name: 'Endeavor LATAM' },
];
const kindLabels = {
  official: 'Publicación oficial',
  news: 'Noticia',
  company: 'Blog de empresa',
  organization: 'Contenido de organización',
};
const periods = [
  { days: 1, button: 'Hoy', name: 'Hoy: últimas 24 horas', long: '24 horas' },
  { days: 7, button: '7 días', name: 'Últimos 7 días', long: '7 días' },
  { days: 15, button: '15', name: 'Últimos 15 días', long: '15 días' },
  { days: 30, button: '30', name: 'Últimos 30 días', long: '30 días' },
];
const DEFAULT_PERIOD = 1;
const tierLabels = { 1: 'Oficiales y de referencia', 2: 'Especializadas', 3: 'Contexto' };
const MIN_STORIES = 5;
const DAY = 86_400_000;
const STALE_AFTER = 3 * 3_600_000;
const FUTURE_TOLERANCE = 5 * 60_000;
const REFRESH_EVERY = 10 * 60_000;
const TICKER_ITEMS = 12;
const TICKER_PER_CHANNEL = 3;
const TICKER_WINDOW = 2 * 86_400_000;
const TICKER_SPEED = 70; // píxeles por segundo
const ZONE = 'America/Guayaquil';

const dateTimeFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONE });
const shortFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', timeZone: ZONE });
const yearFormat = new Intl.DateTimeFormat('es-EC', { year: 'numeric', timeZone: ZONE });
const $ = selector => document.querySelector(selector);

// Estado único: canal, noticia y período.
const state = {
  data: null,
  status: 'cargando', // cargando | ok | error
  error: '',
  refreshError: '',
  loading: false,
  channel: 0,
  story: 0,
  period: DEFAULT_PERIOD,
  view: { stories: [], periodIndex: DEFAULT_PERIOD, widened: false },
  stripChannel: -1,
  tickerKey: null,
  channelButtons: [],
  periodButtons: [],
  excerptFor: null, // id de la nota cuyo extracto se muestra
  excerptOpen: false, // el extracto se muestra en pocas líneas hasta pulsar «Ver todo»
};

// ---------- Utilidades ----------
function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}
function text(value) { return value == null ? '' : String(value).trim(); }
function timeOf(value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : NaN; }
function formatDate(ms) { return Number.isFinite(ms) ? dateTimeFormat.format(ms) : 'fecha no disponible'; }
// Fecha de la línea de estado: relativa si es de las últimas 48 horas, «7 nov» después (con año si no es el en curso).
function formatShort(ms) {
  if (!Number.isFinite(ms)) return 'fecha no disponible';
  if (Date.now() - ms < 48 * 3_600_000) return ago(Date.now() - ms);
  return yearFormat.format(ms) === yearFormat.format(Date.now()) ? shortFormat.format(ms) : `${shortFormat.format(ms)} ${yearFormat.format(ms)}`;
}
function plural(count, one, many) { return `${count} ${count === 1 ? one : many}`; }
function ago(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'hace menos de un minuto';
  if (minutes < 60) return `hace ${plural(minutes, 'minuto', 'minutos')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `hace ${plural(hours, 'hora', 'horas')}`;
  return `hace ${Math.floor(hours / 24)} días`;
}
// Traducción automática del titular de una nota en inglés (campo opcional `editorial.es`): texto plano corto.
// Cualquier otro texto de la capa editorial (incluido el campo antiguo de las ediciones previas) no se muestra.
function translationOf(story) {
  if (langOf(story) !== 'en') return '';
  const es = story?.editorial?.es;
  if (typeof es !== 'string') return '';
  const clean = es.replace(/\s+/g, ' ').trim();
  return clean.length <= 240 && !/[<>]|https?:|www\./i.test(clean) ? clean : '';
}
// «También en»: otros medios que contaron el mismo hecho (campo opcional `coverage`).
function coverageOf(story) {
  if (!Array.isArray(story?.coverage)) return [];
  return story.coverage.filter(name => typeof name === 'string').map(name => name.trim()).filter(name => name && name.length <= 80).slice(0, 8);
}
function langOf(story) { return story?.language === 'en' ? 'en' : 'es'; }
function titleOf(story) { return text(story?.title) || '(sin titular)'; }
function channelIndexOf(id) { return channels.findIndex(channel => channel.id === id); }
function dialogOpen() { return $('#fuentes').open; }

// ---------- Selección de notas ----------
// Juicio editorial (campo opcional `editorial`): puntuación válida, o null. Ediciones sin el campo funcionan igual.
function scoreOf(story) {
  const score = story?.editorial?.score;
  return Number.isInteger(score) && score >= 0 && score <= 100 ? score : null;
}
// Si el canal trae juicio editorial, la edición ya viene en su orden (por período y, dentro de cada uno, por importancia)
// y se respeta; si no, las notas se ordenan por fecha, de la más reciente a la más antigua.
function storiesIn(channelIndex, periodIndex) {
  const now = Date.now();
  const cutoff = now - periods[periodIndex].days * DAY;
  const id = channels[channelIndex].id;
  const list = (state.data?.stories || []).filter(story => {
    if (!story || story.category !== id) return false;
    const published = timeOf(story.publishedAt);
    return published >= cutoff && published <= now + FUTURE_TOLERANCE;
  });
  if (list.some(story => scoreOf(story) != null)) return list;
  return list.sort((a, b) => timeOf(b.publishedAt) - timeOf(a.publishedAt));
}
// Si el canal tiene menos de 5 notas en el período elegido, amplía al siguiente.
function viewFor(channelIndex) {
  const requested = storiesIn(channelIndex, state.period);
  let periodIndex = state.period;
  let stories = requested;
  while (stories.length < MIN_STORIES && periodIndex < periods.length - 1) {
    periodIndex += 1;
    stories = storiesIn(channelIndex, periodIndex);
  }
  if (stories.length === requested.length) return { stories: requested, periodIndex: state.period, widened: false };
  return { stories, periodIndex, widened: true };
}
function refreshView() {
  state.view = viewFor(state.channel);
  if (state.story >= state.view.stories.length) state.story = 0;
}
function currentStory() { return state.view.stories[state.story] || null; }
// ---------- Construcción única de controles ----------
function buildChannels() {
  const root = $('#canales');
  state.channelButtons = channels.map((channel, index) => {
    const button = el('button', 'canal');
    button.type = 'button';
    const count = el('span', 'canal-cuenta', '—');
    count.setAttribute('aria-hidden', 'true');
    button.append(el('span', 'canal-nombre', channel.short), count);
    button.addEventListener('click', () => selectChannel(index));
    root.append(button);
    return button;
  });
}
function buildPeriods() {
  const root = $('#periodos');
  state.periodButtons = periods.map((period, index) => {
    const button = el('button', 'periodo', period.button);
    button.type = 'button';
    button.setAttribute('aria-label', period.name);
    button.addEventListener('click', () => setPeriod(index));
    root.append(button);
    return button;
  });
}

// ---------- Render ----------
function updateDeck() {
  state.channelButtons.forEach((button, index) => {
    const count = state.data ? (index === state.channel ? state.view : viewFor(index)).stories.length : null;
    button.setAttribute('aria-pressed', String(index === state.channel));
    button.querySelector('.canal-cuenta').textContent = count == null ? '—' : String(count);
    button.setAttribute('aria-label', `${channels[index].name}${count == null ? '' : `, ${plural(count, 'nota', 'notas')}`}`);
  });
  // Marca el período que de verdad se ve (si se amplió, el ampliado).
  const shown = state.data ? state.view.periodIndex : state.period;
  state.periodButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === shown)));
  $('#adelante').disabled = state.view.stories.length < 2;
  revealChannel();
}
// En pantallas estrechas la lista de canales es una franja horizontal: centra el canal activo.
function revealChannel() {
  if (state.stripChannel === state.channel) return;
  const strip = $('#canales');
  const button = state.channelButtons[state.channel];
  if (!button || strip.scrollWidth <= strip.clientWidth) return;
  state.stripChannel = state.channel;
  const left = button.offsetLeft - (strip.clientWidth - button.offsetWidth) / 2;
  strip.scrollLeft = Math.max(0, left);
}

function editionTime() {
  const generated = timeOf(state.data?.generatedAt);
  if (Number.isFinite(generated)) return generated;
  const successes = (state.data?.sources || []).map(source => timeOf(source.lastSuccessAt)).filter(Number.isFinite);
  return successes.length ? Math.max(...successes) : NaN;
}
// Barra final: antigüedad de la edición. Con aviso (punto azul) si pasa de 3 horas o falló la actualización.
function renderEdition() {
  const node = $('#edicion');
  if (!state.data) {
    node.textContent = state.status === 'error' ? 'Sin edición' : 'Cargando…';
    node.classList.toggle('atrasada', state.status === 'error');
    node.removeAttribute('title');
    return;
  }
  const generated = editionTime();
  if (!Number.isFinite(generated)) {
    node.textContent = 'Edición sin fecha';
    node.classList.add('atrasada');
    return;
  }
  const age = Date.now() - generated;
  const late = age > STALE_AFTER;
  let label = `Actualizado ${ago(age)}`;
  if (late) label = `Atrasada · actualizada ${ago(age)}`;
  if (state.refreshError) label = `Sin actualizar · actualizada ${ago(age)}`;
  node.textContent = label;
  node.title = `Edición generada el ${formatDate(generated)} (hora de Ecuador)${state.refreshError ? `. Último intento de actualización fallido: ${state.refreshError}.` : ''}`;
  node.classList.toggle('atrasada', late || !!state.refreshError);
}

function showSignal({ label, title, body, detail = '', retry = false }) {
  $('#nota').hidden = true;
  $('#senal').hidden = false;
  $('#senal-rotulo').textContent = label;
  $('#senal-titulo').textContent = title;
  $('#senal-titulo').dataset.largo = title.length <= 40 ? 's' : 'm';
  $('#senal-texto').textContent = body;
  $('#senal-texto').hidden = !body;
  $('#senal-rotulo').parentElement.hidden = !label;
  $('#senal-detalle').hidden = !detail;
  $('#senal-detalle').textContent = detail;
  $('#reintentar').hidden = !retry;
}
function renderStory(story) {
  $('#senal').hidden = true;
  $('#nota').hidden = false;
  const lang = langOf(story);
  const title = titleOf(story);
  const excerpt = text(story.excerpt);
  const heading = $('#nota-titular');
  heading.textContent = title;
  heading.lang = lang;
  heading.dataset.largo = title.length <= 60 ? 's' : title.length <= 100 ? 'm' : title.length <= 140 ? 'l' : title.length <= 200 ? 'xl' : 'xxl';
  const excerptNode = $('#nota-extracto');
  excerptNode.hidden = !excerpt;
  excerptNode.textContent = excerpt;
  excerptNode.lang = lang;
  const translation = translationOf(story);
  $('#nota-traduccion').hidden = !translation;
  $('#nota-traduccion-texto').textContent = translation;
  $('#nota').classList.toggle('con-traduccion', !!translation);
  const coverage = coverageOf(story);
  $('#nota-cobertura').hidden = !coverage.length;
  $('#nota-cobertura').textContent = coverage.length ? `También en ${coverage.join(', ')}` : '';
  // Cada nota nueva empieza con el extracto recogido; un re-render de la misma nota respeta lo que eligió quien lee.
  if (state.excerptFor !== story.id) { state.excerptFor = story.id; state.excerptOpen = false; }
  fitExcerpt();

  // Línea de estado: medio · tipo (solo si no es noticia) · fecha · «en inglés» · «de pago»; la posición va después.
  const facts = [];
  const source = text(story.source);
  if (source) facts.push(el('li', 'dato-medio', source));
  if (kindLabels[story.kind] && story.kind !== 'news') facts.push(el('li', 'dato-tipo', kindLabels[story.kind].toLowerCase()));
  const published = timeOf(story.publishedAt);
  const date = el('li', 'dato-fecha');
  const time = el('time', '', formatShort(published));
  if (Number.isFinite(published)) {
    time.dateTime = new Date(published).toISOString();
    time.title = `${formatDate(published)} (hora de Ecuador) · ${ago(Date.now() - published)}`;
  }
  date.append(time);
  facts.push(date);
  if (lang === 'en') facts.push(el('li', 'dato-idioma', 'en inglés'));
  if (story.access === 'paywall') facts.push(el('li', 'dato-pago', 'de pago'));
  const via = text(story.via);
  $('#nota-datos').replaceChildren(...facts);

  renderEndeavor(story.endeavor);
  $('#nota-aviso').hidden = story.stale !== true;
  const url = safeUrl(story.url);
  const link = $('#nota-enlace');
  link.hidden = !url;
  link.href = url || '#';
  $('#nota-enlace-texto').textContent = via ? 'Leer vía Google News' : 'Leer en la fuente';
  $('#nota-sin-enlace').hidden = !!url;
}
// Extracto: CSS lo limita a pocas líneas; «Ver todo» aparece solo si de verdad queda texto oculto.
function fitExcerpt() {
  const node = $('#nota-extracto');
  const button = $('#extracto-boton');
  node.classList.toggle('abierto', state.excerptOpen);
  const clipped = !node.hidden && !state.excerptOpen && node.scrollHeight > node.clientHeight + 1;
  button.hidden = node.hidden || !(clipped || state.excerptOpen);
  button.textContent = state.excerptOpen ? 'Ver menos' : 'Ver todo';
  button.setAttribute('aria-label', state.excerptOpen ? 'Ver menos del extracto' : 'Ver todo el extracto');
  button.setAttribute('aria-expanded', String(state.excerptOpen));
}
function toggleExcerpt() {
  state.excerptOpen = !state.excerptOpen;
  fitExcerpt();
}
// Rótulo de empresa de la red Endeavor (campo opcional `endeavor`): nombre y país, con enlace a su ficha del directorio.
function renderEndeavor(tag) {
  const node = $('#nota-endeavor');
  const company = text(tag?.company);
  node.hidden = !company;
  if (!company) { node.replaceChildren(); return; }
  const name = company === company.toUpperCase() && company.length > 3 ? company.charAt(0) + company.slice(1).toLowerCase() : company;
  const label = ['Empresa Endeavor', name, text(tag.country)].filter(Boolean).join(' · ');
  const url = safeUrl(tag.url);
  if (!url) { node.replaceChildren(el('span', '', label)); return; }
  const link = el('a', '', label);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = 'Ficha de la empresa en el directorio de Endeavor';
  link.append(el('span', 'sr-only', ' (ficha en el directorio de Endeavor, se abre en otra pestaña)'));
  node.replaceChildren(link);
}
function renderScreen() {
  const story = currentStory();
  const channel = channels[state.channel];
  if (!state.data && state.status === 'error') {
    showSignal({ label: 'No cargó', title: 'No se pudo cargar la edición', body: '', detail: `${state.error}.`, retry: true });
  } else if (!state.data) {
    showSignal({ label: '', title: 'Cargando…', body: '' });
  } else if (!story) {
    showSignal({ label: 'Sin notas', title: `${channel.short}: sin notas en ${periods[periods.length - 1].long}`, body: '' });
  } else {
    renderStory(story);
  }
  const total = state.view.stories.length;
  $('#posicion').textContent = total ? `${state.story + 1} de ${total}` : '';
  const periodNote = $('#periodo-nota');
  periodNote.textContent = state.view.widened
    ? `Pocas notas en ${periods[state.period].long}: se muestran ${periods[state.view.periodIndex].long}.`
    : '';
  periodNote.hidden = !state.data || !state.view.widened;
}
function render() {
  refreshView();
  updateDeck();
  renderEdition();
  renderScreen();
}

// ---------- Cintillo de última hora ----------
function buildTicker() {
  const track = $('#cintillo-pista');
  const setMessage = (key, message) => {
    if (state.tickerKey === key) return;
    state.tickerKey = key;
    track.classList.add('quieta');
    track.replaceChildren(el('p', 'cintillo-estado', message));
  };
  if (!state.data) {
    setMessage(`estado:${state.status}`, state.status === 'error' ? 'No se pudo cargar la edición' : 'Cargando…');
    return;
  }
  const now = Date.now();
  const valid = state.data.stories
    .filter(story => story && channelIndexOf(story.category) >= 0 && text(story.title) && timeOf(story.publishedAt) <= now + FUTURE_TOLERANCE);
  // Titulares recientes: los de las últimas 48 horas (si hay pocos, todos), por importancia y después por fecha, máximo 3 por canal.
  const recent = valid.filter(story => timeOf(story.publishedAt) >= now - TICKER_WINDOW);
  const pool = (recent.length >= 8 ? recent : valid)
    .sort((a, b) => ((scoreOf(b) ?? 50) - (scoreOf(a) ?? 50)) || (timeOf(b.publishedAt) - timeOf(a.publishedAt)));
  const perChannel = {};
  const items = pool.filter(story => (perChannel[story.category] = (perChannel[story.category] || 0) + 1) <= TICKER_PER_CHANNEL).slice(0, TICKER_ITEMS);
  if (!items.length) { setMessage('vacio', 'Sin titulares'); return; }
  const key = items.map(story => story.id).join('|');
  if (state.tickerKey === key) return;
  state.tickerKey = key;

  const makeList = copy => {
    const list = el('ul', copy ? 'cintillo-lista copia' : 'cintillo-lista');
    for (const story of items) {
      const index = channelIndexOf(story.category);
      const item = el('li');
      const button = el('button', 'cintillo-titular');
      button.type = 'button';
      button.dataset.id = String(story.id);
      const title = el('span', '', titleOf(story));
      title.lang = langOf(story);
      button.append(el('span', 'sr-only', `${channels[index].name}: `));
      if (langOf(story) === 'en') button.append(el('span', 'cintillo-idioma', 'EN · '));
      button.append(title, el('span', 'sr-only', `, ${ago(now - timeOf(story.publishedAt))}`));
      if (copy) button.tabIndex = -1;
      item.append(button);
      list.append(item);
    }
    if (copy) { list.setAttribute('aria-hidden', 'true'); list.inert = true; }
    return list;
  };
  track.replaceChildren(makeList(false), makeList(true));
  track.classList.remove('quieta');
  requestAnimationFrame(() => {
    const width = track.firstElementChild?.scrollWidth || 0;
    track.style.setProperty('--duracion', `${Math.max(30, Math.round(width / TICKER_SPEED))}s`);
  });
}
function tuneToStory(id) {
  const story = (state.data?.stories || []).find(item => String(item.id) === id);
  if (!story) return;
  const index = channelIndexOf(story.category);
  if (index < 0) return;
  const changed = index !== state.channel;
  state.channel = index;
  state.view = viewFor(index);
  let position = state.view.stories.findIndex(item => item === story);
  while (position < 0 && state.period < periods.length - 1) {
    state.period += 1;
    state.view = viewFor(index);
    position = state.view.stories.findIndex(item => item === story);
  }
  state.story = Math.max(0, position);
  render();
  announceStory(changed);
}

// ---------- Fuentes ----------
function buildSources() {
  const list = $('#fuentes-lista');
  const summary = $('#fuentes-resumen');
  if (!state.data) {
    summary.textContent = state.status === 'error' ? 'No se pudo cargar la edición.' : 'Cargando…';
    list.replaceChildren();
    return;
  }
  const sources = state.data.sources.filter(source => source && typeof source === 'object');
  const ok = sources.filter(source => source.status === 'ok').length;
  const checks = sources.map(source => timeOf(source.checkedAt)).filter(Number.isFinite);
  const failed = sources.length - ok;
  summary.textContent = `${plural(sources.length, 'fuente', 'fuentes')}${failed ? `, ${failed} sin respuesta` : ', todas respondieron'} en la última ejecución${checks.length ? ` (${formatDate(Math.max(...checks))}, hora de Ecuador)` : ''}.`;

  const order = (a, b) => (channelIndexOf(a.category) - channelIndexOf(b.category)) || text(a.name).localeCompare(text(b.name), 'es');
  const groups = [1, 2, 3].map(tier => ({ label: tierLabels[tier], items: sources.filter(source => Number(source.tier) === tier) }));
  groups.push({ label: 'Sin nivel asignado', items: sources.filter(source => ![1, 2, 3].includes(Number(source.tier))) });

  const sections = groups.filter(group => group.items.length).map(group => {
    const section = el('section', 'nivel');
    section.append(el('h3', '', `${group.label} (${group.items.length})`));
    const ul = el('ul');
    for (const source of group.items.sort(order)) {
      const item = el('li', 'fuente');
      const info = el('div');
      const name = text(source.name) || text(source.id) || 'Fuente sin nombre';
      const url = safeUrl(source.url);
      const nameNode = el('p', 'fuente-nombre');
      if (url) {
        const link = el('a', '', name);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.append(el('span', 'sr-only', ' (se abre en otra pestaña)'));
        nameNode.append(link);
      } else {
        nameNode.textContent = name;
      }
      const channelIndex = channelIndexOf(source.category);
      const facts = [
        channelIndex >= 0 ? channels[channelIndex].short : text(source.category),
        source.kind && source.kind !== 'news' ? (kindLabels[source.kind] || '').toLowerCase() : '',
        source.language === 'en' ? 'en inglés' : '',
        source.access === 'paywall' ? 'de pago' : '',
      ].filter(Boolean);
      info.append(nameNode, el('p', 'fuente-datos', facts.join(' · ')));
      item.append(info, el('p', `fuente-estado${source.status === 'ok' ? '' : ' error'}`, sourceStatus(source)));
      ul.append(item);
    }
    section.append(ul);
    return section;
  });
  list.replaceChildren(...sections);
}
function sourceStatus(source) {
  if (source.status === 'ok') {
    const count = Number(source.recentCount) || 0;
    return count ? plural(count, 'nota', 'notas') : 'sin novedades';
  }
  const last = timeOf(source.lastSuccessAt);
  return Number.isFinite(last) ? `Sin respuesta · último éxito ${formatDate(last)}` : 'Sin respuesta · sin éxito registrado';
}

// ---------- Sintonizador ----------
function announce(message) {
  const node = $('#anunciador');
  node.textContent = '';
  window.setTimeout(() => { node.textContent = message; }, 60);
}
function announceStory(withChannel) {
  const story = currentStory();
  const total = state.view.stories.length;
  let message = withChannel ? `${channels[state.channel].name}. ` : '';
  if (!state.data) message += state.status === 'error' ? 'No se pudo cargar la edición.' : 'Cargando.';
  else if (!story) message += 'Sin notas.';
  else message += `Nota ${state.story + 1} de ${total}: ${titleOf(story)}`;
  if (withChannel && state.view.widened) message += `. Período ampliado a ${periods[state.view.periodIndex].long}.`;
  announce(message);
}
function selectChannel(index) {
  const total = channels.length;
  const target = ((index % total) + total) % total;
  if (target === state.channel) return;
  state.channel = target;
  state.story = 0;
  render();
  announceStory(true);
}
function moveStory(direction, manual) {
  const total = state.view.stories.length;
  if (total < 2) return;
  state.story = (state.story + direction + total) % total;
  renderScreen();
  if (manual) announceStory(false);
}
function setPeriod(index) {
  if (index === state.period) return;
  const currentId = currentStory()?.id;
  state.period = index;
  refreshView();
  const position = state.view.stories.findIndex(story => story.id === currentId);
  state.story = position < 0 ? 0 : position;
  render();
  const count = state.view.stories.length;
  announce(`Período: ${periods[index].name}. ${channels[state.channel].name}: ${plural(count, 'nota', 'notas')}${state.view.widened ? `, período ampliado a ${periods[state.view.periodIndex].long}` : ''}.`);
}
// ---------- Carga de la edición ----------
async function loadNews({ manual = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const retry = $('#reintentar');
  if (manual) { retry.setAttribute('aria-disabled', 'true'); retry.textContent = 'Reintentando…'; }
  try {
    let response;
    try { response = await fetch('./data/news.json', { cache: 'no-store' }); }
    catch { throw new Error('no hay conexión con el servidor'); }
    if (!response.ok) throw new Error(`el servidor respondió HTTP ${response.status}`);
    let data;
    try { data = await response.json(); }
    catch { throw new Error('el archivo de la edición no es JSON válido'); }
    if (!data || !Array.isArray(data.stories) || !Array.isArray(data.sources)) throw new Error('la edición no tiene el formato esperado');
    const previousId = currentStory()?.id;
    const recovered = state.status === 'error';
    state.data = data;
    state.status = 'ok';
    state.error = '';
    state.refreshError = '';
    refreshView();
    const position = state.view.stories.findIndex(story => story.id === previousId);
    state.story = position < 0 ? 0 : position;
    render();
    buildTicker();
    buildSources();
    if (recovered) {
      announce('Edición cargada.');
      if (manual) $('#noticia').focus();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error desconocido';
    if (state.data) {
      state.refreshError = message;
      renderEdition();
    } else {
      state.status = 'error';
      state.error = message;
      render();
      buildTicker();
      buildSources();
      if (manual) announce(`Sigue sin cargar: ${message}.`);
    }
  } finally {
    state.loading = false;
    retry.removeAttribute('aria-disabled');
    retry.textContent = 'Reintentar';
  }
}

// ---------- Eventos ----------
function bindEvents() {
  $('#adelante').addEventListener('click', () => moveStory(1, true));
  $('#extracto-boton').addEventListener('click', toggleExcerpt);
  // El recorte depende del ancho y de la letra: se vuelve a medir al cambiar la ventana y cuando Geist termina de cargar.
  window.addEventListener('resize', fitExcerpt);
  document.fonts?.ready?.then(fitExcerpt);
  $('#reintentar').addEventListener('click', () => {
    if ($('#reintentar').getAttribute('aria-disabled') === 'true') return;
    loadNews({ manual: true });
  });
  $('#cintillo-pista').addEventListener('click', event => {
    const button = event.target.closest('button[data-id]');
    if (button) tuneToStory(button.dataset.id);
  });

  const sources = $('#fuentes');
  $('#abrir-fuentes').addEventListener('click', () => sources.showModal());
  $('#cerrar-fuentes').addEventListener('click', () => sources.close());
  sources.addEventListener('click', event => { if (event.target === sources) sources.close(); });
  sources.addEventListener('close', () => $('#abrir-fuentes').focus());

  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || dialogOpen()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
    // La lista de canales es vertical: ↓ baja al canal siguiente y ↑ sube al anterior.
    if (event.key === 'ArrowDown') { event.preventDefault(); selectChannel(state.channel + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); selectChannel(state.channel - 1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); moveStory(-1, true); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); moveStory(1, true); }
    else if (/^[1-9]$/.test(event.key)) {
      const number = Number(event.key);
      if (number <= channels.length) selectChannel(number - 1);
      else announce(`El canal ${number} no existe. Hay ${channels.length} canales.`);
    }
  });
}

// ---------- Tipografía ----------
// Si Geist no carga, se relajan tracking e interlineado del titular (html.no-geist).
function checkFont() {
  if (!document.fonts?.load) return;
  document.fonts.load('900 1em Geist').then(faces => {
    if (!faces.length) document.documentElement.classList.add('no-geist');
  }, () => document.documentElement.classList.add('no-geist'));
}

// ---------- Arranque ----------
checkFont();
buildChannels();
buildPeriods();
bindEvents();
render();
buildTicker();
buildSources();
loadNews();
window.setInterval(renderEdition, 15_000);
window.setInterval(() => loadNews(), REFRESH_EVERY);
