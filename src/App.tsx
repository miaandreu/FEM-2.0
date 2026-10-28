import { Component, Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { analyze2D, type Analysis2D } from './fem/analyze2d';
import { analyze3D, type Analysis3D } from './fem/analyze3d';
import { exampleA, exampleB, exampleC } from './examples/examples2d';
import { exampleD, exampleE } from './examples/examples3d';
import { emptyModel, modelFromHash, modelToHash, modelToJson, parseModel, validateModel, UNIT_SYSTEMS, type Dimension, type FemModel, type ValidationIssue } from './model';
import { Editor, IssueList } from './ui/Editor';
import { Conventions, Help } from './ui/Help';
import { StructureView2D } from './ui/StructureView2D';
import { DisplayCtx, type Display } from './ui/Tex';
import { fmtNum } from './ui/format';
import { StepAssembly, StepDofs, StepElements, StepLoads, StepModel } from './ui/steps/StepsA';
import { StepDeformed, StepDisplacements, StepForces, StepPartition, StepReactions, StepSolve } from './ui/steps/StepsB';
import { StepElements3, StepForces3, StepModel3 } from './ui/steps/StepsC';
import { setLabelDim, type StepPropsAny } from './ui/steps/common';
import './styles.css';

const StructureView3D = lazy(() => import('./ui/StructureView3D'));

const EXAMPLES: { id: string; dim: Dimension; label: string; make: () => FemModel }[] = [
  { id: 'A', dim: '2D', label: 'A · 2D rigid frame (Logan Fig. 5-4)', make: exampleA },
  { id: 'B', dim: '2D', label: 'B · 2D beam with hinge (Logan P4-41)', make: exampleB },
  { id: 'C', dim: '2D', label: 'C · 2D beam, hinge + distributed load (P4-42)', make: exampleC },
  { id: 'D', dim: '3D', label: 'D · 3D L-shaped cantilever', make: exampleD },
  { id: 'E', dim: '3D', label: 'E · 3D space frame (portal + roof beams)', make: exampleE },
];

type StepDef = { title: string; needs: 'none' | 'elements' | 'solved'; Comp: unknown };
const STEPS_2D: StepDef[] = [
  { title: 'Model', needs: 'none', Comp: StepModel },
  { title: 'DOF numbering', needs: 'elements', Comp: StepDofs },
  { title: 'Element matrices', needs: 'elements', Comp: StepElements },
  { title: 'Assembly', needs: 'elements', Comp: StepAssembly },
  { title: 'Load vector', needs: 'elements', Comp: StepLoads },
  { title: 'Supports & reduced system', needs: 'elements', Comp: StepPartition },
  { title: 'Solve', needs: 'elements', Comp: StepSolve },
  { title: 'Displacements', needs: 'solved', Comp: StepDisplacements },
  { title: 'Reactions', needs: 'solved', Comp: StepReactions },
  { title: 'Element forces', needs: 'solved', Comp: StepForces },
  { title: 'Deformed shape', needs: 'solved', Comp: StepDeformed },
];
const STEPS_3D: StepDef[] = STEPS_2D.map((s, i) => (i === 0 ? { ...s, Comp: StepModel3 } : i === 2 ? { ...s, Comp: StepElements3 } : i === 9 ? { ...s, Comp: StepForces3 } : s));

class Boundary extends Component<{ children: ReactNode; resetKey: unknown }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidUpdate(prev: { resetKey: unknown }) { if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (this.state.err) return <div className="issues"><li className="error">⛔ This step could not be displayed: {this.state.err.message}. Check the model for problems.</li></div>;
    return this.props.children;
  }
}

function loadInitial(): { mode: Dimension; models: Record<Dimension, FemModel> } {
  const models: Record<Dimension, FemModel> = { '2D': exampleA(), '3D': exampleD() };
  let mode: Dimension = '2D';
  if (location.hash.startsWith('#m=')) {
    const r = modelFromHash(location.hash);
    if (r.model) { mode = r.model.dimension; models[mode] = r.model; }
  }
  return { mode, models };
}

const blank = (dim: Dimension, units: FemModel['units']): FemModel => ({ ...emptyModel(dim, units), name: 'Untitled' });

