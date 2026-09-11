export const AGE_COLORS = ['#a22422', '#99641c', '#777821', '#166e61', '#205c99', '#67149a', '#522344'];
export const AGE_LABELS = ['1 wk', '2 wk', '1 mo', '3 mo', '6 mo', '1 yr', '> 1 yr'];
export const ANTENNA_STATUSES = [
  { key: 'unstarted', label: 'Unstarted', color: '#52669a' },
  { key: 'started', label: 'In progress', color: '#c28a22' },
  { key: 'completed', label: 'Completed', color: '#25804e' },
];

export function statusBucket(node, states) {
  // Workflow types remain stable when a workspace renames its columns.
  const state = String(states.get(node.workflow_state_id)?.type || node.state || '').toLowerCase();
  if (['done', 'finished', 'completed'].includes(state)) return 'completed';
  if (['started', 'in progress'].includes(state)) return 'started';
  if (['unstarted', 'to do', 'backlog'].includes(state)) return 'unstarted';
  if (node.complete === true || node.completed === true) return 'completed';
  if (node.started === true) return 'started';
  if (node.complete === false || node.started === false) return 'unstarted';
  return 'unknown';
}
export function ageColor(date) {
  const days = Math.max(0, (Date.now() - new Date(date || Date.now()).getTime()) / 86400000);
  const index = [7, 14, 30, 90, 180, 365].findIndex(limit => days < limit);
  return AGE_COLORS[index < 0 ? 6 : index];
}

export class Workspace {
  constructor(name = 'Workspace') {
    this.nodes = new Map();
    this.root = { key: 'root', id: 'root', kind: 'workspace', name, children: [], loaded: true };
    this.nodes.set('root', this.root);
    this.states = new Map();
    this.members = new Map();
  }
  upsert(kind, data) {
    const key = `${kind}:${data.id}`;
    const old = this.nodes.get(key);
    const node = { children: [], ...old, ...data, kind, key, name: data.name || data.description || `${kind} ${data.id}` };
    if (kind === 'task') node.name = data.description || data.name;
    this.nodes.set(key, node);
    return node;
  }
  rebuild() {
    for (const node of this.nodes.values()) { node.children = []; node.parents = []; }
    const connect = (parent, child) => {
      if (!parent.children.includes(child.key)) parent.children.push(child.key);
      child.parents.push(parent.key);
    };
    const orphan = (key, name) => {
      let node = this.nodes.get(key);
      if (!node) { node = { key, id: key, kind: 'folder', name, children: [], parents: [], loaded: true }; this.nodes.set(key, node); }
      if (!node.parents.length) connect(this.root, node);
      return node;
    };
    for (const node of this.nodes.values()) {
      if (node.kind === 'objective') connect(this.root, node);
      if (node.kind === 'epic') {
        const ids = node.objective_ids?.length ? node.objective_ids : node.milestone_id ? [node.milestone_id] : [];
        const parents = ids.map(id => this.nodes.get(`objective:${id}`)).filter(Boolean);
        if (parents.length) parents.forEach(parent => connect(parent, node));
        else connect(orphan('loose-epics', 'Unassigned epics'), node);
      }
      if (node.kind === 'story') connect(this.nodes.get(`epic:${node.epic_id}`) || orphan('loose-stories', 'Stories without an epic'), node);
      if (node.kind === 'task') {
        const parent = this.nodes.get(`story:${node.story_id}`);
        if (parent) connect(parent, node);
      }
    }
    for (const key of ['loose-epics', 'loose-stories']) {
      const node = this.nodes.get(key);
      if (node && !node.children.length) this.nodes.delete(key);
    }
  }
  get(key) { return this.nodes.get(key); }
  children(key) { return (this.get(key)?.children || []).map(id => this.get(id)).filter(Boolean); }
  antennaSummary(key) {
    const node = this.get(key);
    const children = this.children(key).filter(child => !child.archived);
    const counts = { unstarted: 0, started: 0, completed: 0, unknown: 0 };
    for (const child of children) counts[statusBucket(child, this.states)]++;
    return {
      counts,
      total: children.length,
      partial: !!node && ['epic', 'story'].includes(node.kind) && !node.loaded,
      unit: { objective: 'epics', epic: 'stories', story: 'tasks' }[node?.kind] || 'items',
    };
  }
  path(key) {
    const chain = []; const visited = new Set(); let node = this.get(key);
    while (node && !visited.has(node.key)) {
      visited.add(node.key); chain.unshift(node); node = this.get(node.parents?.[0]);
    }
    return chain;
  }
  counts() {
    const result = { objective: 0, epic: 0, story: 0, task: 0 };
    for (const node of this.nodes.values()) if (!node.archived && node.kind in result) result[node.kind]++;
    return result;
  }
}

