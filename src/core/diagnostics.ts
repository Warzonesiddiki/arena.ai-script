/** Minimal diagnostic seam used before Phase 1D's structured tracing is available. */
export interface DiagnosticReporter {
  warn(message: string, error?: unknown): void;
  error?(message: string, error?: unknown): void;
}

export const consoleDiagnostics: DiagnosticReporter = {
  warn(message: string, error?: unknown): void {
    console.warn(`[AAMP] ${message}`, error);
  },
  error(message: string, error?: unknown): void {
    console.error(`[AAMP] ${message}`, error);
  },
};
