export type LicenseUnit = 'user' | 'device' | 'core' | 'instance';
export type LicenseState = 'surplus' | 'balanced' | 'potential_shortfall' | 'missing_data';

export const LICENSE_RENEWAL_NOTICE_DAYS = 90;
const DAY_MS = 86_400_000;

export interface LicenseInput {
  unit: LicenseUnit;
  contractual_scope: string;
  entitlement: number;
  assigned: number | null;
  consumption: number | null;
  measured_at: string | Date | null;
  completeness: number | null;
  renewal_at: string | Date;
}

export interface LicenseEvaluation {
  /** Entitlement minus measured consumption. Null when consumption was not measured. */
  available_balance: number | null;
  /** Measured consumption above entitlement. Not a legal compliance finding. */
  potential_shortfall: number | null;
  assigned_balance: number | null;
  state: LicenseState;
  measurement_complete: boolean;
  days_to_renewal: number;
  renewal_upcoming: boolean;
  calculation_basis: string;
}

export function evaluateLicense(l: LicenseInput, now: Date): LicenseEvaluation {
  const days_to_renewal = Math.ceil((new Date(l.renewal_at).getTime() - now.getTime()) / DAY_MS);
  const renewal_upcoming = days_to_renewal >= 0 && days_to_renewal <= LICENSE_RENEWAL_NOTICE_DAYS;
  const assigned_balance = l.assigned === null ? null : l.entitlement - l.assigned;

  if (l.consumption === null || !l.measured_at) {
    return {
      available_balance: null,
      potential_shortfall: null,
      assigned_balance,
      state: 'missing_data',
      measurement_complete: false,
      days_to_renewal,
      renewal_upcoming,
      calculation_basis: 'No consumption measurement is available, so balance and shortfall cannot be calculated.',
    };
  }

  const available_balance = l.entitlement - l.consumption;
  const measurement_complete = l.completeness === 100;
  const coverageNote = measurement_complete ? '' : ` The measurement covers ${l.completeness ?? 'an unknown share'}% of the scope, so treat the result as provisional.`;
  return {
    available_balance,
    potential_shortfall: Math.max(0, l.consumption - l.entitlement),
    assigned_balance,
    state: available_balance < 0 ? 'potential_shortfall' : available_balance === 0 ? 'balanced' : 'surplus',
    measurement_complete,
    days_to_renewal,
    renewal_upcoming,
    calculation_basis: `Balance = entitlement ${l.entitlement} - measured consumption ${l.consumption} = ${available_balance} ${l.unit}(s), within "${l.contractual_scope}".${coverageNote}`,
  };
}

/** Quantities compare only within the same unit and contractual scope. */
export function areComparable(a: Pick<LicenseInput, 'unit' | 'contractual_scope'>, b: Pick<LicenseInput, 'unit' | 'contractual_scope'>): boolean {
  return a.unit === b.unit && a.contractual_scope === b.contractual_scope;
}

export interface LicenseSummaryGroup {
  unit: LicenseUnit;
  contractual_scope: string;
  licenses: number;
  entitlement: number;
  /** Only sums records that have a measurement. */
  measured_entitlement: number;
  consumption: number;
  potential_shortfall: number;
  missing_measurements: number;
}

/** Groups by unit and scope. There is deliberately no grand total across units. */
export function summarizeLicenses(rows: LicenseInput[]): LicenseSummaryGroup[] {
  const groups = new Map<string, LicenseSummaryGroup>();
  for (const row of rows) {
    const key = `${row.unit}|${row.contractual_scope}`;
    const group = groups.get(key) ?? {
      unit: row.unit,
      contractual_scope: row.contractual_scope,
      licenses: 0,
      entitlement: 0,
      measured_entitlement: 0,
      consumption: 0,
      potential_shortfall: 0,
      missing_measurements: 0,
    };
    group.licenses++;
    group.entitlement += row.entitlement;
    if (row.consumption === null || !row.measured_at) {
      group.missing_measurements++;
    } else {
      group.measured_entitlement += row.entitlement;
      group.consumption += row.consumption;
      group.potential_shortfall += Math.max(0, row.consumption - row.entitlement);
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.unit.localeCompare(b.unit) || a.contractual_scope.localeCompare(b.contractual_scope));
}
