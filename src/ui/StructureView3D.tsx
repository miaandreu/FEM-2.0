import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { deformedMember3D, type Analysis3D } from '../fem/analyze3d';
import { orientation3D } from '../fem/element3d';
import { fmtNum } from './format';
import { UNIT_SYSTEMS, type FemModel } from '../model';
import { describeModel } from './describe';

export interface StructureView3DProps {
  model: FemModel;
  analysis: Analysis3D | null;
  showDeformed: boolean;
  scale: number;
  showDofs: boolean;
  selectedElement: number | null;
  selectedNode: number | null;
  onSelectElement: (id: number | null) => void;
  onSelectNode: (id: number | null) => void;
  theme: 'light' | 'dark';
  /** Change to re-fit the camera (e.g. after loading another model). */
  fitKey: number;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

/** Text label as a camera-facing sprite sized in world units. */
function makeLabel(text: string, color: string, height: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontPx = 48;
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  canvas.width = w;
  canvas.height = fontPx + 16;
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  sprite.renderOrder = 10;
  return sprite;
}

const V = (a: ArrayLike<number>) => new THREE.Vector3(a[0], a[1], a[2]);

function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, color: string): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), new THREE.MeshBasicMaterial({ color }));
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      (x as THREE.SpriteMaterial).map?.dispose?.();
      x.dispose();
    }
  });
}

