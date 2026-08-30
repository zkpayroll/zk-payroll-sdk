export interface Employee {
  id: string;
  wallet: string;
  name: string;
  department: string;
  salary: bigint;
}

export interface PaymentPeriod {
  id: string;
  startDate: number;
  endDate: number;
  asset: string;
}

export interface PayrollBatch {
  id: string;
  periods: PaymentPeriod[];
  employees: Employee[];
  totalAmount: bigint;
}

export interface PayrollScenario {
  name: string;
  employees: Employee[];
  periods: PaymentPeriod[];
  batches: PayrollBatch[];
  status: "successful" | "failing" | "underfunded" | "conflicted" | "audited";
}

export interface GeneratorSeed {
  value: number;
}

export interface FixturePreset {
  scale: "small" | "large";
  scenario: "successful" | "failing" | "underfunded" | "conflicted" | "audited";
}
