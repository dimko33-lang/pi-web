import './legacy-compat.ts';
/* CHAT MODEL CATALOG: direct OpenAI, DeepSeek and Moonshot providers.
   Selection persists in data/model.txt without changing the Pi session.
   Prices are catalog estimates in USD per million tokens, not live quotes. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Server-side provider requests need their own proxy dispatcher;
   configuring the child Pi process alone does not route these requests. */
function proxyUrl(): string {
  return process.env.PI_WEB_PROXY
    || process.env.HTTPS_PROXY
    || process.env.HTTP_PROXY
    || '';
}

export type ModelInfo = {
  id: string;
  label: string;
  hint: string;
  tier: 'fast' | 'good' | 'top' | 'max';
  inUsd: number;
  outUsd: number;
  /** Billing provider. */
  provider: 'openai' | 'deepseek' | 'moonshot';
  /** Supports image input and generic tool screenshots. */
  vision?: boolean;
};

export const MODELS: ModelInfo[] = [
  /* Premium tier. */
  {
    id: 'openai/gpt-5.5-pro',
    label: 'GPT-5.5 Pro',
    hint: 'OpenAI flagship in pro mode for complex mathematics and large refactors',
    tier: 'max', inUsd: 30.00, provider: 'openai', outUsd: 180.00, vision: true
  },
  {
    id: 'openai/gpt-5.4-pro',
    label: 'GPT-5.4 Pro',
    hint: 'Previous flagship in pro mode, priced like 5.5 Pro',
    tier: 'max', inUsd: 30.00, provider: 'openai', outUsd: 180.00, vision: true
  },
  {
    id: 'openai/gpt-5.2-pro',
    label: 'GPT-5.2 Pro',
    hint: 'Earlier flagship in pro mode, slightly cheaper than 5.4 Pro',
    tier: 'max', inUsd: 21.00, provider: 'openai', outUsd: 168.00, vision: true
  },
  {
    id: 'openai/gpt-5-pro',
    label: 'GPT-5 Pro',
    hint: 'First generation-5 pro model; expensive and thorough',
    tier: 'max', inUsd: 15.00, provider: 'openai', outUsd: 120.00, vision: true
  },
  {
    id: 'openai/gpt-6-astra',
    label: 'GPT-6 Astra',
    hint: 'Powerful flagship; reserve for tasks that Sol cannot handle',
    tier: 'max', inUsd: 10.00, provider: 'openai', outUsd: 50.00, vision: true
  },
  {
    id: 'openai/gpt-6.2-astra',
    label: 'GPT-6.2 Astra',
    hint: 'Newer Astra: stronger science and documents, 20% cheaper than Astra 6',
    tier: 'max', inUsd: 8.00, provider: 'openai', outUsd: 40.00, vision: true
  },
  {
    id: 'openai/chat-latest',
    label: 'GPT Chat Latest',
    hint: 'Latest OpenAI chat model; premium option for important conversations',
    tier: 'max', inUsd: 5.00, provider: 'openai', outUsd: 30.00, vision: true
  },
  {
    id: 'openai/gpt-5.5',
    label: 'GPT-5.5',
    hint: 'Previous general-purpose flagship for work on large files',
    tier: 'top', inUsd: 5.00, provider: 'openai', outUsd: 30.00, vision: true
  },

  /* Higher-priced tier. */
  {
    id: 'openai/gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    hint: 'Strong coding and agent-task model',
    tier: 'top', inUsd: 4.00, provider: 'openai', outUsd: 20.00, vision: true
  },
  {
    id: 'openai/gpt-5.4',
    label: 'GPT-5.4',
    hint: 'Reliable general-purpose model for long sessions',
    tier: 'top', inUsd: 2.50, provider: 'openai', outUsd: 15.00, vision: true
  },
  {
    id: 'openai/gpt-5.2',
    label: 'GPT-5.2',
    hint: 'Previous flagship with strong general capabilities',
    tier: 'top', inUsd: 1.75, provider: 'openai', outUsd: 14.00, vision: true
  },
  {
    id: 'openai/gpt-5.3-codex',
    label: 'GPT-5.3 Codex',
    hint: 'Code-specialized model for programming tasks',
    tier: 'top', inUsd: 1.75, provider: 'openai', outUsd: 14.00, vision: true
  },
  {
    id: 'openai/gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    hint: 'Capable and relatively affordable',
    tier: 'top', inUsd: 2.00, provider: 'openai', outUsd: 12.00, vision: true
  },
  {
    id: 'openai/gpt-4o',
    label: 'GPT-4o',
    hint: 'Established model with image support and broad availability',
    tier: 'good', inUsd: 2.50, provider: 'openai', outUsd: 10.00, vision: true
  },
  {
    id: 'openai/gpt-6-sol',
    label: 'GPT-6 Sol',
    hint: 'Generation-6 flagship balancing cost and capability',
    tier: 'top', inUsd: 2.00, provider: 'openai', outUsd: 10.00, vision: true
  },
  {
    id: 'openai/gpt-6.1-sol',
    label: 'GPT-6.1 Sol',
    hint: 'Recommended for UI work: CSS, buttons and panels; cheaper than Astra',
    tier: 'top', inUsd: 2.00, provider: 'openai', outUsd: 10.00, vision: true
  },
  {
    id: 'openai/gpt-5',
    label: 'GPT-5',
    hint: 'Generation-5 baseline; general-purpose and predictable',
    tier: 'good', inUsd: 1.25, provider: 'openai', outUsd: 10.00, vision: true
  },
  {
    id: 'openai/gpt-5.1',
    label: 'GPT-5.1',
    hint: 'More capable than GPT-5 at the same listed price',
    tier: 'good', inUsd: 1.25, provider: 'openai', outUsd: 10.00, vision: true
  },
  {
    id: 'openai/gpt-4.1',
    label: 'GPT-4.1',
    hint: 'Reliable non-reasoning model for fast responses',
    tier: 'good', inUsd: 2.00, provider: 'openai', outUsd: 8.00, vision: true
  },
  {
    id: 'openai/o3',
    label: 'o3',
    hint: 'OpenAI reasoning model for logic and mathematics',
    tier: 'good', inUsd: 2.00, provider: 'openai', outUsd: 8.00, vision: true
  },
  {
    id: 'moonshotai/kimi-k3.1-pro',
    label: 'Kimi K3.1 Pro',
    hint: 'Strong on long code inputs',
    tier: 'top', inUsd: 2.00, provider: 'moonshot', outUsd: 10.00
  },

  /* Midrange tier. */
  {
    id: 'openai/gpt-6.1-terra',
    label: 'GPT-6.1 Terra',
    hint: 'Everyday edits, code and writing at a lower cost than Astra',
    tier: 'good', inUsd: 1.00, provider: 'openai', outUsd: 5.00, vision: true
  },
  {
    id: 'openai/gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    hint: 'Fast, low-cost model for simple tasks',
    tier: 'good', inUsd: 0.75, provider: 'openai', outUsd: 4.50, vision: true
  },
  {
    id: 'openai/gpt-5-mini',
    label: 'GPT-5 mini',
    hint: 'Small edits and short answers',
    tier: 'fast', inUsd: 0.25, provider: 'openai', outUsd: 2.00, vision: true
  },
  {
    id: 'openai/gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    hint: 'Low-cost non-reasoning model for immediate responses',
    tier: 'fast', inUsd: 0.40, provider: 'openai', outUsd: 1.60, vision: true
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    hint: 'Capable, low-cost general-purpose model',
    tier: 'good', inUsd: 1.32, provider: 'deepseek', outUsd: 3.96
  },
  {
    id: 'moonshotai/kimi-k2.7-code',
    label: 'Kimi K2.7 Code',
    hint: 'Code-focused model with a listed 262k context window',
    tier: 'good', inUsd: 0.67, provider: 'moonshot', outUsd: 3.35
  },
  {
    id: 'moonshotai/kimi-k3',
    label: 'Kimi K3',
    hint: 'Very low input cost with premium output pricing',
    tier: 'good', inUsd: 0.17, provider: 'moonshot', outUsd: 20.00
  },

  /* Budget tier. */
  {
    id: 'openai/gpt-5.4-nano',
    label: 'GPT-5.4 nano',
    hint: 'Low-cost reasoning model for drafts and small tasks',
    tier: 'fast', inUsd: 0.20, provider: 'openai', outUsd: 1.25, vision: true
  },
  {
    id: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini',
    hint: 'Established low-cost model with image support',
    tier: 'fast', inUsd: 0.15, provider: 'openai', outUsd: 0.60, vision: true
  },
  {
    id: 'openai/gpt-5-nano',
    label: 'GPT-5 nano',
    hint: 'Minimal cost for simple answers',
    tier: 'fast', inUsd: 0.05, provider: 'openai', outUsd: 0.40, vision: true
  },
  {
    id: 'openai/gpt-6-luna',
    label: 'GPT-6 Luna',
    hint: 'Low-cost option for straightforward edits',
    tier: 'fast', inUsd: 0.10, provider: 'openai', outUsd: 0.50, vision: true
  },
  {
    id: 'deepseek/deepseek-flash',
    label: 'DeepSeek Flash',
    hint: 'Budget model with low cached-input pricing for long conversations',
    tier: 'fast', inUsd: 0.30, provider: 'deepseek', outUsd: 1.20, vision: true
  },
];

