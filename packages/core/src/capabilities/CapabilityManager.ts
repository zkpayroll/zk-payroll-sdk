import {
  CapabilityFeature,
  CapabilitySet,
  CapabilityValidation,
} from "./types";

export class CapabilityManager {
  private capabilities: Map<string, CapabilityFeature> = new Map();
  private requiredFeatures: Set<string> = new Set();

  registerCapability(feature: CapabilityFeature): void {
    this.capabilities.set(feature.name, feature);
    if (feature.required) {
      this.requiredFeatures.add(feature.name);
    }
  }

  registerCapabilities(features: CapabilityFeature[]): void {
    for (const feature of features) {
      this.registerCapability(feature);
    }
  }

  getCapability(name: string): CapabilityFeature | undefined {
    return this.capabilities.get(name);
  }

  getAllCapabilities(): CapabilitySet {
    return {
      features: Array.from(this.capabilities.values()),
      timestamp: Date.now(),
    };
  }

  validateCapabilities(
    availableFeatures: string[]
  ): CapabilityValidation {
    const availableSet = new Set(availableFeatures);
    const missingFeatures: string[] = [];
    const incompatibleFeatures: string[] = [];

    for (const required of this.requiredFeatures) {
      if (!availableSet.has(required)) {
        missingFeatures.push(required);
      }
    }

    for (const available of availableFeatures) {
      const capability = this.capabilities.get(available);
      if (!capability) {
        incompatibleFeatures.push(available);
      }
    }

    return {
      valid: missingFeatures.length === 0,
      missingFeatures,
      incompatibleFeatures,
    };
  }

  markCapabilityRequired(name: string): void {
    const capability = this.capabilities.get(name);
    if (capability) {
      capability.required = true;
      this.requiredFeatures.add(name);
    }
  }

  markCapabilityOptional(name: string): void {
    const capability = this.capabilities.get(name);
    if (capability) {
      capability.required = false;
      this.requiredFeatures.delete(name);
    }
  }

  getRequiredFeatures(): string[] {
    return Array.from(this.requiredFeatures);
  }

  getOptionalFeatures(): string[] {
    const optional: string[] = [];
    for (const [name, feature] of this.capabilities) {
      if (!feature.required) {
        optional.push(name);
      }
    }
    return optional;
  }
}
