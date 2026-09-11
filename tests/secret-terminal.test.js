import test from 'node:test';
import assert from 'node:assert/strict';
import { ParkTerminal } from '../src/secret-terminal.js';
import { createDemo, Workspace } from '../src/data.js';

function fixture(workspace = createDemo()) {
  const context = { workspace, directory: 'root', selected: null };
  const calls = [];
  const actions = {
    getContext: () => context,
    hydrate: async key => { calls.push(['hydrate', key]); },
    navigate: key => { context.directory = key; calls.push(['navigate', key]); },
    select: key => { context.selected = key; calls.push(['select', key]); },
    fly: key => { context.selected = key; calls.push(['fly', key]); },
  };
  return { context, calls, actions, terminal: new ParkTerminal(actions) };
}

test('only the three exact movie commands in order trigger Nedry', async () => {
  const { terminal } = fixture();
  for (const command of ['bad command', 'access nonsense', 'fetch("/api/session")', 'rm -rf /', 'access security', 'access main program grid']) {
    assert.ok(!(await terminal.command(command)).locked);
  }
  assert.ok(!(await terminal.command(' ACCESS   MAIN PROGRAM ')).locked);
  await terminal.command('help'); await terminal.command('clear'); await terminal.command('find fence');
  assert.ok(!(await terminal.command('access security')).locked);
  assert.equal((await terminal.command('access main program grid')).locked, true);
  assert.equal((await terminal.command('ls')).locked, true);
  assert.equal((await terminal.command('exit')).action, 'exit');
  assert.ok(!(await new ParkTerminal().command('access main program grid')).locked);
});

test('help exposes workspace commands and no longer advertises the Easter egg', async () => {
  const result = await new ParkTerminal().command('help');
  assert.match(result.lines.join('\n'), /ls.*List/);
  assert.match(result.lines.join('\n'), /fly/);
  assert.doesNotMatch(result.lines.join('\n'), /ACCESS SECURITY/);
});

test('ls and cd share the field directory and resolve names, keys, parent and root', async () => {
  const { terminal, context } = fixture();
  assert.match((await terminal.command('ls')).lines.join('\n'), /objective:1.*Park operations/);
  await terminal.command('cd "Park operations"');
  assert.equal(context.directory, 'objective:1');
  await terminal.command('cd epic:100');
  assert.equal(context.directory, 'epic:100');
  assert.match((await terminal.command('pwd')).lines[0], /Park operations\/Perimeter security/);
  assert.match((await terminal.command('ls')).lines.join('\n'), /story:1000/);
  await terminal.command('cd ..');
  assert.equal(context.directory, 'objective:1');
  await terminal.command('cd /');
  assert.equal(context.directory, 'root');
  assert.match((await terminal.command('cd task:10000')).lines[0], /no directory/);
  assert.equal(context.directory, 'root');
});

test('find, listings and counts exclude archives and support all result pages', async () => {
  const ws = new Workspace('Test');
  for (let i = 1; i <= 85; i++) ws.upsert('objective', { id: i, name: `Tower ${i}`, archived: i === 85 });
  ws.rebuild();
  const { terminal } = fixture(ws);
  const first = await terminal.command('find Tower');
  assert.equal(first.lines.length, 42);
  const last = (await terminal.command('find Tower --page 3')).lines.join('\n');
  assert.match(last, /objective:84/); assert.doesNotMatch(last, /objective:85/);
  assert.match((await terminal.command('ls --page 3')).lines.join('\n'), /84 objects · page 3\/3/);
  assert.match((await terminal.command('ls --page 0')).lines[0], /positive page/);
  assert.match((await terminal.command('find Tower --page 4')).lines[0], /3 pages/);
  assert.match((await terminal.command('counts')).lines.join('\n'), /objective\s+84/);
});

test('ambiguous IDs and duplicate names require an explicit key', async () => {
  const ws = new Workspace('Test');
  ws.upsert('objective', { id: 1, name: 'Shared' });
  ws.upsert('epic', { id: 1, name: 'Shared', objective_ids: [1] }); ws.rebuild();
  const { terminal, context } = fixture(ws);
  assert.match((await terminal.command('cd 1')).lines[0], /Ambiguous.*objective:1.*epic:1/);
  assert.match((await terminal.command('cd Shared')).lines[0], /Ambiguous/);
  await terminal.command('cd epic:1'); assert.equal(context.directory, 'epic:1');
});

test('show loads full story detail and tasks, links are restricted to Shortcut', async () => {
  const { terminal, context, actions } = fixture();
  context.selected = 'story:1000';
  actions.hydrate = async key => {
    if (key !== 'story:1000') return;
    context.workspace.upsert('story', { id: 1000, epic_id: 100, name: 'Full story', description: 'Fetched detail', app_url: 'https://app.shortcut.com/test/story/1000' });
    context.workspace.rebuild();
  };
  const shown = (await terminal.command('show')).lines.join('\n');
  assert.match(shown, /Fetched detail/); assert.match(shown, /task:10000/);
  assert.equal((await terminal.command('link')).link, 'https://app.shortcut.com/test/story/1000');
  actions.hydrate = async () => {};
  context.workspace.get('story:1000').app_url = 'javascript:alert(1)';
  assert.equal((await terminal.command('link')).link, undefined);
  assert.match((await terminal.command('show unknown')).lines[0], /not found/);
});

test('selection and flying invoke navigation only after successful hydration', async () => {
  const { terminal, calls, context, actions } = fixture();
  assert.equal((await terminal.command('fly story:1000')).action, 'exit');
  assert.equal(context.selected, 'story:1000');
  assert.deepEqual(calls.slice(-2), [['hydrate', 'story:1000'], ['fly', 'story:1000']]);
  assert.equal((await terminal.command('select epic:100')).action, 'exit');
  assert.deepEqual(calls.at(-1), ['select', 'epic:100']);
  actions.hydrate = async () => { throw new Error('Offline. Retry.'); };
  assert.match((await terminal.command('cd epic:101')).lines[0], /Offline/);
  assert.equal(context.directory, 'root');
});

test('workspace replacement or closing during a pending command prevents stale navigation', async () => {
  for (const cancel of ['workspace', 'close']) {
    const { terminal, actions, context, calls } = fixture();
    let release;
    actions.hydrate = () => new Promise(resolve => { release = resolve; });
    const controller = new AbortController();
    const pending = terminal.command('cd epic:100', { signal: controller.signal });
    if (cancel === 'workspace') context.workspace = createDemo();
    else controller.abort();
    release(); await pending;
    assert.equal(context.directory, 'root');
    assert.ok(!calls.some(([action]) => action === 'navigate'));
  }
});
