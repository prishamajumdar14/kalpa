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
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { EngineEvents, GameState, RoomId, SceneId, Settings } from './api';
import type { HotspotItem } from './core';
import { CONTRACT_CHARACTERS, PALETTES, buildFigure, buildPlaceholder } from './placeholder';
import type { Manifest, ModelEntry, Story } from './types';

type HotspotOut = EngineEvents['hotspots:update']['items'];

interface Composer {
  setSize(w: number, h: number): void;
  setPixelRatio(r: number): void;
  render(): void;
  dispose(): void;
}

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
      container.appendChild(renderer.domElement);
      this.renderer = renderer;
      const gl = renderer.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      this.software = /swiftshader|llvmpipe|software/i.test(name);
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
    if (this.root) {
      this.scene.remove(this.root);
      disposeTree(this.root);
    }
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
    if (this.bloom) this.bloom.strength = 0.35 * this.bloomK;
    const fog = entry?.fog;
    this.scene.fog = fog ? new Fog(new Color(fog.color), fog.near, fog.far) : null;
    this.scene.background = new Color(fog?.color ?? (entry ? '#000000' : PALETTES[sceneId].secondary));

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

  /** Switch to the eye camera and open the eye. Resolves with the time it takes, in ms. */
  startFinalShot(): number {
    if (this.eyeCam) {
      this.eyeCam.updateWorldMatrix(true, false);
      this.eyeCam.getWorldPosition(this.basePos);
      this.eyeCam.getWorldQuaternion(this.camera.quaternion);
      // Centre the eye in frame: the whale is re-exported separately, so its eye can drift from where
      // CAM_eye was aimed. Slide the camera sideways in its own plane, keeping distance and lens.
      const lid = this.root?.getObjectByName('whale_eyelid');
      if (lid) {
        lid.updateWorldMatrix(true, false);
        const eye = lid.getWorldPosition(new Vector3());
        const fwd = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const rel = eye.clone().sub(this.basePos);
        this.basePos.add(rel.sub(fwd.multiplyScalar(rel.dot(fwd))));
        // A sideways nudge (manifest eyeShift, metres) slides the tank's frame post off the eye by parallax.
        const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        this.basePos.addScaledVector(right, this.manifest.models.ending?.eyeShift ?? 0);
      }
      const aspect = this.eyeCam.aspect > 0 && this.eyeCam.aspect !== 1 ? this.eyeCam.aspect : AUTHORED_ASPECT;
      const tanH = Math.tan(MathUtils.degToRad(this.eyeCam.fov) / 2) * aspect;
      this.hFov = MathUtils.radToDeg(2 * Math.atan(tanH));
      this.applyFov();
    }
    if (this.eyeAction) {
      this.eyeAction.paused = false;
      return this.eyeAction.getClip().duration * 1000;
    }
    this.lidOpening = this.eyeLid ? 0.0001 : 0;
    return 2500;
  }

  private lidOpening = 0;

  // --- Settings and run state ---

  applySettings(settings: Settings): void {
    this.settings = settings;
    this.resize();
    void this.applyQuality();
  }

  private bloomWanted(): boolean {
    return !!this.renderer && !this.software && this.settings?.quality === 'high';
  }

  private async applyQuality(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    if (!this.bloomWanted()) {
      this.composer?.dispose();
      this.composer = null;
      this.bloom = null;
      return;
    }
    if (this.composer) return;
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      import('three/examples/jsm/postprocessing/OutputPass.js'),
    ]);
    if (!this.bloomWanted() || this.composer) return;
    const target = new WebGLRenderTarget(this.w, this.h, { type: HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new Vector2(this.w, this.h), 0.35 * this.bloomK, 0.4, 1.6);
    this.bloom = bloom;
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(this.w, this.h);
    this.composer = composer;
  }

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
    const dt = Math.min((now - this.lastT) / 1000, 0.1);
    this.lastT = now;
    this.time += dt;

    this.fpsFrames += 1;
    if (now - this.fpsStart >= 1000) {
      this.fpsValue = Math.round((this.fpsFrames * 1000) / (now - this.fpsStart));
      this.fpsFrames = 0;
      this.fpsStart = now;
    }

    for (const mixer of this.mixers) mixer.update(dt);

    const still = !!this.settings?.reducedMotion;
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
    this.tmp.set(p.sx * PARALLAX_X, -p.sy * PARALLAX_Y, 0).applyQuaternion(this.camera.quaternion);
    this.camera.position.copy(this.basePos).add(this.tmp);

    this.renderOnce();
    this.sendHotspots();
  };

  private renderOnce(): void {
    if (!this.renderer) return;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    document.documentElement.style.setProperty('--kalpa-stage-h', `${this.h}px`);
    if (this.renderer) {
      const ratio = this.software ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(this.w, this.h, false);
      this.composer?.setPixelRatio(ratio);
      this.composer?.setSize(this.w, this.h);
    }
    this.applyFov();
    this.lastSent = '';
    this.renderOnce();
    this.sendHotspots();
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
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      for (const value of Object.values(m)) {
        if (value && (value as { isTexture?: boolean }).isTexture) (value as { dispose(): void }).dispose();
      }
      m.dispose();
    }
  });
}
