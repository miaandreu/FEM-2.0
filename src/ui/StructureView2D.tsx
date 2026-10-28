import { useMemo, type MouseEvent } from 'react';
import { deformedMember2D, type Analysis2D } from '../fem/analyze2d';
import { fmtNum } from './format';
import type { FemModel } from '../model';
import { UNIT_SYSTEMS } from '../model';
import { describeModel } from './describe';

const W = 760;
const H = 480;
const PAD = 56;

export interface StructureViewProps {
  model: FemModel;
  analysis: Analysis2D | null;
  showDeformed: boolean;
  scale: number;
  showDofs: boolean;
  selectedElement: number | null;
  selectedNode: number | null;
  onSelectElement: (id: number | null) => void;
  onSelectNode: (id: number | null) => void;
  addNodeMode: boolean;
  onAddNode: (x: number, y: number) => void;
}

/** Nice snapping grid for click-to-add: a power of ten about 1/20 of the model size. */
export function snapStep(size: number): number {
  return Math.pow(10, Math.floor(Math.log10(Math.max(size, 1e-9) / 20)));
}

export function Arrow({ x1, y1, x2, y2, color, w = 2 }: { x1: number; y1: number; x2: number; y2: number; color: string; w?: number }) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const hs = Math.min(9, len * 0.45);
  const p1 = `${x2 - ux * hs - uy * hs * 0.45},${y2 - uy * hs + ux * hs * 0.45}`;
  const p2 = `${x2 - ux * hs + uy * hs * 0.45},${y2 - uy * hs - ux * hs * 0.45}`;
  return (
    <g stroke={color} fill={color} strokeWidth={w}>
      <line x1={x1} y1={y1} x2={x2 - ux * hs * 0.6} y2={y2 - uy * hs * 0.6} />
      <polygon points={`${x2},${y2} ${p1} ${p2}`} strokeWidth={0} />
    </g>
  );
}

export function MomentArc({ x, y, ccw, color }: { x: number; y: number; ccw: boolean; color: string }) {
  const r = 17;
  // The arc spans -40° .. 220° (math angles, y up); the arrowhead sits at the end that matches the sense.
  const a0 = (-40 * Math.PI) / 180, a1 = (220 * Math.PI) / 180;
  const pt = (a: number) => `${x + r * Math.cos(a)},${y - r * Math.sin(a)}`;
  const start = ccw ? a0 : a1;
  const end = ccw ? a1 : a0;
  const sense = ccw ? 1 : -1;
  const ex = x + r * Math.cos(end), ey = y - r * Math.sin(end);
  // tangent of travel at the end point (screen coordinates)
  const dirx = -Math.sin(end) * sense, diry = -Math.cos(end) * sense;
  return (
    <g stroke={color} fill="none" strokeWidth={2}>
      <path d={`M ${pt(start)} A ${r} ${r} 0 1 ${ccw ? 0 : 1} ${pt(end)}`} />
      <Arrow x1={ex - dirx * 6} y1={ey - diry * 6} x2={ex + dirx * 3} y2={ey + diry * 3} color={color} w={2} />
    </g>
  );
}

function SupportSymbol({ x, y, fixed, color }: { x: number; y: number; fixed: boolean[]; color: string }) {
  const [fx, fy, fr] = fixed;
  const hatch = (cx: number, cy: number, w: number) => (
    <g stroke={color} strokeWidth={1.5}>
      <line x1={cx - w} y1={cy} x2={cx + w} y2={cy} />
      {Array.from({ length: 6 }, (_, i) => (
        <line key={i} x1={cx - w + i * ((2 * w) / 5)} y1={cy} x2={cx - w + i * ((2 * w) / 5) - 6} y2={cy + 7} />
      ))}
    </g>
  );
  if (fx && fy && fr) return <g>{hatch(x, y + 2, 15)}</g>;
  if (fx && fy) {
    return (
      <g>
        <polygon points={`${x},${y} ${x - 11},${y + 17} ${x + 11},${y + 17}`} fill="none" stroke={color} strokeWidth={2} />
        {hatch(x, y + 17, 15)}
      </g>
    );
  }
  if (fy && !fx) {
    return (
      <g>
        <polygon points={`${x},${y} ${x - 10},${y + 14} ${x + 10},${y + 14}`} fill="none" stroke={color} strokeWidth={2} />
        <circle cx={x - 5} cy={y + 18} r={3.5} fill="none" stroke={color} strokeWidth={1.5} />
        <circle cx={x + 5} cy={y + 18} r={3.5} fill="none" stroke={color} strokeWidth={1.5} />
        {hatch(x, y + 22, 15)}
      </g>
    );
  }
  if (fx && !fy) {
    return (
      <g transform={`rotate(90 ${x} ${y})`}>
        <polygon points={`${x},${y} ${x - 10},${y + 14} ${x + 10},${y + 14}`} fill="none" stroke={color} strokeWidth={2} />
        <circle cx={x - 5} cy={y + 18} r={3.5} fill="none" stroke={color} strokeWidth={1.5} />
        <circle cx={x + 5} cy={y + 18} r={3.5} fill="none" stroke={color} strokeWidth={1.5} />
        {hatch(x, y + 22, 15)}
      </g>
    );
  }
  // custom: only rotation restrained
  return (
    <g stroke={color} strokeWidth={2} fill="none">
      <rect x={x - 7} y={y - 7} width={14} height={14} />
      <text x={x + 10} y={y + 20} fontSize={11} fill={color} stroke="none">{fr ? 'θ fixed' : ''}</text>
    </g>
  );
}

