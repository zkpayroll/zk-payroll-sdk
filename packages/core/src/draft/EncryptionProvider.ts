export interface EncryptionProvider {
  encrypt(data: string): Promise<string>;
  decrypt(encrypted: string): Promise<string>;
  canEncrypt(): boolean;
}

export type EnvironmentType = "browser" | "server" | "test";

export class BrowserEncryptionProvider implements EncryptionProvider {
  private static readonly ALGORITHM = "AES-GCM";
  private static readonly KEY_LENGTH = 256;
  private static readonly IV_LENGTH = 96;

  private key: CryptoKey | null = null;

  async initialize(password: string): Promise<void> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    this.key = await window.crypto.subtle.importKey(
      "raw",
      await window.crypto.subtle.digest("SHA-256", data),
      { name: BrowserEncryptionProvider.ALGORITHM },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async encrypt(data: string): Promise<string> {
    if (!this.key) throw new Error("Encryption provider not initialized");

    const encoder = new TextEncoder();
    const plaintext = encoder.encode(data);
    const iv = window.crypto.getRandomValues(new Uint8Array(BrowserEncryptionProvider.IV_LENGTH / 8));

    const ciphertext = await window.crypto.subtle.encrypt(
      { name: BrowserEncryptionProvider.ALGORITHM, iv },
      this.key,
      plaintext
    );

    const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode.apply(null, Array.from(combined)));
  }

  async decrypt(encrypted: string): Promise<string> {
    if (!this.key) throw new Error("Encryption provider not initialized");

    const binaryString = atob(encrypted);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const iv = bytes.slice(0, BrowserEncryptionProvider.IV_LENGTH / 8);
    const ciphertext = bytes.slice(BrowserEncryptionProvider.IV_LENGTH / 8);

    const plaintext = await window.crypto.subtle.decrypt(
      { name: BrowserEncryptionProvider.ALGORITHM, iv },
      this.key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(plaintext);
  }

  canEncrypt(): boolean {
    return this.key !== null && typeof window !== "undefined" && typeof window.crypto !== "undefined";
  }
}

export class NoOpEncryptionProvider implements EncryptionProvider {
  async encrypt(data: string): Promise<string> {
    return data;
  }

  async decrypt(encrypted: string): Promise<string> {
    return encrypted;
  }

  canEncrypt(): boolean {
    return false;
  }
}

export class ServerEncryptionProvider implements EncryptionProvider {
  private algorithm = "aes-256-gcm";
  private key: Buffer;

  constructor(keyHex: string) {
    if (keyHex.length !== 64) {
      throw new Error("Key must be 32 bytes (64 hex characters)");
    }
    this.key = Buffer.from(keyHex, "hex");
  }

  async encrypt(data: string): Promise<string> {
    const crypto = require("crypto");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(data, "utf-8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();
    return iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted;
  }

  async decrypt(encrypted: string): Promise<string> {
    const crypto = require("crypto");
    const parts = encrypted.split(":");

    if (parts.length !== 3) {
      throw new Error("Invalid encrypted format");
    }

    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encryptedData = parts[2];

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, "hex", "utf-8");
    decrypted += decipher.final("utf-8");

    return decrypted;
  }

  canEncrypt(): boolean {
    return true;
  }
}
