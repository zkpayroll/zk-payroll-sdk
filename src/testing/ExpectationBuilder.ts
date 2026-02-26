import { PayrollError } from "../errors";

/**
 * Builder for configuring mock contract method expectations.
 * Provides a fluent API for setting up return values, errors, and custom behaviors.
 */
export class ExpectationBuilder {
  private response: {
    type: "success" | "error" | "custom";
    value?: unknown;
    error?: Error;
    handler?: (...args: unknown[]) => unknown;
  } | null = null;

  constructor(
    private methodName: string,
    private onConfigured: (config: MethodExpectation) => void
  ) {}

  /**
   * Configure the method to succeed with an optional return value.
   * @param value - The value to return when the method is invoked
   */
  toSucceed(value?: unknown): void {
    this.response = { type: "success", value };
    this.finalize();
  }

  /**
   * Configure the method to return a specific value.
   * @param value - The value to return when the method is invoked
   */
  toReturn(value: unknown): void {
    this.response = { type: "success", value };
    this.finalize();
  }

  /**
   * Configure the method to fail with an error.
   * @param error - The error to throw when the method is invoked
   */
  toFail(error: Error | string): void {
    const err = typeof error === "string" ? new PayrollError(error, 400) : error;
    this.response = { type: "error", error: err };
    this.finalize();
  }

  /**
   * Configure the method to execute a custom handler function.
   * @param handler - Custom function to handle the method invocation
   */
  toCall(handler: (...args: unknown[]) => unknown): void {
    this.response = { type: "custom", handler };
    this.finalize();
  }

  private finalize(): void {
    if (!this.response) {
      throw new Error("No response configured for expectation");
    }

    const expectation: MethodExpectation = {
      methodName: this.methodName,
      response: this.response,
      callCount: 0,
      callHistory: [],
    };

    this.onConfigured(expectation);
  }
}

/**
 * Internal representation of a method expectation.
 */
export interface MethodExpectation {
  methodName: string;
  response: {
    type: "success" | "error" | "custom";
    value?: unknown;
    error?: Error;
    handler?: (...args: unknown[]) => unknown;
  };
  callCount: number;
  callHistory: Array<{ args: unknown[]; timestamp: number }>;
}
