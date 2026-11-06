// Procedural placeholder rooms in each scene's palette. They carry the same node names as a real
// scene GLB (CAM_main, HS_*, CHAR_*, door_*, sym_*), so everything after loading is one code path.
import {
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { SceneId } from './api';

export interface Palette {
  dominant: string;
  secondary: string;
  accent: string;
}

// docs/ART_DIRECTION.md, "Palette by location".
export const PALETTES: Record<SceneId, Palette> = {
  prologue: { dominant: '#1a2227', secondary: '#2fe6c8', accent: '#ff2a1f' },
  hub: { dominant: '#3a0b12', secondary: '#0a0608', accent: '#2fe6c8' },
  room1: { dominant: '#c9a35e', secondary: '#8a4a26', accent: '#fff1cf' },
  room2: { dominant: '#f3d9d6', secondary: '#d9d3ee', accent: '#9fe7e8' },
  room3: { dominant: '#07070a', secondary: '#17161a', accent: '#ff8a1f' },
  room4: { dominant: '#eef1f2', secondary: '#c6ccd0', accent: '#3fa9ff' },
  room5: { dominant: '#f7fafb', secondary: '#9aa7ad', accent: '#1f7fd6' },
  sub_chamber: { dominant: '#1a2227', secondary: '#d8a31f', accent: '#e8f3ff' },
  moonpool: { dominant: '#06262e', secondary: '#59646a', accent: '#ffb347' },
  ending: { dominant: '#06262e', secondary: '#0a0608', accent: '#1f7fd6' },
};

// docs/CONTRACTS.md Section 4, the hotspot table.
const CONTRACT_HOTSPOTS: Record<SceneId, string[]> = {
  prologue: ['power_main', 'power_backup'],
  hub: ['door1', 'door2', 'door3', 'door4', 'wall5', 'water', 'flesh', 'breath'],
  room1: ['kesav', 'station', 'ship', 'children', 'well', 'exit'],
  room2: ['ila', 'memory_wall', 'cradle', 'couple', 'neural_rig', 'exit'],
  room3: ['archive', 'lamp', 'window', 'poster', 'citizen', 'exit'],
  room4: ['niyati', 'citizens', 'decision_board', 'garden', 'anomaly', 'exit'],
  room5: ['whale', 'monitor_journey', 'monitor_runs', 'monitor_log', 'scientists', 'console', 'hidden_door'],
  sub_chamber: ['submarine', 'logbook', 'passage'],
  moonpool: ['sato', 'monitor', 'water'],
  ending: [],
};

export const CONTRACT_CHARACTERS: Record<SceneId, string[]> = {
  prologue: ['arjun'],
  hub: ['arjun'],
  room1: ['kesav'],
  room2: ['ila'],
  room3: [],
  room4: ['niyati'],
  room5: ['sato'],
  sub_chamber: ['arjun'],
  moonpool: ['sato', 'arjun'],
  ending: [],
};

const ROOM_W = 15;
const ROOM_D = 11;
const ROOM_H = 7;

function material(color: string, emissive?: string, intensity = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.85,
    metalness: 0.05,
    emissive: emissive ?? '#000000',
    emissiveIntensity: intensity,
  });
}

function named<T extends Object3D>(obj: T, name: string, x = 0, y = 0, z = 0): T {
  obj.name = name;
  obj.position.set(x, y, z);
  return obj;
}

