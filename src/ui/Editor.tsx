import { useEffect, useState, type ReactNode } from 'react';
import {
  NO_RELEASE,
  UNIT_IDS,
  UNIT_SYSTEMS,
  makeSupport,
  renumberModel,
  type Dimension,
  supportPresetFlags,
  type FemModel,
  type SupportPreset,
  type UnitSystemId,
  type ValidationIssue,
} from '../model';

/** Number input that keeps what the student is typing and only commits valid numbers. */
function Num({ value, onChange, width = 72, label }: { value: number; onChange: (v: number) => void; width?: number; label: string }) {
  const [text, setText] = useState(String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (parseFloat(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className={bad ? 'bad' : ''}
      style={{ width }}
      aria-label={label}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v)) {
          setBad(false);
          onChange(v);
        } else setBad(true);
      }}
      onBlur={() => {
        if (bad) {
          setText(String(value));
          setBad(false);
        }
      }}
    />
  );
}

function Int({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return <Num value={value} onChange={(v) => onChange(Math.round(v))} width={44} label={label} />;
}

const Del = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button className="icon danger" title={`Delete ${label}`} aria-label={`Delete ${label}`} onClick={onClick}>✕</button>
);

function Section({ title, count, children, onAdd, addLabel, hint }: { title: string; count: number; children: ReactNode; onAdd: () => void; addLabel: string; hint?: string }) {
  return (
    <details className="ed-section" open={title === 'Nodes' || title === 'Elements'}>
      <summary>
        {title} <span className="badge">{count}</span>
      </summary>
      {hint && <p className="muted small">{hint}</p>}
      <div className="scrollx">{children}</div>
      <button className="add" onClick={onAdd}>＋ {addLabel}</button>
    </details>
  );
}

const SUPPORT_PRESETS: { id: SupportPreset | 'custom'; label: string }[] = [
  { id: 'fixed', label: 'Fixed' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'roller-x', label: 'Roller (rolls in x)' },
  { id: 'roller-y', label: 'Roller (rolls in y)' },
  { id: 'roller-z', label: 'Roller (rolls in z)' },
  { id: 'custom', label: 'Custom' },
];

function presetOf(fixed: boolean[], dim: Dimension): SupportPreset | 'custom' {
  for (const p of ['fixed', 'pinned', 'roller-x', 'roller-y', 'roller-z'] as SupportPreset[]) {
    const f = supportPresetFlags(dim, p);
    if (f && f.every((v, i) => v === fixed[i])) return p;
  }
  return 'custom';
}

const DOF_NAMES_2D = ['x (force Fx)', 'y (force Fy)', 'rotation (moment M)'];
const DOF_NAMES_3D = ['x (force Fx)', 'y (force Fy)', 'z (force Fz)', 'about x (moment Mx)', 'about y (moment My)', 'about z (moment Mz)'];
const DOF_SHORT_2D = ['x', 'y', 'rotation'];
const DOF_SHORT_3D = ['x', 'y', 'z', 'θx', 'θy', 'θz'];

/** Number input where an empty box means "not set" (undefined). */
function OptNum({ value, onChange, width = 56, label, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; width?: number; label: string; placeholder?: string }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    if ((value === undefined ? '' : String(value)) !== text && !(value !== undefined && parseFloat(text) === value)) setText(value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      style={{ width }}
      aria-label={label}
      placeholder={placeholder}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === '') onChange(undefined);
        else if (Number.isFinite(Number(e.target.value))) onChange(Number(e.target.value));
      }}
    />
  );
}

export interface EditorProps {
  model: FemModel;
  onChange: (m: FemModel) => void;
  issues: ValidationIssue[];
  selectedNode: number | null;
  selectedElement: number | null;
}

