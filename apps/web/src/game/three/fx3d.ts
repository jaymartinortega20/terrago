/**
 * Flashy combat effects for the 3D view: weapon slash arcs, glowing magic
 * circles, spell bolts with trails, hit bursts, healing pillars and loot
 * beams. All additive and bright so the bloom pass makes them shine.
 */
import * as THREE from 'three';
import { glowTexture } from './kit';

export interface Fx {
  obj: THREE.Object3D;
  born: number;
  until: number;
  update: (k: number) => void;
}

const texCache = new Map<string, THREE.Texture>();
function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d')!, size);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(key, t);
  }
  return t;
}

/** A rune circle (rings, runes, a star). */
function runeTexture(): THREE.Texture {
  return canvasTex('rune', 512, (g, s) => {
    const c = s / 2;
    g.translate(c, c);
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.shadowColor = '#ffffff';
    g.shadowBlur = 12;
    const ring = (r: number, w: number) => {
      g.lineWidth = w;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
    };
    ring(c * 0.95, 6);
    ring(c * 0.86, 3);
    ring(c * 0.55, 4);
    // Runes between the outer rings.
    g.font = `${Math.round(s * 0.06)}px serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.save();
      g.rotate(a);
      g.fillText(runes[i % runes.length]!, 0, -c * 0.905);
      g.restore();
    }
    // Six-point star.
    g.lineWidth = 3;
    for (const off of [0, Math.PI / 3]) {
      g.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = off + (i / 3) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * c * 0.55;
        const y = Math.sin(a) * c * 0.55;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
    ring(c * 0.18, 3);
  });
}

/** Soft vertical gradient (for pillars and beams). */
function beamTexture(): THREE.Texture {
  return canvasTex('beam', 128, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    const hr = g.createLinearGradient(0, 0, s, 0);
    hr.addColorStop(0, 'rgba(0,0,0,1)');
    hr.addColorStop(0.5, 'rgba(0,0,0,0)');
    hr.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = hr;
    g.fillRect(0, 0, s, s);
  });
}

/** A crescent slash (bright edge fading inward). */
function slashTexture(): THREE.Texture {
  return canvasTex('slash', 256, (g, s) => {
    const gr = g.createLinearGradient(0, 0, s, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.75, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });
}

const add = (color: string | number, map: THREE.Texture, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

export function slash(at: THREE.Vector3, yaw: number, color: string, big = false): Fx {
  const r = big ? 1.1 : 0.8;
  const geo = new THREE.RingGeometry(r * 0.55, r, 32, 1, -Math.PI * 0.45, Math.PI * 0.9);
  // Map the slash texture radially: brightest on the outer edge.
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const d = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (d - r * 0.55) / (r * 0.45), 0.5);
  }
  const m = new THREE.Mesh(geo, add(color, slashTexture()));
  const g = new THREE.Group();
  m.rotation.x = -Math.PI / 2 + 0.35;
  g.add(m);
  g.position.copy(at);
  g.rotation.y = yaw;
  const born = performance.now();
  return {
    obj: g,
    born,
    until: born + 260,
    update: (k) => {
      m.rotation.z = -0.9 + k * 1.8;
      (m.material as THREE.MeshBasicMaterial).opacity = 1 - k * k;
      g.scale.setScalar(0.85 + k * 0.3);
    },
  };
}

export function magicCircle(at: THREE.Vector3, color: string, size = 1.4, ms = 900): Fx {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size * 2), add(color, runeTexture(), 0.95));
  m.rotation.x = -Math.PI / 2;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.5, depthWrite: false }));
  glow.scale.set(size * 2.2, size * 0.8, 1);
  glow.position.y = 0.3;
  const g = new THREE.Group();
  g.add(m, glow);
  g.position.copy(at);
  g.position.y += 0.04;
  const born = performance.now();
  return {
    obj: g,
    born,
    until: born + ms,
    update: (k) => {
      const grow = Math.min(1, k * 5);
      m.scale.setScalar(0.3 + grow * 0.7);
      m.rotation.z = k * 2.5;
      const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      (m.material as THREE.MeshBasicMaterial).opacity = 0.95 * fade;
      (glow.material as THREE.SpriteMaterial).opacity = 0.5 * fade;
    },
  };
}

export function pillar(at: THREE.Vector3, color: string, h = 3.2, ms = 900): Fx {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, h, 24, 1, true), add(color, beamTexture(), 0.9));
  m.position.y = h / 2;
  const g = new THREE.Group();
  g.add(m);
  g.position.copy(at);
  const born = performance.now();
  return {
    obj: g,
    born,
    until: born + ms,
    update: (k) => {
      m.scale.set(1 - k * 0.5, 0.3 + Math.min(1, k * 4) * 0.7, 1 - k * 0.5);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      m.rotation.y = k * 3;
    },
  };
}

export function bolt(from: THREE.Vector3, to: THREE.Vector3, color: string, ms = 240): Fx {
  const g = new THREE.Group();
  const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffffff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  head.scale.setScalar(0.5);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  halo.scale.setScalar(1.3);
  g.add(halo, head);
  const trail: THREE.Sprite[] = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6 - i * 0.09 }));
    s.scale.setScalar(0.8 - i * 0.1);
    trail.push(s);
    g.add(s);
  }
  const born = performance.now();
  const p = new THREE.Vector3();
  return {
    obj: g,
    born,
    until: born + ms,
    update: (k) => {
      p.lerpVectors(from, to, k);
      p.y += Math.sin(k * Math.PI) * 0.35;
      head.position.copy(p);
      halo.position.copy(p);
      trail.forEach((s, i) => {
        const kk = Math.max(0, k - (i + 1) * 0.05);
        s.position.lerpVectors(from, to, kk);
        s.position.y += Math.sin(kk * Math.PI) * 0.35;
      });
    },
  };
}

export function burst(at: THREE.Vector3, color: string, n: number, size: number): Fx {
  const g = new THREE.Group();
  const parts: { s: THREE.Sprite; v: THREE.Vector3 }[] = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: i % 3 ? color : '#ffffff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    s.scale.setScalar(0.18 * size);
    const a = Math.random() * Math.PI * 2;
    parts.push({ s, v: new THREE.Vector3(Math.cos(a) * (1 + Math.random()) * size, (0.5 + Math.random() * 2) * size, Math.sin(a) * (1 + Math.random()) * size) });
    g.add(s);
  }
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  g.add(flash);
  g.position.copy(at);
  const born = performance.now();
  return {
    obj: g,
    born,
    until: born + 420,
    update: (k) => {
      for (const q of parts) {
        q.s.position.set(q.v.x * k * 0.45, q.v.y * k * 0.45 - 1.6 * k * k * 0.45, q.v.z * k * 0.45);
        (q.s.material as THREE.SpriteMaterial).opacity = 1 - k;
      }
      flash.scale.setScalar(size * (0.6 + k * 1.6));
      (flash.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - k);
    },
  };
}

/** A tall coloured light beam over loot (like the rarity beams in mobile RPGs). */
export function lootBeam(color: string): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 3, 16, 1, true), add(color, beamTexture(), 0.75));
  m.position.y = 1.5;
  m.name = 'beam';
  return m;
}

export function sparkle(at: THREE.Vector3, color: string, life = 0.5): Fx {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  s.position.set(at.x + (Math.random() - 0.5) * 0.4, at.y, at.z + (Math.random() - 0.5) * 0.4);
  s.scale.setScalar(0.3);
  const born = performance.now();
  return { obj: s, born, until: born + life * 1000, update: (k) => ((s.material as THREE.SpriteMaterial).opacity = 1 - k) };
}

export function ringWave(at: THREE.Vector3, color: string, r: number, ms = 500): Fx {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.copy(at);
  m.position.y += 0.05;
  const born = performance.now();
  return {
    obj: m,
    born,
    until: born + ms,
    update: (k) => {
      m.scale.setScalar(0.2 + k * r);
      (m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    },
  };
}
