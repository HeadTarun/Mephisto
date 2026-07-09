const listeners = new Set<(event: string) => void>();

export function notifyChange(event = "change"): void {
  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeToChanges(listener: (event: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
