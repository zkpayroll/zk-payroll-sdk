import {
  PayrollFixtureGenerator,
  FixturePreset,
  PayrollScenario,
} from "../generators";

export function createSmallSuccessfulFixture(): PayrollScenario {
  const generator = new PayrollFixtureGenerator({ value: 42 });
  return generator.generateScenario({
    scale: "small",
    scenario: "successful",
  });
}

export function createLargeSuccessfulFixture(): PayrollScenario {
  const generator = new PayrollFixtureGenerator({ value: 123 });
  return generator.generateScenario({
    scale: "large",
    scenario: "successful",
  });
}

export function createSmallUnderfundedFixture(): PayrollScenario {
  const generator = new PayrollFixtureGenerator({ value: 456 });
  return generator.generateScenario({
    scale: "small",
    scenario: "underfunded",
  });
}

export function createLargeUnderfundedFixture(): PayrollScenario {
  const generator = new PayrollFixtureGenerator({ value: 789 });
  return generator.generateScenario({
    scale: "large",
    scenario: "underfunded",
  });
}

export function createConflictedFixture(): PayrollScenario {
  const generator = new PayrollFixtureGenerator({ value: 1001 });
  return generator.generateScenario({
    scale: "small",
    scenario: "conflicted",
  });
}

export function createAuditedFixture(): PayrollScenario {
  const generator = new PayrollFixtureGenerator({ value: 2002 });
  return generator.generateScenario({
    scale: "large",
    scenario: "audited",
  });
}

export function createFixture(preset: FixturePreset, seed?: number): PayrollScenario {
  const generator = new PayrollFixtureGenerator({
    value: seed ?? Date.now() % 1000000,
  });
  return generator.generateScenario(preset);
}

export { PayrollFixtureGenerator } from "../generators";