function shell(root: Group, p: Palette): void {
  const dark = new Color(p.dominant).multiplyScalar(0.72).getStyle();
  const floor = new Mesh(new PlaneGeometry(ROOM_W * 2, ROOM_D * 2), material(p.secondary));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -ROOM_D / 2 + 3;
  root.add(floor);

  const back = new Mesh(new PlaneGeometry(ROOM_W * 2, ROOM_H * 2), material(p.dominant));
  back.position.set(0, ROOM_H, -ROOM_D + 3);
  root.add(back);

  for (const side of [-1, 1]) {
    const wall = new Mesh(new PlaneGeometry(ROOM_D * 2, ROOM_H * 2), material(dark));
    wall.rotation.y = -side * (Math.PI / 2);
    wall.position.set(side * (ROOM_W / 2 + 1), ROOM_H, 0);
    root.add(wall);
  }

  // Background masses, for some depth.
  for (let i = 0; i < 5; i++) {
    const h = 1.6 + ((i * 37) % 10) * 0.28;
    const block = new Mesh(new BoxGeometry(1.5, h, 1.2), material(dark));
    block.position.set(-6 + i * 3, h / 2, -ROOM_D + 4);
    root.add(block);
  }
}

function lights(root: Group, p: Palette): void {
  root.add(new HemisphereLight('#ffffff', p.secondary, 1.5));
  const sun = new DirectionalLight('#ffffff', 1.2);
  sun.position.set(2, 8, 6);
  root.add(sun);
  const glow = new PointLight(p.accent, 40, 26);
  glow.position.set(0, 4.5, -2);
  root.add(glow);
}

function prop(root: Group, p: Palette, x: number, z: number): void {
  const plinth = new Mesh(new CylinderGeometry(0.5, 0.65, 0.5, 7), material(p.secondary));
  plinth.position.set(x, 0.25, z);
  root.add(plinth);
  const gem = new Mesh(new IcosahedronGeometry(0.42), material(p.dominant, p.accent, 0.55));
  gem.position.set(x, 0.95, z);
  root.add(gem);
}

function door(root: Group, p: Palette, n: number, x: number, z: number): void {
  const mesh = named(new Mesh(new BoxGeometry(1.5, 3.1, 0.2), material('#22070c', p.accent, 0.1)), `door_${n}`, x, 1.55, z);
  root.add(mesh);
  const sym = named(new Mesh(new CircleGeometry(0.34, 12), material('#000000', p.accent, 1)), `sym_door_${n}`, x, 2.35, z + 0.13);
  root.add(sym);
}

function buildHub(root: Group, p: Palette): void {
  const backZ = -4.6;
  [-5.6, -3, 3, 5.6].forEach((x, i) => door(root, p, i + 1, x, backZ));

  const wall = named(new Mesh(new BoxGeometry(2.6, 3.4, 0.2), material('#2a090e')), 'blank_wall', 0, 1.7, backZ);
  root.add(wall);
  const quarters: [number, number][] = [[-0.36, 0.36], [0.36, 0.36], [0.36, -0.36], [-0.36, -0.36]];
  quarters.forEach(([dx, dy], i) => {
    const q = new Mesh(new BoxGeometry(0.62, 0.62, 0.04), material('#120306', p.accent, 0));
    root.add(named(q, `sym_wall_${i + 1}`, dx, 2 + dy, backZ + 0.13));
  });

  // Ribs, so the belly reads as organic even as a placeholder.
  for (let i = 0; i < 6; i++) {
    const rib = new Mesh(new TorusGeometry(8.5, 0.28, 5, 20, Math.PI), material('#1c060a'));
    rib.position.set(0, 0, 3.5 - i * 2);
    root.add(rib);
  }

  const anchors: Record<string, [number, number, number]> = {
    door1: [-5.6, 1.6, backZ + 0.3],
    door2: [-3, 1.6, backZ + 0.3],
    door3: [3, 1.6, backZ + 0.3],
    door4: [5.6, 1.6, backZ + 0.3],
    wall5: [0, 1.9, backZ + 0.3],
    water: [-3.8, 0.45, 0.2],
    flesh: [4.2, 1.2, -1.5],
    breath: [0, 3.5, -1],
  };
  for (const [id, [x, y, z]] of Object.entries(anchors)) root.add(named(new Object3D(), `HS_${id}`, x, y, z));
  prop(root, p, -3.8, 0.2);
  prop(root, p, 4.2, -1.5);
  root.add(named(new Object3D(), 'CHAR_arjun', -1.3, 0, -0.8));
}

