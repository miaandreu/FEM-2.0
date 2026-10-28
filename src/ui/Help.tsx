import { Fragment, type ReactNode } from 'react';
import guide from '../../USER_GUIDE.md?raw';

/** Minimal markdown → React (headings, lists, **bold**, `code`, paragraphs) for the in-app Help panel. */
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((p, i) => {
    if (p.startsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
    if (p.startsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith('*') && p.length > 2) return <i key={i}>{p.slice(1, -1)}</i>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export function Help() {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    out.push(list.ordered ? <ol key={out.length}>{list.items.map((x, i) => <li key={i}>{x}</li>)}</ol> : <ul key={out.length}>{list.items.map((x, i) => <li key={i}>{x}</li>)}</ul>);
    list = null;
  };
  for (const line of guide.split('\n')) {
    const h = /^(#{1,3})\s+(.*)/.exec(line);
    const ol = /^\d+\.\s+(.*)/.exec(line);
    const ul = /^\s*-\s+(.*)/.exec(line);
    if (h) { flush(); const L = h[1].length; out.push(L === 1 ? <h2 key={out.length}>{inline(h[2])}</h2> : L === 2 ? <h3 key={out.length}>{inline(h[2])}</h3> : <h4 key={out.length}>{inline(h[2])}</h4>); }
    else if (ol) { if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; } list.items.push(inline(ol[1])); }
    else if (ul) { if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; } list.items.push(inline(ul[1])); }
    else if (line.trim() === '') flush();
    else { flush(); out.push(<p key={out.length}>{inline(line)}</p>); }
  }
  flush();
  return <div className="doc">{out}</div>;
}

export function Conventions() {
  return (
    <div className="doc">
      <h2>Conventions</h2>
      <ul>
        <li><b>Axes:</b> right-handed global X, Y. Counter-clockwise rotations and moments are positive.</li>
        <li><b>DOF numbering:</b> node <i>n</i> owns global DOFs (n−1)·3+1 … n·3, in the order x-displacement, y-displacement, rotation. Labels: d2x, d2y, φ2.</li>
        <li><b>Element axes:</b> local x̂ runs from node <i>i</i> to node <i>j</i>; ŷ is x̂ rotated 90° counter-clockwise; ẑ = z. C = cos θ = (x₂−x₁)/L, S = sin θ = (y₂−y₁)/L.</li>
        <li><b>Element DOFs (local):</b> [d̂₁ₓ, d̂₁ᵧ, φ̂₁, d̂₂ₓ, d̂₂ᵧ, φ̂₂]; end forces f̂ act <i>on</i> the element ends, in the same order.</li>
        <li><b>Distributed loads:</b> force per unit member length; positive along the stated axis. They become equivalent nodal loads; member end forces are f̂ = k̂ d̂ − f̂<sub>eq</sub>.</li>
        <li><b>Hinges:</b> the released end moment is removed by static condensation k* = k<sub>rr</sub> − k<sub>rc</sub> k<sub>cc</sub>⁻¹ k<sub>cr</sub>.</li>
        <li><b>3D:</b> global X, Y, Z (Z is up), right-handed; six DOFs per node (u, v, w, θx, θy, θz), numbered (n−1)·6+1 … n·6 (labels d2x … φ2z). Local element order is [u₁ v₁ w₁ θx₁ θy₁ θz₁ | u₂ v₂ w₂ θx₂ θy₂ θz₂].</li>
        <li><b>3D element axes:</b> x̂ from node i to node j. A reference vector (default global Z) lies in the local x–y plane: ẑ = x̂ × r, ŷ = ẑ × x̂. For a vertical member the reference becomes global X (the tool tells you when it does this). A roll angle turns ŷ, ẑ about x̂. With the default axes a horizontal member's ŷ points up, so vertical bending uses <b>Iz</b>.</li>
        <li><b>3D stiffness blocks:</b> axial EA/L, torsion GJ/L, bending about z (EIz, in the x–y plane) and bending about y (EIy, x–z plane; θy = −dw/dx, so its θ couplings change sign). G = E/2(1+ν) if G is not given.</li>
        <li><b>Units:</b> labels only; nothing is converted. Use one consistent system.</li>
        <li><b>Colours:</b> blue = axial terms, red = bending terms, grey = zeros, yellow = cells touched by the selected element.</li>
      </ul>
    </div>
  );
}
