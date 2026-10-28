import type { Dimension, EndRelease, FemModel, Support, UnitSystemId } from './types';
import { dofsPerNode } from './dof';

export const NO_RELEASE: EndRelease = { rx: false, ry: false, rz: false };

export function emptyModel(dimension: Dimension, units: UnitSystemId = dimension === '2D' ? 'kN-m' : 'kN-m'): FemModel {
  return {
    schemaVersion: 1,
    name: 'Untitled',
    dimension,
    units,
    nodes: [],
    materials: [],
    sections: [],
    elements: [],
    supports: [],
    springs: [],
    nodalLoads: [],
    elementLoads: [],
  };
}

/**
 * Support presets. A "roller-x" can roll in the x direction (it restrains y);
 * "roller-y" can roll in y (restrains x). In 3D the roller restrains the two
 * translations perpendicular to its rolling axis. Rotations stay free for every
 * roller and pinned preset.
 */
export type SupportPreset = 'fixed' | 'pinned' | 'roller-x' | 'roller-y' | 'roller-z';

export function supportPresetFlags(dim: Dimension, preset: SupportPreset): boolean[] | null {
  const k = dofsPerNode(dim);
  const flags = new Array<boolean>(k).fill(false);
  switch (preset) {
    case 'fixed':
      return flags.fill(true);
    case 'pinned':
      flags[0] = flags[1] = true;
      if (dim === '3D') flags[2] = true;
      return flags;
    case 'roller-x':
      flags[1] = true;
      if (dim === '3D') flags[2] = true;
      return flags;
    case 'roller-y':
      flags[0] = true;
      if (dim === '3D') flags[2] = true;
      return flags;
    case 'roller-z':
      if (dim === '2D') return null;
      flags[0] = flags[1] = true;
      return flags;
  }
}

export function makeSupport(dim: Dimension, nodeId: number, preset: SupportPreset): Support {
  const fixed = supportPresetFlags(dim, preset);
  if (!fixed) throw new Error(`Support preset "${preset}" is not available in ${dim}`);
  return { nodeId, fixed, prescribed: new Array<number>(fixed.length).fill(0) };
}

/**
 * Restore contiguous 1-based ids after deleting rows, remapping every reference
 * (element end nodes, supports, springs, loads, material/section ids). Rows keep
 * their relative order (sorted by their old id). References to rows that no
 * longer exist are dropped, since a dangling reference cannot be meaningfully kept.
 */
export function renumberModel(model: FemModel): FemModel {
  const remap = <T extends { id: number }>(rows: T[]) => {
    const sorted = [...rows].sort((a, b) => a.id - b.id);
    const map = new Map<number, number>();
    sorted.forEach((r, i) => map.set(r.id, i + 1));
    return { rows: sorted.map((r, i) => ({ ...r, id: i + 1 })), map };
  };
  const nodes = remap(model.nodes);
  const mats = remap(model.materials);
  const secs = remap(model.sections);

  // Elements whose nodes/material/section survive keep their relative order and are renumbered 1..M.
  const elemMap = new Map<number, number>();
  const elements = model.elements
    .slice()
    .sort((a, b) => a.id - b.id)
    .flatMap((e) => {
      const nodeI = nodes.map.get(e.nodeI);
      const nodeJ = nodes.map.get(e.nodeJ);
      const materialId = mats.map.get(e.materialId);
      const sectionId = secs.map.get(e.sectionId);
      if (nodeI === undefined || nodeJ === undefined || materialId === undefined || sectionId === undefined) return [];
      const id = elemMap.size + 1;
      elemMap.set(e.id, id);
      return [{ ...e, id, nodeI, nodeJ, materialId, sectionId }];
    });

  const keepNode = <T extends { nodeId: number }>(rows: T[]) =>
    rows.flatMap((r) => {
      const nodeId = nodes.map.get(r.nodeId);
      return nodeId === undefined ? [] : [{ ...r, nodeId }];
    });

  return {
    ...model,
    nodes: nodes.rows,
    materials: mats.rows,
    sections: secs.rows,
    elements,
    supports: keepNode(model.supports),
    springs: keepNode(model.springs),
    nodalLoads: keepNode(model.nodalLoads),
    elementLoads: model.elementLoads.flatMap((l) => {
      const elementId = elemMap.get(l.elementId);
      return elementId === undefined ? [] : [{ ...l, elementId }];
    }),
  };
}
