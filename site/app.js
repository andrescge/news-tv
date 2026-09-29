const channels = [
  { id: 'ecuador', name: 'Ecuador financiero', label: 'ECUADOR FINANCIERO' },
  { id: 'regulacion', name: 'Autoridades EC', label: 'AUTORIDADES EC' },
  { id: 'latam', name: 'Fintech LATAM', label: 'FINTECH LATAM' },
  { id: 'pagos', name: 'Pagos globales', label: 'PAGOS GLOBALES' },
  { id: 'cripto', name: 'Cripto', label: 'CRIPTO' },
];
const durations = [10_000, 20_000, 40_000];
const $ = selector => document.querySelector(selector);
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' });
const fullDateFormat = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Guayaquil' });
const clockFormat = new Intl.DateTimeFormat('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Guayaquil' });
const state = { data: null, channelIndex: 0, storyIndex: 0, days: 7, playing: true, durationIndex: 1, elapsed: 0, lastFrame: 0, dialogFocus: null };

function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
function date(value, time = false) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? (time ? fullDateFormat : dateFormat).format(parsed) : 'Fecha no disponible';
}
function currentChannel() { return channels[state.channelIndex]; }
function channelStories(index = state.channelIndex) {
  const cutoff = Date.now() - state.days * 86400000;
  return (state.data?.stories || []).filter(story => story.category === channels[index].id && Number.isFinite(Date.parse(story.publishedAt)) && Date.parse(story.publishedAt) >= cutoff && Date.parse(story.publishedAt) <= Date.now() + 300000).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
function currentStory() { const stories = channelStories(); return stories[state.storyIndex % stories.length] || null; }
function element(tag, className, content) { const node = document.createElement(tag); if (className) node.className = className; if (content != null) node.textContent = content; return node; }

function renderChannels() {
  const root = $('#channel-buttons'); root.replaceChildren();
  channels.forEach((channel, index) => {
    const button = element('button', 'channel-button'); button.type = 'button'; button.setAttribute('aria-label', `Canal ${index + 1}: ${channel.name}`); button.setAttribute('aria-pressed', String(index === state.channelIndex));
    const top = element('span', 'channel-top', `CH ${String(index + 1).padStart(2, '0')}`);
    const bottom = element('span', 'channel-bottom'); bottom.append(element('span', 'channel-name', channel.name), element('span', 'channel-count', String(channelStories(index).length)));
    button.append(top, bottom); button.addEventListener('click', () => selectChannel(index)); root.append(button);
  });
}
function renderScreen() {
  const channel = currentChannel(), stories = channelStories();
  if (state.storyIndex >= stories.length) state.storyIndex = 0;
  const story = currentStory();
  const number = String(state.channelIndex + 1).padStart(2, '0');
  $('#screen-channel-name').textContent = channel.label; $('#channel-number').textContent = `CH ${number}`; $('#watermark').textContent = number;
  $('#screen-date').textContent = date(Date.now()).toUpperCase();
  $('#story-position').textContent = stories.length ? `${String(state.storyIndex + 1).padStart(2, '0')} / ${String(stories.length).padStart(2, '0')}` : '— / —';
  $('#next-story').textContent = stories.length > 1 ? `A CONTINUACIÓN · ${stories[(state.storyIndex + 1) % stories.length].title}` : stories.length ? 'UNA NOTICIA EN ESTE CANAL' : 'ESPERANDO NOVEDADES';
  $('#previous').disabled = stories.length < 2; $('#next').disabled = stories.length < 2; $('#read-story').disabled = !story;
  if (story) {
    $('#story-kind').textContent = story.kind === 'official' ? 'PUBLICACIÓN OFICIAL' : story.kind === 'analysis' ? 'ANÁLISIS SECTORIAL' : 'NOTICIA DEL SECTOR';
    $('#story-title').textContent = story.title;
    $('#story-excerpt').textContent = story.excerpt || 'Este medio no ofrece un extracto. Abre la fuente para leer la publicación.';
    $('#story-meta').textContent = `${story.source} · ${date(story.publishedAt)}${story.via ? ` · ${story.via}` : ''}`;
    const url = safeUrl(story.url); $('#original-link').hidden = !url; $('#original-link').href = url || '#';
  } else {
    $('#story-kind').textContent = state.data ? 'SIN NOVEDADES RECIENTES' : 'CARGANDO SEÑAL';
    $('#story-title').textContent = state.data ? `Sin noticias en ${channel.name}.` : 'Preparando señal…';
    $('#story-excerpt').textContent = state.data ? `No encontramos publicaciones de este canal en los últimos ${state.days === 1 ? '24 horas' : `${state.days} días`}. Puedes ampliar el período en los controles.` : 'Estamos consultando las fuentes de este canal.';
    $('#story-meta').textContent = ''; $('#original-link').hidden = true;
  }
  $('#play-state').textContent = state.playing ? 'EN EMISIÓN' : 'PAUSADO';
  $('#play-pause').innerHTML = state.playing ? '❚❚ <span>Pausar</span>' : '▶ <span>Reanudar</span>';
  $('#play-pause').setAttribute('aria-label', state.playing ? 'Pausar reproducción' : 'Reanudar reproducción');
  $('#speed').textContent = `${durations[state.durationIndex] / 1000} s`;
  $('#progress-fill').style.width = `${Math.min(100, state.elapsed / durations[state.durationIndex] * 100)}%`;
}
function renderStatus() {
  const sources = state.data?.sources || [];
  const successful = sources.map(source => Date.parse(source.lastSuccessAt)).filter(Number.isFinite);
  const latest = successful.length ? Math.max(...successful) : 0;
  const stale = !latest || Date.now() - latest > 3 * 60 * 60 * 1000;
  const label = !state.data ? 'Consultando fuentes…' : !latest ? 'Sin actualización disponible' : stale ? `Actualización atrasada · última consulta: ${date(latest, true)}` : `Fuentes consultadas: ${date(latest, true)}`;
  $('#update-status').textContent = label; $('#freshness-dot').classList.toggle('stale', !!state.data && stale);
}
function renderSources() {
  const root = $('#sources-list'); root.replaceChildren();
  for (const source of state.data?.sources || []) {
    const card = element('article', 'source-card'); const info = element('div');
    info.append(element('h3', '', source.name), element('p', '', `${source.kind === 'official' ? 'Fuente oficial' : source.kind === 'analysis' ? 'Análisis sectorial' : 'Medio / agregador'} · ${channels.find(ch => ch.id === source.category)?.name || source.category}`));
    const url = safeUrl(source.url); if (url) { const link = element('a', '', 'Visitar sitio ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; info.append(link); }
    const badge = element('span', `source-state${source.status === 'ok' ? '' : ' warning'}`, source.status === 'ok' ? source.recentCount ? `${source.recentCount} recientes` : 'Sin novedades' : 'No disponible');
    badge.title = source.lastSuccessAt ? `Última consulta correcta: ${date(source.lastSuccessAt, true)}` : 'Sin consulta correcta'; card.append(info, badge); root.append(card);
  }
}
function render() { renderChannels(); renderScreen(); renderStatus(); renderSources(); }
function selectChannel(index) { if (index < 0 || index >= channels.length) return; state.channelIndex = index; state.storyIndex = 0; state.elapsed = 0; render(); }
function moveStory(direction) { const stories = channelStories(); if (stories.length < 2) return; state.storyIndex = (state.storyIndex + direction + stories.length) % stories.length; state.elapsed = 0; renderScreen(); }
function togglePlayback() { state.playing = !state.playing; state.lastFrame = performance.now(); renderScreen(); }
function updateClock() { $('#clock').textContent = clockFormat.format(new Date()); $('#screen-date').textContent = date(Date.now()).toUpperCase(); }

function showStory() {
  const story = currentStory(); if (!story) return;
  const url = safeUrl(story.url); if (!url) return;
  state.dialogFocus = document.activeElement;
  $('#dialog-category').textContent = currentChannel().label;
  $('#dialog-title').textContent = story.title;
  $('#dialog-meta').textContent = `${story.source} · ${date(story.publishedAt, true)} · ${story.kind === 'official' ? 'Publicación oficial' : story.kind === 'analysis' ? 'Análisis sectorial' : 'Noticia'} · ${story.language === 'en' ? 'Inglés' : 'Español'}`;
  $('#dialog-excerpt').textContent = story.excerpt || 'No hay un extracto disponible. Puedes leer la publicación en la fuente original.';
  $('#dialog-link').href = url; $('#dialog-via').textContent = story.via || '';
  $('#story-dialog').showModal(); $('#close-story').focus();
}
function showSources() { state.dialogFocus = document.activeElement; $('#sources-dialog').showModal(); $('#close-sources').focus(); }
function closeDialog(dialog) { dialog.close(); }
function onDialogClose() { state.dialogFocus?.focus(); state.lastFrame = performance.now(); }

async function loadNews() {
  try {
    const response = await fetch('./data/news.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(); if (!Array.isArray(data.stories) || !Array.isArray(data.sources)) throw new Error('Edición inválida');
    const oldId = currentStory()?.id; state.data = data;
    const found = channelStories().findIndex(story => story.id === oldId); state.storyIndex = found < 0 ? 0 : found;
    render();
  } catch {
    if (!state.data) { state.data = { stories: [], sources: [] }; render(); }
    $('#update-status').textContent = 'No se pudo cargar la edición. Inténtalo de nuevo más tarde.'; $('#freshness-dot').classList.add('stale');
  }
}
function tick(now) {
  if (state.playing && channelStories().length > 1 && !document.hidden && !$('#story-dialog').open && !$('#sources-dialog').open) {
    state.elapsed += Math.min(1000, now - (state.lastFrame || now));
    if (state.elapsed >= durations[state.durationIndex]) moveStory(1);
    else $('#progress-fill').style.width = `${state.elapsed / durations[state.durationIndex] * 100}%`;
  }
  state.lastFrame = now; requestAnimationFrame(tick);
}

$('#previous').addEventListener('click', () => moveStory(-1)); $('#next').addEventListener('click', () => moveStory(1));
$('#play-pause').addEventListener('click', togglePlayback);
$('#speed').addEventListener('click', () => { state.durationIndex = (state.durationIndex + 1) % durations.length; state.elapsed = 0; renderScreen(); });
$('#period').addEventListener('change', event => { state.days = Number(event.target.value); state.storyIndex = 0; state.elapsed = 0; render(); });
$('#read-story').addEventListener('click', showStory);
$('#open-sources').addEventListener('click', showSources);
$('#close-story').addEventListener('click', () => closeDialog($('#story-dialog')));
$('#close-sources').addEventListener('click', () => closeDialog($('#sources-dialog')));
$('#story-dialog').addEventListener('close', onDialogClose); $('#sources-dialog').addEventListener('close', onDialogClose);
for (const dialog of [$('#story-dialog'), $('#sources-dialog')]) dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(dialog); });
$('#fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('.tv-case').requestFullscreen(); }
  catch { $('#update-status').textContent = 'La pantalla completa no está disponible en este navegador.'; }
});
document.addEventListener('fullscreenchange', () => { $('#fullscreen').textContent = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa'; });
document.addEventListener('keydown', event => {
  if ($('#story-dialog').open || $('#sources-dialog').open || event.altKey || event.ctrlKey || event.metaKey) return;
  const interactive = event.target.closest?.('button,select,input,a');
  if (/^[1-5]$/.test(event.key) && !interactive) { selectChannel(Number(event.key) - 1); return; }
  if (interactive) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); moveStory(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); moveStory(1); }
  if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
});

render(); updateClock(); loadNews(); requestAnimationFrame(tick);
setInterval(updateClock, 30_000); setInterval(loadNews, 10 * 60_000);