function buildGeneric(root: Group, p: Palette, ids: string[], characters: string[]): void {
  const others = ids.filter((id) => id !== 'exit');
  const n = others.length;
  others.forEach((id, i) => {
    const x = n === 1 ? 0 : -5.4 + (10.8 * i) / (n - 1);
    const z = i % 2 === 0 ? -0.8 : -3.2;
    const isChar = characters.includes(id);
    root.add(named(new Object3D(), `HS_${id}`, x, isChar ? 2.1 : 1.1, z));
    if (isChar) root.add(named(new Object3D(), `CHAR_${id}`, x, 0, z));
    else prop(root, p, x, z);
  });
  characters
    .filter((c) => !others.includes(c))
    .forEach((c, i) => root.add(named(new Object3D(), `CHAR_${c}`, -2.2 + i * 1.5, 0, 0.6)));
  if (ids.includes('exit')) {
    const frame = new Mesh(new BoxGeometry(1.3, 2.7, 0.15), material('#000000', p.accent, 0.5));
    frame.rotation.y = -0.5;
    frame.position.set(6.4, 1.35, -0.6);
    root.add(frame);
    root.add(named(new Object3D(), 'HS_exit', 6.2, 1.2, -0.3));
  }
}

function whaleBody(root: Group, x: number, y: number, z: number, scale: number): void {
  const body = new Mesh(new SphereGeometry(1, 18, 10), material('#3c5a78'));
  body.scale.set(5.5 * scale, 1.5 * scale, 1.6 * scale);
  body.position.set(x, y, z);
  root.add(body);
}

function buildEnding(root: Group): void {
  whaleBody(root, -3, 2.4, -3, 1.4);
  const eye = named(new Mesh(new SphereGeometry(0.5, 16, 12), material('#050505', '#1f7fd6', 1.4)), 'eye', 1.4, 2.6, -0.9);
  root.add(eye);
  const lid = named(new Mesh(new SphereGeometry(0.56, 16, 12), material('#2d4660')), 'eye_lid', 1.4, 2.6, -0.87);
  root.add(lid);
  const cam = new PerspectiveCamera(32, 16 / 9, 0.1, 200);
  root.add(named(cam, 'CAM_eye', 1.4, 2.6, 2.6));
  cam.lookAt(1.4, 2.6, -0.9);
}

/** The node set a real GLB would have, for a scene with no final asset. */
export function buildPlaceholder(sceneId: SceneId, storyIds: string[]): Group {
  const root = new Group();
  root.name = `placeholder_${sceneId}`;
  const p = PALETTES[sceneId];
  shell(root, p);
  lights(root, p);

  const cam = new PerspectiveCamera(38, 16 / 9, 0.1, 200);
  root.add(named(cam, 'CAM_main', 0, 2.6, 10));
  cam.lookAt(0, 1.9, -2);

  const ids = [...new Set([...CONTRACT_HOTSPOTS[sceneId], ...storyIds])];
  if (sceneId === 'hub') buildHub(root, p);
  else if (sceneId === 'ending') buildEnding(root);
  else buildGeneric(root, p, ids, CONTRACT_CHARACTERS[sceneId]);
  if (sceneId === 'room5') whaleBody(root, 0, 3.4, -6, 1);

  return root;
}

/** A stand-in figure for a character with no final GLB: feet at the origin, 1.75 m tall. */
export function buildFigure(id: string, color: string): Group {
  const fig = new Group();
  fig.name = `figure_${id}`;
  const body = new Mesh(new CapsuleGeometry(0.28, 1.0, 4, 8), material(color));
  body.position.y = 0.8;
  fig.add(body);
  const head = new Mesh(new IcosahedronGeometry(0.2, 1), material(color));
  head.position.y = 1.62;
  fig.add(head);
  return fig;
}
