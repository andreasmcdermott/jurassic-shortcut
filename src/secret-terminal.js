import { attachTerminalWindow } from './terminal-window.js';
import { statusBucket } from './data.js';

const MOVIE_COMMANDS = ['access main program', 'access security', 'access main program grid'];
const PAGE_SIZE = 40;
const HELP = [
  'WORKSPACE COMMANDS (read only)',
  '  ls [object] [--page N]  List non-archived children',
  '  cd <object>            Open a directory in the 3D view',
  '  cd .. / cd /           Parent directory / workspace root',
  '  pwd                    Current directory',
  '  find <text> [--page N]  Search loaded names and IDs',
  '  show [object]          Details and story checklist tasks',
  '  select <object>        Select in the navigator and return',
  '  fly <object>           Fly to an object and return',
  '  link [object]          Link to the object in Shortcut',
  '  counts                 Loaded, non-archived workspace totals',
  '  help / clear / exit',
  '',
  'Use an object key from ls/find, e.g. epic:100 or story:1000.',
  'An exact name or unique ID also works. Quotes are optional.',
  'Show/link default to the current selection or directory.',
  'Search covers loaded data; epic lists and story details load on demand.',
];
const unquote = value => /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
const safeLink = url => { try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.hostname === 'app.shortcut.com' ? parsed.href : null; } catch { return null; } };