// Explicit project catalog, independent of other browser applications.
const catalogPath = path.join(__dirname, '..', 'models.json');
const enabledModelIds: string[] = fs.existsSync(catalogPath)
  ? JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  : MODELS.map((model) => model.id);

export const DEFAULT_MODEL = process.env.PI_WEB_MODEL
  || 'openai/gpt-6.1-sol';

/* MODEL SELECTION: persist a catalog-valid model ID in data/model.txt. */
const STORE = path.join(__dirname, '..', 'data', 'browser-model.txt');

export function loadSaved(file = STORE): string {
  try {
    const id = fs.readFileSync(file, 'utf8').trim();
    if (id && (id === nativeDefault() || (enabledModelIds.includes(id) && MODELS.some((m) => m.id === id)))) return id;
  } catch { /* Fall back to the default if the selection file is unreadable. */ }
  return DEFAULT_MODEL;
}

function saveSaved(id: string) {
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, id);
  } catch { /* Selection persistence is best-effort. */ }
}

let current = loadSaved();

/* The displayed selection is also the model used for execution. */
function nativeDefault():string | undefined {
  // Only the local Pi settings, never client-supplied provider or model definitions.
    try {
      const dir = process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || '', '.pi/agent');
      const s = JSON.parse(fs.readFileSync(path.join(dir,'settings.json'),'utf8'));
      if (/^[a-z][a-z0-9_-]*$/.test(s.defaultProvider || '') && typeof s.defaultModel === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,200}$/.test(s.defaultModel)) return `${s.defaultProvider}/${s.defaultModel}`;
    } catch { /* No native default selected. */ }
}

