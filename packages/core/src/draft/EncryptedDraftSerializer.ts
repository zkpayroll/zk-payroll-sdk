import { EncryptionProvider } from "./EncryptionProvider";
import { PayrollDraft, PayrollDraftEntry } from "./types";

export interface SensitiveFieldConfig {
  field: string;
  requiresEncryption: boolean;
}

export interface DraftMetadata {
  version: number;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
  label?: string;
  isEncrypted: boolean;
  encryptionTimestamp?: number;
}

export interface EncryptedDraftPackage {
  metadata: DraftMetadata;
  encryptedPayload: string;
  redactedPreview?: RedactedDraftPreview;
}

export interface RedactedDraftPreview {
  label?: string;
  entryCount: number;
  assets: string[];
  totalAmountRedacted: boolean;
}

export class EncryptedDraftSerializer {
  private encryptionProvider: EncryptionProvider | null = null;
  private schemaVersion = "1.0.0";

  setEncryptionProvider(provider: EncryptionProvider): void {
    this.encryptionProvider = provider;
  }

  async serializeWithEncryption(draft: PayrollDraft): Promise<EncryptedDraftPackage> {
    if (!this.encryptionProvider || !this.encryptionProvider.canEncrypt()) {
      throw new Error("Encryption provider is not available or initialized");
    }

    this.validateDraftForSerialization(draft);

    const payload = JSON.stringify(draft);
    const encryptedPayload = await this.encryptionProvider.encrypt(payload);

    const metadata: DraftMetadata = {
      version: draft.version,
      schemaVersion: this.schemaVersion,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      label: draft.label,
      isEncrypted: true,
      encryptionTimestamp: Date.now(),
    };

    const redactedPreview = this.createRedactedPreview(draft);

    return {
      metadata,
      encryptedPayload,
      redactedPreview,
    };
  }

  async serializeWithoutEncryption(draft: PayrollDraft): Promise<EncryptedDraftPackage> {
    this.validateDraftForSerialization(draft);

    const metadata: DraftMetadata = {
      version: draft.version,
      schemaVersion: this.schemaVersion,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      label: draft.label,
      isEncrypted: false,
    };

    return {
      metadata,
      encryptedPayload: JSON.stringify(draft),
    };
  }

  async deserialize(pkg: EncryptedDraftPackage): Promise<PayrollDraft> {
    if (pkg.metadata.isEncrypted) {
      if (!this.encryptionProvider || !this.encryptionProvider.canEncrypt()) {
        throw new Error("Cannot decrypt package: encryption provider not available");
      }

      const decrypted = await this.encryptionProvider.decrypt(pkg.encryptedPayload);
      return JSON.parse(decrypted) as PayrollDraft;
    }

    return JSON.parse(pkg.encryptedPayload) as PayrollDraft;
  }

  async getRedactedPreview(pkg: EncryptedDraftPackage): Promise<RedactedDraftPreview | undefined> {
    return pkg.redactedPreview;
  }

  validateDraftVersion(draft: PayrollDraft): boolean {
    return typeof draft.version === "number" && draft.version > 0;
  }

  async migrateDraftVersion(draft: PayrollDraft, targetVersion: number): Promise<PayrollDraft> {
    if (draft.version === targetVersion) {
      return draft;
    }

    if (targetVersion > 2) {
      throw new Error(`Migration to version ${targetVersion} is not supported`);
    }

    if (draft.version === 1 && targetVersion === 2) {
      return {
        ...draft,
        version: 2,
        updatedAt: new Date().toISOString(),
      };
    }

    throw new Error(`Cannot migrate from version ${draft.version} to ${targetVersion}`);
  }

  private validateDraftForSerialization(draft: PayrollDraft): void {
    if (!draft.entries || draft.entries.length === 0) {
      throw new Error("Cannot serialize empty draft");
    }

    for (const entry of draft.entries) {
      this.validateDraftEntry(entry);
    }
  }

  private validateDraftEntry(entry: PayrollDraftEntry): void {
    if (!entry.recipientId || entry.recipientId.trim() === "") {
      throw new Error("Draft entry is missing recipientId");
    }

    if (!entry.amount || entry.amount.trim() === "") {
      throw new Error("Draft entry is missing amount");
    }

    if (!entry.asset || entry.asset.trim() === "") {
      throw new Error("Draft entry is missing asset");
    }

    const amountNum = parseFloat(entry.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error("Draft entry has invalid amount");
    }
  }

  private createRedactedPreview(draft: PayrollDraft): RedactedDraftPreview {
    const assets = new Set<string>();

    for (const entry of draft.entries) {
      assets.add(entry.asset);
    }

    return {
      label: draft.label,
      entryCount: draft.entries.length,
      assets: Array.from(assets),
      totalAmountRedacted: true,
    };
  }
}