export function StructureView2D(p: StructureViewProps) {
  const { model, analysis } = p;
  const deformed = p.showDeformed && analysis?.ok;

  const curves = useMemo(
    () => (deformed ? analysis!.elements.map((e) => deformedMember2D(analysis!, e, p.scale, 25)) : []),
    [deformed, analysis, p.scale],
  );

  const view = useMemo(() => {
    const xs: number[] = [], ys: number[] = [];
    for (const n of model.nodes) { xs.push(n.x); ys.push(n.y); }
    for (const c of curves) for (const q of c.deformed) { xs.push(q.x); ys.push(q.y); }
    if (xs.length === 0) { xs.push(-1, 1); ys.push(-1, 1); }
    let minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    let sx = maxx - minx, sy = maxy - miny;
    if (sx === 0 && sy === 0) { sx = sy = 2; minx -= 1; miny -= 1; }
    const s = Math.min((W - 2 * PAD) / (sx || 1e-9), (H - 2 * PAD) / (sy || 1e-9));
    const ox = (W - sx * s) / 2 - minx * s;
    const oy = (H + sy * s) / 2 + miny * s;
    return { s, ox, oy, size: Math.max(sx, sy) };
  }, [model.nodes, curves]);

  const X = (x: number) => view.ox + x * view.s;
  const Y = (y: number) => view.oy - y * view.s;
  const unit = UNIT_SYSTEMS[model.units];
  const nodeById = (id: number) => model.nodes[id - 1];

  const maxForce = Math.max(1e-12, ...model.nodalLoads.filter((l) => l.dof < 2).map((l) => Math.abs(l.value)));
  const maxW = Math.max(1e-12, ...model.elementLoads.map((l) => Math.max(Math.abs(l.w1), Math.abs(l.kind === 'linear' ? l.w2 : l.w1))));

  const onSvgClick = (ev: MouseEvent<SVGSVGElement>) => {
    if (!p.addNodeMode) {
      if (ev.target === ev.currentTarget) { p.onSelectElement(null); p.onSelectNode(null); }
      return;
    }
    const r = ev.currentTarget.getBoundingClientRect();
    const px = ((ev.clientX - r.left) * W) / r.width;
    const py = ((ev.clientY - r.top) * H) / r.height;
    const g = snapStep(view.size);
    const snap = (v: number) => Math.round(v / g) * g;
    p.onAddNode(+snap((px - view.ox) / view.s).toPrecision(10), +snap((view.oy - py) / view.s).toPrecision(10));
  };

  const col = { line: 'var(--line)', accent: 'var(--accent)', load: 'var(--load)', sup: 'var(--support)', def: 'var(--deformed)' };

  return (
    <svg className={`structure ${p.addNodeMode ? 'adding' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Structure drawing" onClick={onSvgClick}>
      <title>Structure drawing</title>
      <desc>{describeModel(model)}</desc>
      {/* global axes */}
      <g stroke="var(--muted)" fill="var(--muted)">
        <Arrow x1={20} y1={H - 20} x2={58} y2={H - 20} color="var(--muted)" w={1.5} />
        <Arrow x1={20} y1={H - 20} x2={20} y2={H - 58} color="var(--muted)" w={1.5} />
        <text x={62} y={H - 16} fontSize={12} stroke="none">X</text>
        <text x={15} y={H - 62} fontSize={12} stroke="none">Y</text>
      </g>

      {/* supports */}
      {model.supports.map((s) => {
        const n = nodeById(s.nodeId);
        if (!n || s.fixed.length !== 3) return null;
        return (
          <g key={`s${s.nodeId}`}>
            <title>{`Support at node ${s.nodeId}: ${s.fixed.map((f, i) => (f ? ['x', 'y', 'θ'][i] : '')).join('') || 'none'} restrained`}</title>
            <SupportSymbol x={X(n.x)} y={Y(n.y)} fixed={s.fixed} color={col.sup} />
          </g>
        );
      })}

      {/* elements (undeformed) */}
      {model.elements.map((e) => {
        const a = nodeById(e.nodeI), b = nodeById(e.nodeJ);
        if (!a || !b) return null;
        const x1 = X(a.x), y1 = Y(a.y), x2 = X(b.x), y2 = Y(b.y);
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const sel = p.selectedElement === e.id;
        const ar = { x: x1 + ux * len * 0.55, y: y1 + uy * len * 0.55 };
        const el = analysis?.elements[e.id - 1];
        return (
          <g key={`e${e.id}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={sel ? col.accent : col.line} strokeWidth={sel ? 4 : 3} strokeDasharray={deformed ? '6 5' : undefined} opacity={deformed ? 0.7 : 1} />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }} tabIndex={0} role="button" aria-label={`Select element ${e.id}, node ${e.nodeI} to node ${e.nodeJ}`} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); p.onSelectElement(e.id); } }} onClick={(ev) => { ev.stopPropagation(); if (!p.addNodeMode) p.onSelectElement(e.id); }}>
              <title>{`Element ${e.id}: node ${e.nodeI} → ${e.nodeJ}${el ? `, L = ${fmtNum(el.geometry.L)} ${unit.length}` : ''}`}</title>
            </line>
            <Arrow x1={ar.x - ux * 10} y1={ar.y - uy * 10} x2={ar.x + ux * 10} y2={ar.y + uy * 10} color={col.accent} w={1.5} />
            <text x={ar.x + ux * 10 - uy * 10} y={ar.y + uy * 10 + ux * 10 - 2} fontSize={11} fill={col.accent}>x̂</text>
            <circle cx={mx - uy * 15} cy={my + ux * 15} r={9} fill="var(--bg)" stroke={sel ? col.accent : 'var(--muted)'} />
            <text x={mx - uy * 15} y={my + ux * 15 + 4} fontSize={11} textAnchor="middle" fill="var(--fg)">{e.id}</text>
            {(e.releaseI.rz || e.releaseJ.rz) && (
              <>
                {e.releaseI.rz && <circle cx={x1 + ux * 9} cy={y1 + uy * 9} r={4.5} fill="var(--bg)" stroke="var(--fg)" strokeWidth={1.5}><title>Hinge (moment released) at node i</title></circle>}
                {e.releaseJ.rz && <circle cx={x2 - ux * 9} cy={y2 - uy * 9} r={4.5} fill="var(--bg)" stroke="var(--fg)" strokeWidth={1.5}><title>Hinge (moment released) at node j</title></circle>}
              </>
            )}
          </g>
        );
      })}

      {/* distributed loads */}
      {model.elementLoads.map((l, idx) => {
        const e = model.elements[l.elementId - 1];
        if (!e) return null;
        const a = nodeById(e.nodeI), b = nodeById(e.nodeJ);
        if (!a || !b) return null;
        const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const C = (b.x - a.x) / L, S = (b.y - a.y) / L;
        let dir: [number, number];
        if (l.coordSys === 'global') dir = l.axis === 'x' ? [1, 0] : [0, 1];
        else dir = l.axis === 'x' ? [C, S] : [-S, C];
        const w2 = l.kind === 'linear' ? l.w2 : l.w1;
        const n = 7;
        const items = Array.from({ length: n }, (_, i) => {
          const t = i / (n - 1);
          const w = l.w1 + (w2 - l.w1) * t;
          const sign = Math.sign(w) || 1;
          const len = 8 + 26 * (Math.abs(w) / maxW);
          const px = X(a.x + (b.x - a.x) * t), py = Y(a.y + (b.y - a.y) * t);
          const dx = dir[0] * sign, dy = -dir[1] * sign;
          return { t, w, px, py, tx: px - dx * len, ty: py - dy * len };
        });
        return (
          <g key={`dl${idx}`}>
            <title>{`Distributed load on element ${l.elementId}: ${l.w1}${l.kind === 'linear' ? ` → ${l.w2}` : ''} ${unit.force}/${unit.length} (${l.coordSys} ${l.axis})`}</title>
            <polyline points={items.map((q) => `${q.tx},${q.ty}`).join(' ')} fill="none" stroke={col.load} strokeWidth={1.5} />
            {items.map((q, i) => (Math.abs(q.w) > 0 ? <Arrow key={i} x1={q.tx} y1={q.ty} x2={q.px} y2={q.py} color={col.load} w={1.5} /> : null))}
            <text x={items[Math.floor(n / 2)].tx - dir[0] * 0} y={items[Math.floor(n / 2)].ty - 5} fontSize={11} fill={col.load} textAnchor="middle">
              {l.kind === 'linear' ? `${fmtNum(l.w1)}→${fmtNum(l.w2)}` : fmtNum(l.w1)} {unit.force}/{unit.length}
            </text>
          </g>
        );
      })}

      {/* deformed shape */}
      {deformed &&
        curves.map((c, i) => (
          <polyline key={`d${i}`} points={c.deformed.map((q) => `${X(q.x)},${Y(q.y)}`).join(' ')} fill="none" stroke={col.def} strokeWidth={3} />
        ))}

      {/* nodal loads */}
      {model.nodalLoads.map((l, idx) => {
        const n = nodeById(l.nodeId);
        if (!n || l.value === 0) return null;
        const x = X(n.x), y = Y(n.y);
        const label = `${fmtNum(l.value)} ${l.dof === 2 ? unit.moment : unit.force}`;
        if (l.dof === 2) {
          return (
            <g key={`nl${idx}`}>
              <title>{`Moment at node ${l.nodeId}: ${label}`}</title>
              <MomentArc x={x} y={y} ccw={l.value > 0} color={col.load} />
              <text x={x + 22} y={y - 18} fontSize={11} fill={col.load}>{label}</text>
            </g>
          );
        }
        const len = 26 + 24 * (Math.abs(l.value) / maxForce);
        const sign = Math.sign(l.value);
        const dx = l.dof === 0 ? sign : 0, dy = l.dof === 1 ? -sign : 0;
        return (
          <g key={`nl${idx}`}>
            <title>{`Force at node ${l.nodeId}: ${label}`}</title>
            <Arrow x1={x - dx * len} y1={y - dy * len} x2={x - dx * 7} y2={y - dy * 7} color={col.load} w={2.5} />
            {l.dof === 0 ? (
              // horizontal force: the label goes beyond the arrow's tail, never over the node
              <text x={x - dx * (len + 5)} y={y + 4} fontSize={11} fill={col.load} textAnchor={dx > 0 ? 'end' : 'start'}>{label}</text>
            ) : (
              <text x={x + 6} y={y - dy * (len + 4) + (dy > 0 ? -4 : 12)} fontSize={11} fill={col.load}>{label}</text>
            )}
          </g>
        );
      })}

      {/* DOF arrows */}
      {p.showDofs &&
        model.nodes.map((n) => {
          const x = X(n.x), y = Y(n.y);
          const g = (k: number) => (n.id - 1) * 3 + k;
          return (
            <g key={`dof${n.id}`} fill="var(--muted)" stroke="var(--muted)" fontSize={10}>
              <Arrow x1={x + 8} y1={y + 12} x2={x + 30} y2={y + 12} color="var(--muted)" w={1} />
              <text x={x + 32} y={y + 15} stroke="none">{g(1)}</text>
              <Arrow x1={x + 8} y1={y + 12} x2={x + 8} y2={y - 10} color="var(--muted)" w={1} />
              <text x={x + 11} y={y - 12} stroke="none">{g(2)}</text>
              <text x={x + 12} y={y + 28} stroke="none">↺{g(3)}</text>
            </g>
          );
        })}

      {/* nodes */}
      {model.nodes.map((n) => (
        <g key={`n${n.id}`} style={{ cursor: 'pointer' }} tabIndex={0} role="button" aria-label={`Select node ${n.id}`} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); p.onSelectNode(n.id); } }} onClick={(ev) => { ev.stopPropagation(); if (!p.addNodeMode) p.onSelectNode(n.id); }}>
          <title>{`Node ${n.id} at (${fmtNum(n.x)}, ${fmtNum(n.y)}) ${unit.length}`}</title>
          <circle cx={X(n.x)} cy={Y(n.y)} r={p.selectedNode === n.id ? 7 : 5} fill={p.selectedNode === n.id ? col.accent : 'var(--fg)'} />
          <text x={X(n.x) - 14} y={Y(n.y) - 9} fontSize={13} fontWeight={600} fill="var(--fg)">{n.id}</text>
        </g>
      ))}

      {model.nodes.length === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--muted)" fontSize={15}>Add nodes in the table, or turn on “Click to add nodes”.</text>
      )}
    </svg>
  );
}