export function App() {
  const [init] = useState(loadInitial);
  const [mode, setMode] = useState<Dimension>(init.mode);
  const [models, setModels] = useState(init.models);
  const liveModel = models[mode];
  // Heavy views follow the model one render behind, so typing in the editor stays responsive on large structures.
  const model = useDeferredValue(liveModel);
  // ---- undo / redo (edits within 700 ms are merged into one step) ----
  const hist = useRef<{ past: FemModel[]; future: FemModel[]; last: number }>({ past: [], future: [], last: 0 });
  const [, bump] = useState(0);
  const pushHistory = (snapshot: FemModel, force = false) => {
    const h = hist.current;
    const now = Date.now();
    if (force || now - h.last > 700 || h.past.length === 0) { h.past.push(snapshot); if (h.past.length > 100) h.past.shift(); }
    h.last = now;
    h.future = [];
    bump((n) => n + 1);
  };
  const setModel = (m: FemModel) => { pushHistory(models[m.dimension]); setModels((all) => ({ ...all, [m.dimension]: m })); };
  const undo = useCallback(() => {
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(models[prev.dimension]);
    setModels((all) => ({ ...all, [prev.dimension]: prev }));
    setMode(prev.dimension);
    h.last = 0;
    bump((n) => n + 1);
  }, [models]);
  const redo = useCallback(() => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(models[next.dimension]);
    setModels((all) => ({ ...all, [next.dimension]: next }));
    setMode(next.dimension);
    h.last = 0;
    bump((n) => n + 1);
  }, [models]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return; // let text fields keep their own undo
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); }
      else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState(1);
  const [selNode, setSelNode] = useState<number | null>(null);
  const [scaleOverride, setScaleOverride] = useState<number | null>(null);
  const [showDofs, setShowDofs] = useState(false);
  const [defPref, setDefPref] = useState<boolean | null>(null);
  const [addNodeMode, setAddNodeMode] = useState(false);
  const [panel, setPanel] = useState<null | 'help' | 'conventions'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [display, setDisplay] = useState<Display>({ fmt: { mode: 'sig', digits: 4 }, factor: false, zoom: 1 });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const fileRef = useRef<HTMLInputElement>(null);
  const is3 = mode === '3D';
  setLabelDim(mode); // the step components read the dimension for DOF labels

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const t = setTimeout(() => history.replaceState(null, '', modelToHash(liveModel)), 400);
    return () => clearTimeout(t);
  }, [liveModel]);

  const analysis = useMemo(() => {
    try { return mode === '2D' ? analyze2D(model) : analyze3D(model); } catch (e) { return { error: (e as Error).message }; }
  }, [model, mode]);
  const crashed = 'error' in analysis;
  const a: Analysis2D | Analysis3D | null = crashed ? null : analysis;
  const issues: ValidationIssue[] = a ? a.issues : crashed ? [{ severity: 'error', code: 'CRASH', message: `Analysis failed: ${analysis.error}` }, ...validateModel(model)] : [];

  const autoScale = useMemo(() => {
    if (!a?.ok) return 1;
    const k = is3 ? 6 : 3;
    let maxD = 0;
    for (let n = 0; n < model.nodes.length; n++) maxD = Math.max(maxD, Math.hypot(a.d[n * k], a.d[n * k + 1], is3 ? a.d[n * k + 2] : 0));
    const ext = (f: (n: FemModel['nodes'][number]) => number) => Math.max(...model.nodes.map(f)) - Math.min(...model.nodes.map(f));
    const size = Math.max(ext((n) => n.x), ext((n) => n.y), is3 ? ext((n) => n.z) : 0, 1e-9);
    if (maxD === 0) return 1;
    return +((0.08 * size) / maxD).toPrecision(1);
  }, [a, model.nodes, is3]);
  const scale = scaleOverride ?? autoScale;
  const selClamped = Math.min(Math.max(sel, 1), Math.max(1, model.elements.length));
  const STEPS = is3 ? STEPS_3D : STEPS_2D;
  const showDef = defPref ?? step >= 7;

  const loadModel = (m: FemModel) => {
    pushHistory(models[mode], true);
    setModels((all) => ({ ...all, [m.dimension]: m }));
    setMode(m.dimension);
    setSel(1); setSelNode(null); setScaleOverride(null); setDefPref(null); setStep(0); setNotice(null); setAddNodeMode(false);
    setFitKey((k) => k + 1);
  };
  const switchMode = (d: Dimension) => {
    if (d === mode) return;
    setMode(d);
    setSel(1); setSelNode(null); setScaleOverride(null); setDefPref(null); setAddNodeMode(false);
    setFitKey((k) => k + 1);
  };

  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([modelToJson(liveModel)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(liveModel.name || 'model').replace(/[^\w.-]+/g, '_')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (f: File) => {
    const r = parseModel(await f.text());
    if (!r.model) return setNotice(`Could not import "${f.name}": ${r.errors.join(' ')}`);
    loadModel(r.model);
  };
  const copyLink = async () => {
    history.replaceState(null, '', modelToHash(liveModel));
    try { await navigator.clipboard.writeText(location.href); setNotice('Link copied: it contains the whole model.'); }
    catch { setNotice('Copy the address from the browser bar: it contains the whole model.'); }
  };

  const cur = STEPS[step];
  const Comp = cur.Comp as (p: StepPropsAny) => ReactNode;
  let body: ReactNode;
  if (!a) body = <IssueList issues={issues} />;
  else if (cur.needs === 'elements' && a.elements.length === 0) body = <p className="explain">Fix the problems listed on the left first; this step needs a valid model.</p>;
  else if (cur.needs === 'solved' && !a.ok) body = <p className="explain">This step needs a solved structure. {a.issues.some((i) => i.code === 'STRUCTURE_UNSTABLE') ? 'The structure is unstable: see the messages above.' : 'Fix the problems listed on the left first.'}</p>;
  else body = <Comp a={a} model={model} sel={selClamped} setSel={setSel} scale={scale} setScale={setScaleOverride} autoScale={autoScale} />;

  const selEl = a && a.elements.length ? a.elements[selClamped - 1] : null;
  const u = UNIT_SYSTEMS[model.units];
  const k = is3 ? 6 : 3;
  const nodeD = (n: number) => (a?.ok ? Array.from({ length: k }, (_, i) => fmtNum(a.d[(n - 1) * k + i])) : null);

  return (
    <DisplayCtx.Provider value={display}>
      <div className="app">
        <a className="skip" href="#steps">Skip to the solution steps</a>
        <p className="sr-only" role="status">{a?.ok ? `${mode} model solved.` : `${mode} model not solved: ${issues.filter((i) => i.severity === 'error').length} problem(s).`}</p>
        <header className="top">
          <h1>FEM Frame Learning Tool</h1>
          <div className="modes" role="group" aria-label="Dimension">
            <button className={mode === '2D' ? 'active' : ''} aria-pressed={mode === '2D'} onClick={() => switchMode('2D')}>2D</button>
            <button className={mode === '3D' ? 'active' : ''} aria-pressed={mode === '3D'} onClick={() => switchMode('3D')}>3D</button>
          </div>
          <select aria-label="Examples" value="" onChange={(e) => { const ex = EXAMPLES.find((x) => x.id === e.target.value); if (ex) loadModel(ex.make()); }}>
            <option value="">Examples…</option>
            {EXAMPLES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <button onClick={() => loadModel(blank(mode, liveModel.units))}>New</button>
          <button onClick={undo} disabled={hist.current.past.length === 0} aria-label="Undo" title="Undo (Ctrl/Cmd+Z)">↶</button>
          <button onClick={redo} disabled={hist.current.future.length === 0} aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)">↷</button>
          <button onClick={exportJson}>Export</button>
          <button onClick={() => fileRef.current?.click()}>Import</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ''; }} />
          <button onClick={() => void copyLink()}>Copy link</button>
          <span className="spacer" />
          <label className="disp">Digits <input type="number" min={2} max={10} value={display.fmt.digits} onChange={(e) => setDisplay({ ...display, fmt: { ...display.fmt, digits: Math.min(10, Math.max(2, Number(e.target.value) || 4)) } })} aria-label="Significant figures" /></label>
          <label className="disp"><input type="checkbox" checked={display.fmt.mode === 'sci'} onChange={(e) => setDisplay({ ...display, fmt: { ...display.fmt, mode: e.target.checked ? 'sci' : 'sig' } })} /> sci</label>
          <label className="disp" title="Show matrices as scalar × matrix"><input type="checkbox" checked={display.factor} onChange={(e) => setDisplay({ ...display, factor: e.target.checked })} /> factor</label>
          <label className="disp">Zoom <input type="range" min={0.6} max={1.6} step={0.1} value={display.zoom} onChange={(e) => setDisplay({ ...display, zoom: Number(e.target.value) })} aria-label="Matrix zoom" /></label>
          <button onClick={() => setPanel(panel === 'conventions' ? null : 'conventions')}>Conventions</button>
          <button onClick={() => setPanel(panel === 'help' ? null : 'help')}>Help</button>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle dark mode">{theme === 'dark' ? '☀️' : '🌙'}</button>
        </header>

        {notice && <div className="notice" role="status">{notice} <button className="link" onClick={() => setNotice(null)}>dismiss</button></div>}
        {panel && (
          <aside className="drawer" aria-label={panel === 'help' ? 'Help' : 'Conventions'}>
            <button className="icon close" onClick={() => setPanel(null)} aria-label="Close">✕</button>
            {panel === 'help' ? <Help /> : <Conventions />}
          </aside>
        )}

        <main className="layout">
          <section className="col editor-col" aria-label="Model editor">
            <h2>Model ({mode})</h2>
            <Editor model={liveModel} onChange={setModel} issues={issues} selectedNode={selNode} selectedElement={selEl?.id ?? null} />
          </section>

          <section className="col view-col" aria-label="Structure view">
            <div className="viewbar">
              {!is3 && <label><input type="checkbox" checked={addNodeMode} onChange={(e) => setAddNodeMode(e.target.checked)} /> Click to add nodes</label>}
              <label><input type="checkbox" checked={showDofs} onChange={(e) => setShowDofs(e.target.checked)} /> DOF numbers</label>
              <label><input type="checkbox" checked={showDef && !!a?.ok} disabled={!a?.ok} onChange={(e) => setDefPref(e.target.checked)} /> Deformed shape (× {fmtNum(scale)})</label>
            </div>
            {is3 ? (
              <Suspense fallback={<div className="muted">Loading 3D view…</div>}>
                <StructureView3D
                  model={model}
                  analysis={a as Analysis3D | null}
                  showDeformed={showDef}
                  scale={scale}
                  showDofs={showDofs}
                  selectedElement={selEl?.id ?? null}
                  selectedNode={selNode}
                  onSelectElement={(id) => { if (id) setSel(id); setSelNode(null); }}
                  onSelectNode={setSelNode}
                  theme={theme}
                  fitKey={fitKey}
                />
              </Suspense>
            ) : (
              <StructureView2D
                model={model}
                analysis={a as Analysis2D | null}
                showDeformed={showDef}
                scale={scale}
                showDofs={showDofs}
                selectedElement={selEl?.id ?? null}
                selectedNode={selNode}
                onSelectElement={(id) => { if (id) setSel(id); setSelNode(null); }}
                onSelectNode={setSelNode}
                addNodeMode={addNodeMode}
                onAddNode={(x, y) => setModel({ ...liveModel, nodes: [...liveModel.nodes, { id: liveModel.nodes.length + 1, x, y, z: 0 }] })}
              />
            )}
            {a?.ok && showDef && (
              <div className="legend"><span className="sw dashed" /> undeformed <span className="sw solid" /> deformed (displacements × {fmtNum(scale)})</div>
            )}
            {selEl && (
              <div className="card inspector">
                <b>Element {selEl.id}</b> · node {selEl.nodeI} → {selEl.nodeJ} · L = {fmtNum('orientation' in selEl ? selEl.orientation.L : selEl.geometry.L)} {u.length}
                {'orientation' in selEl ? <> · axes from {selEl.orientation.refSource === 'fallback-X' ? 'global X (vertical-member fallback)' : selEl.orientation.refSource === 'default-Z' ? 'global Z (default)' : 'your reference vector'}</> : <> · θ = {fmtNum(selEl.geometry.angleDeg)}°</>}
                {' '}· ID array {'{'}{selEl.idArray.join(', ')}{'}'}
                <div className="row-wrap">
                  <button onClick={() => setStep(2)}>See k̂, T and k</button>
                  <button onClick={() => setStep(3)}>See it in the global K</button>
                  {a?.ok && <button onClick={() => setStep(9)}>See its end forces</button>}
                </div>
              </div>
            )}
            {selNode && model.nodes[selNode - 1] && (
              <div className="card inspector">
                <b>Node {selNode}</b> at ({fmtNum(model.nodes[selNode - 1].x)}, {fmtNum(model.nodes[selNode - 1].y)}{is3 ? `, ${fmtNum(model.nodes[selNode - 1].z)}` : ''}) {u.length} · DOFs {selNode * k - k + 1}–{selNode * k}
                {nodeD(selNode) && <> · d = ({nodeD(selNode)!.slice(0, k === 3 ? 2 : 3).join(', ')}) {u.length}, rotation{k === 6 ? 's' : ''} = ({nodeD(selNode)!.slice(k === 3 ? 2 : 3).join(', ')}) rad</>}
              </div>
            )}
          </section>

          <section className="col steps-col" aria-label="Solution steps" id="steps" tabIndex={-1}>
            <h2>Solution steps</h2>
            <nav className="stepper" aria-label="Steps">
              <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>◀ Back</button>
              <select value={step} onChange={(e) => setStep(Number(e.target.value))} aria-label="Jump to step">
                {STEPS.map((s, i) => <option key={i} value={i}>{i + 1}. {s.title}</option>)}
              </select>
              <button onClick={() => setStep(Math.min(STEPS.length - 1, step + 1))} disabled={step === STEPS.length - 1}>Next ▶</button>
            </nav>
            <div className="chips" role="tablist" aria-label="Step list">
              {STEPS.map((s, i) => (
                <button key={i} role="tab" aria-selected={i === step} className={i === step ? 'chip active' : 'chip'} onClick={() => setStep(i)} title={s.title}>{i + 1}</button>
              ))}
            </div>
            <h3>{step + 1}. {cur.title}</h3>
            {a && a.issues.some((i) => i.severity === 'error') && step > 0 && <IssueList issues={a.issues.filter((i) => i.severity === 'error')} />}
            <Boundary resetKey={model}>{body}</Boundary>
          </section>
        </main>
      </div>
    </DisplayCtx.Provider>
  );
}
