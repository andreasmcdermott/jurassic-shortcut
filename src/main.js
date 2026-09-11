import './style.css';
import { createDemo, AGE_COLORS, AGE_LABELS, ANTENNA_STATUSES } from './data.js';
import { World } from './world.js';
import { Loader, api } from './loader.js';
import { workspaceShortcut } from './navigation.js';

const $ = s => document.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ws = createDemo();
let directory = 'root', selected = null, history = [], marks = [], page = 0, retro = false;
const PAGE_SIZE = 64;
let live = null;
let updateTimer = null;
let cacheLastSavedAt = 0;

$('#app').innerHTML = `
  <header class="desktop">
    <div class="workstation"><div class="sgi-mark" aria-hidden="true">▧</div><div><div class="machine-name">SHORTCUT<span> / </span>fsn</div><div class="machine-sub">Workspace navigation system</div></div></div>
    <div class="desktop-note">“It's a UNIX system. I know this.”<span>ISLA NUBLAR · SYSTEM ONLINE</span></div>
    <section class="overview-window"><div class="titlebar small"><span class="window-dot">▰</span><i>overview</i><span class="stretch"></span><span>◇</span></div><div id="overview"></div></section>
  </header>
  <main class="window">
    <div class="titlebar"><span class="window-dot">▰</span><i>fsn</i><span class="window-title">a 3D Shortcut navigator</span><span class="stretch"></span><span class="session-label" id="session-label">DEMO WORKSPACE</span><span class="title-box">◇</span></div>
    <nav class="menubar" aria-label="Application menu"><button id="session-menu">Session</button><button id="show-menu">Show</button><button id="display-menu">Display</button><button id="directory-menu">Directory</button><span class="stretch"></span><button class="connect-button" id="connect">Connect Shortcut…</button><button id="help">Help</button></nav>
    <div class="workspace">
      <aside class="sidebar">
        <div class="nav-buttons"><button id="reset">reset <kbd>Alt+R</kbd></button><button id="back">go back <kbd>Alt+B</kbd></button><button id="birds-eye">bird's eye</button><button id="front-view">front view</button></div>
        <div class="sliders"><label>Tilt<input id="tilt" type="range" min="0" max="100" value="42" aria-label="Camera tilt"></label><label>Height<input id="height" type="range" min="1" max="100" value="45" aria-label="Camera height"></label></div>
        <section class="directory-section"><label class="section-label" for="search">Find</label><div class="search-row"><input id="search" type="search" placeholder="Name or #ID" autocomplete="off"><kbd>/</kbd></div><div class="list-heading" id="list-heading">Directory</div><div class="directory-list inset" id="directory-list" aria-label="Directory contents"></div></section>
        <section class="marks-section"><div class="section-label">Marks <span id="mark-count">0</span></div><div class="inset marks" id="marks"><span class="muted">No locations marked.</span></div><button id="mark" disabled>mark selection</button></section>
        <button id="home" class="home-button">⌂ workspace root</button>
      </aside>
      <section class="navigator">
        <div class="cache-bar" id="cache-bar" hidden><span id="cache-status">Local cache</span><button id="refresh-data">Refresh from Shortcut</button></div>
        <div class="navigator-heading"><b>Fsn: a 3D Workspace Navigator</b><span id="entity-count"></span></div>
        <div class="pathbar" id="path" aria-label="Current path"></div>
        <div class="file-info" id="file-info">drwxr-xr-x &nbsp; 4 objectives, 16 epics, 144 stories</div>
        <div class="scene-wrap"><div id="scene"></div><div class="scene-tag" id="scene-tag">/isla_nublar</div><div class="scene-help">DRAG orbit <span>·</span> SCROLL zoom <span>·</span> DOUBLE-CLICK enter <span>·</span> ARROWS select <span>·</span> F fly</div><div class="page-controls" id="page-controls" hidden><button id="previous-page">←</button><span id="page-label"></span><button id="next-page">→</button></div><div class="empty-scene" id="empty-scene" hidden></div></div>
        <div class="antenna-legend"><b>antennas:</b>${ANTENNA_STATUSES.map(({ label, color }) => `<span><i style="background:${color}" aria-hidden="true"></i>${label}</span>`).join('')}<small>height = relative count per platform</small></div>
        <div class="legend"><b>ages:</b>${AGE_LABELS.map((label, i) => `<span style="background:${AGE_COLORS[i]}">${label}</span>`).join('')}<span class="legend-note">color = last updated</span><label class="retro-label"><input type="checkbox" id="retro"> 1993 pixels</label></div>
      </section>
      <aside class="inspector" id="inspector"><div class="inspector-heading">Object information</div><div id="details"></div></aside>
    </div>
    <footer class="statusbar"><span class="status-light"></span><span id="status" role="status">Demo loaded. Select an object to inspect it.</span><span class="stretch"></span><span id="status-count">READ ONLY</span><span class="resize-grip">▨</span></footer>
  </main>
  <footer class="desktop-footer"><span>SILICON GRAPHICS INSPIRED <span class="footer-dot">·</span> EST. 1993 / REBUILT 2026</span><span>Connection established. Hold on to your butts.</span></footer>
  <dialog id="connect-dialog"><form id="connect-form"><div class="titlebar"><i id="connect-title">Connect to Shortcut</i><span class="stretch"></span><button type="button" data-close="connect-dialog" aria-label="Close">×</button></div><div class="dialog-body" id="connect-fields"><h2>Your workspace, in three dimensions.</h2><p>Enter a Shortcut API token to explore your objectives, epics, stories, and tasks.</p><label for="token">API token</label><input id="token" type="password" required autocomplete="off" spellcheck="false" placeholder="Paste your Shortcut token"><p class="small-copy">The local server keeps your token in memory for this session. Nothing is written to browser storage or sent anywhere except Shortcut. Workspace data is cached on this computer. This navigator only reads Shortcut data.</p><a href="https://app.shortcut.com/settings/account/api-tokens" target="_blank" rel="noreferrer">Create a token in Shortcut ↗</a><p id="connect-error" class="error" role="alert"></p><div class="dialog-actions"><button type="button" data-close="connect-dialog">Cancel</button><button type="submit" id="connect-submit">Connect workspace</button></div></div>
    <section id="nedry-screen" class="nedry-screen" hidden aria-labelledby="nedry-message">
      <div class="nedry-terminal">
        <div class="nedry-log" aria-hidden="true">ACCESS MAIN PROGRAM<br>ACCESS SECURITY<br>ACCESS MAIN PROGRAM GRID</div>
        <div class="nedry-denied">PERMISSION DENIED</div>
        <div class="nedry-portrait" role="img" aria-label="Dennis Nedry wagging his finger"></div>
        <h2 id="nedry-message" tabindex="-1" aria-describedby="nedry-reason">Ah ah ah!<br>You didn't say the magic word!</h2>
        <p id="nedry-reason" class="nedry-explanation">Shortcut rejected that API token.</p>
      </div>
      <div class="dialog-actions"><button type="button" data-close="connect-dialog">Cancel</button><button type="button" id="nedry-retry">Try another token</button></div>
    </section>
  </form></dialog>
  <dialog id="help-dialog"><div class="titlebar"><i>Navigator help</i><span class="stretch"></span><button data-close="help-dialog" aria-label="Close">×</button></div><div class="dialog-body"><h2>Welcome to the control room.</h2><p>Inspired by <b>fsn</b>, Silicon Graphics' 3D File System Navigator, seen in Jurassic Park.</p><dl class="help-keys"><dt>Click</dt><dd>Select and inspect</dd><dt>Double-click</dt><dd>Enter a directory or story</dd><dt>Drag / right-drag</dt><dd>Orbit / pan the camera</dd><dt>Scroll / pinch</dt><dd>Move closer or farther</dd><dt>Arrow keys</dt><dd>Select nearby siblings in screen directions</dd><dt>F</dt><dd>Fly to the selected object</dd><dt>Enter</dt><dd>Open selection while the 3D view is focused</dd><dt>W A S D</dt><dd>Fly while the 3D view is focused</dd><dt>Q / E</dt><dd>Descend / ascend</dd><dt>Alt+B / Alt+R</dt><dd>Go back / reset view</dd><dt>/</dt><dd>Search loaded objects</dd></dl><p>Platforms are directories. Towers identify objectives and epics. Blocks are their contents. A beam marks your selection. Block color shows age; story height reflects its estimate.</p><p>The three antennas count direct contents: blue for unstarted, amber for in progress, green for completed. Objectives count epics; epics count stories. Heights are proportional within each platform, with the largest count at full height. A bare socket means zero loaded items in that status. Select a platform for exact counts, including items beyond its preview.</p><p>Use the directory list to navigate with a keyboard. Select an object, then choose <b>Enter directory</b> or <b>Fly to object</b>.</p><div class="dialog-actions"><button data-close="help-dialog">Got it</button></div></div></dialog>
`;

