// Look development helpers for the stage: per-scene config, colour-grade shader, contact shadows,
// drifting particles, cheap water and caustic shimmer, material tuning. Nothing here changes
// game logic; the Stage owns the lifecycle and calls into these.
import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  Points,
  Raycaster,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three';
import type { ModelEntry } from './types';

export type V3 = [number, number, number];

export interface LookGrade {
  /** Multiplies the final colour per channel (warm or cold cast). */
  tint?: V3;
  /** Colour poured into the darkest tones so pure black becomes deep colour. */
  lift?: V3;
  contrast?: number;
  saturation?: number;
  vignette?: number;
  grain?: number;
  /** Heat haze: a slight shimmering ripple near the horizon (high quality, motion only). */
  haze?: number;
  /** Local darkening around a point (screen uv, y up): the subject emerges from shadow. */
  focus?: [number, number];
  focusDark?: number;
}

export interface LookLight {
  kind: 'spot' | 'point';
  color: string;
  intensity: number;
  pos: V3;
  target?: V3;
  angle?: number;
  penumbra?: number;
  distance?: number;
}

export interface LookShadow {
  /** Name of the glTF light that casts. */
  light: string;
  /** World box (minx, miny, minz, maxx, maxy, maxz) the directional shadow camera must cover. */
  box?: number[];
  near?: number;
  far?: number;
  bias?: number;
  normalBias?: number;
  radius?: number;
  intensity?: number;
  map?: number;
}

export interface LookParticles {
  color: string;
  count: number;
  /** World size of a speck. */
  size: number;
  opacity: number;
  box: V3;
  center: V3;
  /** Drift velocity in world units per second. */
  drift: V3;
  sway?: number;
  blend?: 'add' | 'normal';
  /** Specks are brightest near this world point and thin out away from it (light paths). */
  focus?: V3;
  focusRadius?: number;
  /** Brightness left far from the focus, 0 to 1. */
  focusMin?: number;
}

export interface LookMat {
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  color?: string;
  colorScale?: number;
  opacity?: number;
  /** Lights the base-colour map from within, so thin lettering stays legible. */
  emissiveFromMap?: number;
  /** Soft haze: alpha fades with height (y0 clear, y1 full) and towards the silhouette edge. */
  haze?: { y0: number; y1: number; edge: number; low: number };
}

export interface LookShimmer {
  mats: string[];
  tint: string;
  strength: number;
  scale: number;
  speed: number;
  plane?: 'xz' | 'xy';
  /** Broad soft dapples instead of thin bright lines. */
  soft?: boolean;
}

export interface LookConfig {
  background?: string;
  grade?: LookGrade;
  lights?: LookLight[];
  shadows?: LookShadow;
  particles?: LookParticles;
  mat?: Record<string, LookMat>;
  /** Intensity multipliers for the glTF lights, by name. */
  lightK?: Record<string, number>;
  shimmer?: LookShimmer[];
  /** Any emissive brighter than this (intensity x brightest channel) is brought down so it keeps detail. */
  emissiveCap?: number;
  /** Pull near-white albedo down to this value for tonal range. Skips lit signs and textured materials. */
  whiteCap?: number;
  contact?: { opacity?: number; skip?: string[]; props?: boolean };
  /** Camera breathing multiplier, 1 is the default, 0 turns it off for this scene. */
  breathe?: number;
}

export type LookEntry = ModelEntry & { look?: LookConfig };

export const NEUTRAL_GRADE: Required<LookGrade> = {
  tint: [1, 1, 1],
  lift: [0, 0, 0],
  contrast: 1,
  saturation: 1,
  vignette: 0.18,
  grain: 0.02,
  haze: 0,
  focus: [0.5, 0.5],
  focusDark: 0,
};

export function gradeOf(look: LookConfig | undefined): Required<LookGrade> {
  return { ...NEUTRAL_GRADE, ...(look?.grade ?? {}) };
}

// --- Colour grade ---------------------------------------------------------------------------------