export function getModel() {
  return !process.env.PI_WEB_MODEL && !fs.existsSync(STORE) ? nativeDefault() || current : current;
}

export function setModel(id: string): string {
  const hit = MODELS.find((m) => m.id === id);
  // Accept catalog IDs only, never arbitrary client-supplied model names.
  if (id !== nativeDefault() && (!hit || !enabledModelIds.includes(id))) throw new Error('unknown model: ' + id);
  current = id;
  saveSaved(current);
  return current;
}

export function resetModel() {
  current = DEFAULT_MODEL;
  saveSaved(current);
}


/* PROVIDER DISCOVERY: cache provider reachability for catalog filtering.
   Startup and scheduled checks use the configured credentials and proxy. */

export type ProviderKey = "openai" | "deepseek" | "moonshot";

/* PROVIDER ENDPOINTS: model catalog discovery. */
const PROVIDER_PROBE: Record<ProviderKey, string> = {
  openai: "https://api.openai.com/v1/models",
  deepseek: "https://api.deepseek.com/v1/models",
  moonshot: "https://api.moonshot.ai/v1/models"
};

/* PROVIDER CREDENTIALS: share Pi's credential store; never embed secrets here. */
const AUTH_PATH = path.join(process.env.HOME || "/root", ".pi", "agent", "auth.json");

function readAuthFile(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(AUTH_PATH, "utf8")); } catch { return {}; }
}

function readAuthKeys(): Record<string, string> {
  const raw = readAuthFile();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    /* API-key providers store key; OAuth entries store access. */
    const key = (v as any)?.key || (v as any)?.access;
    if (typeof key === "string" && key) out[k] = key;
  }
  return out;
}

