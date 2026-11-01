const jar = globalThis.__JAR ??= new Map();
export async function cookies() { return { get: (k) => jar.has(k) ? { value: jar.get(k) } : undefined, set: (k, v) => jar.set(k, v), delete: (k) => jar.delete(k) }; }
export async function headers() { return new Headers(); }
