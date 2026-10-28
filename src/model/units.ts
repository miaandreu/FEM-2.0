import type { UnitSystemId } from './types';

/**
 * Unit systems are LABELS only: the tool never converts values. The label is used
 * to annotate results and to warn when E looks implausible for the chosen system.
 */
export interface UnitSystem {
  id: UnitSystemId;
  label: string;
  force: string;
  length: string;
  /** Stress / modulus unit implied by force and length. */
  stress: string;
  moment: string;
  /** Multiply a modulus in psi by this to express it in this system's stress unit. */
  fromPsi: number;
}

export const UNIT_SYSTEMS: Record<UnitSystemId, UnitSystem> = {
  'lb-in': { id: 'lb-in', label: 'lb – in', force: 'lb', length: 'in', stress: 'psi', moment: 'lb·in', fromPsi: 1 },
  'kip-in': { id: 'kip-in', label: 'kip – in', force: 'kip', length: 'in', stress: 'ksi', moment: 'kip·in', fromPsi: 1e-3 },
  'kip-ft': { id: 'kip-ft', label: 'kip – ft', force: 'kip', length: 'ft', stress: 'kip/ft²', moment: 'kip·ft', fromPsi: 0.144 },
  'N-m': { id: 'N-m', label: 'N – m', force: 'N', length: 'm', stress: 'Pa', moment: 'N·m', fromPsi: 6894.757 },
  'kN-m': { id: 'kN-m', label: 'kN – m', force: 'kN', length: 'm', stress: 'kN/m² (kPa)', moment: 'kN·m', fromPsi: 6.894757 },
  'N-mm': { id: 'N-mm', label: 'N – mm', force: 'N', length: 'mm', stress: 'MPa (N/mm²)', moment: 'N·mm', fromPsi: 6.894757e-3 },
};

export const UNIT_IDS = Object.keys(UNIT_SYSTEMS) as UnitSystemId[];

/** Plausible structural-material range for E, expressed in psi (wood/plastic ... steel/tungsten). */
const E_MIN_PSI = 1e5;
const E_MAX_PSI = 1e8;

export function plausibleModulusRange(units: UnitSystemId): { min: number; max: number } {
  const f = UNIT_SYSTEMS[units].fromPsi;
  return { min: E_MIN_PSI * f, max: E_MAX_PSI * f };
}

export function isPlausibleModulus(E: number, units: UnitSystemId): boolean {
  const { min, max } = plausibleModulusRange(units);
  return E >= min && E <= max;
}
