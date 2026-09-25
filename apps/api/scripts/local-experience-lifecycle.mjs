/** Startup owns every resource before it settles; shutdown waits for that ownership barrier. */
export function createLocalLifecycle() {
  const resources = [];
  let startup,
    shutdown,
    stopping = false,
    stopped = false;
  return {
    get stopping() {
      return stopping;
    },
    own(name, close) {
      if (stopped) throw new Error("Local runtime already stopped");
      resources.push({ name, close });
    },
    checkStarting() {
      if (stopping) throw new Error("Local runtime is stopping");
    },
    start(action) {
      if (startup || stopping) throw new Error("Local startup already handled");
      startup = Promise.resolve().then(action);
      return startup;
    },
    stop() {
      stopping = true;
      shutdown ??= (async () => {
        await startup?.catch(() => undefined);
        const failures = [];
        while (resources.length) {
          const resource = resources.pop();
          try {
            await resource.close();
          } catch {
            failures.push(resource.name);
          }
        }
        stopped = true;
        return failures;
      })();
      return shutdown;
    },
  };
}
