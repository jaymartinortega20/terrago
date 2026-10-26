/**
 * A small Three.js stage for the stable: a low-poly mount turning on a
 * pedestal with your chibi character riding it. Everything is built from
 * simple shapes (no model files) so it loads instantly.
 */
import * as THREE from 'three';

export interface ShowcaseMount {
  kind: string;
  color: string;
  glow?: string | null;
  saddle?: string | null;
  barding?: string | null;
  trail?: string | null;
  /** Locked: a dark silhouette, no rider. */
  locked?: boolean;
}

export interface ShowcaseRider {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
}

const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, metalness: 0.05, ...extra });

function part(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function mountShade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + k)));
  return `#${c.getHexString()}`;
}

/** Four legs, a body, neck, head and tail: horses, stags, wolves and boars. */
export function quadruped(g: THREE.Group, kind: string, m: ShowcaseMount, body: THREE.Material, dark: THREE.Material): number {
  const boar = kind === 'boar';
  const wolf = kind === 'wolf';
  const long = boar ? 1.15 : 1.4;
  const tall = boar ? 0.55 : wolf ? 0.7 : 0.95;
  const thick = boar ? 0.75 : 0.55;
  g.add(part(new THREE.CapsuleGeometry(thick / 2, long, 3, 8), body, 0, tall + thick / 2, 0, 0, 0, Math.PI / 2));
  // legs
  for (const [x, z] of [
    [0.55, 0.2],
    [0.55, -0.2],
    [-0.55, 0.2],
    [-0.55, -0.2],
  ] as const) {
    g.add(part(new THREE.CylinderGeometry(0.08, 0.06, tall + 0.1, 6), dark, x * (long / 1.4), (tall + 0.1) / 2, z));
    g.add(part(new THREE.BoxGeometry(0.14, 0.08, 0.14), mat('#2a2030'), x * (long / 1.4), 0.04, z));
  }
  const headY = tall + thick + (boar ? 0.05 : 0.45);
  const headX = long / 2 + (boar ? 0.35 : 0.45);
  if (!boar) g.add(part(new THREE.CylinderGeometry(0.15, 0.22, 0.7, 6), body, long / 2 + 0.18, tall + thick / 2 + 0.35, 0, 0, 0, -0.75));
  g.add(part(new THREE.BoxGeometry(wolf ? 0.42 : 0.5, 0.3, 0.3), body, headX, headY, 0, 0, 0, wolf ? 0 : -0.25));
  // snout + eyes
  g.add(part(new THREE.BoxGeometry(0.22, 0.18, 0.22), dark, headX + 0.28, headY - 0.06, 0));
  for (const z of [0.12, -0.12]) g.add(part(new THREE.BoxGeometry(0.05, 0.06, 0.04), mat('#1a1420'), headX + 0.08, headY + 0.06, z * 1.3));
  if (wolf) for (const z of [0.1, -0.1]) g.add(part(new THREE.ConeGeometry(0.07, 0.2, 4), body, headX - 0.08, headY + 0.24, z));
  else if (!boar) for (const z of [0.09, -0.09]) g.add(part(new THREE.ConeGeometry(0.05, 0.14, 4), body, headX - 0.12, headY + 0.2, z));
  if (boar) for (const z of [0.13, -0.13]) g.add(part(new THREE.ConeGeometry(0.04, 0.22, 5), mat('#efe7cf'), headX + 0.34, headY - 0.02, z, 0, 0, -1.2));
  if (kind === 'stag') {
    const antler = mat(m.glow ? m.glow : '#d6c79f', m.glow ? { emissive: new THREE.Color(m.glow), emissiveIntensity: 0.8 } : {});
    for (const z of [0.12, -0.12]) {
      g.add(part(new THREE.CylinderGeometry(0.025, 0.035, 0.5, 5), antler, headX - 0.1, headY + 0.38, z, z > 0 ? 0.35 : -0.35, 0, 0.25));
      g.add(part(new THREE.CylinderGeometry(0.02, 0.03, 0.26, 5), antler, headX - 0.02, headY + 0.48, z * 1.9, z > 0 ? 0.9 : -0.9, 0, -0.3));
      g.add(part(new THREE.CylinderGeometry(0.02, 0.03, 0.24, 5), antler, headX - 0.22, headY + 0.56, z * 1.4, z > 0 ? 0.2 : -0.2, 0, 0.8));
    }
  }
  // mane and tail
  if (kind === 'horse') g.add(part(new THREE.BoxGeometry(0.5, 0.12, 0.08), dark, long / 2 + 0.12, tall + thick + 0.25, 0, 0, 0, -0.75));
  g.add(part(new THREE.ConeGeometry(wolf ? 0.12 : 0.09, wolf ? 0.6 : 0.7, 5), wolf ? body : dark, -long / 2 - 0.35, tall + thick / 2, 0, 0, 0, wolf ? 1.9 : 2.5));
  if (m.barding) {
    const plate = mat(m.barding, { metalness: 0.7, roughness: 0.35 });
    g.add(part(new THREE.CylinderGeometry(thick / 2 + 0.05, thick / 2 + 0.05, long * 0.75, 8, 1, true, Math.PI * 0.15, Math.PI * 0.7), plate, 0, tall + thick / 2, 0, Math.PI / 2, 0, Math.PI / 2));
    g.add(part(new THREE.BoxGeometry(0.24, 0.22, 0.34), plate, headX + 0.05, headY + 0.04, 0));
  }
  return tall + thick + 0.02;
}

