// In-memory snapshots survive browser disconnects, not server restarts.
export function createChatLive() {
  let current: any = null;
  const listeners = new Set<(state: any) => void>();
  const publish = () => { for (const listener of listeners) listener(current); };
  return {
    begin(agentAt: number) {
      current = { id: String(agentAt), agentAt, active: true, text: '', tools: [], thinking: '', stage: 'thinking', seconds: 0 };
      publish();
    },
    update(patch: any) {
      if (!current?.active) return;
      current = { ...current, ...patch };
      publish();
    },
    finish(patch: any) {
      if (!current) return;
      current = { ...current, ...patch, active: false };
      publish();
    },
    snapshot() { return current; },
    subscribe(listener: (state: any) => void) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    }
  };
}
