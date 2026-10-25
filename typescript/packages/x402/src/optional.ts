/**
 * A loader for an optional peer dependency: `load()` runs once, on first
 * call, and a module that is not installed yields `null`. `load` is a
 * literal `require` so that bundlers can see the module id.
 */
export function optionalModule<T>(load: () => unknown): () => T | null {
  let module: T | null | undefined;
  return () => {
    if (module === undefined) {
      try {
        module = load() as T;
      } catch {
        module = null;
      }
    }
    return module;
  };
}
