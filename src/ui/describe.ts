import type { FemModel } from '../model';
import { fmtNum } from './format';

/** Plain-language description of a model, for screen readers (drawings are not otherwise readable). */
export function describeModel(m: FemModel): string {
  const k = m.dimension === '2D' ? 3 : 6;
  const els = m.elements
    .slice(0, 30)
    .map((e) => `element ${e.id} from node ${e.nodeI} to node ${e.nodeJ}`)
    .join('; ');
  const sup = m.supports.map((s) => `node ${s.nodeId} (${s.fixed.filter(Boolean).length} of ${k} DOFs restrained)`).join(', ');
  const loads = [
    ...m.nodalLoads.slice(0, 20).map((l) => `${fmtNum(l.value)} on DOF ${l.dof + 1} of node ${l.nodeId}`),
    ...m.elementLoads.slice(0, 20).map((l) => `distributed ${fmtNum(l.w1)} on element ${l.elementId}`),
  ].join('; ');
  return `${m.dimension} frame "${m.name}": ${m.nodes.length} nodes, ${m.elements.length} elements. ${els ? `Elements: ${els}${m.elements.length > 30 ? '; and more' : ''}.` : ''} ${sup ? `Supports at ${sup}.` : 'No supports.'} ${loads ? `Loads: ${loads}.` : 'No loads.'}`;
}
