/** Coalesce cumulative UI snapshots, never model tokens or stored answers. */
export function createStreamDelivery(emit: (event: string, data: any) => void, interval = 75) {
  const pending = new Map<string, any>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const snapshots = [...pending];
    pending.clear();
    for (const [event, data] of snapshots) emit(event, data);
  };
  return {
    send(event: string, data: any) {
      if (event === 'beat' || event === 'progress') {
        pending.set(event, data);
        if (!timer) timer = setTimeout(flush, interval);
      } else {
        flush();
        emit(event, data);
      }
    },
    dispose() { if (timer) clearTimeout(timer); timer = undefined; pending.clear(); }
  };
}
