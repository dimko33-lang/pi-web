/* See docs/CODE-MAP.md for module responsibilities and invariants. */

export type Who = '@@OWNER_LABEL@@' | '@@EDITOR_COLLABORATOR@@' | string;

export type Peer = {
  /** Stable browser ID stored in localStorage. */
  cid: string;
  /** Display name. */
  who: Who;
  /** Open panel: '', 'menu', 'resume', 'files', or 'models'. */
  panel: string;
  /** Active editor tool. */
  tool: string;
  /** SVG camera bounds; only the Live presenter's camera is followed. */
  view: { x: number; y: number; w: number; h: number } | null;
  /** Cursor in SVG scene coordinates; null outside the canvas. */
  cursor: { x: number; y: number } | null;
  /** Last heartbeat timestamp in milliseconds. */
  at: number;
};

const STALE_MS = 12000;
const SWEEP_MS = 3000;

const peers = new Map<string, Peer>();

/* One Live presenter controls camera following, not editing permissions. */
let leader: string | null = null;
let leaderAt = 0;
const listeners = new Set<(list: Peer[]) => void>();

let timer: NodeJS.Timeout | null = null;

function alive(): Peer[] {
  const now = Date.now();
  const out: Peer[] = [];
  for (const p of peers.values()) {
    if (now - p.at <= STALE_MS) out.push(p);
  }
  out.sort((a, b) => a.who.localeCompare(b.who));
  return out;
}

function broadcast() {
  const list = alive();
  const lead = whoLeads().cid;
  for (const fn of listeners) {
    try { fn(list, lead); } catch { /* Disconnected SSE listener. */ }
  }
}

function ensureSweep() {
  if (timer) return;
  timer = setInterval(() => {
    const old = peers.size;
    const now = Date.now();
    for (const [k, p] of peers) {
      if (now - p.at > STALE_MS) peers.delete(k);
    }
    if (peers.size !== old) broadcast();
  }, SWEEP_MS);
  /* Presence alone must not keep the process alive. */
  if (typeof timer.unref === 'function') timer.unref();
}

/** Upsert a peer heartbeat and broadcast presence. */
export function touchPresence(input: {
  cid: string;
  who: Who;
  panel?: string;
  tool?: string;
  view?: { x: number; y: number; w: number; h: number } | null;
  cursor?: { x: number; y: number } | null;
}): Peer[] {
  ensureSweep();
  const cid = String(input.cid || '').slice(0, 64);
  if (!cid) return alive();
  const prev = peers.get(cid);
  const p: Peer = {
    cid,
    who: String(input.who || 'кто-то').slice(0, 32),
    panel: typeof input.panel === 'string' ? input.panel.slice(0, 24) : (prev?.panel || ''),
    tool: typeof input.tool === 'string' ? input.tool.slice(0, 24) : (prev?.tool || ''),
    view: input.view === undefined ? (prev?.view ?? null) : input.view,
    cursor: input.cursor === undefined ? (prev?.cursor ?? null) : input.cursor,
    at: Date.now(),
  };
  peers.set(cid, p);
  broadcast();
  return alive();
}

/** Remove a departing peer without waiting for expiration. */
export function dropPresence(cid: string): Peer[] {
  if (cid) {
    peers.delete(String(cid));
    leadOnLeave(String(cid));
  }
  broadcast();
  return alive();
}

export function listPresence(): Peer[] {
  return alive();
}

/** Subscribe an SSE listener; return its unsubscribe callback. */
export function onPresence(fn: (list: Peer[], leader: string | null) => void): () => void {
  ensureSweep();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}


/* Live presenter lease. */

export function whoLeads(): { cid: string | null; stale: boolean } {
  if (!leader) return { cid: null, stale: false };
  /* Accept a recent lease before the first presence heartbeat arrives. */
  const p = peers.get(leader);
  const alive1 = p && Date.now() - p.at <= STALE_MS;
  const alive2 = Date.now() - leaderAt <= STALE_MS * 3;
  if (!alive1 && !alive2) {
    leader = null;
    return { cid: null, stale: true };
  }
  return { cid: leader, stale: false };
}

/** Renew the presenter's lease. */
export function keepLead(cid: string): void {
  if (leader === cid) leaderAt = Date.now();
}

/** Acquire or renew the lease; reject a competing presenter. */
export function takeLead(cid: string): boolean {
  const cur = whoLeads();
  if (cur.cid && cur.cid !== cid) return false;   // Another presenter holds the lease.
  leader = cid;
  leaderAt = Date.now();
  broadcast();
  return true;
}

/** Release only the caller's lease. */
export function dropLead(cid: string): void {
  if (leader === cid) {
    leader = null;
    leaderAt = 0;
    broadcast();
  }
}

/** Clear the lease when its presenter leaves. */
export function leadOnLeave(cid: string): void {
  if (leader === cid) {
    leader = null;
    leaderAt = 0;
  }
}
