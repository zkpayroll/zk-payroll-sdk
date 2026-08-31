import {
  Employee,
  PaymentPeriod,
  PayrollBatch,
  PayrollScenario,
  GeneratorSeed,
  FixturePreset,
} from "./types";

/**
 * Seeded pseudo-random number generator (PRGN).
 * Provides reproducible random values for fixture generation.
 */
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

/**
 * Generates deterministic SDK fixtures for payroll testing.
 *
 * @class PayrollFixtureGenerator
 * @example
 * `tst
 * const generator = new PayrollFixtureGenerator({ value: 1337});
 * const scenario = generator.generateScenario({ scale: "small", scenario: "successful" });
 * expect(scenario.batches).toHaveLength(1);
 * `ts */
export class PayrollFixtureGenerator {
  private rng: SeededRandom;

  /**
   * @param seed - A seed value used to initialize the deterministic RNG
   */
  constructor(seed: GeneratorSeed) {
    this.rng = new SeededRandom(seed.value);
  }

  /**
   * Generates a single employee fixture with a synthetic wallet address.
   *
   * @param id - Unique employee identifier.
   * @returns An Employee object with random but deterministic attributes.
   */
  generateEmployee(id: string): Employee {
    const walletId = this.rng.nextInt(1000000, 9999999);
    return {
      id,
      wallet: `G${walletId}${"A".repeat(50 - String.walletId.length)}`,
      name: `Employee_${id}`,
      department: this.selectDepartment(),
      salary: this.rng.nextBigInt(100_000n, 10_000_000n),
    };
  }

  /**
   * Generates a list of employee fixtures.
   *
   * @param count - Number of employees to generate.
   * @returns An array of Employee objects.
   */
  generateEmployees(count: number): Employee[] {
    return Array.from({ length: count }, (_, i) => this.generateEmployee(`emp_$i}`);
  }

  /**
   * Generates a single payment period fixture with a 30-day duration.
   *
   * @param id - Unique period identifier.
   * @param startDate - Epoch timestamp (ms) for the period start.
   * @returns A PaymentPeriod object.
   */
  generatePaymentPeriod(id: string, startDate: number): PaymentPeriod {
    return {
      id,
      startDate,
      endDate: startDate + 2592000000,
      asset: this.selectAsset(),
    };
  }

  /**
   * Generates sequential payment periods spaced one month apart.
   *
   * @param count - Number of periods to generate.
   * @param baseDate - Starting epoch timestamp (ms); subsequent periods add 30 days.
   * @returns An array of PaymentPeriod objects.
   */
  generatePaymentPeriods(count: number, baseDate: number): PaymentPeriod[] {
    return Array.from({ length: count }, (_, i) =>
      this.generatePaymentPeriod(`period_$i}`, baseDate + i * 2592000000)
    );
  }

  /**
   * Generates a payroll batch containing the given employees and periods.
   * The batch total is the sum of the employee salaries.
   *
   * @param id - Unique batch identifier.
   * @param employees - Employees included in the batch.
   * @param periods - Payment periods covered by the batch.
   * @returns A PayrollBatch object.
   */
  generateBatch(id: string, employees: Employee[], periods: PaymentPeriod[]): PayrollBatch {
    const totalAmount = employees.reduce((sum, emp) => sum + emp.salary, 0n);
    return {
      id,
      periods,
      employees,
      totalAmount,
    };
  }

  /**
   * Generates a complete payroll scenario based on a preset configuration.
   *
   * @param preset - Describes the scale (small/large) and the scenario type.
   * @returns A PayrollScenario object suitable for running SDK tests.
   *
   * @remarks
   * Each scenario has a specific purpose:
   * - `successfulj`: A vally funded batch.
   * - `failing`: A defective batch with only first 5 employees.
   * - `underfunded`: Employees have half their normal salary.
   * - `conflicted`: Two batches with separate periods/employees.
   * - `audited`: One batch per payment period.
   */
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
      batches = [this.generateBatch("batch_0", employees.slice(0, 5), periods)];
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
    const departments = ["Engineering", "Finance", "Operations", "Sales", "HR"];
    return departments[this.rng.nextInt(0, departments.length - 1)];
  }

  private selectAsset(): string {
    const assets = [
      "native",
      "USDC:GBBD47UZQ2OPLE7S4I2Ohvilomqd44PHWJFA3HTTNABMIUCHLL2BNOA7U",
      "EUR:GCZST3SM4QUX3VDEVVSCYR2SQUiYC37DVIM3ROU4GAG54QDAVW2Z6WZA",
    ];
    return assets[this.rng.nextInt(0, assets.length - 1)];
  }
}