export function wyvern(g: THREE.Group, m: ShowcaseMount, body: THREE.Material, dark: THREE.Material): number {
  g.add(part(new THREE.CapsuleGeometry(0.32, 1.1, 3, 8), body, 0, 0.95, 0, 0, 0, Math.PI / 2));
  for (const x of [0.4, -0.35]) for (const z of [0.18, -0.18]) g.add(part(new THREE.CylinderGeometry(0.1, 0.07, 0.75, 6), dark, x, 0.4, z));
  g.add(part(new THREE.CylinderGeometry(0.12, 0.18, 0.8, 6), body, 0.85, 1.35, 0, 0, 0, -0.7));
  g.add(part(new THREE.BoxGeometry(0.5, 0.26, 0.3), body, 1.25, 1.7, 0));
  for (const z of [0.1, -0.1]) g.add(part(new THREE.ConeGeometry(0.05, 0.3, 4), mat('#d6c79f'), 1.05, 1.92, z, 0, 0, 0.9));
  g.add(part(new THREE.ConeGeometry(0.14, 1.2, 5), body, -1.2, 0.95, 0, 0, 0, 1.75));
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.9, 0.2, 1.4, 0.5, 0.1, 1.2, 0, 0, 0, 0.5, 0.1, 1.2, -0.9, 0.2, 1.4], 3));
  wing.computeVertexNormals();
  const wm = mat(mountShade(m.color, 0.15), { side: THREE.DoubleSide });
  const left = part(wing, wm, 0.1, 1.25, 0.2);
  const right = part(wing, wm, 0.1, 1.25, -0.2);
  right.scale.z = -1;
  left.name = 'wingL';
  right.name = 'wingR';
  g.add(left, right);
  return 1.27;
}

export function hovergear(g: THREE.Group, m: ShowcaseMount, body: THREE.Material): number {
  const glow = m.glow ?? '#5ad0ff';
  g.add(part(new THREE.CylinderGeometry(0.85, 0.7, 0.3, 10), body, 0, 0.75, 0));
  const ring = part(new THREE.TorusGeometry(0.8, 0.06, 6, 20), mat(glow, { emissive: new THREE.Color(glow), emissiveIntensity: 1.2 }), 0, 0.72, 0, Math.PI / 2);
  ring.name = 'ring';
  g.add(ring);
  g.add(part(new THREE.BoxGeometry(0.5, 0.35, 0.5), mat(m.barding ?? mountShade(m.color, -0.15), { metalness: 0.6, roughness: 0.4 }), 0.35, 1.05, 0));
  for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) {
    const jet = part(new THREE.ConeGeometry(0.12, 0.35, 6), mat(glow, { emissive: new THREE.Color(glow), emissiveIntensity: 1.5, transparent: true, opacity: 0.85 }), x, 0.42, z, Math.PI);
    jet.name = 'jet';
    g.add(jet);
  }
  return 0.92;
}