export default function StructureView3D(p: StructureView3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    content: THREE.Group; raycaster: THREE.Raycaster; render: () => void;
  } | null>(null);
  const bounds = useRef<{ center: THREE.Vector3; size: number }>({ center: new THREE.Vector3(), size: 1 });
  const cb = useRef(p);
  cb.current = p;
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [webglOk, setWebglOk] = useState(true);

  const fit = useCallback(() => {
    const t = three.current;
    if (!t) return;
    const { center, size } = bounds.current;
    const dist = size * 1.9 + 1e-6;
    t.controls.target.copy(center);
    t.camera.position.set(center.x + dist * 0.75, center.y - dist * 0.9, center.z + dist * 0.65);
    t.camera.near = dist / 500;
    t.camera.far = dist * 50;
    t.camera.updateProjectionMatrix();
    t.controls.update();
    t.render();
  }, []);

  // ---- one-time setup ----
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setWebglOk(false);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    const content = new THREE.Group();
    scene.add(content);
    const raycaster = new THREE.Raycaster();
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    three.current = { renderer, scene, camera, controls, content, raycaster, render };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // picking: click selects, hover shows a tooltip
    const pick = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(content.children.filter((c) => c.userData.pick), false);
      if (!hits.length) return null;
    const nodeHit = hits.find((h) => h.object.userData.kind === 'node');
    return (nodeHit ?? hits[0]).object.userData as { kind: 'node' | 'element'; id: number; text: string };
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (ev: PointerEvent) => { down = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) return;
      const h = pick(ev);
      if (!h) { cb.current.onSelectElement(null); cb.current.onSelectNode(null); }
      else if (h.kind === 'element') { cb.current.onSelectElement(h.id); cb.current.onSelectNode(null); }
      else cb.current.onSelectNode(h.id);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.buttons) return setTip(null);
      const h = pick(ev);
      const r = el.getBoundingClientRect();
      setTip(h ? { x: ev.clientX - r.left + 12, y: ev.clientY - r.top + 12, text: h.text } : null);
    };
    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerleave', () => setTip(null));
    return () => {
      ro.disconnect();
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointermove', onMove);
      controls.dispose();
      disposeGroup(content);
      renderer.dispose();
      el.removeChild(dom);
      three.current = null;
    };
  }, []);

  // ---- rebuild the drawn content whenever the model / results / options change ----
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    disposeGroup(t.content);
    t.content.clear();
    const { model, analysis } = p;
    const unit = UNIT_SYSTEMS[model.units];
    const fg = css('--fg'), muted = css('--muted'), accent = css('--accent'), loadC = css('--load'), supC = css('--support'), defC = css('--deformed'), lineC = css('--line');
    const pts = model.nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z));
    const box = new THREE.Box3();
    pts.forEach((q) => box.expandByPoint(q));
    if (analysis?.ok && p.showDeformed) for (const e of analysis.elements) for (const q of deformedMember3D(analysis, e, p.scale, 9).deformed) box.expandByPoint(new THREE.Vector3(q.x, q.y, q.z));
    if (pts.length === 0) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length() / 1.7, 1e-6);
    bounds.current = { center, size };
    const S = size;
    const G = t.content;
    const add = (o: THREE.Object3D) => { G.add(o); return o; };
    const label = (text: string, at: THREE.Vector3, color: string, h = S * 0.045) => {
      const s = makeLabel(text, color, h);
      s.position.copy(at);
      add(s);
    };
    const arrow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, color: string, head = 0.28) =>
      add(new THREE.ArrowHelper(dir.clone().normalize(), from, len, color, len * head, len * head * 0.55));

    // global axes triad at the minimum corner
    const o0 = new THREE.Vector3(box.min.x - S * 0.15, box.min.y - S * 0.15, box.min.z);
    [['X', [1, 0, 0]], ['Y', [0, 1, 0]], ['Z', [0, 0, 1]]].forEach(([n, d]) => {
      const dir = V(d as number[]);
      arrow(o0, dir, S * 0.2, muted);
      label(n as string, o0.clone().addScaledVector(dir, S * 0.24), muted);
    });

    // elements
    const orient = new Map<number, ReturnType<typeof orientation3D>>();
    for (const e of model.elements) {
      const ni = model.nodes[e.nodeI - 1], nj = model.nodes[e.nodeJ - 1];
      if (!ni || !nj || e.nodeI === e.nodeJ) continue;
      const a = V([ni.x, ni.y, ni.z]), b = V([nj.x, nj.y, nj.z]);
      if (a.distanceTo(b) < 1e-12) continue;
      const o = orientation3D(ni, nj, e.refVector, e.rollAngleDeg ?? 0);
      orient.set(e.id, o);
      const sel = p.selectedElement === e.id;
      const dashed = p.showDeformed && analysis?.ok;
      const mesh = cylinderBetween(a, b, S * (sel ? 0.009 : 0.006), sel ? accent : dashed ? muted : lineC);
      (mesh.material as THREE.MeshBasicMaterial).transparent = !!dashed;
      (mesh.material as THREE.MeshBasicMaterial).opacity = dashed ? 0.45 : 1;
      add(mesh);
      // invisible, fatter proxy so thin members are easy to click and hover
      const proxy = cylinderBetween(a, b, S * 0.022, '#000000');
      (proxy.material as THREE.MeshBasicMaterial).transparent = true;
      (proxy.material as THREE.MeshBasicMaterial).opacity = 0;
      (proxy.material as THREE.MeshBasicMaterial).depthWrite = false;
      proxy.userData = { pick: true, kind: 'element', id: e.id, text: `Element ${e.id}: node ${e.nodeI} → ${e.nodeJ}, L = ${fmtNum(o.L)} ${unit.length}` };
      add(proxy);
      const mid = a.clone().lerp(b, 0.5);
      label(String(e.id), mid.clone().addScaledVector(V(o.ey), S * 0.04), fg, S * 0.05);
      // local axes: x̂ on every element, the full triad on the selected one
      const base = a.clone().lerp(b, 0.62);
      const axLen = S * (sel ? 0.1 : 0.06);
      arrow(base, V(o.ex), axLen, '#ef4444');
      if (sel) {
        arrow(base, V(o.ey), axLen, '#22c55e');
        arrow(base, V(o.ez), axLen, '#3b82f6');
        label('x̂', base.clone().addScaledVector(V(o.ex), axLen * 1.2), '#ef4444', S * 0.04);
        label('ŷ', base.clone().addScaledVector(V(o.ey), axLen * 1.2), '#22c55e', S * 0.04);
        label('ẑ', base.clone().addScaledVector(V(o.ez), axLen * 1.2), '#3b82f6', S * 0.04);
      }
      // hinges
      for (const [end, rel, pos] of [['i', e.releaseI, a.clone().lerp(b, 0.06)], ['j', e.releaseJ, a.clone().lerp(b, 0.94)]] as const) {
        if (rel.rx || rel.ry || rel.rz) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(S * 0.016, 12, 8), new THREE.MeshBasicMaterial({ color: css('--bg') }));
          s.position.copy(pos);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(S * 0.016, S * 0.003, 6, 16), new THREE.MeshBasicMaterial({ color: fg }));
          ring.position.copy(pos);
          add(s); add(ring);
          s.userData = { tip: `Release at node ${end}` };
        }
      }
    }

    // nodes
    for (const n of model.nodes) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(S * (p.selectedNode === n.id ? 0.017 : 0.012), 14, 10), new THREE.MeshBasicMaterial({ color: p.selectedNode === n.id ? accent : fg }));
      m.position.set(n.x, n.y, n.z);
      add(m);
      const nproxy = new THREE.Mesh(new THREE.SphereGeometry(S * 0.032, 10, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      nproxy.position.copy(m.position);
      nproxy.userData = { pick: true, kind: 'node', id: n.id, text: `Node ${n.id} at (${fmtNum(n.x)}, ${fmtNum(n.y)}, ${fmtNum(n.z)}) ${unit.length}` };
      add(nproxy);
      label(String(n.id), new THREE.Vector3(n.x, n.y, n.z).add(new THREE.Vector3(S * 0.03, -S * 0.03, S * 0.04)), fg, S * 0.055);
      if (p.showDofs) label(`DOF ${(n.id - 1) * 6 + 1}–${n.id * 6}`, new THREE.Vector3(n.x, n.y, n.z).add(new THREE.Vector3(S * 0.03, S * 0.03, -S * 0.05)), muted, S * 0.035);
    }

    // supports
    for (const s of model.supports) {
      const n = model.nodes[s.nodeId - 1];
      if (!n || s.fixed.length !== 6) continue;
      const at = new THREE.Vector3(n.x, n.y, n.z);
      const [fx, fy, fz, rx, ry, rz] = s.fixed;
      const mat = new THREE.MeshBasicMaterial({ color: supC });
      if (fx && fy && fz && rx && ry && rz) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(S * 0.05, S * 0.05, S * 0.05), mat);
        b.position.copy(at); add(b);
      } else if (fx && fy && fz) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(S * 0.03, S * 0.06, 16), mat);
        c.rotation.x = Math.PI / 2; // cone axis is +Y by default; rotate it to +Z so the apex points up at the node
        c.position.copy(at).add(new THREE.Vector3(0, 0, -S * 0.03)); add(c);
      } else {
        [fx, fy, fz].forEach((f, ax) => {
          if (!f) return;
          const d = new THREE.Vector3(ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0);
          add(cylinderBetween(at.clone().addScaledVector(d, -S * 0.04), at.clone().addScaledVector(d, S * 0.04), S * 0.004, supC));
          const cap = new THREE.Mesh(new THREE.SphereGeometry(S * 0.01, 8, 6), mat);
          cap.position.copy(at).addScaledVector(d, -S * 0.04); add(cap);
        });
        if (rx || ry || rz) { const b = new THREE.Mesh(new THREE.BoxGeometry(S * 0.03, S * 0.03, S * 0.03), mat); b.position.copy(at); add(b); }
      }
      label(`${[fx && 'x', fy && 'y', fz && 'z', rx && 'θx', ry && 'θy', rz && 'θz'].filter(Boolean).join(' ')} fixed`, at.clone().add(new THREE.Vector3(S * 0.04, 0, -S * 0.07)), supC, S * 0.035);
    }

    // nodal loads
    const maxF = Math.max(1e-12, ...model.nodalLoads.filter((l) => l.dof < 3).map((l) => Math.abs(l.value)));
    const maxM = Math.max(1e-12, ...model.nodalLoads.filter((l) => l.dof >= 3).map((l) => Math.abs(l.value)));
    for (const l of model.nodalLoads) {
      const n = model.nodes[l.nodeId - 1];
      if (!n || l.value === 0 || l.dof > 5) continue;
      const at = new THREE.Vector3(n.x, n.y, n.z);
      const ax = l.dof % 3;
      const d = new THREE.Vector3(ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0).multiplyScalar(Math.sign(l.value));
      if (l.dof < 3) {
        const len = S * (0.12 + 0.1 * (Math.abs(l.value) / maxF));
        arrow(at.clone().addScaledVector(d, -len - S * 0.015), d, len, loadC);
        label(`${fmtNum(l.value)} ${unit.force}`, at.clone().addScaledVector(d, -len - S * 0.035).add(new THREE.Vector3(0, 0, S * 0.03)), loadC, S * 0.04);
      } else {
        // moment vector: double-headed arrow (right-hand rule)
        const len = S * (0.1 + 0.08 * (Math.abs(l.value) / maxM));
        const from = at.clone().addScaledVector(d, -len - S * 0.015);
        arrow(from, d, len, '#c026d3');
        arrow(from.clone().addScaledVector(d, len * 0.3), d, len * 0.7, '#c026d3');
        label(`M${'xyz'[ax]} = ${fmtNum(l.value)} ${unit.moment}`, from.clone().add(new THREE.Vector3(0, 0, S * 0.03)), '#c026d3', S * 0.04);
      }
    }

    // distributed loads
    const maxW = Math.max(1e-12, ...model.elementLoads.map((l) => Math.max(Math.abs(l.w1), Math.abs(l.kind === 'linear' ? l.w2 : l.w1))));
    for (const l of model.elementLoads) {
      const e = model.elements[l.elementId - 1];
      const o = orient.get(l.elementId);
      if (!e || !o) continue;
      const a = V([model.nodes[e.nodeI - 1].x, model.nodes[e.nodeI - 1].y, model.nodes[e.nodeI - 1].z]);
      const b = V([model.nodes[e.nodeJ - 1].x, model.nodes[e.nodeJ - 1].y, model.nodes[e.nodeJ - 1].z]);
      const ai = l.axis === 'x' ? 0 : l.axis === 'y' ? 1 : 2;
      const dir = l.coordSys === 'global' ? new THREE.Vector3(ai === 0 ? 1 : 0, ai === 1 ? 1 : 0, ai === 2 ? 1 : 0) : V([o.ex, o.ey, o.ez][ai]);
      const w2 = l.kind === 'linear' ? l.w2 : l.w1;
      const tails: THREE.Vector3[] = [];
      for (let i = 0; i < 7; i++) {
        const tt = i / 6;
        const w = l.w1 + (w2 - l.w1) * tt;
        if (w === 0) { tails.push(a.clone().lerp(b, tt)); continue; }
        const len = S * (0.03 + 0.07 * (Math.abs(w) / maxW));
        const d = dir.clone().multiplyScalar(Math.sign(w));
        const pt = a.clone().lerp(b, tt);
        const tail = pt.clone().addScaledVector(d, -len);
        tails.push(tail);
        arrow(tail, d, len, loadC, 0.4);
      }
      add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(tails), new THREE.LineBasicMaterial({ color: loadC })));
      label(`${fmtNum(l.w1)}${l.kind === 'linear' ? `→${fmtNum(l.w2)}` : ''} ${unit.force}/${unit.length}`, tails[3].clone().add(new THREE.Vector3(0, 0, S * 0.03)), loadC, S * 0.035);
    }

    // deformed shape
    if (analysis?.ok && p.showDeformed) {
      for (const e of analysis.elements) {
        const pts3 = deformedMember3D(analysis, e, p.scale, 25).deformed.map((q) => new THREE.Vector3(q.x, q.y, q.z));
        const curve = new THREE.CatmullRomCurve3(pts3);
        add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, S * 0.0065, 6, false), new THREE.MeshBasicMaterial({ color: defC })));
      }
    }
    t.render();
  }, [p.model, p.analysis, p.showDeformed, p.scale, p.showDofs, p.selectedElement, p.selectedNode, p.theme]);

  useEffect(() => { fit(); }, [p.fitKey, fit]);

  if (!webglOk) return <div className="issues"><li className="error">⛔ 3D drawing needs WebGL, which this browser does not provide. The calculations and all solution steps still work.</li></div>;
  return (
    <div className="view3d" ref={host} role="group" aria-label="3D structure view (drag to rotate)">
      <p className="sr-only">{describeModel(p.model)}</p>
      <div className="view3d-bar">
        <button onClick={fit} title="Reset the camera to fit the structure">Reset view</button>
        <span className="muted small">drag = rotate · right-drag = pan · wheel = zoom · click an element or node</span>
      </div>
      {tip && <div className="view3d-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
    </div>
  );
}