export function Editor({ model, onChange, issues, selectedNode, selectedElement }: EditorProps) {
  const unit = UNIT_SYSTEMS[model.units];
  // rows named by a validation issue get a red/amber tint, so a student can see WHICH row to fix
  const flagged = new Map<string, 'error' | 'warning'>();
  for (const i of issues) {
    if (!i.table || i.id === undefined || i.severity === 'info') continue;
    const key = `${i.table}:${i.id}`;
    if (flagged.get(key) !== 'error') flagged.set(key, i.severity);
  }
  const rc = (table: string, id: number, extra = '') => [extra, flagged.get(`${table}:${id}`) === 'error' ? 'err' : flagged.get(`${table}:${id}`) === 'warning' ? 'warn' : ''].filter(Boolean).join(' ') || undefined;
  const dim = model.dimension;
  const is3 = dim === '3D';
  const DOF_NAMES = is3 ? DOF_NAMES_3D : DOF_NAMES_2D;
  const DOF_SHORT = is3 ? DOF_SHORT_3D : DOF_SHORT_2D;
  const set = (patch: Partial<FemModel>) => onChange({ ...model, ...patch });
  const patchRow = <K extends keyof FemModel>(key: K, idx: number, patch: object) =>
    set({ [key]: (model[key] as unknown as object[]).map((r, i) => (i === idx ? { ...r, ...patch } : r)) } as Partial<FemModel>);
  const removeRow = <K extends keyof FemModel>(key: K, idx: number) => {
    const next = { ...model, [key]: (model[key] as unknown as object[]).filter((_, i) => i !== idx) } as FemModel;
    onChange(renumberModel(next));
  };

  const addNode = () => {
    const last = model.nodes[model.nodes.length - 1];
    set({ nodes: [...model.nodes, { id: model.nodes.length + 1, x: last ? last.x + 1 : 0, y: last ? last.y : 0, z: last ? last.z : 0 }] });
  };
  const addElement = () => {
    let m = model;
    if (m.materials.length === 0) m = { ...m, materials: [{ id: 1, name: 'Material 1', E: model.units === 'lb-in' ? 30e6 : model.units === 'kN-m' ? 2e8 : model.units === 'N-mm' ? 2e5 : model.units === 'N-m' ? 2e11 : model.units === 'kip-in' ? 29000 : 4.2e6 }] };
    if (m.sections.length === 0) m = { ...m, sections: [{ id: 1, name: 'Section 1', A: 1, Iz: 1, Iy: 1, J: 1 }] };
    const n = m.nodes.length;
    const e = { id: m.elements.length + 1, nodeI: Math.max(1, n - 1), nodeJ: Math.max(1, n), materialId: 1, sectionId: 1, releaseI: { ...NO_RELEASE }, releaseJ: { ...NO_RELEASE } };
    onChange({ ...m, elements: [...m.elements, e] });
  };

  return (
    <div className="editor">
      <div className="ed-head">
        <label>
          Name <input value={model.name} onChange={(e) => set({ name: e.target.value })} aria-label="Model name" />
        </label>
        <label>
          Units{' '}
          <select value={model.units} onChange={(e) => set({ units: e.target.value as UnitSystemId })} aria-label="Unit system">
            {UNIT_IDS.map((u) => (
              <option key={u} value={u}>{UNIT_SYSTEMS[u].label}</option>
            ))}
          </select>
        </label>
        <p className="muted small">Units are labels only: type every value in this one consistent system (E in {unit.stress}, lengths in {unit.length}, forces in {unit.force}). Nothing is converted.</p>
      </div>

      <IssueList issues={issues} />

      <Section title="Nodes" count={model.nodes.length} onAdd={addNode} addLabel="Add node" hint={`Coordinates in ${unit.length}${is3 ? ' (Z is up)' : ''}. Select a row's node by clicking it in the drawing.`}>
        <table className="ed">
          <thead><tr><th>#</th><th>x</th><th>y</th>{is3 && <th>z</th>}<th /></tr></thead>
          <tbody>
            {model.nodes.map((n, i) => (
              <tr key={i} className={rc('nodes', n.id, selectedNode === n.id ? 'sel' : '')}>
                <td>{n.id}</td>
                <td><Num label={`Node ${n.id} x`} value={n.x} onChange={(v) => patchRow('nodes', i, { x: v })} /></td>
                <td><Num label={`Node ${n.id} y`} value={n.y} onChange={(v) => patchRow('nodes', i, { y: v })} /></td>
                {is3 && <td><Num label={`Node ${n.id} z`} value={n.z} onChange={(v) => patchRow('nodes', i, { z: v })} /></td>}
                <td><Del label={`node ${n.id}`} onClick={() => removeRow('nodes', i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Materials"
        count={model.materials.length}
        onAdd={() => set({ materials: [...model.materials, { id: model.materials.length + 1, name: `Material ${model.materials.length + 1}`, E: model.materials[0]?.E ?? 1 }] })}
        addLabel="Add material"
        hint={is3 ? `E = Young's modulus in ${unit.stress}. Give G, or leave G empty and give ν (G = E/2(1+ν); default ν = 0.3).` : `E = Young's modulus in ${unit.stress}.`}
      >
        <table className="ed">
          <thead><tr><th>#</th><th>Name</th><th>E</th>{is3 && <><th>G</th><th>ν</th></>}<th /></tr></thead>
          <tbody>
            {model.materials.map((m, i) => (
              <tr key={i} className={rc('materials', m.id)}>
                <td>{m.id}</td>
                <td><input aria-label={`Material ${m.id} name`} value={m.name} onChange={(e) => patchRow('materials', i, { name: e.target.value })} style={{ width: 110 }} /></td>
                <td><Num label={`Material ${m.id} E`} value={m.E} width={96} onChange={(v) => patchRow('materials', i, { E: v })} /></td>
                {is3 && (
                  <>
                    <td><OptNum label={`Material ${m.id} G`} value={m.G} width={84} placeholder="from ν" onChange={(v) => patchRow('materials', i, { G: v })} /></td>
                    <td><OptNum label={`Material ${m.id} nu`} value={m.nu} width={50} placeholder="0.3" onChange={(v) => patchRow('materials', i, { nu: v })} /></td>
                  </>
                )}
                <td><Del label={`material ${m.id}`} onClick={() => removeRow('materials', i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Sections"
        count={model.sections.length}
        onAdd={() => set({ sections: [...model.sections, { id: model.sections.length + 1, name: `Section ${model.sections.length + 1}`, A: model.sections[0]?.A ?? 1, Iz: model.sections[0]?.Iz ?? 1, Iy: model.sections[0]?.Iy ?? 1, J: 1 }] })}
        addLabel="Add section"
        hint={is3 ? `A in ${unit.length}², I and J in ${unit.length}⁴. Iz resists bending in the local x–y plane, Iy in the local x–z plane. With default axes a horizontal member's local y points up (global Z), so vertical bending uses Iz.` : `A in ${unit.length}², I in ${unit.length}⁴.`}
      >
        <table className="ed">
          <thead><tr><th>#</th><th>Name</th><th>A</th>{is3 ? <><th>Iy</th><th>Iz</th><th>J</th></> : <th>I</th>}<th /></tr></thead>
          <tbody>
            {model.sections.map((s, i) => (
              <tr key={i} className={rc('sections', s.id)}>
                <td>{s.id}</td>
                <td><input aria-label={`Section ${s.id} name`} value={s.name} onChange={(e) => patchRow('sections', i, { name: e.target.value })} style={{ width: 110 }} /></td>
                <td><Num label={`Section ${s.id} A`} value={s.A} onChange={(v) => patchRow('sections', i, { A: v })} /></td>
                {is3 ? (
                  <>
                    <td><Num label={`Section ${s.id} Iy`} value={s.Iy} onChange={(v) => patchRow('sections', i, { Iy: v })} /></td>
                    <td><Num label={`Section ${s.id} Iz`} value={s.Iz} onChange={(v) => patchRow('sections', i, { Iz: v })} /></td>
                    <td><Num label={`Section ${s.id} J`} value={s.J} onChange={(v) => patchRow('sections', i, { J: v })} /></td>
                  </>
                ) : (
                  <td><Num label={`Section ${s.id} I`} value={s.Iz} onChange={(v) => patchRow('sections', i, { Iz: v, Iy: v })} /></td>
                )}
                <td><Del label={`section ${s.id}`} onClick={() => removeRow('sections', i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Elements" count={model.elements.length} onAdd={addElement} addLabel="Add element" hint={is3 ? 'Local x̂ runs from node i to node j. Tick θx/θy/θz to release that end moment (a hinge about that local axis). Reference vector (blank = default global Z; vertical members use X) sets the local y–z axes; roll turns the section about x̂.' : 'Local x̂ runs from node i to node j. Tick “hinge” to release the end moment there.'}>
        <table className="ed">
          <thead>
            <tr>
              <th>#</th><th>i</th><th>j</th><th>Mat</th><th>Sec</th>
              {is3 ? <><th title="Release at node i">i: θx θy θz</th><th title="Release at node j">j: θx θy θz</th><th title="Reference vector (blank = default)">ref x</th><th>ref y</th><th>ref z</th><th>roll °</th></> : <><th title="Hinge at node i">hinge i</th><th title="Hinge at node j">hinge j</th></>}
              <th />
            </tr>
          </thead>
          <tbody>
            {model.elements.map((e, i) => (
              <tr key={i} className={rc('elements', e.id, selectedElement === e.id ? 'sel' : '')}>
                <td>{e.id}</td>
                <td><Int label={`Element ${e.id} node i`} value={e.nodeI} onChange={(v) => patchRow('elements', i, { nodeI: v })} /></td>
                <td><Int label={`Element ${e.id} node j`} value={e.nodeJ} onChange={(v) => patchRow('elements', i, { nodeJ: v })} /></td>
                <td><Int label={`Element ${e.id} material`} value={e.materialId} onChange={(v) => patchRow('elements', i, { materialId: v })} /></td>
                <td><Int label={`Element ${e.id} section`} value={e.sectionId} onChange={(v) => patchRow('elements', i, { sectionId: v })} /></td>
                {is3 ? (
                  <>
                    {(['releaseI', 'releaseJ'] as const).map((end) => (
                      <td key={end} style={{ whiteSpace: 'nowrap' }}>
                        {(['rx', 'ry', 'rz'] as const).map((r) => (
                          <input key={r} type="checkbox" aria-label={`Element ${e.id} release ${r} at ${end === 'releaseI' ? 'i' : 'j'}`} checked={e[end][r]} onChange={(ev) => patchRow('elements', i, { [end]: { ...e[end], [r]: ev.target.checked } })} />
                        ))}
                      </td>
                    ))}
                    {[0, 1, 2].map((c) => (
                      <td key={c}>
                        <OptNum
                          label={`Element ${e.id} reference vector ${'xyz'[c]}`}
                          width={44}
                          value={e.refVector?.[c]}
                          onChange={(v) => {
                            const cur: [number, number, number] = e.refVector ? [...e.refVector] : [0, 0, 0];
                            cur[c] = v ?? 0;
                            patchRow('elements', i, { refVector: cur.every((x) => x === 0) ? undefined : cur });
                          }}
                        />
                      </td>
                    ))}
                    <td><OptNum label={`Element ${e.id} roll angle`} width={44} value={e.rollAngleDeg} onChange={(v) => patchRow('elements', i, { rollAngleDeg: v })} /></td>
                  </>
                ) : (
                  <>
                    <td><input type="checkbox" aria-label={`Element ${e.id} hinge at i`} checked={e.releaseI.rz} onChange={(ev) => patchRow('elements', i, { releaseI: { ...e.releaseI, rz: ev.target.checked } })} /></td>
                    <td><input type="checkbox" aria-label={`Element ${e.id} hinge at j`} checked={e.releaseJ.rz} onChange={(ev) => patchRow('elements', i, { releaseJ: { ...e.releaseJ, rz: ev.target.checked } })} /></td>
                  </>
                )}
                <td><Del label={`element ${e.id}`} onClick={() => removeRow('elements', i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Supports"
        count={model.supports.length}
        onAdd={() => {
          const used = new Set(model.supports.map((s) => s.nodeId));
          const free = model.nodes.find((n) => !used.has(n.id));
          set({ supports: [...model.supports, makeSupport(dim, free?.id ?? 1, 'fixed')] });
        }}
        addLabel="Add support"
        hint="Tick the restrained DOFs. A restrained DOF may be given a prescribed displacement (e.g. settlement)."
      >
        <table className="ed">
          <thead><tr><th>Node</th><th>Type</th>{DOF_SHORT.map((n) => <th key={n} title="restrained?">{n}</th>)}{DOF_SHORT.map((n) => <th key={'p' + n} title="prescribed value">δ{n}</th>)}<th /></tr></thead>
          <tbody>
            {model.supports.map((s, i) => (
              <tr key={i} className={rc('supports', i + 1)}>
                <td><Int label={`Support ${i + 1} node`} value={s.nodeId} onChange={(v) => patchRow('supports', i, { nodeId: v })} /></td>
                <td>
                  <select
                    aria-label={`Support ${i + 1} type`}
                    value={presetOf(s.fixed, dim)}
                    onChange={(e) => {
                      const f = supportPresetFlags(dim, e.target.value as SupportPreset);
                      if (f) patchRow('supports', i, { fixed: f, prescribed: s.prescribed.map((v, d) => (f[d] ? v : 0)) });
                    }}
                  >
                    {SUPPORT_PRESETS.filter((p) => is3 || p.id !== 'roller-z').map((p) => (
                      <option key={p.id} value={p.id} disabled={p.id === 'custom'}>{p.label}</option>
                    ))}
                  </select>
                </td>
                {DOF_SHORT.map((_, d) => (
                  <td key={d}>
                    <input type="checkbox" aria-label={`Support ${i + 1} restrains ${DOF_SHORT[d]}`} checked={s.fixed[d]} onChange={(e) => patchRow('supports', i, { fixed: s.fixed.map((f, k) => (k === d ? e.target.checked : f)) })} />
                  </td>
                ))}
                {DOF_SHORT.map((_, d) => (
                  <td key={d}>
                    {s.fixed[d] ? (
                      <Num label={`Support ${i + 1} prescribed ${DOF_SHORT[d]}`} width={56} value={s.prescribed[d]} onChange={(v) => patchRow('supports', i, { prescribed: s.prescribed.map((p, k) => (k === d ? v : p)) })} />
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                ))}
                <td><Del label={`support ${i + 1}`} onClick={() => removeRow('supports', i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Ground springs" count={model.springs.length} onAdd={() => set({ springs: [...model.springs, { nodeId: 1, dof: 1, k: 1000 }] })} addLabel="Add spring" hint={`Stiffness in ${unit.force}/${unit.length} (or ${unit.moment}/rad for rotation); added to the diagonal of K.`}>
        <table className="ed">
          <thead><tr><th>Node</th><th>DOF</th><th>k</th><th /></tr></thead>
          <tbody>
            {model.springs.map((s, i) => (
              <tr key={i} className={rc('springs', i + 1)}>
                <td><Int label={`Spring ${i + 1} node`} value={s.nodeId} onChange={(v) => patchRow('springs', i, { nodeId: v })} /></td>
                <td>
                  <select aria-label={`Spring ${i + 1} DOF`} value={s.dof} onChange={(e) => patchRow('springs', i, { dof: Number(e.target.value) })}>
                    {DOF_SHORT.map((n, d) => <option key={d} value={d}>{n}</option>)}
                  </select>
                </td>
                <td><Num label={`Spring ${i + 1} stiffness`} value={s.k} onChange={(v) => patchRow('springs', i, { k: v })} /></td>
                <td><Del label={`spring ${i + 1}`} onClick={() => removeRow('springs', i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Nodal loads" count={model.nodalLoads.length} onAdd={() => set({ nodalLoads: [...model.nodalLoads, { nodeId: Math.max(1, model.nodes.length), dof: is3 ? 2 : 1, value: -1 }] })} addLabel="Add nodal load" hint={`Forces in ${unit.force}, moments in ${unit.moment} (counter-clockwise positive), in global directions.`}>
        <table className="ed">
          <thead><tr><th>Node</th><th>Direction</th><th>Value</th><th /></tr></thead>
          <tbody>
            {model.nodalLoads.map((l, i) => (
              <tr key={i} className={rc('nodalLoads', i + 1)}>
                <td><Int label={`Load ${i + 1} node`} value={l.nodeId} onChange={(v) => patchRow('nodalLoads', i, { nodeId: v })} /></td>
                <td>
                  <select aria-label={`Load ${i + 1} direction`} value={l.dof} onChange={(e) => patchRow('nodalLoads', i, { dof: Number(e.target.value) })}>
                    {DOF_NAMES.map((n, d) => <option key={d} value={d}>{n}</option>)}
                  </select>
                </td>
                <td><Num label={`Load ${i + 1} value`} value={l.value} onChange={(v) => patchRow('nodalLoads', i, { value: v })} /></td>
                <td><Del label={`load ${i + 1}`} onClick={() => removeRow('nodalLoads', i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Distributed loads" count={model.elementLoads.length} onAdd={() => set({ elementLoads: [...model.elementLoads, { elementId: 1, kind: 'uniform', coordSys: 'global', axis: is3 ? 'z' : 'y', w1: -1, w2: -1 }] })} addLabel="Add distributed load" hint={`Intensity in ${unit.force}/${unit.length} along the member. “Linear” varies from w at node i to w₂ at node j.`}>
        <table className="ed">
          <thead><tr><th>Elem</th><th>Shape</th><th>Axes</th><th>Dir</th><th>w</th><th>w₂</th><th /></tr></thead>
          <tbody>
            {model.elementLoads.map((l, i) => (
              <tr key={i} className={rc('elementLoads', i + 1)}>
                <td><Int label={`Distributed load ${i + 1} element`} value={l.elementId} onChange={(v) => patchRow('elementLoads', i, { elementId: v })} /></td>
                <td>
                  <select aria-label={`Distributed load ${i + 1} shape`} value={l.kind} onChange={(e) => patchRow('elementLoads', i, { kind: e.target.value })}>
                    <option value="uniform">Uniform</option><option value="linear">Linear</option>
                  </select>
                </td>
                <td>
                  <select aria-label={`Distributed load ${i + 1} axes`} value={l.coordSys} onChange={(e) => patchRow('elementLoads', i, { coordSys: e.target.value })}>
                    <option value="global">Global</option><option value="local">Local</option>
                  </select>
                </td>
                <td>
                  <select aria-label={`Distributed load ${i + 1} direction`} value={l.axis} onChange={(e) => patchRow('elementLoads', i, { axis: e.target.value })}>
                    <option value="x">x</option><option value="y">y</option>{is3 && <option value="z">z</option>}
                  </select>
                </td>
                <td><Num label={`Distributed load ${i + 1} w`} width={56} value={l.w1} onChange={(v) => patchRow('elementLoads', i, { w1: v, ...(l.kind === 'uniform' ? { w2: v } : {}) })} /></td>
                <td>{l.kind === 'linear' ? <Num label={`Distributed load ${i + 1} w2`} width={56} value={l.w2} onChange={(v) => patchRow('elementLoads', i, { w2: v })} /> : <span className="muted">–</span>}</td>
                <td><Del label={`distributed load ${i + 1}`} onClick={() => removeRow('elementLoads', i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

export function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return <div className="issues ok" role="status">✓ No problems found.</div>;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <ul className="issues" aria-label="Problems found in the model" aria-live="polite">
      {sorted.map((i, k) => (
        <li key={k} className={i.severity}>
          <span className="sev">{i.severity === 'error' ? '⛔' : i.severity === 'warning' ? '⚠️' : 'ℹ️'}</span> {i.message}
        </li>
      ))}
    </ul>
  );
}