/** A chibi rider: big head, small body, legs around the mount. */
function rider(r: ShowcaseRider, seatY: number, x: number): THREE.Group {
  const g = new THREE.Group();
  const skin = mat(r.skin);
  g.add(part(new THREE.BoxGeometry(0.34, 0.4, 0.3), mat(r.shirt), 0, seatY + 0.28, 0));
  for (const z of [0.2, -0.2]) {
    g.add(part(new THREE.BoxGeometry(0.12, 0.34, 0.12), mat(r.pants), 0.05, seatY + 0.02, z, z > 0 ? 0.35 : -0.35));
    g.add(part(new THREE.BoxGeometry(0.1, 0.3, 0.1), mat(r.shirt), 0.12, seatY + 0.3, z * 1.05, 0, 0, -0.8));
    g.add(part(new THREE.SphereGeometry(0.06, 6, 5), skin, 0.26, seatY + 0.2, z * 1.05));
  }
  g.add(part(new THREE.SphereGeometry(0.32, 10, 8), skin, 0.02, seatY + 0.78, 0));
  const hair = part(new THREE.SphereGeometry(0.34, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(r.hair), -0.02, seatY + 0.82, 0, 0, 0, 0.25);
  g.add(hair);
  for (const z of [0.1, -0.1]) g.add(part(new THREE.BoxGeometry(0.04, 0.09, 0.05), mat('#1a1420'), 0.31, seatY + 0.76, z));
  g.position.x = x;
  return g;
}

export class MountShowcase {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private model = new THREE.Group();
  private sparks: THREE.Points | null = null;
  private raf = 0;
  private angle = 0.6;
  private dragging: { x: number; angle: number } | null = null;
  private last = performance.now();
  private glowLight: THREE.PointLight;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

    this.scene.add(new THREE.HemisphereLight('#dfe8ff', '#3a2f4a', 1.1));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
    sun.position.set(3, 6, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -3;
    sun.shadow.camera.right = 3;
    sun.shadow.camera.top = 3;
    sun.shadow.camera.bottom = -3;
    this.scene.add(sun);
    this.glowLight = new THREE.PointLight('#ffffff', 0, 4);
    this.glowLight.position.set(0, 1.3, 0.8);
    this.scene.add(this.glowLight);

    // A floating-island pedestal: grass top, rocky underside.
    const top = part(new THREE.CylinderGeometry(1.9, 1.75, 0.22, 14), mat('#5f9443'), 0, -0.11, 0);
    const rock = part(new THREE.ConeGeometry(1.75, 1.3, 14), mat('#6d5a4a'), 0, -0.87, 0, Math.PI);
    top.receiveShadow = true;
    this.scene.add(top, rock, this.model);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, angle: this.angle };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.dragging) this.angle = this.dragging.angle + (e.clientX - this.dragging.x) * 0.012;
    });
    el.addEventListener('pointerup', () => (this.dragging = null));
    el.addEventListener('pointercancel', () => (this.dragging = null));
    this.resize();
    this.loop();
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    // Keep the whole mount (antlers and wings too) in view on tall or wide panels.
    const fitH = 3.2;
    const fitW = 4.2;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const dist = Math.max(fitH / 2 / Math.tan(vFov / 2), fitW / 2 / (Math.tan(vFov / 2) * this.camera.aspect)) + 1.2;
    this.camera.position.set(0, 1.25 + dist * 0.18, dist);
    this.camera.lookAt(0, 1.05, 0);
    this.camera.updateProjectionMatrix();
  }

  show(m: ShowcaseMount, who: ShowcaseRider | null): void {
    for (const c of [...this.model.children]) this.model.remove(c);
    if (this.sparks) {
      this.scene.remove(this.sparks);
      this.sparks = null;
    }
    const locked = !!m.locked;
    const body = locked ? mat('#151320', { roughness: 1 }) : mat(m.color, m.glow ? { emissive: new THREE.Color(m.glow), emissiveIntensity: 0.15 } : {});
    const dark = locked ? body : mat(mountShade(m.color, -0.18));
    const g = new THREE.Group();
    let seat: number;
    if (m.kind === 'wyvern') seat = wyvern(g, m, body, dark);
    else if (m.kind === 'hovergear') seat = hovergear(g, m, body);
    else seat = quadruped(g, m.kind, m, body, dark);
    if (!locked) {
      const saddle = mat(m.saddle ?? '#7a3a2a');
      g.add(part(new THREE.BoxGeometry(0.5, 0.08, 0.6), saddle, -0.05, seat, 0));
      g.add(part(new THREE.BoxGeometry(0.1, 0.16, 0.5), saddle, 0.2, seat + 0.06, 0));
      if (who) g.add(rider(who, seat + 0.02, -0.05));
    }
    g.position.x = m.kind === 'wyvern' ? -0.1 : -0.2;
    this.model.add(g);
    this.glowLight.intensity = m.glow && !locked ? 6 : 0;
    if (m.glow) this.glowLight.color.set(m.glow);
    if (m.trail && !locked) {
      const n = 60;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pos.set([Math.cos(a) * 1.5, 0.2 + Math.random() * 1.6, Math.sin(a) * 1.5], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.sparks = new THREE.Points(geo, new THREE.PointsMaterial({ color: m.trail, size: 0.07, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.scene.add(this.sparks);
    }
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.dragging) this.angle += dt * 0.5;
    this.model.rotation.y = this.angle;
    const t = now / 1000;
    this.model.position.y = Math.sin(t * 1.6) * 0.03;
    this.model.traverse((o) => {
      if (o.name === 'wingL') o.rotation.x = Math.sin(t * 4) * 0.35;
      if (o.name === 'wingR') o.rotation.x = -Math.sin(t * 4) * 0.35;
      if (o.name === 'ring') o.rotation.z = t * 2;
      if (o.name === 'jet') o.scale.y = 0.8 + Math.sin(t * 20 + o.position.x * 3) * 0.2;
    });
    if (this.sparks) this.sparks.rotation.y = -t * 0.8;
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
