// The three.js stage: loads scenes, frames the camera, projects hotspots, renders.
import {
  AgXToneMapping,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HalfFloatType,
  HemisphereLight,
  Light,
  LoopOnce,
  PointLight,
  TextureLoader,
  LoopRepeat,
  Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PCFShadowMap,
  Points,
  PerspectiveCamera,
  Scene,
  SkinnedMesh,
  SpotLight,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { EngineEvents, GameState, RoomId, SceneId, Settings } from './api';
import type { HotspotItem } from './core';
import {
  CssGrade,
  GRADE_SHADER,
  ParticleField,
  applyShimmers,
  buildContactShadows,
  gradeOf,
  markShadowCasters,
  tuneMaterials,
  type LookConfig,
  type LookEntry,
} from './look';
import { CONTRACT_CHARACTERS, PALETTES, buildFigure, buildPlaceholder } from './placeholder';
import type { Manifest, ModelEntry, Story } from './types';

type HotspotOut = EngineEvents['hotspots:update']['items'];

interface Composer {
  setSize(w: number, h: number): void;
  setPixelRatio(r: number): void;
  render(): void;
  dispose(): void;
}

/** Optional UI hooks, set with Stage.setEvents. */
export interface StageEvents {
  onContextLost?: () => void;
  onContextRestored?: () => void;
  onQualityReduced?: (state: QualityState) => void;
}

export interface QualityState {
  quality: 'low' | 'high';
  pixelRatio: number;
  shadows: boolean;
  bloom: boolean;
  grade: boolean;
  particles: boolean;
  reduced: { pixel: boolean; shadows: boolean; bloom: boolean; particles: boolean };
}

interface LightShadowLike {
  mapSize: Vector2;
  bias: number;
  normalBias: number;
  radius: number;
  intensity: number;
  camera: PerspectiveCamera | OrthographicCamera;
  updateMatrices(light: Light): void;
}

/** Mean frame time over a window, ignoring stalls from tab switches and loading. */
class PerfMonitor {
  private sum = 0;
  private sumSq = 0;
  private n = 0;
  private start = 0;
  private warmUntil = 0;
  static readonly WINDOW_MS = 3000;
  reset(now: number, warmMs: number): void {
    this.sum = 0;
    this.sumSq = 0;
    this.n = 0;
    this.start = now + warmMs;
    this.warmUntil = now + warmMs;
  }
  /** Returns the mean frame time in ms at the end of each window, else null. */
  sample(now: number, dtMs: number): number | null {
    if (now < this.warmUntil) return null;
    if (dtMs < 400) {
      this.sum += dtMs;
      this.sumSq += dtMs * dtMs;
      this.n += 1;
    }
    if (now - this.start < PerfMonitor.WINDOW_MS) return null;
    let mean: number | null = this.n >= 20 ? this.sum / this.n : null;
    if (mean !== null) {
      // A steady 30 Hz is a display or power-saver cap, not load: taking effects away would not help.
      const sd = Math.sqrt(Math.max(0, this.sumSq / this.n - mean * mean));
      if (mean > 30.5 && mean < 36 && sd < 2.5) mean = null;
    }
    this.sum = 0;
    this.sumSq = 0;
    this.n = 0;
    this.start = now;
    return mean;
  }
}

const POOR_FRAME_MS = 27;
const PARALLAX_X = 0.1;
const PARALLAX_Y = 0.06;
const EDGE_MARGIN = 28;
const AUTHORED_ASPECT = 16 / 9;

export function modelFor(manifest: Manifest, key: string): ModelEntry | null {
  const entry = manifest.models[key];
  return entry && entry.status === 'final' ? entry : null;
}

function sceneKey(manifest: Manifest, sceneId: SceneId): string {
  // The prologue's interactive beat uses the shared cockpit model.
  return sceneId === 'prologue' && !manifest.models.prologue ? 'cockpit' : sceneId;
}

/** Blender sun strength S exports as S x 683 lux; three.js needs S x pi to look the same. */
const SUN_UNITS = Math.PI / 683;
/** Blender point and spot lights export about 9x hotter than the three.js candela that matches them. */
const POINT_UNITS = 1 / 9;

function url(file: string): string {
  return `${import.meta.env.BASE_URL}${file}`;
}

export class Stage {
  private renderer: WebGLRenderer | null = null;
  private composer: Composer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private bloomK = 1;
  private scene = new Scene();
  private camera = new PerspectiveCamera(38, AUTHORED_ASPECT, 0.1, 500);
  private basePos = new Vector3();
  private hFov = 60;
  private root: Group | null = null;
  private anchors = new Map<string, Object3D>();
  private figures: { obj: Object3D; phase: number }[] = [];
  private mixers: AnimationMixer[] = [];
  private eyeAction: AnimationAction | null = null;
  private eyeLid: Object3D | null = null;
  private eyeCam: PerspectiveCamera | null = null;
  private gltf: GLTFLoader;
  private draco: DRACOLoader;
  private software = false;
  private settings: Settings | null = null;
  private w = 1;
  private h = 1;

  private raf = 0;
  private running = false;
  private paused = false;
  private hidden = false;
  private videoOn = false;
  private lastT = 0;
  private time = 0;
  private fpsValue = 0;
  private fpsFrames = 0;
  private fpsStart = 0;

  private pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  private items: HotspotItem[] = [];
  private lastSent = '';
  private tmp = new Vector3();
  private materials = new Map<string, Material[]>();
  private sceneId: SceneId | null = null;

  // Look development state.
  private look: LookConfig = {};
  private cssGrade: CssGrade | null = null;
  private gradePass: ShaderPass | null = null;
  private particles: ParticleField | null = null;
  private accents: Light[] = [];
  private particleFade = 1;
  private shadowLight: Light | null = null;
  private shadowBase = 1;
  private shadowK = 0;
  private shadowTarget = 0;
  private animTime = 0;
  private timeU = { value: 0 };
  private breathK = 1;
  private push = { t: 0, active: false, dist: 0 };
  private fwd = new Vector3();
  private breath = new Vector3();
  private perf: PerfMonitor = new PerfMonitor();
  private drop = { pixel: false, shadows: false, bloom: false, particles: false };
  private ratio = 1;
  private contextLost = false;
  private events: StageEvents = {};

  constructor(
    private container: HTMLElement,
    private manifest: Manifest,
    private story: Story,
    private onHotspots: (items: HotspotOut) => void,
  ) {
    this.draco = new DRACOLoader();
    this.draco.setDecoderPath(url('draco/'));
    this.draco.setWorkerLimit(2);
    this.gltf = new GLTFLoader();
    this.gltf.setDRACOLoader(this.draco);

    try {
      const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = AgXToneMapping;
      renderer.shadowMap.type = PCFShadowMap;
      container.appendChild(renderer.domElement);
      this.renderer = renderer;
      renderer.domElement.addEventListener('webglcontextlost', this.onContextLost, false);
      renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored, false);
      const gl = renderer.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      this.software = /swiftshader|llvmpipe|software/i.test(name);
      this.cssGrade = new CssGrade(container, renderer.domElement, !this.software);
    } catch (err) {
      // The game stays playable without 3D: hotspots fall back to a screen layout.
      console.warn('[kalpa] WebGL unavailable', err);
    }

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    });
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.updateRunning();
    });
    this.hidden = document.hidden;
    this.updateRunning();
  }

  // --- Scene loading ---

  async load(
    sceneId: SceneId,
    hotspotIds: string[],
    onProgress: (loaded: number, total: number) => void,
  ): Promise<void> {
    const entry = modelFor(this.manifest, sceneKey(this.manifest, sceneId));
    let group: Group;
    let clips: AnimationClip[] = [];
    let isReal = false;

    const whale = modelFor(this.manifest, 'whale');
    const wantsWhale = !!whale && (sceneId === 'room5' || sceneId === 'ending');
    let total = 1;
    let done = 0;
    const part = (fraction: number) => onProgress(done + fraction, total);

    if (entry) {
      try {
        const gltf = await this.gltf.loadAsync(url(entry.file), (e) => {
          if (e.lengthComputable && e.total > 0) part(e.loaded / e.total);
        });
        group = gltf.scene;
        group.userData.real = true;
        clips = gltf.animations;
        isReal = true;
      } catch (err) {
        console.warn(`[kalpa] ${entry.file} failed, using placeholder`, err);
        group = buildPlaceholder(sceneId, hotspotIds);
      }
    } else {
      group = buildPlaceholder(sceneId, hotspotIds);
    }
    done += 1;

    const anchors = new Map<string, Object3D>();
    const charNodes: { id: string; node: Object3D }[] = [];
    let whaleAnchor: Object3D | null = null;
    group.traverse((o) => {
      if (o.name.startsWith('HS_')) anchors.set(o.name.slice(3), o);
      else if (o.name.startsWith('CHAR_')) charNodes.push({ id: o.name.slice(5), node: o });
      else if (o.name === 'whale_anchor') whaleAnchor = o;
    });
    if (isReal) {
      for (const id of sceneId === 'prologue' ? [] : CONTRACT_CHARACTERS[sceneId]) {
        if (!charNodes.some((c) => c.id === id)) console.warn(`[kalpa] ${sceneId} has no CHAR_${id}`);
      }
    }

    total += charNodes.length + (wantsWhale ? 1 : 0);
    const figures: { obj: Object3D; phase: number }[] = [];
    const extraClips: { clip: AnimationClip; root: Object3D }[] = [];
    await Promise.all(
      charNodes.map(async ({ id, node }, i) => {
        const obj = await this.loadCharacter(id);
        node.add(obj.root);
        figures.push({ obj: obj.root, phase: i * 1.7 });
        // Characters carry idle plus pose clips (seated, thrown_forward); playing them together folds the body.
        const idle = obj.clips.find((c) => c.name === 'idle') ?? obj.clips[0];
        if (idle) extraClips.push({ clip: idle, root: obj.root });
        done += 1;
        part(0);
      }),
    );
    if (wantsWhale && whale) {
      try {
        const gltf = await this.gltf.loadAsync(url(whale.file));
        gltf.scene.scale.setScalar(entry?.whaleScale ?? 1);
        (whaleAnchor ?? group).add(gltf.scene);
        gltf.animations.forEach((clip) => extraClips.push({ clip, root: gltf.scene }));
      } catch (err) {
        console.warn('[kalpa] whale failed to load', err);
      }
      done += 1;
      part(0);
    }

    this.install(sceneId, group, anchors, figures, clips, extraClips, entry);
    onProgress(total, total);
  }

  private async loadCharacter(id: string): Promise<{ root: Object3D; clips: AnimationClip[] }> {
    const entry = modelFor(this.manifest, `char_${id}`);
    if (entry) {
      try {
        const gltf = await this.gltf.loadAsync(url(entry.file));
        return { root: gltf.scene, clips: gltf.animations };
      } catch (err) {
        console.warn(`[kalpa] ${entry.file} failed, using a figure`, err);
      }
    }
    return { root: buildFigure(id, this.story.speakers[id]?.color ?? '#8899aa'), clips: [] };
  }

  private install(
    sceneId: SceneId,
    group: Group,
    anchors: Map<string, Object3D>,
    figures: { obj: Object3D; phase: number }[],
    clips: AnimationClip[],
    extraClips: { clip: AnimationClip; root: Object3D }[],
    entry: ModelEntry | null,
  ): void {
    for (const m of this.mixers) {
      m.stopAllAction();
      m.uncacheRoot(m.getRoot());
    }
    if (this.root) {
      this.scene.remove(this.root);
      disposeTree(this.root);
    }
    this.particles = null;
    this.accents = [];
    this.shadowLight = null;
    this.push.active = false;
    this.push.t = 0;
    this.root = group;
    this.anchors = anchors;
    this.figures = figures;
    this.sceneId = sceneId;
    this.materials.clear();
    this.scene.add(group);
    group.updateMatrixWorld(true);

    // Lights: a scene with none of its own still has to be visible.
    let hasLight = false;
    const isReal = group.userData.real === true;
    group.traverse((o) => {
      const l = o as Light;
      if (!l.isLight) return;
      hasLight = true;
      // glTF lights from Blender arrive in photometric units (sun in lux = W/m2 x 683, point in
      // inflated candela), which are 10 to 1000 times too hot for three.js. Convert back.
      if (isReal && !l.userData.converted) {
        l.userData.converted = true;
        const k = entry?.lightScale ?? 1;
        if ((l as DirectionalLight).isDirectionalLight) l.intensity *= SUN_UNITS * k * (entry?.sunScale ?? 1);
        else l.intensity *= POINT_UNITS * k;
      }
    });
    if (!hasLight) group.add(new HemisphereLight('#ffffff', '#222222', 1.5));
    if (isReal && entry?.ambient) {
      const a = entry.ambient;
      group.add(new HemisphereLight(new Color(a.sky), new Color(a.ground), a.intensity));
    }

    // Exposure and fog from the manifest.
    if (this.renderer) this.renderer.toneMappingExposure = entry?.exposure ?? 1;
    this.bloomK = entry?.bloom ?? 1;
    this.syncBloom();
    const fog = entry?.fog;
    this.scene.fog = fog ? new Fog(new Color(fog.color), fog.near, fog.far) : null;
    this.look = isReal ? ((entry as LookEntry | null)?.look ?? {}) : {};
    this.scene.background = new Color(
      this.look.background ?? fog?.color ?? (entry ? '#000000' : PALETTES[sceneId].secondary),
    );
    this.setupLook(group);

    // Camera.
    const cam = findCamera(group, 'CAM_main');
    if (cam) {
      cam.updateWorldMatrix(true, false);
      cam.getWorldPosition(this.basePos);
      cam.getWorldQuaternion(this.camera.quaternion);
      this.camera.near = cam.near;
      this.camera.far = cam.far;
      const aspect = cam.aspect > 0 && cam.aspect !== 1 ? cam.aspect : AUTHORED_ASPECT;
      const tanH = Math.tan(MathUtils.degToRad(cam.fov) / 2) * aspect;
      this.hFov = MathUtils.radToDeg(2 * Math.atan(tanH));
    } else {
      console.warn(`[kalpa] ${sceneId} has no CAM_main`);
      this.basePos.set(0, 2, 10);
      this.camera.quaternion.identity();
      this.hFov = 60;
    }
    this.camera.position.copy(this.basePos);
    this.applyFov();

    // Animation: a character or scene clip loops, the whale's eye waits for the final shot.
    this.mixers = [];
    this.eyeAction = null;
    const add = (clip: AnimationClip, root: Object3D) => {
      const mixer = new AnimationMixer(root);
      const action = mixer.clipAction(clip);
      if (clip.name === 'eye_open') {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        action.paused = true;
        this.eyeAction = action;
      } else {
        action.setLoop(LoopRepeat, Infinity);
        action.play();
      }
      mixer.update(0);
      this.mixers.push(mixer);
    };
    clips.forEach((clip) => add(clip, group));
    extraClips.forEach(({ clip, root }) => add(clip, root));

    this.eyeLid = group.getObjectByName('eye_lid') ?? null;
    this.eyeCam = findCamera(group, 'CAM_eye');
    this.lastSent = '';
    this.renderOnce();
  }

  /** Warm the HTTP cache for a final model. Unlisted models make no request. */
  prefetch(key: string): void {
    const entry = modelFor(this.manifest, key);
    if (entry) fetch(url(entry.file)).catch(() => undefined);
  }

  // --- Hub lighting, by mesh name ---

  sync(state: GameState): void {
    if (!this.root || this.sceneId !== 'hub') return;
    const accent = new Color(PALETTES.hub.accent);
    for (let n = 1; n <= 4; n++) {
      const room = `room${n}` as RoomId;
      const held = state.fragments.includes(n);
      this.light(`door_${n}`, accent, 0.14);
      this.light(`sym_door_${n}`, accent, state.visitedOrder.includes(room) ? 0.6 : 1.1);
      this.light(`sym_wall_${n}`, accent, held ? (state.fragments.length === 4 ? 2.2 : 1.3) : 0);
    }
  }

  private light(name: string, color: Color, intensity: number): void {
    let mats = this.materials.get(name);
    if (!mats) {
      mats = [];
      const collected = mats;
      this.root?.getObjectByName(name)?.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        // Clone so that a material shared between doors can be lit one door at a time.
        const clone = (mesh.material as Material).clone();
        mesh.material = clone;
        collected.push(clone);
      });
      this.materials.set(name, mats);
    }
    for (const m of mats) {
      if ((m as MeshStandardMaterial).isMeshStandardMaterial) {
        const std = m as MeshStandardMaterial;
        std.emissive.copy(color);
        std.emissiveIntensity = intensity;
      } else if ((m as MeshBasicMaterial).isMeshBasicMaterial) {
        (m as MeshBasicMaterial).color.copy(color).multiplyScalar(Math.min(intensity, 1));
      }
    }
  }

  // --- Moon pool monitor: dark until the monitor sequence, then lit with the decision panel ---

  lightMonitor(): void {
    if (this.sceneId !== 'moonpool' || !this.root) return;
    const root = this.root;
    root.traverse((o) => {
      const mesh = o as Mesh;
      const mat = mesh.isMesh ? (mesh.material as MeshStandardMaterial) : null;
      if (mat?.name === 'screen_moon') {
        new TextureLoader().load(url('textures/screen_moon.png'), (tex) => {
          tex.flipY = false;
          tex.colorSpace = SRGBColorSpace;
          mat.emissiveMap = tex;
          mat.emissive.set(1, 1, 1);
          mat.emissiveIntensity = 1.5;
          mat.needsUpdate = true;
        });
      }
    });
    const lamp = root.getObjectByName('light_monitor') as PointLight | undefined;
    if (lamp?.isLight) {
      lamp.color.setRGB(1, 0.45, 0.063);
      lamp.intensity = 22 * (this.manifest.models.moonpool?.lightScale ?? 1);
    }
  }

  // --- Final shot ---

  /**
   * Close-up on the eye: nothing may sit between the lens and the eyeball. Hide the tank glass and
   * light shafts, and take the hard mouth line out of the framing.
   */
  private clearEyeShot(): void {
    if (!this.root) return;
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const names = [mesh.name, ...mats.map((m) => m.name)];
      if (names.some((n) => /glass|pane|shaft/i.test(n))) mesh.visible = false;
      // The mouth line is a hard dark bar in close-up: repaint it as the skin around it.
      // A deeper, wetter eye: darker iris, tight glossy highlights, less cartoon.
      for (const m of mats) {
        const eye = m as MeshStandardMaterial;
        if (!eye.isMeshStandardMaterial || eye.userData.kEye) continue;
        eye.userData.kEye = true;
        if (/^whale_iris/.test(m.name)) {
          eye.roughness = m.name === 'whale_iris' ? 0.05 : 0.1;
          if (m.name !== 'whale_iris') eye.color.multiplyScalar(1.3);
        } else if (m.name === 'whale_sclera') {
          eye.roughness = 0.2;
          eye.emissive.set('#2a180f');
          eye.emissiveIntensity = 0.3;
        }
      }
      const skin = mats.find((m) => m.name === 'whale_slate') as MeshStandardMaterial | undefined;
      for (const m of mats) {
        if (m.name !== 'whale_mouth' || !(m as MeshStandardMaterial).isMeshStandardMaterial) continue;
        const std = m as MeshStandardMaterial;
        const ref = skin ?? this.findMaterial('whale_slate');
        if (ref) {
          std.color.copy(ref.color);
          std.roughness = ref.roughness;
          std.metalness = ref.metalness;
          std.map = ref.map;
        }
        std.emissive.set(0, 0, 0);
        std.needsUpdate = true;
      }
    });
    this.addEyeSocket();
  }

  /**
   * An eyelid fold in the whale's own skin, so the eyeball reads as set into the face. Built from
   * primitives and added to the scene group, so it is disposed with the scene and exists only in this shot.
   */
  private addEyeSocket(): void {
    const root = this.root;
    const anchor = root?.getObjectByName('whale_eyelid');
    if (!root || !anchor || root.getObjectByName('eye_socket')) return;
    const skin = this.findMaterial('whale_slate');
    if (!skin) return;
    const centre = anchor.getWorldPosition(new Vector3());

    const fold = skin.clone();
    fold.name = 'eye_socket_fold';
    fold.color.multiplyScalar(0.78);
    fold.roughness = Math.min(1, skin.roughness + 0.1);

    const group = new Group();
    group.name = 'eye_socket';
    group.position.copy(centre);

    // Almond fold: heavier upper lid, lighter lower lid, both overlapping the rim of the ball.
    const R = 0.2;
    const lids = new Group();
    const ring = new Mesh(new TorusGeometry(R, 0.045, 12, 64), fold);
    ring.name = 'eye_socket_ring';
    lids.add(ring);
    // Heavier upper lid: a thicker arc over the top, its ends rounded off so it blends into the ring.
    const a0 = Math.PI * 0.08;
    const a1 = Math.PI * 0.92;
    const upper = new Mesh(new TorusGeometry(R, 0.08, 14, 48, a1 - a0), fold);
    upper.rotation.z = a0;
    upper.name = 'eye_socket_upper';
    lids.add(upper);
    for (const a of [a0, a1]) {
      const cap = new Mesh(new SphereGeometry(0.08, 14, 10), fold);
      cap.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      cap.name = 'eye_socket_cap';
      lids.add(cap);
    }
    lids.scale.set(1.25, 0.85, 0.8);
    lids.position.z = 0.08;
    group.add(lids);

    root.add(group);
  }

  private findMaterial(name: string): MeshStandardMaterial | null {
    let found: MeshStandardMaterial | null = null;
    this.root?.traverse((o) => {
      const mesh = o as Mesh;
      if (found || !mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      found = (mats.find((m) => m.name === name) as MeshStandardMaterial | undefined) ?? null;
    });
    return found;
  }

  /** Switch to the eye camera and open the eye. Resolves with the time it takes, in ms. */
  startFinalShot(): number {
    if (this.eyeCam) {
      this.eyeCam.updateWorldMatrix(true, false);
      this.eyeCam.getWorldPosition(this.basePos);
      this.eyeCam.getWorldQuaternion(this.camera.quaternion);
      const aspect = this.eyeCam.aspect > 0 && this.eyeCam.aspect !== 1 ? this.eyeCam.aspect : AUTHORED_ASPECT;
      const tanH = Math.tan(MathUtils.degToRad(this.eyeCam.fov) / 2) * aspect;
      this.hFov = MathUtils.radToDeg(2 * Math.atan(tanH));
      this.applyFov();
      this.clearEyeShot();
      this.startPushIn();
    }
    if (this.eyeAction) {
      this.eyeAction.paused = false;
      return this.eyeAction.getClip().duration * 1000;
    }
    this.lidOpening = this.eyeLid ? 0.0001 : 0;
    return 2500;
  }

  private lidOpening = 0;

  /** A slow push toward the eye, a few percent of the distance, over about sixteen seconds. */
  private startPushIn(): void {
    this.fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const eye = this.root?.getObjectByName('whale_eyelid');
    const dist = eye ? eye.getWorldPosition(new Vector3()).distanceTo(this.basePos) : 6;
    this.push = { t: 0, active: !this.settings?.reducedMotion, dist: dist * 0.075 };
    this.particles?.recentre([this.basePos.x + this.fwd.x * 9, this.basePos.y + this.fwd.y * 9, this.basePos.z + this.fwd.z * 9]);
  }

  // --- Settings and run state ---

  applySettings(settings: Settings): void {
    const changed = !!this.settings && this.settings.quality !== settings.quality;
    this.settings = settings;
    this.updateGrade();
    // An explicit change of quality by the player starts the automatic reduction afresh.
    if (changed) this.drop = { pixel: false, shadows: false, bloom: false, particles: false };
    this.resize();
    void this.applyQuality();
    this.applyFx(false);
  }

  /** The look pipeline (bloom, grade, grain) needs a real GPU and the high setting. */
  private composerWanted(): boolean {
    return !!this.renderer && !this.software && this.settings?.quality === 'high';
  }

  private shadowsWanted(): boolean {
    return this.composerWanted() && !this.drop.shadows && !!this.shadowLight;
  }

  private async applyQuality(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    if (!this.composerWanted()) {
      if (this.composer) {
        this.composer.dispose();
        this.composer = null;
        this.bloom = null;
        this.gradePass = null;
      }
      this.updateGrade();
      return;
    }
    if (this.composer) {
      this.syncBloom();
      return;
    }
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] = await Promise.all([
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      import('three/examples/jsm/postprocessing/OutputPass.js'),
      import('three/examples/jsm/postprocessing/ShaderPass.js'),
    ]);
    if (!this.composerWanted() || this.composer) return;
    const target = new WebGLRenderTarget(this.w, this.h, { type: HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new Vector2(this.w, this.h), 0.35 * this.bloomK, 0.4, 1.6);
    this.bloom = bloom;
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const grade = new ShaderPass(GRADE_SHADER);
    this.gradePass = grade;
    composer.addPass(grade);
    composer.setPixelRatio(this.ratio);
    composer.setSize(this.w, this.h);
    this.composer = composer;
    this.syncBloom();
    this.updateGrade();
  }

  private syncBloom(): void {
    if (!this.bloom) return;
    this.bloom.strength = 0.35 * this.bloomK;
    this.bloom.enabled = this.bloomK > 0 && !this.drop.bloom;
  }

  /** Pushes the scene's grade into the shader pass, or into the CSS stand-in on low quality. */
  private updateGrade(): void {
    const g = gradeOf(this.look);
    const pass = this.gradePass;
    if (pass) {
      const u = pass.uniforms;
      (u.uTint.value as Vector3).set(...g.tint);
      (u.uLift.value as Vector3).set(...g.lift);
      u.uContrast.value = g.contrast;
      u.uSat.value = g.saturation;
      u.uVig.value = g.vignette;
      u.uGrain.value = g.grain;
      u.uAspect.value = this.w / this.h;
      u.uHaze.value = this.settings?.reducedMotion ? 0 : g.haze;
      (u.uFocus.value as Vector3).set(g.focus[0], g.focus[1], g.focusDark);
    }
    this.cssGrade?.set(g, !this.composer && !this.software);
  }

  /** Shadow maps and particles follow the quality setting and the automatic reduction. */
  private applyFx(instant: boolean): void {
    const r = this.renderer;
    if (!r) return;
    const want = this.shadowsWanted();
    this.shadowTarget = want ? 1 : 0;
    const light = this.shadowLight as (Light & { shadow: LightShadowLike }) | null;
    if (want) {
      r.shadowMap.enabled = true;
      if (light) light.castShadow = true;
      if (instant) this.shadowK = 1;
    } else if (instant || !this.shadowLight) {
      this.shadowK = 0;
      r.shadowMap.enabled = false;
      if (light) light.castShadow = false;
    }
    if (light) light.shadow.intensity = this.shadowBase * this.shadowK;
    // Accent lights cost per-pixel work, so low quality goes without them. Particles thin out instead.
    const rich = this.composerWanted();
    for (const l of this.accents) l.visible = rich;
    this.particles?.setDensity(rich ? 1 : 0.5);
    if (instant && this.particles) {
      this.particleFade = this.drop.particles ? 0 : 1;
      this.particles.setFade(this.particleFade);
    }
  }

  private setupLook(group: Group): void {
    const look = this.look;
    tuneMaterials(group, look);
    if (look.lightK) {
      group.traverse((o) => {
        const k = look.lightK?.[o.name];
        if (k !== undefined && (o as Light).isLight) (o as Light).intensity *= k;
      });
    }
    // Software rendering (and so the test suite) gets the lite look: no accent lights, particles or shimmer.
    const lite = this.software;
    for (const l of lite ? [] : (look.lights ?? [])) {
      let light: Light;
      if (l.kind === 'spot') {
        const spot = new SpotLight(l.color, l.intensity, l.distance ?? 0, l.angle ?? 0.4, l.penumbra ?? 0.85, 2);
        if (l.target) {
          spot.target.position.set(...l.target);
          group.add(spot.target);
        }
        light = spot;
      } else {
        light = new PointLight(l.color, l.intensity, l.distance ?? 0, 2);
      }
      light.name = 'look_light';
      light.position.set(...l.pos);
      group.add(light);
      this.accents.push(light);
    }
    group.updateMatrixWorld(true);

    markShadowCasters(group);
    const sh = look.shadows;
    const keyLight = sh ? (group.getObjectByName(sh.light) as (Light & { shadow?: LightShadowLike }) | undefined) : undefined;
    if (sh && keyLight?.shadow) {
      const shadow = keyLight.shadow;
      shadow.mapSize.set(sh.map ?? 2048, sh.map ?? 2048);
      shadow.bias = sh.bias ?? -0.0004;
      shadow.normalBias = sh.normalBias ?? 0.03;
      shadow.radius = sh.radius ?? 3;
      const cam = shadow.camera as OrthographicCamera & PerspectiveCamera;
      if ((keyLight as DirectionalLight).isDirectionalLight && sh.box) {
        shadow.updateMatrices(keyLight);
        const [x0, y0, z0, x1, y1, z1] = sh.box;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let minZ = Infinity;
        const v = new Vector3();
        for (const x of [x0, x1]) {
          for (const y of [y0, y1]) {
            for (const z of [z0, z1]) {
              v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
              minX = Math.min(minX, v.x);
              maxX = Math.max(maxX, v.x);
              minY = Math.min(minY, v.y);
              maxY = Math.max(maxY, v.y);
              minZ = Math.min(minZ, v.z);
            }
          }
        }
        cam.left = minX;
        cam.right = maxX;
        cam.bottom = minY;
        cam.top = maxY;
        cam.near = 0.1;
        cam.far = -minZ + 1;
        cam.updateProjectionMatrix();
      } else {
        cam.near = sh.near ?? 0.5;
        cam.far = sh.far ?? 40;
        cam.updateProjectionMatrix();
      }
      this.shadowLight = keyLight;
      this.shadowBase = sh.intensity ?? 0.85;
    }

    const chars: Object3D[] = [];
    group.traverse((o) => {
      if (o.name.startsWith('CHAR_')) chars.push(o);
    });
    group.add(buildContactShadows(group, chars, look.contact));

    if (look.particles && !lite) {
      const pf = new ParticleField(look.particles, this.timeU, this.h * this.ratio);
      this.particles = pf;
      group.add(pf.points);
    }
    if (!lite) applyShimmers(group, look, this.timeU);
    this.breathK = look.breathe ?? 1;
    this.perf.reset(performance.now(), 3000);
    this.updateGrade();
    this.applyFx(true);
  }

  // --- Automatic quality reduction ---

  /** One step down the ladder: pixel ratio, then shadows, then bloom, then particles. Never goes back up. */
  private reduceQuality(meanMs: number): void {
    const d = this.drop;
    let what = '';
    if (!d.pixel && this.ratio > 0.75) {
      d.pixel = true;
      what = 'pixel ratio';
      this.resize();
    } else if (!d.shadows && this.shadowsWanted()) {
      d.shadows = true;
      what = 'shadows';
      this.applyFx(false);
    } else if (!d.bloom && this.bloom?.enabled) {
      d.bloom = true;
      what = 'bloom';
      this.syncBloom();
    } else if (!d.particles && this.particles) {
      d.particles = true;
      what = 'particles';
    } else {
      this.perf.reset(performance.now(), 6000);
      return;
    }
    console.warn(`[kalpa] frame time ${meanMs.toFixed(1)} ms, reducing ${what}`);
    this.perf.reset(performance.now(), 3500);
    this.events.onQualityReduced?.(this.qualityState());
  }

  /** What the automatic reduction has taken away so far, for the UI and tests. */
  qualityState(): QualityState {
    return {
      quality: this.settings?.quality ?? 'high',
      pixelRatio: this.ratio,
      shadows: this.shadowTarget > 0,
      bloom: !!this.bloom?.enabled,
      grade: !!this.composer,
      particles: !!this.particles && !this.drop.particles,
      reduced: { ...this.drop },
    };
  }

  /** Optional hooks for the UI: a lost or restored WebGL context, and an automatic quality reduction. */
  setEvents(events: StageEvents): void {
    this.events = events;
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    console.warn('[kalpa] WebGL context lost; waiting for the browser to restore it');
    this.events.onContextLost?.();
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    console.warn('[kalpa] WebGL context restored');
    this.lastSent = '';
    this.perf.reset(performance.now(), 3000);
    this.renderOnce();
    this.events.onContextRestored?.();
  };

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.updateRunning();
  }

  /** The render loop rests while the prologue video has the screen. */
  setVideoActive(on: boolean): void {
    this.videoOn = on;
    if (this.renderer) this.renderer.domElement.style.visibility = on ? 'hidden' : 'visible';
    this.updateRunning();
  }

  private updateRunning(): void {
    const should = !this.paused && !this.hidden && !this.videoOn;
    if (should === this.running) return;
    this.running = should;
    if (should) {
      this.lastT = performance.now();
      this.fpsStart = this.lastT;
      this.fpsFrames = 0;
      this.raf = requestAnimationFrame(this.frame);
    } else {
      cancelAnimationFrame(this.raf);
    }
  }

  fps(): number {
    return this.fpsValue;
  }

  // --- Frame ---

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const rawMs = now - this.lastT;
    const dt = Math.min(rawMs / 1000, 0.1);
    this.lastT = now;
    this.time += dt;
    if (this.contextLost) return;

    this.fpsFrames += 1;
    if (now - this.fpsStart >= 1000) {
      this.fpsValue = Math.round((this.fpsFrames * 1000) / (now - this.fpsStart));
      this.fpsFrames = 0;
      this.fpsStart = now;
    }

    const still = !!this.settings?.reducedMotion;
    // Idle loops stand still with reduced motion on; the eye opening is story, so it always plays.
    const eyeMixer = this.eyeAction?.getMixer();
    for (const mixer of this.mixers) if (!still || mixer === eyeMixer) mixer.update(dt);

    // Drives every look effect (particles, shimmer, grain, breathing). Frozen when reduced motion is on.
    if (!still) this.animTime += dt;
    this.timeU.value = this.animTime;
    if (this.gradePass) this.gradePass.uniforms.uTime.value = this.animTime;
    this.stepFx(dt);
    if (!this.software) {
      const mean = this.perf.sample(now, rawMs);
      if (mean !== null && mean > POOR_FRAME_MS) this.reduceQuality(mean);
    }
    for (const { obj, phase } of this.figures) {
      obj.scale.y = still ? 1 : 1 + Math.sin(this.time * 1.3 + phase) * 0.006;
    }
    if (this.lidOpening > 0 && this.eyeLid) {
      this.lidOpening = Math.min(this.lidOpening + dt / 2, 1);
      this.eyeLid.position.y = 2.6 + this.lidOpening * 0.62;
    }

    const p = this.pointer;
    const ease = Math.min(dt * 3, 1);
    p.sx += ((still ? 0 : p.x) - p.sx) * ease;
    p.sy += ((still ? 0 : p.y) - p.sy) * ease;
    // Slow breathing on top of the pointer parallax, in camera space. Off when reduced motion is on.
    const bk = still ? 0 : this.breathK;
    const bt = this.animTime;
    this.breath.set(
      (Math.sin(bt * 0.43) * 0.032 + Math.sin(bt * 0.17 + 1) * 0.018) * bk,
      Math.sin(bt * 0.31 + 2) * 0.022 * bk,
      Math.sin(bt * 0.23) * 0.03 * bk,
    );
    this.tmp.set(p.sx * PARALLAX_X, -p.sy * PARALLAX_Y, 0).applyQuaternion(this.camera.quaternion);
    this.camera.position.copy(this.basePos).add(this.tmp);
    // Hotspots follow the pointer parallax but not the breathing, so the markers don't jitter.
    this.sendHotspots();
    if (bk > 0) {
      this.tmp.copy(this.breath).applyQuaternion(this.camera.quaternion);
      this.camera.position.add(this.tmp);
    }
    if (this.push.active) {
      this.push.t += still ? 0 : dt;
      const k = Math.min(this.push.t / 16, 1);
      const eased = 1 - (1 - k) * (1 - k) * (1 - k);
      this.camera.position.addScaledVector(this.fwd, this.push.dist * eased);
    }

    this.renderOnce();
  };

  /** Eases the shadow, particle and shimmer fades so a quality step never pops. */
  private stepFx(dt: number): void {
    const light = this.shadowLight as (Light & { shadow: LightShadowLike }) | null;
    if (light && this.shadowK !== this.shadowTarget) {
      const step = dt / 0.8;
      this.shadowK =
        this.shadowK < this.shadowTarget
          ? Math.min(this.shadowTarget, this.shadowK + step)
          : Math.max(this.shadowTarget, this.shadowK - step);
      light.shadow.intensity = this.shadowBase * this.shadowK;
      if (this.shadowK <= 0 && this.shadowTarget === 0 && this.renderer) {
        light.castShadow = false;
        this.renderer.shadowMap.enabled = false;
      }
    }
    if (this.particles) {
      const target = this.drop.particles ? 0 : 1;
      if (this.particleFade !== target) {
        const step = dt / 1.2;
        this.particleFade =
          this.particleFade < target ? Math.min(target, this.particleFade + step) : Math.max(target, this.particleFade - step);
        this.particles.setFade(this.particleFade);
      }
    }
  }

  private renderOnce(): void {
    if (!this.renderer || this.contextLost) return;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    document.documentElement.style.setProperty('--kalpa-stage-h', `${this.h}px`);
    if (this.renderer) {
      const ratio = this.pixelRatio();
      this.ratio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(this.w, this.h, false);
      this.composer?.setPixelRatio(ratio);
      this.composer?.setSize(this.w, this.h);
      this.particles?.setViewportHeight(this.h * ratio);
      if (this.gradePass) this.gradePass.uniforms.uAspect.value = this.w / this.h;
    }
    this.applyFov();
    this.lastSent = '';
    this.renderOnce();
    this.sendHotspots();
  }

  /**
   * Pixel ratio is capped by the quality setting and by a pixel budget, so a 4K or high-DPI screen
   * can't turn into a 9 million pixel frame with bloom on top. The automatic reduction lowers it further.
   */
  private pixelRatio(): number {
    if (this.software) return 1;
    const high = this.settings?.quality === 'high';
    let r = Math.min(window.devicePixelRatio || 1, high ? 1.75 : 1.25);
    r = Math.min(r, Math.sqrt((high ? 3.6e6 : 1.9e6) / (this.w * this.h)));
    if (this.drop.pixel) r *= 0.78;
    return Math.max(0.6, r);
  }

  /** Keeps the authored horizontal FOV at every aspect ratio. */
  private applyFov(): void {
    const aspect = this.w / this.h;
    const tanH = Math.tan(MathUtils.degToRad(this.hFov) / 2);
    this.camera.aspect = aspect;
    this.camera.fov = MathUtils.radToDeg(2 * Math.atan(tanH / aspect));
    this.camera.updateProjectionMatrix();
  }

  // --- Hotspots ---

  setHotspots(items: HotspotItem[]): void {
    this.items = items;
    this.sendHotspots();
  }

  private sendHotspots(): void {
    const rect = this.container.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const n = this.items.length;
    const out: HotspotOut = this.items.map((item, i) => {
      const anchor = this.anchors.get(item.id);
      let x: number;
      let y: number;
      if (anchor) {
        anchor.getWorldPosition(this.tmp).project(this.camera);
        x = rect.left + ((this.tmp.x + 1) / 2) * rect.width;
        y = rect.top + ((1 - this.tmp.y) / 2) * rect.height;
      } else {
        // No anchor in the GLB: lay it out on the screen so that it is never unreachable.
        x = rect.left + ((i + 0.5) / Math.max(n, 1)) * rect.width;
        y = rect.top + rect.height * 0.62;
      }
      x = MathUtils.clamp(x, rect.left + EDGE_MARGIN, rect.right - EDGE_MARGIN);
      y = MathUtils.clamp(y, rect.top + EDGE_MARGIN, rect.bottom - EDGE_MARGIN);
      return { ...item, x: Math.round(x), y: Math.round(y) };
    });
    const signature = JSON.stringify(out);
    if (signature === this.lastSent) return;
    this.lastSent = signature;
    this.onHotspots(out);
  }
}

function findCamera(root: Object3D, name: string): PerspectiveCamera | null {
  let found: PerspectiveCamera | null = null;
  root.traverse((o) => {
    if (found || !(o as PerspectiveCamera).isPerspectiveCamera) return;
    if (o.name === name || o.parent?.name === name) found = o as PerspectiveCamera;
  });
  return found;
}

function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const light = o as Light & { shadow?: { dispose(): void } };
    if (light.isLight && light.shadow) light.shadow.dispose();
    const skinned = o as SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton?.dispose();
    const mesh = o as Mesh;
    if (!mesh.isMesh && !(o as Points).isPoints) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      for (const value of Object.values(m)) {
        const tex = value as { isTexture?: boolean; userData?: { shared?: boolean }; dispose(): void } | null;
        if (tex && tex.isTexture && !tex.userData?.shared) tex.dispose();
      }
      m.dispose();
    }
  });
}
