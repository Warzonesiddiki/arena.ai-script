import { consoleDiagnostics, type DiagnosticReporter } from './diagnostics';

export type ModulePhase = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type ModuleStatus = 'registered' | 'initializing' | 'ready' | 'errored' | 'destroyed';

export interface AampModule {
  phase?: ModulePhase;
  deps?: readonly string[];
  init?: () => unknown | Promise<unknown>;
  destroy?: () => unknown | Promise<unknown>;
  onRouteChange?: ((url: string) => unknown | Promise<unknown>) | null;
  onConfigChange?: ((change: unknown) => unknown | Promise<unknown>) | null;
}

export interface RegisteredModule extends Required<Pick<AampModule, 'phase' | 'deps' | 'init' | 'destroy'>> {
  name: string;
  onRouteChange: AampModule['onRouteChange'];
  onConfigChange: AampModule['onConfigChange'];
}

export interface BootReport {
  total: number;
  ready: number;
  errored: number;
  phases: Readonly<Record<ModulePhase, { total: number; ready: number; errored: number }>>;
}

const PHASES: readonly ModulePhase[] = [0, 1, 2, 3, 4, 5, 6];
const NOOP = (): void => undefined;

/**
 * Phase-oriented module registry ported from v7.2.
 *
 * Registration order inside a phase remains deterministic. Failures are stored
 * per module and do not abort subsequent modules or phases.
 */
export class ModuleRegistry {
  private readonly modules = new Map<string, RegisteredModule>();
  private readonly statuses = new Map<string, ModuleStatus>();
  private readonly errors = new Map<string, unknown>();

  public constructor(private readonly diagnostics: DiagnosticReporter = consoleDiagnostics) {}

  public register(name: string, module: AampModule): boolean {
    if (!name.trim()) {
      this.diagnostics.warn('Cannot register a module without a name.');
      return false;
    }
    if (this.modules.has(name)) {
      this.diagnostics.warn(`Module "${name}" is already registered.`);
      return false;
    }

    const deps = [...(module.deps ?? [])];
    for (const dependency of deps) this.warnForDependencyProblem(name, dependency);

    const registered: RegisteredModule = {
      name,
      phase: module.phase ?? 5,
      deps,
      init: module.init ?? NOOP,
      destroy: module.destroy ?? NOOP,
      onRouteChange: module.onRouteChange ?? null,
      onConfigChange: module.onConfigChange ?? null,
    };

    this.modules.set(name, registered);
    this.statuses.set(name, 'registered');
    return true;
  }

  public getModule(name: string): RegisteredModule | null {
    return this.modules.get(name) ?? null;
  }

  public getStatus(name: string): ModuleStatus | null {
    return this.statuses.get(name) ?? null;
  }

  public getError(name: string): unknown | null {
    return this.errors.get(name) ?? null;
  }

  public getAll(): RegisteredModule[] {
    return [...this.modules.values()];
  }

  public getByPhase(phase: ModulePhase): RegisteredModule[] {
    return this.getAll().filter((module) => module.phase === phase);
  }

  public async boot(): Promise<BootReport> {
    const phaseReport = makeEmptyPhaseReport();
    let total = 0;
    let ready = 0;
    let errored = 0;

    for (const phase of PHASES) {
      const phaseModules = this.getByPhase(phase);
      for (const module of phaseModules) {
        total += 1;
        phaseReport[phase].total += 1;
        this.statuses.set(module.name, 'initializing');

        try {
          await module.init();
          this.statuses.set(module.name, 'ready');
          this.errors.delete(module.name);
          ready += 1;
          phaseReport[phase].ready += 1;
        } catch (error) {
          this.statuses.set(module.name, 'errored');
          this.errors.set(module.name, error);
          errored += 1;
          phaseReport[phase].errored += 1;
          this.diagnostics.warn(`Module "${module.name}" failed to initialize.`, error);
        }
      }
    }

    return { total, ready, errored, phases: phaseReport };
  }

  /** Destroys registered modules in reverse boot order while preserving isolation. */
  public async destroyAll(): Promise<void> {
    const modules = this.getAll()
      .map((module, registrationOrder) => ({ module, registrationOrder }))
      .sort((left, right) => right.module.phase - left.module.phase || right.registrationOrder - left.registrationOrder)
      .map(({ module }) => module);
    for (const module of modules) {
      if (this.statuses.get(module.name) === 'destroyed') continue;
      try {
        await module.destroy();
      } catch (error) {
        this.diagnostics.warn(`Module "${module.name}" failed to destroy.`, error);
      } finally {
        this.statuses.set(module.name, 'destroyed');
      }
    }
  }

  private warnForDependencyProblem(name: string, dependency: string): void {
    if (dependency === name) {
      this.diagnostics.warn(`Module "${name}" depends on itself.`);
      return;
    }

    const registeredDependency = this.modules.get(dependency);
    if (registeredDependency?.deps.includes(name)) {
      this.diagnostics.warn(`Circular dependency detected: "${name}" <-> "${dependency}".`);
    }
  }
}

function makeEmptyPhaseReport(): Record<ModulePhase, { total: number; ready: number; errored: number }> {
  return {
    0: { total: 0, ready: 0, errored: 0 },
    1: { total: 0, ready: 0, errored: 0 },
    2: { total: 0, ready: 0, errored: 0 },
    3: { total: 0, ready: 0, errored: 0 },
    4: { total: 0, ready: 0, errored: 0 },
    5: { total: 0, ready: 0, errored: 0 },
    6: { total: 0, ready: 0, errored: 0 },
  };
}
