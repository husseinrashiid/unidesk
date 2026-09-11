// Android can load the frontend before its native IPC transport is ready.
// Probe with an idempotent read; never retry a mutation after an uncertain reply.
export function nativeReadiness(probe: () => Promise<unknown>, timeoutMs = 1500, attempts = 20) {
  let pending: Promise<void> | undefined;
  return () => pending ??= (async () => {
    let last: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([probe(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Native startup did not respond')), timeoutMs);
        })]);
        return;
      } catch (error) { last = error; }
      finally { if (timer) clearTimeout(timer); }
    }
    throw new Error('Could not initialize local storage. Try opening your workspace again.', { cause: last });
  })().catch(error => { pending = undefined; throw error; });
}
