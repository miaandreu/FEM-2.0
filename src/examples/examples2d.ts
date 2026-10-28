import { NO_RELEASE, emptyModel, makeSupport, type FemElement, type FemModel } from '../model';

const el = (id: number, nodeI: number, nodeJ: number, sectionId = 1, rel: Partial<Pick<FemElement, 'releaseI' | 'releaseJ'>> = {}): FemElement => ({
  id, nodeI, nodeJ, materialId: 1, sectionId,
  releaseI: { ...NO_RELEASE, ...rel.releaseI },
  releaseJ: { ...NO_RELEASE, ...rel.releaseJ },
});

/** Example A: Logan Example 5.1 (Fig. 5-4), rigid plane frame, lb–in. */
export function exampleA(): FemModel {
  const m = emptyModel('2D', 'lb-in');
  m.name = 'A: Rigid plane frame (Logan Fig. 5-4)';
  m.nodes = [
    { id: 1, x: -60, y: 0, z: 0 },
    { id: 2, x: -60, y: 120, z: 0 },
    { id: 3, x: 60, y: 120, z: 0 },
    { id: 4, x: 60, y: 0, z: 0 },
  ];
  m.materials = [{ id: 1, name: 'E = 30×10⁶ psi', E: 30e6 }];
  m.sections = [
    { id: 1, name: 'A=10, I=200', A: 10, Iz: 200, Iy: 200, J: 1 },
    { id: 2, name: 'A=10, I=100', A: 10, Iz: 100, Iy: 100, J: 1 },
  ];
  m.elements = [el(1, 1, 2, 1), el(2, 2, 3, 2), el(3, 3, 4, 1)];
  m.supports = [makeSupport('2D', 1, 'fixed'), makeSupport('2D', 4, 'fixed')];
  m.nodalLoads = [
    { nodeId: 2, dof: 0, value: 10000 },
    { nodeId: 3, dof: 2, value: 5000 },
  ];
  return m;
}

const beamBase = (name: string): FemModel => {
  const m = emptyModel('2D', 'kN-m');
  m.name = name;
  m.materials = [{ id: 1, name: 'E = 200 GPa', E: 2e8 }];
  m.sections = [{ id: 1, name: 'I = 1×10⁻⁴ m⁴, A = 0.01 m²', A: 0.01, Iz: 1e-4, Iy: 1e-4, J: 1e-5 }];
  return m;
};

/** Example B: Logan Fig. P4-41. Fixed wall, hinge at x = 2 m carrying P = 5 kN down, roller at x = 4 m. */
export function exampleB(): FemModel {
  const m = beamBase('B: Beam with internal hinge (Logan P4-41)');
  m.nodes = [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 2, y: 0, z: 0 },
    { id: 3, x: 4, y: 0, z: 0 },
  ];
  m.elements = [el(1, 1, 2), el(2, 2, 3, 1, { releaseI: { rx: false, ry: false, rz: true } })];
  m.supports = [makeSupport('2D', 1, 'fixed'), makeSupport('2D', 3, 'roller-x')];
  m.nodalLoads = [{ nodeId: 2, dof: 1, value: -5 }];
  return m;
}

/** Example C: Logan Fig. P4-42. Fixed wall, 2 m, roller, 1 m, hinge, 1 m, fixed wall; 10 kN/m on the last metre. */
export function exampleC(): FemModel {
  const m = beamBase('C: Beam with hinge and distributed load (Logan P4-42)');
  m.nodes = [0, 2, 3, 4].map((x, i) => ({ id: i + 1, x, y: 0, z: 0 }));
  m.elements = [
    el(1, 1, 2),
    el(2, 2, 3, 1, { releaseJ: { rx: false, ry: false, rz: true } }),
    el(3, 3, 4, 1, { releaseI: { rx: false, ry: false, rz: true } }),
  ];
  m.supports = [makeSupport('2D', 1, 'fixed'), makeSupport('2D', 2, 'roller-x'), makeSupport('2D', 4, 'fixed')];
  m.elementLoads = [{ elementId: 3, kind: 'uniform', coordSys: 'global', axis: 'y', w1: -10, w2: -10 }];
  return m;
}