/* OPENAI OAUTH REFRESH: access tokens expire; refresh tokens may rotate.
   Share one in-process refresh promise and atomically replace auth.json.
   The promise does not synchronize with other processes such as Pi. */
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_RESOURCE = "https://api.openai.com/v1";
/* Refresh before expiry rather than waiting for a failed provider request. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/* TOKEN REFRESH LOCK: concurrent callers share one refresh promise. */
let refreshInFlight: Promise<void> | null = null;

function authExpiresAt(entry: any): number {
  if (typeof entry?.expires === "number") return entry.expires;
  /* Fall back to the JWT expiry if the explicit field is missing. */
  try {
    const payload = JSON.parse(
      Buffer.from(String(entry?.access).split(".")[1] || "", "base64url").toString("utf8")
    );
    if (typeof payload?.exp === "number") return payload.exp * 1000;
  } catch {}
  return 0;
}

/* Flush a temporary file before replacing credentials to avoid partial JSON. */
function writeAuthFileAtomic(data: unknown): void {
  const tmp = AUTH_PATH + ".tmp-" + process.pid + "-" + Date.now();
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, AUTH_PATH);
}

async function refreshOpenAI(): Promise<void> {
  const all = readAuthFile();
  const entry = all?.openai;
  /* API-key entries do not use the OAuth refresh flow. */
  if (!entry || entry.type !== "oauth" || !entry.refresh || !entry.clientId) return;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: String(entry.clientId),
    refresh_token: String(entry.refresh),
    resource: OPENAI_RESOURCE
  });

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  let data: any;
  try {
    const proxy = proxyUrl();
    const opts: any = {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: body.toString(),
      signal: ctl.signal
    };
    if (proxy) opts.dispatcher = new ProxyAgent(proxy);
    const r = proxy
      ? await undiciFetch(OPENAI_TOKEN_URL, opts)
      : await fetch(OPENAI_TOKEN_URL, opts);
    clearTimeout(t);
    const txt = await r.text().catch(() => "");
    if (!r.ok) {
      /* invalid_grant requires signing in again through Pi. */
      console.log("[models] openai refresh: " + r.status + " " + txt.slice(0, 200).replace(/\s+/g, " "));
      return;
    }
    data = JSON.parse(txt);
  } catch (e) {
    clearTimeout(t);
    console.log("[models] openai refresh: network error — " + (e as Error).message);
    return;
  }

  if (typeof data?.access_token !== "string" || !data.access_token) {
    console.log("[models] openai refresh: response missing access_token");
    return;
  }

  /* Re-read after the request: Pi may have saved a later-expiring token.
     Keep that token rather than replacing it with an older result. */
  const fresh = readAuthFile();
  const cur = fresh?.openai;
  const expiresIn = Number(data.expires_in) || 3600;
  const newExpires = Date.now() + expiresIn * 1000;
  const oldExpires = authExpiresAt(cur);
  if (cur && oldExpires > newExpires) return;

  const merged: any = {
    ...(cur || {}),
    type: "oauth",
    access: data.access_token,
    refresh: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : cur?.refresh,
    expires: newExpires,
    clientId: cur?.clientId || entry.clientId
  };
  if (typeof data.scope === "string" && data.scope.trim()) {
    merged.scopes = data.scope.trim().split(/\s+/);
  }

  try {
    writeAuthFileAtomic({ ...fresh, openai: merged });
    console.log("[models] openai refresh: access valid until " + new Date(newExpires).toISOString());
  } catch (e) {
    console.log("[models] openai refresh: could not write auth.json — " + (e as Error).message);
  }
}

/* Refresh near expiry; concurrent callers await the same promise. */
export function ensureOpenAIToken(force = false): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  const entry = readAuthFile()?.openai;
  if (!entry || entry.type !== "oauth") return Promise.resolve();
  const expires = authExpiresAt(entry);
  if (!force && expires && expires - Date.now() > REFRESH_MARGIN_MS) return Promise.resolve();
  refreshInFlight = refreshOpenAI().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

/* PROVIDER AVAILABILITY: undefined means not yet probed. */
const reachable = new Map<ProviderKey, boolean>();
let probed = false;

export function probeProviders(): Promise<void> {
  if (probed) return Promise.resolve();
  probed = true;
  /* Refresh credentials before probing to avoid caching an expired-token failure. */
  return ensureOpenAIToken().then(checkProviders);
}

