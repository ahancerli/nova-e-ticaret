/**
 * Minimal typed dependency-injection container (no decorators, no reflect-metadata — Workers friendly).
 *
 *   const Clock = token<Clock>("Clock");
 *   root.singleton(Clock, () => new SystemClock());
 *   root.scoped(OrderService, (c) => new OrderService(c.resolve(OrderRepository), c.resolve(Clock)));
 *   const scope = root.createScope();          // one per request
 *   scope.resolve(OrderService);
 *
 * Lifetimes:
 *  - singleton: one instance per root container (stateless helpers, config). Never depend on a scoped token.
 *  - scoped:    one instance per scope (per request): repositories, services, the request context.
 *  - transient: a new instance on every resolve.
 *
 * Classes receive their dependencies through the constructor; only the composition root (registrations)
 * knows concrete types (Dependency Inversion).
 */

export interface Token<T> {
  readonly key: symbol;
  readonly name: string;
  /** Phantom field that carries the type; never set at runtime. */
  readonly __type?: T;
}

export function token<T>(name: string): Token<T> {
  return { key: Symbol(name), name };
}

export type Lifetime = "singleton" | "scoped" | "transient";
export type Factory<T> = (c: Resolver) => T;

export interface Resolver {
  resolve<T>(t: Token<T>): T;
  has(t: Token<unknown>): boolean;
}

interface Registration<T> {
  lifetime: Lifetime;
  factory: Factory<T>;
}

export class ContainerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContainerError";
  }
}

export class Container implements Resolver {
  private readonly root: Container;
  private readonly registrations: Map<symbol, Registration<unknown>>;
  private readonly singletons: Map<symbol, unknown>;
  private readonly scopedInstances = new Map<symbol, unknown>();
  private readonly resolving: Token<unknown>[] = [];

  /** Use `new Container()` for the root; scopes come from `createScope()`. */
  constructor(parent?: Container) {
    this.root = parent ? parent.root : this;
    this.registrations = this.root === this ? new Map() : this.root.registrations;
    this.singletons = this.root === this ? new Map() : this.root.singletons;
  }

  private get isScope(): boolean {
    return this.root !== this;
  }

  register<T>(t: Token<T>, lifetime: Lifetime, factory: Factory<T>): this {
    if (this.isScope) throw new ContainerError(`Cannot register "${t.name}" on a scope; use scope.provide() for request values.`);
    this.registrations.set(t.key, { lifetime, factory });
    this.singletons.delete(t.key);
    return this;
  }

  singleton<T>(t: Token<T>, factory: Factory<T>): this {
    return this.register(t, "singleton", factory);
  }

  scoped<T>(t: Token<T>, factory: Factory<T>): this {
    return this.register(t, "scoped", factory);
  }

  transient<T>(t: Token<T>, factory: Factory<T>): this {
    return this.register(t, "transient", factory);
  }

  /** Puts a ready value into this scope only (request id, current user, test doubles). */
  provide<T>(t: Token<T>, value: T): this {
    if (!this.isScope) throw new ContainerError(`provide("${t.name}") is only allowed on a scope.`);
    this.scopedInstances.set(t.key, value);
    return this;
  }

  /** A new request scope. Scopes share the root's registrations and singletons, never each other's instances. */
  createScope(): Container {
    return new Container(this.root);
  }

  has(t: Token<unknown>): boolean {
    return this.scopedInstances.has(t.key) || this.registrations.has(t.key);
  }

  resolve<T>(t: Token<T>): T {
    if (this.scopedInstances.has(t.key)) return this.scopedInstances.get(t.key) as T;
    const reg = this.registrations.get(t.key) as Registration<T> | undefined;
    if (!reg) throw new ContainerError(`No registration for "${t.name}".`);

    switch (reg.lifetime) {
      case "singleton": {
        // Built against the root so a singleton can never capture a request-scoped dependency.
        if (!this.singletons.has(t.key)) this.singletons.set(t.key, this.root.build(t, reg));
        return this.singletons.get(t.key) as T;
      }
      case "scoped": {
        if (!this.isScope) throw new ContainerError(`"${t.name}" is scoped; resolve it from container.createScope().`);
        const value = this.build(t, reg);
        this.scopedInstances.set(t.key, value);
        return value;
      }
      case "transient":
        return this.build(t, reg);
    }
  }

  private build<T>(t: Token<T>, reg: Registration<T>): T {
    if (this.resolving.includes(t)) {
      const chain = [...this.resolving, t].map((x) => x.name).join(" → ");
      throw new ContainerError(`Circular dependency: ${chain}`);
    }
    this.resolving.push(t);
    try {
      return reg.factory(this);
    } finally {
      this.resolving.pop();
    }
  }
}
