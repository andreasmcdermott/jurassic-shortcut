import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ageColor, ANTENNA_STATUSES } from './data.js';
import { directionalNeighbor } from './navigation.js';

const UP = new THREE.Vector3(0, 1, 0);
export class World {
  constructor(container, overview, onSelect, onOpen) {
    this.container = container;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.onSelect = onSelect; this.onOpen = onOpen;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#39814e', 380, 1400);
    const sky = document.createElement('canvas'); sky.width = 2; sky.height = 256;
    const ctx = sky.getContext('2d'); const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#006abb'); gradient.addColorStop(.55, '#00a8df'); gradient.addColorStop(1, '#a4ffe2');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2, 256);
    this.scene.background = new THREE.CanvasTexture(sky);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '3D workspace. Arrow keys select nearby objects. F flies to the selection. Enter opens it. WASD moves the camera.');
    this.renderer.domElement.tabIndex = 0;
    this.camera = new THREE.PerspectiveCamera(48, 1, .2, 4000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .09;
    this.controls.maxPolarAngle = Math.PI / 2 - .025;
    this.controls.minDistance = 7; this.controls.maxDistance = 650;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', () => { this.flight = null; });
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(-80, 170, 90); this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: '#347e49' }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.25; this.scene.add(ground);
    const grid = new THREE.GridHelper(2500, 125, '#418955', '#39834e'); grid.position.y = -.2; this.scene.add(grid);
    this.content = new THREE.Group(); this.scene.add(this.content);
    this.picks = []; this.positions = new Map(); this.keys = new Set();
    this.ray = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.mini = new THREE.WebGLRenderer({ antialias: false }); this.mini.setPixelRatio(1); overview.append(this.mini.domElement);
    this.miniCamera = new THREE.OrthographicCamera(-100, 100, 65, -65, 1, 2000); this.miniCamera.position.set(0, 450, 180); this.miniCamera.lookAt(0, 0, 0);
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(3, 8, 3), new THREE.MeshBasicMaterial({ color: '#fffbd7', depthTest: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.renderOrder = 100; this.scene.add(this.marker);
    this.beam = this.makeBeam(); this.scene.add(this.beam); this.beam.visible = false;
    this.resize = () => {
      const { width, height } = container.getBoundingClientRect();
      this.renderer.setSize(width, height); this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
      this.mini.setSize(overview.clientWidth, overview.clientHeight);
    };
    this.observer = new ResizeObserver(this.resize); this.observer.observe(container); this.observer.observe(overview);
    let down = null;
    this.renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    this.renderer.domElement.addEventListener('pointerup', e => {
      if (down && Math.hypot(down.x - e.clientX, down.y - e.clientY) < 5 && e.button === 0) {
        const hit = this.pick(e); if (hit) this.onSelect(hit.key, hit.occurrenceId);
      }
      down = null;
    });
    this.renderer.domElement.addEventListener('dblclick', e => { const hit = this.pick(e); if (hit) this.onOpen(hit.key); });
    this.renderer.domElement.addEventListener('pointermove', e => { this.renderer.domElement.style.cursor = this.pick(e) ? 'pointer' : 'grab'; });
    this.renderer.domElement.addEventListener('keydown', e => {
      if (document.querySelector('dialog[open]') || e.altKey || e.ctrlKey || e.metaKey) return;
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(e.key.toLowerCase())) { e.preventDefault(); this.keys.add(e.key.toLowerCase()); this.flight = null; }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    this.renderer.domElement.addEventListener('blur', () => this.keys.clear());
    this.last = performance.now(); this.animate = this.animate.bind(this); requestAnimationFrame(this.animate);
  }
  makeBeam() {
    const beam = new THREE.Group();
    const halo = new THREE.Mesh(new THREE.CircleGeometry(4.5, 40), new THREE.MeshBasicMaterial({ color: '#fffed1', transparent: true, opacity: .8, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = .06; beam.add(halo);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 4, 35, 4, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffda', transparent: true, opacity: .13, side: THREE.DoubleSide, depthWrite: false }));
    cone.position.y = 17.5; cone.rotation.y = Math.PI / 4; beam.add(cone);
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x * 2.8, 0, z * 2.8), new THREE.Vector3(x * 1.06, 35, z * 1.06)]);
      beam.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffffd1', transparent: true, opacity: .85 })));
    }
    return beam;
  }
  box(width, height, depth, color, x, y, z, node, occurrenceId) {
    const batchKey = `${color}:${node ? 'pick' : 'decor'}`;
    if (!this.boxes.has(batchKey)) this.boxes.set(batchKey, { color, items: [] });
    this.boxes.get(batchKey).items.push({ width, height, depth, x, y, z, key: node?.key, occurrenceId });
  }
  flushBoxes() {
    const dummy = new THREE.Object3D();
    for (const { color, items } of this.boxes.values()) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color }), items.length);
      mesh.userData.keys = [];
      mesh.userData.occurrenceIds = [];
      items.forEach((item, i) => {
        dummy.position.set(item.x, item.y + item.height / 2, item.z); dummy.scale.set(item.width, item.height, item.depth); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix); mesh.userData.keys.push(item.key); mesh.userData.occurrenceIds.push(item.occurrenceId);
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); this.content.add(mesh);
      if (items[0].key) this.picks.push(mesh);
    }
  }
  label(text, x, y, z, width = 20, white = false) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = white ? '#f1f2da' : '#161c17'; ctx.fillText(text.length > 32 ? `${text.slice(0, 30)}…` : text, 256, 32, 500);
    const texture = new THREE.CanvasTexture(canvas); texture.minFilter = THREE.LinearFilter;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 8), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); this.content.add(mesh);
  }
  documentGlyph(x, y, z, size = 1, task = false) {
    for (let i = 0; i < (task ? 1 : 3); i++) this.box(1.7 * size, .06, 2.2 * size, '#c4b7c1', x + i * .18 * size, y + i * .09, z - i * .15 * size);
    for (let i = 0; i < 4; i++) this.box(1.15 * size, .035, .1 * size, '#5b435b', x + .35 * size, y + .3, z - .8 * size + i * .42 * size);
  }
  clear(preserveSelection = false) {
    this.content.traverse(obj => { if (obj.isInstancedMesh) obj.dispose(); obj.geometry?.dispose(); if (obj.material) { obj.material.map?.dispose(); obj.material.dispose(); } });
    this.content.clear(); this.boxes = new Map(); this.picks = []; this.positions.clear(); this.occurrences = new Map();
    if (!preserveSelection) { this.beam.visible = false; this.beamTransition = null; this.selectedOccurrence = null; }
  }
  place(node, parentKey, position) {
    const id = `${parentKey}/${node.key}`;
    this.occurrences.set(id, { id, key: node.key, parentKey, position });
    if (!this.positions.has(node.key)) this.positions.set(node.key, position);
    return id;
  }
  resolveOccurrence(key, occurrenceId) {
    if (!this.occurrences) return null;
    const exact = this.occurrences.get(occurrenceId || (this.selectedOccurrence?.key === key ? this.selectedOccurrence.id : null));
    if (exact?.key === key) return exact;
    const copies = [...this.occurrences.values()].filter(item => item.key === key);
    return copies.find(item => item.parentKey === this.selectedOccurrence?.parentKey) || copies[0];
  }
  setDirectory(ws, directory, nodes, reset = true) {
    this.clear(!reset && this.directoryKey === directory.key);
    this.directoryKey = directory.key;
    const isCampus = ['workspace', 'objective', 'folder'].includes(directory.kind);
    const cols = isCampus ? Math.ceil(Math.sqrt(nodes.length || 1)) : Math.min(8, Math.ceil(Math.sqrt(nodes.length || 1)));
    const spacingX = isCampus ? 70 : 10; const spacingZ = isCampus ? 65 : 12;
    const rows = Math.ceil(nodes.length / cols);
    const totalW = Math.max(30, cols * spacingX), totalD = Math.max(30, rows * spacingZ);
    this.extent = Math.max(totalW, totalD);
    if (!isCampus) this.box(totalW + 8, 1.4, totalD + 12, '#cfcec6', 0, 0, 0);
    nodes.forEach((node, i) => {
      const x = (i % cols - (cols - 1) / 2) * spacingX;
      const z = (Math.floor(i / cols) - (rows - 1) / 2) * spacingZ;
      const base = isCampus ? 2.5 : 1.4;
      if (isCampus) {
        const occurrenceId = this.place(node, directory.key, new THREE.Vector3(x, base, z - 13));
        this.box(56, base, 47, '#cccfc3', x, 0, z, node, occurrenceId);
        this.box(7, 6, 6, '#acb7a2', x, base, z - 14, node, occurrenceId);
        const { counts } = ws.antennaSummary(node.key);
        const maxCount = Math.max(1, ...ANTENNA_STATUSES.map(({ key }) => counts[key]));
        ANTENNA_STATUSES.forEach(({ key, color }, index) => {
          const ax = x + (index - 1) * 2.3;
          // Neutral sockets remain visible for zero or not-yet-loaded counts.
          this.box(1.3, .4, 1.3, '#737c73', ax, base + 6, z - 14, node, occurrenceId);
          if (counts[key]) this.box(.9, 23 * counts[key] / maxCount, .9, color, ax, base + 6.4, z - 14, node, occurrenceId);
        });
        this.label(node.name, x, base + .08, z + 20, 47);
        const children = ws.children(node.key).filter(child => !child.archived).slice(0, 24);
        children.forEach((child, ci) => {
          const cx = x + (ci % 6 - 2.5) * 8; const cz = z - 5 + Math.floor(ci / 6) * 5.5;
          const h = child.kind === 'epic' ? 2.2 + Math.min(4, (child.stats?.num_stories_total || child.children.length) / 10) : 1.5;
          const childOccurrence = this.place(child, node.key, new THREE.Vector3(cx, base, cz));
          this.box(5, h, 3.6, ageColor(child.updated_at), cx, base, cz, child, childOccurrence);
          this.documentGlyph(cx, base + h, cz, .65);
        });
        // The directory paths are geometry in the same world as the platforms.
        for (let lane = -1; lane <= 1; lane++) {
          const points = [new THREE.Vector3(x + lane * 1.1, .05, z + 24), new THREE.Vector3(x + lane * 1.1, .05, totalD / 2 + 13 + lane * 1.1), new THREE.Vector3(lane * 1.1, .05, totalD / 2 + 13 + lane * 1.1)];
          this.content.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#9fc69a' })));
        }
      } else {
        const h = node.kind === 'story' ? 1.5 + Math.min(4, (node.estimate || 1) * .35) : node.complete ? .7 : 1.5;
        const occurrenceId = this.place(node, directory.key, new THREE.Vector3(x, base, z));
        this.box(6, h, 6, ageColor(node.updated_at), x, base, z, node, occurrenceId);
        this.documentGlyph(x, base + h + .01, z, 1, node.kind === 'task');
        this.label(node.kind === 'task' ? node.name : `#${node.id} ${node.name}`, x, base + .06, z + 4.4, 9.6);
      }
    });
    this.label(`/${directory.name.toLowerCase().replaceAll(' ', '_')}`, 0, .07, totalD / 2 + 26, Math.min(100, totalW), true);
    this.flushBoxes();
    const e = this.extent * .65 + 20;
    this.miniCamera.left = -e; this.miniCamera.right = e; this.miniCamera.top = e * .48; this.miniCamera.bottom = -e * .48;
    this.miniCamera.updateProjectionMatrix();
    if (reset) this.home(false);
  }
  home(animate = true) { this.fly(new THREE.Vector3(this.extent * .2, this.extent * .5 + 22, this.extent * .85 + 30), new THREE.Vector3(0, 0, 0), animate); }
  view(type) {
    const target = this.controls.target.clone(); const distance = Math.max(35, this.camera.position.distanceTo(target));
    this.fly(target.clone().add(type === 'bird' ? new THREE.Vector3(0, distance, .1) : new THREE.Vector3(0, distance * .18, distance)), target);
  }
  select(key, focus = false, occurrenceId) {
    const occurrence = this.resolveOccurrence(key, occurrenceId);
    const pos = occurrence?.position || this.positions.get(key);
    if (!pos) { this.beam.visible = false; this.beamTransition = null; return; }
    this.selectedOccurrence = occurrence || null;
    this.positions.set(key, pos);
    if (!this.beam.visible || this.reducedMotion?.matches) {
      // First selection in a directory appears in place, not from the world origin.
      this.beam.position.copy(pos); this.beamTransition = null;
    } else if (!this.beamTransition?.to.equals(pos) && !this.beam.position.equals(pos)) {
      this.beamTransition = { start: performance.now(), from: this.beam.position.clone(), to: pos.clone() };
    } else if (this.beam.position.equals(pos)) {
      this.beamTransition = null;
    }
    this.beam.visible = true;
    if (focus) this.fly(pos.clone().add(new THREE.Vector3(10, 18, 30)), pos);
  }
  updateSpotlight(now) {
    if (!this.beamTransition) return;
    const { start, from, to } = this.beamTransition;
    const t = this.reducedMotion?.matches ? 1 : THREE.MathUtils.clamp((now - start) / 320, 0, 1);
    const eased = t * t * (3 - 2 * t);
    this.beam.position.lerpVectors(from, to, eased);
    if (t === 1) this.beamTransition = null;
  }
  neighbor(key, direction, candidates) {
    this.camera.updateMatrixWorld();
    const points = [];
    for (const candidate of candidates) {
      const position = this.resolveOccurrence(candidate)?.position || this.positions.get(candidate);
      if (!position) continue;
      const projected = position.clone().project(this.camera);
      if (![projected.x, projected.y, projected.z].every(Number.isFinite) || projected.z < -1 || projected.z > 1) continue;
      points.push({ key: candidate, x: projected.x * this.camera.aspect, y: projected.y });
    }
    return directionalNeighbor(points, key, direction);
  }
  fly(position, target, animate = true) {
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { this.camera.position.copy(position); this.controls.target.copy(target); this.controls.update(); return; }
    this.flight = { start: performance.now(), from: this.camera.position.clone(), to: position, targetFrom: this.controls.target.clone(), targetTo: target };
  }
  tilt(value) {
    this.flight = null;
    const offset = this.camera.position.clone().sub(this.controls.target); const s = new THREE.Spherical().setFromVector3(offset);
    s.phi = THREE.MathUtils.degToRad(85 - Number(value) * .75); offset.setFromSpherical(s); this.camera.position.copy(this.controls.target).add(offset);
  }
  height(value) { this.flight = null; this.camera.position.y = this.controls.target.y + Number(value) * 2 + 3; }
  setRetro(on) { this.renderer.setPixelRatio(on ? .7 : Math.min(devicePixelRatio, 1.5)); this.resize(); }
  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    const hit = this.ray.intersectObjects(this.picks, false)[0];
    return hit ? { key: hit.object.userData.keys[hit.instanceId], occurrenceId: hit.object.userData.occurrenceIds[hit.instanceId] } : undefined;
  }
  animate(now) {
    requestAnimationFrame(this.animate);
    const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
    this.updateSpotlight(now);
    if (this.flight) {
      const t = Math.min(1, (now - this.flight.start) / 850); const eased = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, eased); this.controls.target.lerpVectors(this.flight.targetFrom, this.flight.targetTo, eased);
      if (t === 1) this.flight = null;
    }
    if (this.keys.size) {
      const forward = this.controls.target.clone().sub(this.camera.position).setY(0).normalize(); const right = forward.clone().cross(UP);
      const step = new THREE.Vector3();
      if (this.keys.has('w')) step.add(forward);
      if (this.keys.has('s')) step.sub(forward);
      if (this.keys.has('d')) step.add(right);
      if (this.keys.has('a')) step.sub(right);
      if (this.keys.has('e')) step.y += 1; if (this.keys.has('q')) step.y -= 1;
      step.multiplyScalar(dt * 40); if (this.camera.position.y + step.y < 2) step.y = 0;
      this.camera.position.add(step); this.controls.target.add(step);
    }
    this.controls.update(); this.marker.visible = false; this.renderer.render(this.scene, this.camera);
    if (!this.miniFrame || now - this.miniFrame > 120) {
      this.miniFrame = now; const background = this.scene.background; this.scene.background = new THREE.Color('#28633c');
      this.marker.visible = true; this.marker.position.copy(this.camera.position).setY(55);
      this.marker.rotation.z = this.controls.getAzimuthalAngle();
      this.mini.render(this.scene, this.miniCamera); this.scene.background = background; this.marker.visible = false;
    }
  }
}