let world;
try { world = new World($('#scene'), $('#overview'), select, open); }
catch { $('#scene').innerHTML = '<div class="webgl-error">WebGL could not start. Enable hardware acceleration or try another browser. You can still explore through the directory list.</div>'; }

function status(text) { $('#status').textContent = text; }
function visibleChildren() { return ws.children(directory).filter(node => !node.archived); }
function render(reset = true) {
  const node = ws.get(directory) || ws.root; directory = node.key;
  const children = visibleChildren(); page = Math.min(page, Math.max(0, Math.ceil(children.length / PAGE_SIZE) - 1));
  world?.setDirectory(ws, node, children.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), reset);
  if (selected) world?.select(selected);
  $('#path').innerHTML = ws.path(directory).map(n => `<button data-path="${escape(n.key)}">/${escape(n.name.toLowerCase().replaceAll(' ', '_'))}</button>`).join('');
  $('#scene-tag').textContent = `${node.kind.toUpperCase()} / ${node.name}`;
  $('#file-info').textContent = `drwxr-xr-x   ${children.length} objects${node.kind === 'epic' && !node.loaded ? ' · stories still loading' : ''}`;
  $('#entity-count').textContent = `${children.length} objects`;
  $('#back').disabled = !history.length;
  $('#mark').disabled = !selected;
  $('#page-controls').hidden = children.length <= PAGE_SIZE;
  $('#page-label').textContent = `${page + 1} / ${Math.max(1, Math.ceil(children.length / PAGE_SIZE))}`;
  $('#previous-page').disabled = page === 0; $('#next-page').disabled = (page + 1) * PAGE_SIZE >= children.length;
  $('#empty-scene').hidden = !!children.length;
  $('#empty-scene').textContent = node.loading ? 'Reading directory…' : node.loadError ? 'Directory could not load. Select it and retry.' : 'This directory is empty.';
  renderList(); renderDetails();
}
function renderList() {
  const term = $('#search').value.trim().toLowerCase().replace(/^#/, '');
  const nodes = term ? [...ws.nodes.values()].filter(n => !['workspace', 'folder'].includes(n.kind) && `${n.name} ${n.id}`.toLowerCase().includes(term) && !n.archived) : visibleChildren();
  $('#list-heading').textContent = term ? `${nodes.length} matches in loaded data` : `Directory · ${nodes.length}`;
  $('#directory-list').innerHTML = nodes.slice(0, 200).map(n => `<button class="directory-item ${selected === n.key ? 'selected' : ''}" data-select="${escape(n.key)}" title="${escape(n.name)}"><span class="file-icon ${n.kind}">${['objective', 'epic', 'folder'].includes(n.kind) ? '▰' : '▤'}</span><span>${escape(n.name)}</span></button>`).join('') || '<span class="list-empty">No objects found.</span>';
}
function antennaDetails(node) {
  if (node.kind === 'task') return '';
  const { counts, total, partial, unit } = ws.antennaSummary(node.key);
  return `<section class="antenna-counts"><b>Antenna counts · ${unit}</b><dl>${ANTENNA_STATUSES.map(({ key, label, color }) => `<div><dt><i style="background:${color}" aria-hidden="true"></i>${label}</dt><dd>${counts[key]}</dd></div>`).join('')}${counts.unknown ? `<div><dt>Status unknown</dt><dd>${counts.unknown}</dd></div>` : ''}</dl><p>${total} loaded, non-archived ${unit}.${partial ? ' Counts are partial until this directory loads.' : ''} Heights compare statuses within this platform.</p></section>`;
}
function renderDetails() {
  const node = ws.get(selected);
  if (!node) {
    const counts = ws.counts();
    $('#details').innerHTML = `<div class="inspector-art" aria-hidden="true">▧</div><div class="eyebrow">${live ? 'CONNECTED WORKSPACE' : 'DEMONSTRATION'}</div><h1>${escape(ws.root.name)}</h1><p class="intro-copy">Select an object in the landscape to inspect it.</p><dl class="workspace-counts">${Object.entries(counts).map(([key, count]) => `<div><dt>${key === 'story' ? 'Stories' : key.charAt(0).toUpperCase() + key.slice(1) + 's'}</dt><dd>${count}</dd></div>`).join('')}</dl><div class="inspector-note"><b>Follow the hierarchy</b><p>Objectives → epics → stories → tasks</p><p>Double-click a platform to enter. Use bird's eye to get your bearings.</p></div>${live ? '<button id="disconnect">Disconnect & return to demo</button>' : '<div class="demo-note">Fictional park data.<br>Connect Shortcut to load your workspace.</div>'}`;
    return;
  }
  const state = node.complete || node.completed ? 'Done' : ws.states.get(node.workflow_state_id)?.name || node.state || (node.started ? 'In progress' : 'Unstarted');
  const owners = (node.owner_ids || []).map(id => ws.members.get(id) || 'Unknown member').join(', ');
  const tasks = ws.children(node.key).filter(n => n.kind === 'task');
  $('#details').innerHTML = `<div class="object-type"><span class="file-icon ${node.kind}">▤</span>${escape(node.kind)} <span>#${escape(node.id)}</span></div><h1>${escape(node.name)}</h1><div class="object-state">${escape(state)}</div><dl class="metadata">${owners ? `<dt>Owner</dt><dd>${escape(owners)}</dd>` : ''}${node.estimate != null ? `<dt>Estimate</dt><dd>${node.estimate} points</dd>` : ''}${node.story_type ? `<dt>Type</dt><dd>${escape(node.story_type)}</dd>` : ''}<dt>Contents</dt><dd>${node.children.length} objects${!node.loaded && ['story', 'epic'].includes(node.kind) ? ' · partial' : ''}</dd>${node.updated_at ? `<dt>Modified</dt><dd>${new Date(node.updated_at).toLocaleDateString()}</dd>` : ''}</dl><div class="object-actions">${node.kind !== 'task' ? `<button id="enter">Enter directory →</button>` : ''}<button id="fly" aria-keyshortcuts="F">Fly to object <kbd>F</kbd></button>${safeShortcutUrl(node.app_url) ? `<a class="button" href="${escape(node.app_url)}" target="_blank" rel="noreferrer">Open in Shortcut ↗</a>` : ''}${node.loadError ? '<button id="retry">Retry loading</button>' : ''}</div>${node.loading ? '<p class="loading-copy">Reading from Shortcut…</p>' : ''}${node.loadError ? `<p class="error">${escape(node.loadError)}</p>` : ''}${antennaDetails(node)}<div class="description">${escape(node.description || 'No description.').replaceAll('\n', '<br>')}</div>${tasks.length ? `<div class="task-heading">Tasks · ${tasks.filter(t => t.complete).length}/${tasks.length}</div><div class="task-list">${tasks.map(t => `<button data-select="${escape(t.key)}"><span>${t.complete ? '☑' : '☐'}</span>${escape(t.name)}</button>`).join('')}</div>` : ''}`;
  $('#enter')?.addEventListener('click', () => open(node.key));
  $('#fly')?.addEventListener('click', () => locate(node.key));
  $('#retry')?.addEventListener('click', () => hydrate(node.key));
}
function safeShortcutUrl(url) { try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.hostname === 'app.shortcut.com'; } catch { return false; } }
function select(key, occurrenceId) {
  selected = key; world?.select(key, false, occurrenceId); $('#mark').disabled = false; renderList(); renderDetails();
  const node = ws.get(key); if (node) { $('#file-info').textContent = `${node.kind} #${node.id}   ${node.name}`; status(`Selected ${node.kind} #${node.id}. Double-click to enter.`); }
  if (live && node?.kind === 'story' && !node.loaded) hydrate(key);
}
function open(key) {
  const node = ws.get(key); if (!node) return;
  if (node.kind === 'task') { select(key); return; }
  if (key !== directory) history.push(directory);
  directory = key; page = 0; selected = null; $('#search').value = ''; $('#mark').disabled = true;
  render(); status(`Opened /${node.name.toLowerCase().replaceAll(' ', '_')}`);
  if (live) hydrate(key);
}
function locate(key) {
  let parent = ws.get(key)?.parents?.[0];
  if (!world?.positions.has(key) && parent) {
    open(parent); const index = visibleChildren().findIndex(n => n.key === key); page = Math.max(0, Math.floor(index / PAGE_SIZE)); render();
  }
  select(key); world?.select(key, true);
}
async function hydrate(key) { if (live) await live.hydrate(key); }
function renderMarks() {
  $('#mark-count').textContent = marks.length;
  $('#marks').innerHTML = marks.length ? marks.map(key => `<div><button data-locate="${escape(key)}">${escape(ws.get(key)?.name)}</button><button data-unmark="${escape(key)}" aria-label="Remove mark">×</button></div>`).join('') : '<span class="muted">No locations marked.</span>';
}
$('#app').addEventListener('click', e => {
  const item = e.target.closest('[data-select]'); if (item) select(item.dataset.select);
  const path = e.target.closest('[data-path]'); if (path) open(path.dataset.path);
  const mark = e.target.closest('[data-locate]'); if (mark) locate(mark.dataset.locate);
  const remove = e.target.closest('[data-unmark]'); if (remove) { marks = marks.filter(k => k !== remove.dataset.unmark); renderMarks(); }
  const close = e.target.closest('[data-close]'); if (close) $(`#${close.dataset.close}`).close();
  if (e.target.closest('#disconnect')) disconnect();
});
$('#directory-list').addEventListener('dblclick', e => { const item = e.target.closest('[data-select]'); if (item) open(item.dataset.select); });
$('#directory-list').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.select) { e.preventDefault(); open(e.target.dataset.select); } });
$('#reset').onclick = () => world?.home();
$('#back').onclick = () => { if (history.length) { directory = history.pop(); page = 0; selected = null; $('#search').value = ''; render(); } };
$('#birds-eye').onclick = () => world?.view('bird');
$('#front-view').onclick = () => world?.view('front');
$('#home').onclick = $('#show-menu').onclick = () => open('root');
$('#directory-menu').onclick = () => open(ws.get(directory)?.parents?.[0] || 'root');
$('#tilt').oninput = e => world?.tilt(e.target.value);
$('#height').oninput = e => world?.height(e.target.value);
$('#search').oninput = renderList;
$('#mark').onclick = () => { if (selected && !marks.includes(selected)) { marks.push(selected); renderMarks(); status('Location marked for this session.'); } };
$('#retro').onchange = e => { retro = e.target.checked; world?.setRetro(retro); $('.scene-wrap').classList.toggle('retro', retro); };
$('#display-menu').onclick = () => { $('#retro').checked = !retro; $('#retro').dispatchEvent(new Event('change')); };
$('#connect').onclick = $('#session-menu').onclick = () => { $('#connect-error').textContent = ''; $('#connect-dialog').showModal(); };
$('#help').onclick = () => $('#help-dialog').showModal();
$('#previous-page').onclick = () => { page--; render(); };
$('#next-page').onclick = () => { page++; render(); };
window.addEventListener('keydown', e => {
  const dialogOpen = !!document.querySelector('dialog[open]');
  const shortcut = workspaceShortcut(e, dialogOpen);
  if (shortcut === 'select' && world) {
    e.preventDefault();
    const current = ws.get(selected);
    const inScene = current && world.positions.has(current.key);
    const candidates = inScene
      ? [...world.positions.keys()].filter(key => ws.get(key)?.parents?.some(parent => current.parents?.includes(parent)))
      : visibleChildren().map(node => node.key);
    const next = world.neighbor(selected, e.key, candidates);
    if (next) {
      select(next);
      world.renderer.domElement.focus({ preventScroll: true });
    }
    return;
  }
  if (shortcut === 'fly') {
    e.preventDefault();
    if (selected && !e.repeat) {
      locate(selected);
      world?.renderer.domElement.focus({ preventScroll: true });
    }
    return;
  }
  if (e.defaultPrevented || dialogOpen || e.target.closest('input, textarea, select, dialog, [contenteditable]:not([contenteditable="false"])')) return;
  if (e.key === 'Enter' && e.target === world?.renderer.domElement && selected && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault(); if (!e.repeat) open(selected); return;
  }
  if (e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); world?.home(); }
  if (e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); $('#back').click(); }
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
});
$('#connect-form').onsubmit = async e => { e.preventDefault(); await connect(); };
function showCacheStatus(info) {
  if (info.state === 'unavailable') {
    $('#cache-status').textContent = 'Local cache unavailable · live loading still works';
    return;
  }
  cacheLastSavedAt = Math.max(cacheLastSavedAt, info.savedAt || 0);
  $('#cache-status').textContent = cacheLastSavedAt
    ? `Local cache · last saved ${new Date(cacheLastSavedAt).toLocaleString()} · refresh for latest`
    : 'Local cache enabled · saving as data loads';
}
$('#refresh-data').onclick = async () => {
  if (!live) return;
  const previous = live;
  $('#refresh-data').disabled = true;
  previous.stop(); status('Clearing the local cache and fetching current Shortcut data…');
  try {
    await api('cache', { method: 'DELETE' });
    if (live === previous) startSession(previous.member);
  } catch (error) {
    if (live === previous) { startSession(previous.member); status(error.message); }
  } finally { $('#refresh-data').disabled = false; }
};
function startSession(member) {
  live?.stop(); clearTimeout(updateTimer);
  cacheLastSavedAt = 0;
  let framed = false;
  $('#cache-bar').hidden = false;
  $('#cache-status').textContent = 'Restoring local cache…';
  live = new Loader(member, next => {
    ws = next;
    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      const frame = !framed && ws.children(directory).length > 0;
      render(frame); if (frame) framed = true;
    }, 140);
  }, status, showCacheStatus);
  ws = live.ws; directory = 'root'; selected = null; history = []; page = 0; marks = [];
  $('#search').value = ''; renderMarks();
  $('#session-label').textContent = 'SHORTCUT CONNECTED';
  $('#connect').textContent = 'Change workspace…';
  $('.desktop-note span').textContent = 'SHORTCUT · SESSION CONNECTED';
  render(); live.start();
}
function resetTokenError() {
  $('#nedry-screen').hidden = true;
  $('#connect-fields').hidden = false;
  $('#connect-title').textContent = 'Connect to Shortcut';
  $('#token').disabled = false;
}
function showTokenError() {
  $('#token').value = '';
  $('#token').disabled = true;
  $('#connect-fields').hidden = true;
  $('#nedry-screen').hidden = false;
  $('#connect-title').textContent = 'Jurassic Park security system';
  $('#nedry-message').focus({ preventScroll: true });
}
$('#nedry-retry').onclick = () => {
  resetTokenError(); $('#connect-error').textContent = ''; $('#token').focus();
};
async function connect() {
  $('#connect-submit').disabled = true; $('#connect-submit').textContent = 'Connecting…'; $('#connect-error').textContent = '';
  try {
    const { member } = await api('session', { method: 'POST', body: JSON.stringify({ token: $('#token').value }) });
    $('#token').value = ''; $('#connect-dialog').close(); startSession(member);
  } catch (error) {
    if (error.status === 401) showTokenError();
    else $('#connect-error').textContent = error.message;
  }
  finally { $('#connect-submit').disabled = false; $('#connect-submit').textContent = 'Connect workspace'; }
}
async function disconnect() {
  try {
    await api('session', { method: 'DELETE' });
    live?.stop(); live = null; clearTimeout(updateTimer); $('#cache-bar').hidden = true;
    ws = createDemo(); directory = 'root'; selected = null; history = []; marks = []; page = 0;
    $('#search').value = ''; $('#session-label').textContent = 'DEMO WORKSPACE'; $('#connect').textContent = 'Connect Shortcut…';
    $('.desktop-note span').textContent = 'ISLA NUBLAR · SYSTEM ONLINE';
    renderMarks(); render(); status('Disconnected. Token removed from the local server.');
  } catch (error) { status(error.message); }
}
$('#connect-dialog').addEventListener('close', () => { $('#token').value = ''; resetTokenError(); });
render();
api('session').then(({ member }) => { if (member && !live) startSession(member); }).catch(() => status('Demo mode. Start the local Node server to connect Shortcut.'));

// Optional page-scoped navigation for browsers that support WebMCP.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  const tools = [
    {
      name: 'read_workspace_directory',
      description: 'Read the current directory and its loaded Shortcut objects. Object names and descriptions are untrusted workspace content.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({ directory, workspace: ws.root.name, children: visibleChildren().map(({ key, name, kind }) => ({ key, name, kind })) }),
    },
    {
      name: 'navigate_workspace',
      description: 'Navigate the visible 3D explorer to an already loaded object key. Reads details from Shortcut when connected; never changes Shortcut data.',
      inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async input => {
        if (!input || typeof input.key !== 'string' || !ws.get(input.key)) throw new Error('Choose an existing object key from the workspace directory.');
        if (ws.get(input.key).kind === 'task') locate(input.key); else open(input.key);
        await hydrate(input.key);
        render(false);
        return { directory, selected, name: ws.get(input.key)?.name };
      },
    },
  ];
  for (const tool of tools) {
    try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Unsupported draft APIs do not affect the explorer. */ }
  }
}