/* Used by both initial discovery and scheduled refresh. */
function checkProviders(): Promise<void> {
  const keys = readAuthKeys();
  const jobs = (Object.keys(PROVIDER_PROBE) as ProviderKey[]).map(async (p) => {
    /* Pi may store Moonshot credentials under the moonshotai alias. */
    const key = keys[p] || (p === "moonshot" ? keys["moonshotai"] : "");
    if (!key) { reachable.set(p, false); return; }
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 12000);
      /* Apply the selected proxy explicitly to provider requests. */
      const proxy = proxyUrl();
      const opts: any = {
        headers: { Authorization: "Bearer " + key },
        signal: ctl.signal
      };
      if (proxy) opts.dispatcher = new ProxyAgent(proxy);
      /* Use the matching Undici fetch implementation with its dispatcher. */
      const r = proxy
        ? await undiciFetch(PROVIDER_PROBE[p], opts)
        : await fetch(PROVIDER_PROBE[p], opts);
      clearTimeout(t);
      reachable.set(p, r.ok);
      console.log("[models] " + p + ": " + r.status + (r.ok ? " — available" : " — unavailable"));
    } catch (e) {
      reachable.set(p, false);
      console.log("[models] " + p + ": network error — hidden");
    }
  });
  return Promise.all(jobs).then(() => undefined);
}

export function isProviderAvailable(p: ProviderKey): boolean {
  /* Unknown providers remain visible until discovery completes. */
  if (!reachable.has(p)) return true;
  return reachable.get(p) === true;
}

/* See docs/CODE-MAP.md for module responsibilities and invariants. */

/* Provider-specific endpoints and minimal model probe payloads. */
const MODEL_PROBE: Record<ProviderKey, { url: string; body: (m: string) => unknown; headers?: Record<string, string> }> = {
  openai: {
    url: "https://api.openai.com/v1/responses",
    body: (m) => ({
      model: m,
      input: [{ role: "user", content: [{ type: "input_text", text: "ok" }] }],
      max_output_tokens: 16,
      store: false,
      stream: true
    })
  },
  deepseek: {
    url: "https://api.deepseek.com/chat/completions",
    body: (m) => ({ model: m, messages: [{ role: "user", content: "ok" }], max_tokens: 8 })
  },
  moonshot: {
    url: "https://api.moonshot.ai/v1/chat/completions",
    body: (m) => ({ model: m, messages: [{ role: "user", content: "ok" }], max_tokens: 8 })
  }
};

/* MODEL AVAILABILITY: cache by full model ID; undefined means not yet probed. */
const modelAlive = new Map<string, boolean>();
let modelsProbed = false;

/* Persist probe results for one day to avoid paid requests on every restart. */
const ALIVE_CACHE_PATH = path.join(__dirname, "..", "data", "models-alive.json");
const ALIVE_TTL_MS = 24 * 60 * 60 * 1000; // One day.

function loadAliveCache(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(ALIVE_CACHE_PATH, "utf8"));
    if (typeof raw?.checkedAt !== "number") return false;
    if (Date.now() - raw.checkedAt > ALIVE_TTL_MS) return false;
    const map = raw?.alive;
    if (!map || typeof map !== "object") return false;
    for (const [id, ok] of Object.entries(map)) modelAlive.set(id, ok === true);
    return modelAlive.size > 0;
  } catch { return false; }
}

function saveAliveCache(): void {
  try {
    fs.mkdirSync(path.dirname(ALIVE_CACHE_PATH), { recursive: true });
    const alive: Record<string, boolean> = {};
    for (const [id, ok] of modelAlive) alive[id] = ok;
    fs.writeFileSync(
      ALIVE_CACHE_PATH,
      JSON.stringify({ checkedAt: Date.now(), alive }, null, 2)
    );
  } catch (e) {
    console.log("[models] could not save cache: " + (e as Error).message);
  }
}