/** Runs after OutputPass, so it works on display-referred sRGB values. */
export const GRADE_SHADER = {
  name: 'KalpaGrade',
  uniforms: {
    tDiffuse: { value: null as unknown },
    uTint: { value: new Vector3(1, 1, 1) },
    uLift: { value: new Vector3(0, 0, 0) },
    uContrast: { value: 1 },
    uSat: { value: 1 },
    uVig: { value: 0.2 },
    uGrain: { value: 0.02 },
    uTime: { value: 0 },
    uAspect: { value: 16 / 9 },
    uHaze: { value: 0 },
    uFocus: { value: new Vector3(0.5, 0.5, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uTint;
    uniform vec3 uLift;
    uniform float uContrast;
    uniform float uSat;
    uniform float uVig;
    uniform float uGrain;
    uniform float uTime;
    uniform float uAspect;
    uniform float uHaze;
    uniform vec3 uFocus;
    varying vec2 vUv;
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    // Smooth value noise on an irrational-stepped, rotated lattice, so no pixel-aligned pattern shows.
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = p - i;
      f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    void main() {
      vec2 uv = vUv;
      float hm = smoothstep(0.36, 0.5, uv.y) * smoothstep(0.68, 0.54, uv.y);
      uv.x += sin(uv.y * 150.0 + uTime * 1.7 + sin(uv.x * 9.0 + uTime * 0.7) * 2.0) * 0.0016 * uHaze * hm;
      uv.y += cos(uv.x * 80.0 + uTime * 1.3) * 0.0005 * uHaze * hm;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      c = max(c, 0.0);
      vec3 inv = 1.0 - min(c, 1.0);
      c += uLift * inv * inv;
      c *= uTint;
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      float d = length(q) / 0.95;
      float v = smoothstep(0.32, 1.12, d);
      c *= 1.0 - uVig * v * v;
      vec2 fq = vec2(uFocus.x, uFocus.y);
      float fd = length((vUv - fq) * vec2(uAspect, 1.0));
      c *= 1.0 - uFocus.z * smoothstep(0.18, 0.75, fd);
      // Grain: two soft, rotated, differently scaled noise layers that move every frame. No repeat, no grid.
      float ft = floor(uTime * 24.0);
      vec2 o1 = vec2(hash(vec2(ft, 1.7)), hash(vec2(ft, 9.1))) * 400.0;
      vec2 o2 = vec2(hash(vec2(ft, 4.3)), hash(vec2(ft, 7.7))) * 400.0;
      mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
      float n1 = vnoise(rot * gl_FragCoord.xy * 0.62 + o1);
      float n2 = vnoise(rot * gl_FragCoord.xy * 1.27 + 17.0 + o2);
      float g = (n1 + n2) * 0.5 - 0.5;
      c += g * uGrain * 1.4 * (0.55 + 0.45 * (1.0 - l));
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

/** Low quality has no composer: a CSS vignette and a light canvas filter stand in for the grade. */
export class CssGrade {
  private overlay: HTMLDivElement;
  constructor(
    container: HTMLElement,
    private canvas: HTMLCanvasElement,
    private allowFilter: boolean,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;';
    container.appendChild(this.overlay);
  }
  set(g: Required<LookGrade>, active: boolean): void {
    const v = active ? g.vignette : 0;
    this.overlay.style.background = `radial-gradient(ellipse 78% 78% at 50% 50%, rgba(0,0,0,0) 46%, rgba(0,0,0,${(v * 1.05).toFixed(3)}) 100%)`;
    this.overlay.style.opacity = active ? '1' : '0';
    this.canvas.style.filter =
      active && this.allowFilter ? `contrast(${g.contrast.toFixed(3)}) saturate(${g.saturation.toFixed(3)})` : '';
  }
  dispose(): void {
    this.overlay.remove();
    this.canvas.style.filter = '';
  }
}

// --- Procedural textures (tiny, shared) -----------------------------------------------------------

let radialTex: CanvasTexture | null = null;
let boxTex: CanvasTexture | null = null;

function makeAlphaTexture(fn: (x: number, y: number) => number): CanvasTexture {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(n, n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, Math.min(1, fn((i + 0.5) / n * 2 - 1, (j + 0.5) / n * 2 - 1)));
        const k = (j * n + i) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = 0;
        img.data[k + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const t = new CanvasTexture(c);
  t.userData.shared = true;
  return t;
}

function radialTexture(): CanvasTexture {
  radialTex ??= makeAlphaTexture((x, y) => {
    const d = Math.hypot(x, y);
    const s = 1 - Math.min(1, d);
    return s * s * (3 - 2 * s);
  });
  return radialTex;
}

function boxTexture(): CanvasTexture {
  boxTex ??= makeAlphaTexture((x, y) => {
    // Soft rounded box: signed distance to a box of half size 0.62, feathered over the rest.
    const qx = Math.abs(x) - 0.42;
    const qy = Math.abs(y) - 0.42;
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
    const s = 1 - Math.max(0, Math.min(1, d / 0.58));
    return s * s * (3 - 2 * s);
  });
  return boxTex;
}

// --- Contact shadows ------------------------------------------------------------------------------

const PROP_SKIP =
  /backdrop|sky|sun_disc|floor|shell|wall|ground|ridge|seabed|street|deck|facade|foreground|tank|skin|rib|colonnade|strip|crack|fx_|ghost|glass|light|^HS_|^CHAR_|camera|sign|poster|window|cable|overhead|gantry|crane|hub_|pool|rim|neural|frames|threshold|^sym_|^door_|anchor|monitor_stand|passage|memory|exit_arch|screen_|logbook/i;

function isGroundCandidate(m: Mesh): boolean {
  if (!m.visible) return false;
  const mat = m.material as Material;
  if (!mat || (mat as Material).transparent) return false;
  return true;
}

export function buildContactShadows(
  root: Object3D,
  charNodes: Object3D[],
  cfg: LookConfig['contact'] | undefined,
): Group {
  const out = new Group();
  out.name = 'look_contact';
  const opacity = cfg?.opacity ?? 0.5;
  const skip = cfg?.skip ?? [];
  root.updateMatrixWorld(true);

  const meshes: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && !(m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh && isGroundCandidate(m)) meshes.push(m);
  });
  const ray = new Raycaster();
  ray.far = 3;
  const down = new Vector3(0, -1, 0);

  const groundAt = (x: number, y: number, z: number, exclude: Set<Object3D>): number | null => {
    ray.set(new Vector3(x, y, z), down);
    const hits = ray.intersectObjects(
      meshes.filter((m) => !exclude.has(m) && !/backdrop|sky/.test(m.name)),
      false,
    );
    return hits.length ? hits[0].point.y : null;
  };
  const subtree = (o: Object3D): Set<Object3D> => {
    const s = new Set<Object3D>();
    o.traverse((c) => s.add(c));
    return s;
  };

  const add = (x: number, y: number, z: number, w: number, d: number, round: boolean, a: number, name: string) => {
    const mat = new MeshBasicMaterial({
      map: round ? radialTexture() : boxTexture(),
      color: 0x000000,
      transparent: true,
      opacity: a,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: false,
      toneMapped: false,
    });
    const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
    mesh.name = name;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.012, z);
    mesh.scale.set(w, d, 1);
    mesh.renderOrder = 2;
    mesh.frustumCulled = true;
    out.add(mesh);
  };

  for (const node of charNodes) {
    const p = node.getWorldPosition(new Vector3());
    const own = subtree(node);
    const gy = groundAt(p.x, p.y + 0.3, p.z, own) ?? p.y;
    add(p.x, gy, p.z, 1.5, 1.2, true, Math.min(1, opacity * 1.15), `contact_${node.name}`);
  }

  if (cfg?.props !== false) {
    const box = new Box3();
    for (const child of root.children) {
      if (!child.name || PROP_SKIP.test(child.name) || skip.includes(child.name)) continue;
      if ((child as unknown as { isLight?: boolean }).isLight || (child as unknown as { isCamera?: boolean }).isCamera) continue;
      box.setFromObject(child);
      if (box.isEmpty()) continue;
      const w = box.max.x - box.min.x;
      const d = box.max.z - box.min.z;
      const h = box.max.y - box.min.y;
      if (h < 0.15 || w * d > 150 || Math.min(w, d) < 0.35) continue;
      if (box.min.y < -0.2 || box.min.y > 0.6) continue;
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      const gy = groundAt(cx, box.min.y + 0.35, cz, subtree(child)) ?? box.min.y;
      const pad = Math.min(1.1, 0.28 + 0.12 * Math.sqrt(w * d));
      add(cx, gy, cz, w + pad * 1.6, d + pad * 1.6, false, opacity, `contact_${child.name}`);
    }
  }
  return out;
}

// --- Particles ------------------------------------------------------------------------------------

export class ParticleField {
  readonly points: Points;
  private mat: ShaderMaterial;

  private count: number;

  constructor(cfg: LookParticles, time: { value: number }, viewportH: number) {
    const n = Math.max(8, Math.round(cfg.count));
    this.count = n;
    const seed = new Float32Array(n * 4);
    // Deterministic pseudo-random so every visit looks the same.
    let s = 1234567;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n * 4; i++) seed[i] = rnd();
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aSeed', new BufferAttribute(seed, 4));
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: cfg.blend === 'normal' ? NormalBlending : AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: time,
        uBox: { value: new Vector3(...cfg.box) },
        uDrift: { value: new Vector3(...cfg.drift) },
        uSway: { value: cfg.sway ?? 0.25 },
        uSize: { value: cfg.size },
        uColor: { value: new Color(cfg.color) },
        uOpacity: { value: cfg.opacity },
        uFade: { value: 1 },
        uViewH: { value: viewportH },
        uFocus: { value: new Vector4(...(cfg.focus ?? [0, 0, 0]), cfg.focus ? (cfg.focusRadius ?? 6) : 0) },
        uFocusMin: { value: cfg.focusMin ?? 0.15 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uBox; uniform vec3 uDrift; uniform float uSway;
        uniform float uSize; uniform float uViewH; uniform float uFade;
        uniform vec4 uFocus; uniform float uFocusMin;
        attribute vec4 aSeed;
        varying float vA;
        void main() {
          vec3 p = (aSeed.xyz - 0.5) * uBox;
          p += uDrift * uTime * (0.55 + aSeed.w);
          p += vec3(sin(uTime * 0.31 + aSeed.w * 40.0), cos(uTime * 0.23 + aSeed.x * 30.0), sin(uTime * 0.27 + aSeed.y * 50.0)) * uSway;
          p = mod(p + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 q = p / (uBox * 0.5);
          float edge = (1.0 - pow(abs(q.x), 6.0)) * (1.0 - pow(abs(q.y), 6.0)) * (1.0 - pow(abs(q.z), 6.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          // Size and brightness vary a lot: mostly tiny dim motes, a few larger soft ones.
          float v1 = aSeed.w * aSeed.w;
          float v2 = aSeed.x * aSeed.x;
          float sz = uSize * (0.35 + v1 * 2.2);
          float ps = sz * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.1);
          gl_PointSize = clamp(ps, 2.0, 30.0);
          float lightPath = 1.0;
          if (uFocus.w > 0.0) {
            vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
            lightPath = mix(uFocusMin, 1.0, 1.0 - smoothstep(0.0, uFocus.w, distance(wp, uFocus.xyz)));
          }
          float small = clamp(ps / 3.0, 0.35, 1.0);
          vA = edge * uFade * (0.15 + 0.85 * v2) * lightPath * small;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.0, 1.0, d));
          a = a * a * vA * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new Points(geo, this.mat);
    this.points.name = 'look_particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.position.set(...cfg.center);
  }

  setFade(f: number): void {
    this.mat.uniforms.uFade.value = f;
    this.points.visible = f > 0.002;
  }
  /** Fraction of the specks that are drawn. */
  setDensity(f: number): void {
    this.points.geometry.setDrawRange(0, Math.max(1, Math.round(this.count * f)));
  }
  setViewportHeight(h: number): void {
    this.mat.uniforms.uViewH.value = h;
  }
  recentre(center: V3): void {
    this.points.position.set(...center);
  }
}

// --- Materials ------------------------------------------------------------------------------------

function stdMats(root: Object3D, skinned: boolean | null = null): MeshStandardMaterial[] {
  const set = new Set<MeshStandardMaterial>();
  root.traverse((o) => {
    const mesh = o as Mesh & { isSkinnedMesh?: boolean };
    if (!mesh.isMesh) return;
    if (skinned !== null && !!mesh.isSkinnedMesh !== skinned) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if ((m as MeshStandardMaterial).isMeshStandardMaterial) set.add(m as MeshStandardMaterial);
    }
  });
  return [...set];
}

/** Per-material overrides, white compression, and emissive cap. Idempotent per loaded scene. */
export function tuneMaterials(root: Object3D, look: LookConfig): void {
  const cap = look.emissiveCap ?? 3;
  const white = look.whiteCap;
  for (const m of stdMats(root)) {
    const o = look.mat?.[m.name];
    if (o) {
      if (o.roughness !== undefined) m.roughness = o.roughness;
      if (o.metalness !== undefined) m.metalness = o.metalness;
      if (o.color) m.color.set(o.color);
      if (o.colorScale !== undefined) m.color.multiplyScalar(o.colorScale);
      if (o.emissive) m.emissive.set(o.emissive);
      if (o.emissiveIntensity !== undefined) m.emissiveIntensity = o.emissiveIntensity;
      if (o.opacity !== undefined) m.opacity = o.opacity;
      if (o.emissiveFromMap && m.map) {
        m.emissiveMap = m.map;
        m.emissive.set('#ffffff');
        m.emissiveIntensity = o.emissiveFromMap;
      }
      if (o.haze) patchHaze(m, o.haze);
    }
    const e = Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity;
    if (e > cap && !o?.emissiveIntensity) m.emissiveIntensity *= cap / e;
    if (white && !o?.color && !m.map && !m.emissiveMap && !m.transparent && e < 0.05) {
      const top = Math.max(m.color.r, m.color.g, m.color.b);
      if (top > white) m.color.multiplyScalar(white / top);
    }
  }
}

/** Light-cone haze: alpha is faint, fades with distance from the lamp, and feathers at the silhouette. */
function patchHaze(mat: MeshStandardMaterial, h: NonNullable<LookMat['haze']>): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHz = { value: new Vector4(h.y0, h.y1, h.edge, h.low) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHW;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvHW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uHz; varying vec3 vHW;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float hzF = abs(dot(normalize(normal), normalize(vViewPosition)));
         float hzH = mix(uHz.w, 1.0, smoothstep(uHz.x, uHz.y, vHW.y));
         diffuseColor.a *= pow(clamp(hzF, 0.0, 1.0), uHz.z) * hzH;`,
      );
  };
  mat.customProgramCacheKey = () => 'kalpa-haze';
  mat.needsUpdate = true;
}

const CAUSTIC_GLSL = /* glsl */ `
  uniform float uKTime; uniform vec3 uKTint; uniform float uKStr; uniform float uKScale; uniform float uKPlane;
  varying vec3 vKW;
  float kCaustic(vec2 p, float t) {
    float v = 0.0;
    v += sin(p.x * 2.0 + sin(p.y * 1.7 + t * 0.6) * 1.5 + t * 0.5);
    v += sin(p.y * 2.3 + sin(p.x * 1.9 - t * 0.5) * 1.4 - t * 0.4);
    v += sin((p.x + p.y) * 1.5 + sin(p.x * 0.8 + t * 0.3) + t * 0.35);
    float r = 1.0 - abs(sin(v * 1.15));
    return pow(r, 4.0);
  }
  float kDapple(vec2 p, float t) {
    float v = sin(p.x * 1.3 + sin(p.y * 1.1 + t * 0.5) * 1.2 + t * 0.4) + sin(p.y * 1.5 + sin(p.x * 0.9 - t * 0.4) * 1.1 - t * 0.3);
    float r = 0.5 + 0.25 * v;
    return r * r * r;
  }`;

/** Adds a moving caustic or shimmer to a standard material's emissive. Cheap: no textures. */
export function patchShimmer(
  mat: MeshStandardMaterial,
  time: { value: number },
  cfg: LookShimmer,
  strengthRef: { value: number },
): void {
  const tint = new Color(cfg.tint);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uKTime = time;
    shader.uniforms.uKTint = { value: tint };
    shader.uniforms.uKStr = strengthRef;
    shader.uniforms.uKScale = { value: cfg.scale };
    shader.uniforms.uKPlane = { value: cfg.plane === 'xy' ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKW;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvKW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CAUSTIC_GLSL}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         vec2 kp = (uKPlane > 0.5 ? vec2(vKW.x + vKW.z, vKW.y) : vKW.xz) * uKScale;
         totalEmissiveRadiance += uKTint * ${cfg.soft ? 'kDapple' : 'kCaustic'}(kp, uKTime * ${cfg.speed.toFixed(3)}) * uKStr;`,
      );
  };
  mat.customProgramCacheKey = () => `kalpa-shimmer-${cfg.plane ?? 'xz'}-${cfg.speed}-${cfg.soft ? 's' : 'l'}`;
  mat.needsUpdate = true;
}

export function applyShimmers(
  root: Object3D,
  look: LookConfig,
  time: { value: number },
): { value: number }[] {
  const refs: { value: number }[] = [];
  for (const s of look.shimmer ?? []) {
    const strength = { value: s.strength };
    refs.push(strength);
    for (const m of stdMats(root)) if (s.mats.includes(m.name)) patchShimmer(m, time, s, strength);
  }
  return refs;
}

// --- Shadows --------------------------------------------------------------------------------------

const NO_RECEIVE = /sign|lbl|label|_name$|poster|research|kalpa|symbol/i;
const NO_CAST = /backdrop|sky|sun_disc|fx_|glass|shaft|ghost|cone|wake|water|seam|^lab_sign/i;

export function markShadowCasters(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const see = mats.some((m) => m.transparent && m.opacity < 0.9) || NO_CAST.test(mesh.name) || mats.some((m) => NO_CAST.test(m.name));
    mesh.castShadow = !see;
    // Text and sign decals read flat: shadows would muddy the lettering.
    mesh.receiveShadow = !see && !mats.some((m) => NO_RECEIVE.test(m.name)) && !NO_RECEIVE.test(mesh.name);
  });
}
