import type { MediaProcessingError } from "@fan-support/contracts";

export class ProcessingFailure extends Error {
  constructor(readonly code: MediaProcessingError["code"]) {
    super(code);
    this.name = "ProcessingFailure";
  }
}

export function processingError(error: unknown): MediaProcessingError {
  const code =
    error instanceof ProcessingFailure
      ? error.code
      : "UNEXPECTED_PROCESSING_FAILURE";
  return {
    code,
    retryable: [
      "STORAGE_UNAVAILABLE",
      "PROCESSING_TIMEOUT",
      "UNEXPECTED_PROCESSING_FAILURE",
    ].includes(code),
  };
}

/** Monotonic total budget bounds each storage request and native codec stage. */
export class ProcessingBudget {
  private readonly deadline = performance.now() + 180_000;
  private expired = false;

  constructor(
    private readonly requestTimeoutMs: number,
    private readonly codecTimeoutSeconds: number,
  ) {}

  remainingMs(): number {
    const remaining = this.deadline - performance.now();
    if (this.expired || remaining <= 0)
      throw new ProcessingFailure("PROCESSING_TIMEOUT");
    return remaining;
  }

  codecSeconds(): number {
    return Math.min(
      this.codecTimeoutSeconds,
      Math.max(1, Math.ceil(this.remainingMs() / 1000)),
    );
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const remaining = this.remainingMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.expired = true;
        reject(new ProcessingFailure("PROCESSING_TIMEOUT"));
      }, remaining);
    });
    try {
      return await Promise.race([operation(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async request<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const remaining = this.remainingMs();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          controller.abort();
          reject(new ProcessingFailure("PROCESSING_TIMEOUT"));
        },
        Math.min(this.requestTimeoutMs, remaining),
      );
    });
    try {
      return await Promise.race([operation(controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
