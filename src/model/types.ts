/**
 * Data model for a user-defined frame. Everything here is plain JSON-serializable
 * data (no classes) so a model can be saved to a file, put in the URL hash, and
 * hashed deterministically.
 *
 * IDs are 1-based and must be contiguous (1..N) within each table; the global DOF
 * numbering depends on it (node n owns DOFs (n-1)k+1 .. nk). `renumberModel`
 * restores that invariant after edits.
 */

export type Dimension = '2D' | '3D';

export type UnitSystemId = 'lb-in' | 'kip-in' | 'kip-ft' | 'N-m' | 'kN-m' | 'N-mm';

export interface FemNode {
  id: number;
  x: number;
  y: number;
  /** Always 0 in 2D models. */
  z: number;
}

export interface Material {
  id: number;
  name: string;
  /** Young's modulus. */
  E: number;
  /** Shear modulus. If omitted in 3D, G = E / (2 (1 + nu)). */
  G?: number;
  /** Poisson's ratio, used only when G is omitted. */
  nu?: number;
}

export interface Section {
  id: number;
  name: string;
  /** Cross-sectional area. */
  A: number;
  /** Second moment of area about the local z axis (bending in the local x-y plane). The only I used in 2D. */
  Iz: number;
  /** Second moment of area about the local y axis (bending in the local x-z plane). 3D only. */
  Iy: number;
  /** Torsion constant. 3D only. */
  J: number;
}

/** Which ROTATIONAL local DOFs are released (moment = 0) at one element end. 2D uses only `rz`. */
export interface EndRelease {
  rx: boolean;
  ry: boolean;
  rz: boolean;
}

export interface FemElement {
  id: number;
  nodeI: number;
  nodeJ: number;
  materialId: number;
  sectionId: number;
  releaseI: EndRelease;
  releaseJ: EndRelease;
  /** 3D only: reference vector that, with x-hat, defines the local x-y plane. Default: global Z. */
  refVector?: [number, number, number];
  /** 3D only: roll angle (degrees) about local x-hat applied after the reference-vector orientation. */
  rollAngleDeg?: number;
}

/** Restraint at one node. Arrays have length k (3 in 2D, 6 in 3D), in DOF order (see dof.ts). */
export interface Support {
  nodeId: number;
  fixed: boolean[];
  /** Prescribed value per DOF (translation or rotation). Meaningful only where `fixed` is true. */
  prescribed: number[];
}

/** Linear spring to ground at one DOF: adds k to the diagonal of K. */
export interface Spring {
  nodeId: number;
  /** 0-based local DOF index at the node (0..k-1). */
  dof: number;
  k: number;
}

export interface NodalLoad {
  nodeId: number;
  /** 0-based local DOF index at the node (0..k-1). */
  dof: number;
  value: number;
}

export interface ElementLoad {
  elementId: number;
  /** 'uniform' uses w1 only; 'linear' varies from w1 at node i to w2 at node j. */
  kind: 'uniform' | 'linear';
  coordSys: 'local' | 'global';
  axis: 'x' | 'y' | 'z';
  /** Load intensity (force per length) in the positive direction of `axis`. */
  w1: number;
  w2: number;
}

export interface FemModel {
  schemaVersion: 1;
  name: string;
  dimension: Dimension;
  units: UnitSystemId;
  nodes: FemNode[];
  materials: Material[];
  sections: Section[];
  elements: FemElement[];
  supports: Support[];
  springs: Spring[];
  nodalLoads: NodalLoad[];
  elementLoads: ElementLoad[];
}

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: Severity;
  /** Stable machine-readable code, e.g. "ELEMENT_ZERO_LENGTH". */
  code: string;
  /** Student-friendly message. */
  message: string;
  table?: 'nodes' | 'materials' | 'sections' | 'elements' | 'supports' | 'springs' | 'nodalLoads' | 'elementLoads' | 'model';
  /** Row id (node/element/material/section id) or index for tables without ids. */
  id?: number;
}