async function probeOne(m: ModelInfo, key: string): Promise<boolean> {
  const cfg = MODEL_PROBE[m.provider];
  if (!cfg) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const proxy = proxyUrl();
    const opts: any = {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(cfg.body(m.id.slice(m.id.indexOf("/") + 1))),
      signal: ctl.signal
    };
    if (proxy) opts.dispatcher = new ProxyAgent(proxy);
    const r = proxy ? await undiciFetch(cfg.url, opts) : await fetch(cfg.url, opts);
    clearTimeout(t);
    /* Treat rate limiting as evidence that the model endpoint exists. */
    if (r.status === 429) return true;
    if (r.ok) {
      /* Drain successful OpenAI SSE responses so connections can be released. */
      if (m.provider === "openai") await r.text().catch(() => "");
      return true;
    }
    const txt = await r.text().catch(() => "");
    console.log("[models] " + m.id + ": " + r.status + " " + txt.slice(0, 160).replace(/\s+/g, " "));
    return false;
  } catch (e) {
    clearTimeout(t);
    console.log("[models] " + m.id + ": network error — " + (e as Error).message);
    return false;
  }
}

/* MODEL PROBES: limit concurrent availability checks to five. */
export function probeModels(force = false): Promise<void> {
  if (modelsProbed) return Promise.resolve();
  modelsProbed = true;
  return runProbe(force);
}

async function runProbe(force: boolean): Promise<void> {
  /* Reuse a fresh cache instead of issuing paid probes. */
  if (!force && loadAliveCache()) {
    const alive = MODELS.filter((m) => modelAlive.get(m.id) === true).length;
    console.log("[models] cached: available " + alive + " of " + MODELS.length);
    return;
  }
  /* Skip model probes for providers already known to be unreachable. */
  await probeProviders();
  /* Read credentials after refresh so probes use the updated access token. */
  const keys = readAuthKeys();
  const queue = MODELS.filter((m) => isProviderAvailable(m.provider));
  const workers = new Array(Math.min(5, queue.length)).fill(0).map(async () => {
    while (queue.length) {
      const m = queue.shift();
      if (!m) break;
      const key = keys[m.provider] || (m.provider === "moonshot" ? keys["moonshotai"] : "");
      if (!key) { modelAlive.set(m.id, false); continue; }
      modelAlive.set(m.id, await probeOne(m, key));
    }
  });
  await Promise.all(workers);
  for (const m of MODELS) {
    if (!modelAlive.has(m.id)) modelAlive.set(m.id, false);
  }
  saveAliveCache();
  const alive = MODELS.filter((m) => modelAlive.get(m.id) === true).length;
  console.log("[models] available models: " + alive + " of " + MODELS.length);
}

/* See docs/CODE-MAP.md for module responsibilities and invariants. */
const AUTO_REFRESH_MS = 24 * 60 * 60 * 1000; // One day.
/* Token checks run more frequently than catalog probes. */
const TOKEN_CHECK_MS = 5 * 60 * 1000; // Five minutes.

let autoRefreshStarted = false;

/* REFRESH SCHEDULER: background credential and model-catalog maintenance. */
export function startAutoRefresh(): void {
  if (autoRefreshStarted) return;
  autoRefreshStarted = true;
  void ensureOpenAIToken().catch(() => {});

  /* Check every five minutes; refresh within ten minutes of expiry. */
  setInterval(() => {
    ensureOpenAIToken().catch(() => {});
  }, TOKEN_CHECK_MS).unref?.();

  /* Refresh availability for catalog entries once per day. */
  setInterval(() => {
    runProbe(true).catch((e) =>
      console.log("[models] scheduled probe failed: " + (e as Error).message)
    );
  }, AUTO_REFRESH_MS).unref?.();

  console.log(
    "[models] auto-refresh enabled: token check every " + TOKEN_CHECK_MS / 3600000 + "h, catalog daily"
  );
}

export function isModelAlive(id: string): boolean {
  /* Unknown models remain visible until their first probe completes. */
  if (!modelAlive.has(id)) return true;
  return modelAlive.get(id) === true;
}

/* Filter by cached availability and sort by combined input/output price. */
export function availableModels() {
  // Settings are editable offline; selecting a model does not authorize inference.
  const list = MODELS.filter((m) => enabledModelIds.includes(m.id));
  list.sort((a, b) => (b.inUsd + b.outUsd) - (a.inUsd + a.outUsd));
  const native=nativeDefault();
  if (native && !list.some(m=>m.id===native)) return [{id:native,label:native,hint:'Selected in Pi',tier:'good',inUsd:null,outUsd:null,provider:native.split('/')[0]},...list];
  return list;
}
