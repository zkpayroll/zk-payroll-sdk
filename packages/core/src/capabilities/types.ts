export interface CapabilityFeature {
  name: string;
  version: string;
  required: boolean;
}

export interface CapabilitySet {
  features: CapabilityFeature[];
  timestamp: number;
}

export interface CapabilityValidation {
  valid: boolean;
  missingFeatures: string[];
  incompatibleFeatures: string[];
}
