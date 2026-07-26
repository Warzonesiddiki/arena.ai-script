import { EventBus, type EventMap } from '../core/event-bus';
import { Tracer } from '../observability/tracer';

export interface RecoveryNotification {
  title: string;
  message: string;
  correlationId: string;
  severity: 'warning' | 'error';
}

export interface RecoveryNotifier {
  notify(notification: RecoveryNotification): void | Promise<void>;
}

export interface RecoveryEvents extends EventMap {
  'recovery:attempt': { operation: string; attempt: number; correlationId: string };
  'recovery:recovered': { operation: string; attempt: number; correlationId: string };
  'recovery:failed': { operation: string; attempts: number; correlationId: string; error: string };
}

export interface RetryOptions<TFallback> {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryable?: (error: unknown) => boolean;
  fallback: (error: unknown) => TFallback | Promise<TFallback>;
}

export interface RecoveryManagerOptions {
  eventBus?: EventBus<RecoveryEvents>;
  tracer?: Tracer;
  notifier?: RecoveryNotifier;
  sleep?: (milliseconds: number) => Promise<void>;
}

/** Retries isolated operations and converts terminal failures to explicit fallbacks. */
export class ErrorRecoveryManager {
  private readonly eventBus: EventBus<RecoveryEvents>;
  private readonly tracer: Tracer;
  private readonly notifier?: RecoveryNotifier;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  public constructor(options: RecoveryManagerOptions = {}) {
    this.eventBus = options.eventBus ?? new EventBus<RecoveryEvents>();
    this.tracer = options.tracer ?? new Tracer();
    this.notifier = options.notifier;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  public async execute<T, TFallback>(operation: string, action: () => Promise<T>, options: RetryOptions<TFallback>): Promise<T | TFallback> {
    const maxAttempts = options.maxAttempts ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 250;
    const maxDelayMs = options.maxDelayMs ?? 5_000;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts must be at least 1.');
    const span = this.tracer.startSpan('recovery.execute', { operation, maxAttempts });
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.eventBus.emit('recovery:attempt', { operation, attempt, correlationId: span.correlationId });
      try {
        const result = await action();
        if (attempt > 1) this.eventBus.emit('recovery:recovered', { operation, attempt, correlationId: span.correlationId });
        span.end({ status: 'success', attempt });
        return result;
      } catch (error) {
        lastError = error;
        this.tracer.recordError('recovery.attemptFailed', error, span.correlationId, { operation, attempt });
        if (attempt === maxAttempts || options.retryable?.(error) === false) break;
        const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        await this.sleep(delay);
      }
    }

    const message = toErrorMessage(lastError);
    this.eventBus.emit('recovery:failed', { operation, attempts: maxAttempts, correlationId: span.correlationId, error: message });
    await this.notifier?.notify({
      title: 'Arena Agent Mode Pro recovered safely',
      message: `${operation} failed after ${maxAttempts} attempt(s). A safe fallback was used.`,
      correlationId: span.correlationId,
      severity: 'error',
    });
    span.end({ status: 'fallback', attempts: maxAttempts });
    return options.fallback(lastError);
  }

  /** Registers global error hooks; callers own the returned cleanup lifecycle. */
  public installGlobalHandlers(target: EventTarget): () => void {
    const onError = (event: Event): void => { this.captureGlobal('window.error', extractEventError(event)); };
    const onRejection = (event: Event): void => { this.captureGlobal('window.unhandledrejection', extractEventError(event)); };
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    return () => {
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onRejection);
    };
  }

  public captureGlobal(operation: string, error: unknown): void {
    const correlationId = this.tracer.startSpan('recovery.globalError', { operation }).correlationId;
    const message = toErrorMessage(error);
    this.tracer.recordError('recovery.globalErrorCaptured', error, correlationId, { operation });
    this.eventBus.emit('recovery:failed', { operation, attempts: 1, correlationId, error: message });
    void this.notifier?.notify({
      title: 'Arena Agent Mode Pro encountered an error',
      message: `${operation}: ${message}`.slice(0, 1_024),
      correlationId,
      severity: 'warning',
    });
  }
}

function extractEventError(event: Event): unknown {
  const candidate = event as Event & { error?: unknown; reason?: unknown; message?: unknown };
  return candidate.error ?? candidate.reason ?? candidate.message ?? 'Unknown global error';
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
