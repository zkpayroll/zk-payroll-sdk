import {
  Employee,
  PaymentPeriod,
  PayrollBatch,
  PayrollScenario,
  GeneratorSeed,
  FixturePreset,
} from "./types";

class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextBigInt(min: bigint, max: bigint): bigint {
    const range = max - min + 1n;
    const randomPart = BigInt(Math.floor(this.next() * 1000000000));
    return min + (randomPart % range);
  }
}

export class PayrollFixtureGenerator {
  private rng: SeededRandom;

  constructor(seed: GeneratorSeed) {
    this.rng = new SeededRandom(seed.value);
  }

  generateEmployee(id: string): Employee {
    const walletId = this.rng.nextInt(1000000, 9999999);
    return {
      id,
      wallet: `G${walletId}${"A".repeat(50 - String(walletId).length)}`,
      name: `Employee_${id}`,
      department: this.selectDepartment(),
      salary: this.rng.nextBigInt(100_000n, 10_000_000n),
    };
  }

  generateEmployees(count: number): Employee[] {
    return Array.from({ length: count }, (_, i) =>
      this.generateEmployee(`emp_${i}`)
    );
  }

  generatePaymentPeriod(id: string, startDate: number): PaymentPeriod {
    return {
      id,
      startDate,
      endDate: startDate + 2592000000,
      asset: this.selectAsset(),
    };
  }

  generatePaymentPeriods(
    count: number,
    baseDate: number
  ): PaymentPeriod[] {
    return Array.from({ length: count }, (_, i) =>
      this.generatePaymentPeriod(`period_${i}`, baseDate + i * 2592000000)
    );
  }

  generateBatch(
    id: string,
    employees: Employee[],
    periods: PaymentPeriod[]
  ): PayrollBatch {
    const totalAmount = employees.reduce((sum, emp) => sum + emp.salary, 0n);
    return {
      id,
      periods,
      employees,
      totalAmount,
    };
  }

  generateScenario(preset: FixturePreset): PayrollScenario {
    const employeeCount = preset.scale === "small" ? 10 : 100;
    const periodCount = preset.scale === "small" ? 3 : 12;

    const employees = this.generateEmployees(employeeCount);
    const baseDate = Date.now() - 86400000 * 30;
    const periods = this.generatePaymentPeriods(periodCount, baseDate);

    let batches: PayrollBatch[] = [];
    if (preset.scenario === "successful") {
      batches = [this.generateBatch("batch_0", employees, periods)];
    } else if (preset.scenario === "failing") {
      batches = [
        this.generateBatch("batch_0", employees.slice(0, 5), periods),
      ];
    } else if (preset.scenario === "underfunded") {
      const reducedEmployees = employees.map((emp) => ({
        ...emp,
        salary: emp.salary / 2n,
      }));
      batches = [this.generateBatch("batch_0", reducedEmployees, periods)];
    } else if (preset.scenario === "conflicted") {
      const half = Math.floor(employees.length / 2);
      batches = [
        this.generateBatch("batch_0", employees.slice(0, half), [periods[0]]),
        this.generateBatch("batch_1", employees.slice(half), [periods[1]]),
      ];
    } else if (preset.scenario === "audited") {
      batches = periods.map((period, idx) =>
        this.generateBatch(`batch_${idx}`, employees, [period])
      );
    }

    return {
      name: `${preset.scale}-${preset.scenario}`,
      employees,
      periods,
      batches,
      status: preset.scenario as PayrollScenario["status"],
    };
  }

  private selectDepartment(): string {
    const departments = [
      "Engineering",
      "Finance",
      "Operations",
      "Sales",
      "HR",
    ];
    return departments[this.rng.nextInt(0, departments.length - 1)];
  }

  private selectAsset(): string {
    const assets = [
      "native",
      "USDC:GBBD47UZQ2OPLE7S4I2Ohvilomqd4PHWJFA3HTTNABMIUCHLL2BNOA7U",
      "EUR:GCZST3SM4QUX3VDEVVSSCYR2SQUYC37DVIM3ROU4GAG54QDAVW2Z6WZA",
    ];
    return assets[this.rng.nextInt(0, assets.length - 1)];
  }
}