export function createDemo() {
  const ws = new Workspace('Isla Nublar');
  const themes = [
    ['Park operations', ['Perimeter security', 'Visitor experience', 'Vehicle systems', 'Park communications']],
    ['Genetics & research', ['Genome sequencing', 'Hatchery operations', 'Species catalog', 'Lab infrastructure']],
    ['Island infrastructure', ['Power grid', 'Water & utilities', 'Dock operations', 'Weather monitoring']],
    ['Safety & containment', ['Raptor containment', 'Emergency protocols', 'Access control', 'Animal tracking']],
  ];
  const stories = [
    ['Restore electric perimeter fences', 'Calibrate paddock motion sensors', 'Audit the west gate controls', 'Replace damaged fence relays', 'Test the perimeter alarm', 'Map blind spots in sector seven', 'Schedule overnight patrols', 'Verify backup power routing', 'Inspect the dilophosaurus paddock'],
    ['Update the guided tour narration', 'Prepare the visitor center displays', 'Test the automated tour route', 'Rebuild the vehicle telemetry link', 'Check the lunch reservation system', 'Install the new wayfinding signs', 'Review the park opening checklist', 'Sync the control room displays', 'Document the maintenance procedure'],
    ['Sequence the remaining DNA samples', 'Verify the incubation temperatures', 'Review the specimen growth logs', 'Calibrate the laboratory equipment', 'Archive the research observations', 'Check the cold storage alarms', 'Update the species records', 'Inspect the egg turning mechanism', 'Back up the sequencing results'],
    ['Run a failover simulation', 'Patch the control room terminals', 'Rotate system access credentials', 'Verify the emergency shutdown', 'Restore the island network', 'Test the radio repeater stations', 'Document the recovery procedure', 'Investigate unexpected motion', 'Confirm all systems operational'],
  ];
  const ages = [3, 10, 22, 56, 120, 240, 450];
  themes.forEach(([name, epics], oi) => {
    const objective = ws.upsert('objective', { id: oi + 1, name, description: `Coordinate ${name.toLowerCase()} before the park opens to visitors. All systems must pass a full inspection.`, state: oi === 1 ? 'done' : 'in progress', updated_at: new Date().toISOString(), loaded: true });
    epics.forEach((epicName, ei) => {
      const epicId = 100 + oi * 10 + ei;
      ws.upsert('epic', { id: epicId, name: epicName, objective_ids: [objective.id], description: `Prepare and verify ${epicName.toLowerCase()} across Isla Nublar.\n\nCoordinate with the control room before conducting any live system tests. Record the results and flag any unresolved issues.`, state: ei === 2 ? 'done' : 'in progress', loaded: true, stats: { num_stories_total: 9 }, updated_at: new Date(Date.now() - ages[(oi + ei) % 7] * 86400000).toISOString() });
      for (let si = 0; si < 9; si++) {
        const id = epicId * 10 + si;
        ws.upsert('story', { id, epic_id: epicId, name: stories[(oi + ei) % 4][si], description: `Part of the ${epicName.toLowerCase()} program.\n\nCheck the current configuration, run the diagnostic sequence, and report the results to park operations.\n\n“We spared no expense.”`, story_type: si % 4 === 0 ? 'bug' : si % 3 === 0 ? 'chore' : 'feature', estimate: [1, 2, 3, 5, 8][si % 5], completed: si % 4 === 0, started: si % 3 === 0, owner_ids: ['demo'], loaded: true, updated_at: new Date(Date.now() - ages[(oi + ei + si) % 7] * 86400000).toISOString() });
        ['Run initial diagnostics', 'Verify with the control room', 'Record inspection results'].forEach((description, ti) => ws.upsert('task', { id: id * 10 + ti, story_id: id, description, complete: si % 4 === 0 || ti === 0, updated_at: new Date(Date.now() - ages[(si + ti) % 7] * 86400000).toISOString(), loaded: true }));
      }
    });
  });
  ws.members.set('demo', 'Ray Arnold');
  ws.rebuild();
  return ws;
}
