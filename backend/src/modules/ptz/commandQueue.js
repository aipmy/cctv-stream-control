export function createKeyedCommandQueue() {
  const tails = new Map();

  return {
    run(key, task) {
      const previous = tails.get(key) || Promise.resolve();
      const current = previous.catch(() => undefined).then(task);
      const tracked = current.catch(() => undefined).finally(() => {
        if (tails.get(key) === tracked) tails.delete(key);
      });
      tails.set(key, tracked);
      return current;
    },
  };
}
