import type { Dimension, FemElement, FemModel } from './types';

/** DOFs per node: 3 (u, v, θz) in 2D; 6 (u, v, w, θx, θy, θz) in 3D. */
export function dofsPerNode(dim: Dimension): number {
  return dim === '2D' ? 3 : 6;
}

/** Plain-text names of the local DOF slots at a node, in order. */
export function dofNames(dim: Dimension): string[] {
  return dim === '2D' ? ['x', 'y', 'θz'] : ['x', 'y', 'z', 'θx', 'θy', 'θz'];
}

/** Human-readable names for messages ("x-translation", "z-rotation", ...). */
export function dofWords(dim: Dimension): string[] {
  return dim === '2D'
    ? ['x-translation', 'y-translation', 'rotation (about z)']
    : ['x-translation', 'y-translation', 'z-translation', 'x-rotation', 'y-rotation', 'z-rotation'];
}

/** 1-based global DOF number of local slot `local` (0-based) at node `nodeId` (1-based). */
export function globalDof(nodeId: number, local: number, dim: Dimension): number {
  return (nodeId - 1) * dofsPerNode(dim) + local + 1;
}

/** Inverse of globalDof: 1-based global DOF -> node and 0-based local slot. */
export function splitDof(dof: number, dim: Dimension): { nodeId: number; local: number } {
  const k = dofsPerNode(dim);
  return { nodeId: Math.floor((dof - 1) / k) + 1, local: (dof - 1) % k };
}

/**
 * Short label in textbook style: d2x, d2y, φ2 (2D) or d2x ... φ2z (3D).
 * `plain` gives an ASCII-safe variant for messages.
 */
export function dofLabel(nodeId: number, local: number, dim: Dimension): string {
  if (dim === '2D') return local < 2 ? `d${nodeId}${'xy'[local]}` : `φ${nodeId}`;
  return local < 3 ? `d${nodeId}${'xyz'[local]}` : `φ${nodeId}${'xyz'[local - 3]}`;
}

export function globalDofLabel(dof: number, dim: Dimension): string {
  const { nodeId, local } = splitDof(dof, dim);
  return dofLabel(nodeId, local, dim);
}

/** LaTeX version of dofLabel for KaTeX rendering. */
export function dofLabelTex(nodeId: number, local: number, dim: Dimension): string {
  if (dim === '2D') return local < 2 ? `d_{${nodeId}${'xy'[local]}}` : `\\phi_{${nodeId}}`;
  return local < 3 ? `d_{${nodeId}${'xyz'[local]}}` : `\\phi_{${nodeId}${'xyz'[local - 3]}}`;
}

/** Sentence-style description: "node 4, y-translation". */
export function describeDof(dof: number, dim: Dimension): string {
  const { nodeId, local } = splitDof(dof, dim);
  return `${dofLabel(nodeId, local, dim)} (node ${nodeId}, ${dofWords(dim)[local]})`;
}

/**
 * Element ID array: the 1-based global DOF numbers of the element's 2k local DOFs,
 * node i's DOFs first, then node j's.
 */
export function elementIdArray(el: Pick<FemElement, 'nodeI' | 'nodeJ'>, dim: Dimension): number[] {
  const k = dofsPerNode(dim);
  const ids: number[] = [];
  for (const n of [el.nodeI, el.nodeJ]) for (let d = 0; d < k; d++) ids.push(globalDof(n, d, dim));
  return ids;
}

export function totalDofs(model: Pick<FemModel, 'nodes' | 'dimension'>): number {
  return model.nodes.length * dofsPerNode(model.dimension);
}

/** Rows for the "DOF numbering" table: one row per node. */
export function dofTable(model: Pick<FemModel, 'nodes' | 'dimension'>) {
  const k = dofsPerNode(model.dimension);
  return model.nodes.map((n) => ({
    nodeId: n.id,
    dofs: Array.from({ length: k }, (_, d) => ({
      global: globalDof(n.id, d, model.dimension),
      label: dofLabel(n.id, d, model.dimension),
    })),
  }));
}