export class ParkTerminal {
  constructor(actions = {}) { this.actions = actions; this.movieStep = 0; this.locked = false; }
  async command(raw, { signal } = {}) {
    const text = String(raw).slice(0, 240).trim();
    const normalized = text.toLowerCase().replace(/\s+/g, ' ');
    if (!text) return { lines: [] };
    if (normalized === 'exit') return { action: 'exit', lines: [] };
    if (this.locked) return { locked: true, lines: [] };
    if (MOVIE_COMMANDS.includes(normalized)) {
      this.movieStep = normalized === MOVIE_COMMANDS[this.movieStep] ? this.movieStep + 1 : normalized === MOVIE_COMMANDS[0] ? 1 : 0;
      this.locked = this.movieStep === MOVIE_COMMANDS.length;
      return { locked: this.locked, lines: [this.locked ? 'PERMISSION DENIED.' : 'ACCESS DENIED.'] };
    }
    if (normalized === 'clear') return { action: 'clear', lines: [] };
    if (normalized === 'help') return { lines: HELP };
    const [, verb, rest = ''] = text.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    const command = verb.toLowerCase();
    if (!['ls', 'cd', 'pwd', 'find', 'show', 'inspect', 'select', 'fly', 'link', 'counts'].includes(command)) {
      return { lines: [`Unknown command: ${verb}. Type HELP for workspace commands.`] };
    }
    const context = this.actions.getContext?.();
    if (!context?.workspace) return { lines: ['No workspace is available.'] };
    const ws = context.workspace;
    const current = ws.get(context.directory) || ws.root;
    const ensureCurrent = () => {
      signal?.throwIfAborted();
      if (this.actions.getContext().workspace !== ws) throw new Error('Workspace changed. Run the command again in the new workspace.');
    };
    const resolve = (value, fallback = current.key) => {
      const ref = unquote(value.trim()) || fallback;
      if (ref === '/' || ref === 'root') return ws.root;
      if (ref === '.') return current;
      if (ref === '..') return ws.get(current.parents?.[0]) || ws.root;
      const direct = ws.get(ref.toLowerCase());
      if (direct && !direct.archived) return direct;
      const matches = [...ws.nodes.values()].filter(n => !n.archived && (String(n.id) === ref.replace(/^#/, '') || n.name.toLowerCase() === ref.toLowerCase()));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw new Error(`Ambiguous object. Use a key: ${matches.slice(0, 8).map(n => n.key).join(', ')}`);
      throw new Error(`Object not found in loaded data: ${ref}. Try FIND or LS.`);
    };
    const hydrate = async node => {
      await this.actions.hydrate?.(node.key);
      ensureCurrent();
      const loaded = ws.get(node.key);
      if (loaded?.loadError) throw new Error(loaded.loadError);
      return loaded || node;
    };
    const row = node => `${node.key.padEnd(18)} ${node.name}  [${statusBucket(node, ws.states)}]`;
    const path = node => '/' + ws.path(node.key).map(n => n.name).join('/');
    const pageArgs = () => {
      const match = rest.match(/(?:^|\s)--page\s+(\d+)$/);
      const page = match ? Number(match[1]) : 1;
      if (!Number.isSafeInteger(page) || page < 1 || (rest.includes('--page') && !match)) throw new Error('Use --page followed by a positive page number.');
      return { page, argument: unquote(match ? rest.slice(0, match.index).trim() : rest.trim()) };
    };
    const listing = (nodes, page, heading) => {
      const pages = Math.max(1, Math.ceil(nodes.length / PAGE_SIZE));
      if (page > pages) throw new Error(`There are ${pages} pages. Use --page 1 through --page ${pages}.`);
      return { lines: [heading, ...nodes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(row), `${nodes.length} objects · page ${page}/${pages}${pages > page ? ` · use --page ${page + 1} for more` : ''}`] };
    };
    try {
      if (command === 'pwd') return { lines: [path(current), current.key] };
      if (command === 'counts') return { lines: ['LOADED, NON-ARCHIVED TOTALS', ...Object.entries(ws.counts()).map(([kind, count]) => `${kind.padEnd(12)} ${count}`)] };
      if (command === 'find') {
        const { page, argument } = pageArgs();
        if (!argument) throw new Error('Usage: find <name or ID> [--page N]');
        const query = argument.toLowerCase().replace(/^#/, '');
        return listing([...ws.nodes.values()].filter(n => !n.archived && !['workspace', 'folder'].includes(n.kind) && `${n.name} ${n.id}`.toLowerCase().includes(query)), page, 'MATCHES IN LOADED DATA');
      }
      if (command === 'ls') {
        const { page, argument } = pageArgs();
        const node = await hydrate(resolve(argument));
        return listing(ws.children(node.key).filter(n => !n.archived), page, `${path(node)}${!node.loaded && ['epic', 'story'].includes(node.kind) ? ' (partially loaded)' : ''}`);
      }
      if (command === 'cd') {
        const node = await hydrate(resolve(rest || '/'));
        if (node.kind === 'task') throw new Error('Checklist tasks have no directory. Use SHOW or SELECT.');
        this.actions.navigate(node.key);
        return { lines: [path(node), `${node.key} · 3D directory updated.`] };
      }
      const node = await hydrate(resolve(rest, context.selected || current.key));
      if (command === 'fly' || command === 'select') {
        this.actions[command](node.key);
        return { action: 'exit', lines: [`${command === 'fly' ? 'Flying to' : 'Selected'} ${node.name}.`] };
      }
      if (command === 'link') {
        const url = safeLink(node.app_url);
        return url ? { lines: [node.name], link: url } : { lines: ['This object has no Shortcut link. Demo objects are fictional.'] };
      }
      const description = String(node.description || 'No description.').split('\n');
      const children = ws.children(node.key).filter(n => !n.archived);
      const owners = (node.owner_ids || []).map(id => ws.members.get(id) || 'Unknown member').join(', ');
      return { lines: [row(node), `Directory: ${path(node)}`, ...(owners ? [`Owners: ${owners}`] : []), ...(node.estimate != null ? [`Estimate: ${node.estimate}`] : []),
        `${children.length} loaded children${!node.loaded && ['epic', 'story'].includes(node.kind) ? ' (partial)' : ''}`, '', ...description.slice(0, 35), ...(description.length > 35 ? ['[Description truncated. Use LINK for the full story.]'] : []),
        ...(node.kind === 'story' ? ['', 'CHECKLIST TASKS', ...children.slice(0, 30).map(n => `${n.complete ? '[x]' : '[ ]'} ${n.key}  ${n.name}`), ...(children.length > 30 ? ['Use LS to page through all tasks.'] : [])] : [])] };
    } catch (error) { return { lines: [error.message || 'Command failed. Please retry.'] }; }
  }
}

export function installSecretTerminal({ getCanvas, stopMovement, actions, document: doc = document, window: win = window }) {
  const dialog = doc.createElement('dialog');
  dialog.id = 'secret-terminal';
  dialog.setAttribute('aria-labelledby', 'secret-terminal-title');
  dialog.innerHTML = `
    <div class="titlebar" tabindex="0" aria-label="Move terminal with arrow keys; drag to move; double-click to reset position" title="Drag to move · Double-click to reset"><i id="secret-terminal-title">IRIX console / Shortcut workspace</i><span class="stretch"></span><button type="button" data-terminal-close aria-label="Close terminal">×</button></div>
    <div class="park-console">
      <div class="park-console-heading">JURASSIC PARK<br><span>SHORTCUT WORKSPACE TERMINAL · READ ONLY</span></div>
      <div class="park-console-output" role="log" aria-label="Terminal output" aria-live="polite" aria-relevant="additions"></div>
      <form class="park-console-prompt" autocomplete="off"><label for="park-command" aria-label="Command">&gt;</label><input id="park-command" aria-label="Terminal command" type="text" maxlength="240" spellcheck="false" autocomplete="off" autocapitalize="off"><button type="submit">Enter</button></form>
      <section class="park-console-lock" hidden aria-labelledby="park-magic-word">
        <div class="nedry-portrait" role="img" aria-label="Dennis Nedry wagging his finger"></div>
        <h2 id="park-magic-word" tabindex="-1">Ah ah ah!<br>You didn't say the magic word!</h2>
        <button type="button" data-terminal-retry>Return to terminal</button>
      </section>
      <div class="park-console-footer"><span>WORKSPACE CONSOLE / READ ONLY</span><span>ESC to return</span></div>
    </div><button type="button" data-terminal-resize class="terminal-resize" aria-label="Resize terminal with arrow keys or drag" title="Drag to resize · Arrow keys resize when focused">▨</button>`;
  doc.querySelector('#app').append(dialog);
  const frame = attachTerminalWindow(dialog, win);
  const output = dialog.querySelector('.park-console-output');
  const input = dialog.querySelector('input');
  const form = dialog.querySelector('form');
  const lock = dialog.querySelector('.park-console-lock');
  let generation = 0, busy = false;
  let terminal, controller;
  let history = [], historyIndex = 0, draft = '';

  function append(lines, className = '') {
    for (const text of lines) {
      const line = doc.createElement('div');
      line.className = className;
      line.textContent = text;
      output.append(line);
    }
    while (output.childElementCount > 80) output.firstElementChild.remove();
    output.scrollTop = output.scrollHeight;
  }
  async function submit(raw) {
    if (!raw.trim() || busy) return;
    const run = generation;
    busy = true; input.disabled = true;
    const command = raw.slice(0, 240);
    history.push(command); history = history.slice(-30); historyIndex = history.length; draft = '';
    append([`> ${command}`], 'park-console-echo');
    let result;
    try { result = await terminal.command(command, { signal: controller.signal }); }
    catch { result = { lines: ['Command failed. Please retry.'] }; }
    if (run !== generation || !dialog.open) return;
    busy = false; input.disabled = false;
    input.value = '';
    if (result.action === 'exit') { dialog.close(); return; }
    if (result.action === 'clear') output.replaceChildren();
    append(result.lines);
    if (result.link) {
      const link = doc.createElement('a'); link.href = result.link; link.textContent = result.link;
      link.target = '_blank'; link.rel = 'noreferrer'; output.append(link);
    }
    output.scrollTop = output.scrollHeight;
    if (result.locked) {
      form.hidden = true; input.disabled = true; lock.hidden = false;
      dialog.querySelector('#park-magic-word').focus();
    } else input.focus({ preventScroll: true });
  }
  function reset() {
    generation++; busy = false; controller?.abort(); controller = new AbortController();
    terminal = new ParkTerminal(actions); history = []; historyIndex = 0; draft = '';
    output.replaceChildren(); form.hidden = false; input.disabled = false; lock.hidden = true;
    input.value = '';
    append(['READY. Read-only workspace terminal.', 'Type HELP for commands, or LS to explore the current directory.']);
    input.focus({ preventScroll: true });
  }
  function show() {
    if (doc.querySelector('dialog[open]')) return;
    stopMovement();
    dialog.showModal(); frame.show(); reset();
  }
  form.addEventListener('submit', event => { event.preventDefault(); submit(input.value); });
  input.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    event.preventDefault();
    if (historyIndex === history.length) draft = input.value;
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
    input.value = historyIndex === history.length ? draft : history[historyIndex];
    input.setSelectionRange(input.value.length, input.value.length);
  });
  dialog.querySelector('[data-terminal-close]').onclick = () => dialog.close();
  dialog.querySelector('[data-terminal-retry]').onclick = reset;
  dialog.addEventListener('close', () => {
    generation++; busy = false; controller?.abort(); input.value = ''; history = []; terminal = null;
    output.replaceChildren(); lock.hidden = true;
    getCanvas()?.focus({ preventScroll: true });
  });
  win.addEventListener('keydown', event => {
    if (event.key !== '`' || event.repeat || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target !== getCanvas() || doc.querySelector('dialog[open]')) return;
    event.preventDefault(); show();
  });
  return { show };
}
