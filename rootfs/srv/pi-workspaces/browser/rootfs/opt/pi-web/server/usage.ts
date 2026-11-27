import fs from 'node:fs';
import { chatImages } from './chat-images.ts';
import path from 'node:path';
import { hiddenEntryIds } from './message-deletion.ts';

/* SESSION ACCOUNTING: read Pi JSONL, aggregate usage and restore web transcripts.
   Preserve per-model totals: a conversation may span multiple models. */

export type UsageTotals = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;   // input + output + cacheRead + cacheWrite
  cost: number;     // USD
  turns: number;    // Completed model replies.
  context: number;  // Latest request size: input + cacheRead.
};

const EMPTY = (): UsageTotals => ({
  input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
  tokens: 0, cost: 0, turns: 0, context: 0
});

function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/* SESSION FILES: discover Pi conversation logs and resolve session IDs. */
export function sessionFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

export function sessionFile(dir: string, sessionId: string): string | null {
  return sessionFiles(dir).find((f) => f.endsWith('_' + sessionId + '.jsonl')) || null;
}

/* USAGE PARSING: per-model breakdown and total for one session file. */
export type SessionUsage = {
  byModel: Record<string, UsageTotals>;
  total: UsageTotals;
  models: string[];   // Models ordered by descending turn count.
};

export function readSession(file: string): SessionUsage {
  const byModel: Record<string, UsageTotals> = {};
  const steps: Record<string, number> = {};
  const total = EMPTY();

  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { byModel, total, models: [] }; }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type !== 'message') continue;
    const m = ev.message;
    if (!m || m.role !== 'assistant' || !m.usage) continue;

    const model = String(m.model || m.provider || 'unknown');
    const u = m.usage;
    const input = num(u.input), output = num(u.output);
    const cacheRead = num(u.cacheRead), cacheWrite = num(u.cacheWrite);
    const cost = num(u.cost?.total) || (
      num(u.cost?.input) + num(u.cost?.output) + num(u.cost?.cacheRead) + num(u.cost?.cacheWrite)
    );

    for (const bucket of [byModel[model] || (byModel[model] = EMPTY()), total]) {
      bucket.input += input;
      bucket.output += output;
      bucket.reasoning += num(u.reasoning);
      bucket.cacheRead += cacheRead;
      bucket.cacheWrite += cacheWrite;
      bucket.cost += cost;
      bucket.turns += 1;
      const ctx = input + cacheRead + cacheWrite;
      if (ctx > 0) bucket.context = ctx;
    }
    steps[model] = (steps[model] || 0) + 1;
  }

  for (const k of Object.keys(byModel)) {
    const b = byModel[k];
    b.tokens = b.input + b.output + b.cacheRead + b.cacheWrite;
  }
  total.tokens = total.input + total.output + total.cacheRead + total.cacheWrite;
  const models = Object.keys(steps).sort((a, b) => steps[b] - steps[a]);
  return { byModel, total, models };
}

/* Compatibility wrapper returning only session totals. */
export function usageForSession(dir: string, sessionId: string): UsageTotals {
  const file = sessionFile(dir, sessionId);
  return file ? readSession(file).total : EMPTY();
}

/* USAGE AGGREGATION: combine multiple session files. */
export function sumFiles(files: string[]): UsageTotals {
  const total = EMPTY();
  for (const f of files) {
    const s = readSession(f);
    total.input += s.total.input;
    total.output += s.total.output;
    total.reasoning += s.total.reasoning;
    total.cacheRead += s.total.cacheRead;
    total.cacheWrite += s.total.cacheWrite;
    total.cost += s.total.cost;
    total.turns += s.total.turns;
    if (s.total.context > total.context) total.context = s.total.context;
  }
  total.tokens = total.input + total.output + total.cacheRead + total.cacheWrite;
  return total;
}

/* COST COMPARISON: normalize token counts to reference-model pricing. */
const SONNET_RATES = { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 }; // USD per million tokens.

export function costAsSonnet(u: UsageTotals): number {
  return (
    (u.input / 1e6) * SONNET_RATES.input +
    (u.output / 1e6) * SONNET_RATES.output +
    (u.cacheRead / 1e6) * SONNET_RATES.cacheRead +
    (u.cacheWrite / 1e6) * SONNET_RATES.cacheWrite
  );
}

/* CONVERSATION INDEX: titles, timestamps and turn counts for Resume. */
export type ChatEntry = {
  id: string;
  at: number;        // ms
  title: string;     // First user message.
  turns: number;
  cost: number;
};

function isoFromName(file: string): number {
  const m = path.basename(file).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/);
  if (!m) return 0;
  const [, y, mo, d, h, mi, s, ms] = m;
  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`) || 0;
}

function idFromName(file: string): string {
  const b = path.basename(file, '.jsonl');
  const i = b.indexOf('_');
  return i >= 0 ? b.slice(i + 1) : b;
}

/* Derive a title from the first meaningful user message. */
function firstUserText(file: string): string {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type !== 'message') continue;
    const msg = ev.message;
    if (!msg || msg.role !== 'user') continue;
    let text = '';
    if (typeof msg.content === 'string') text = msg.content;
    else if (Array.isArray(msg.content)) {
      text = msg.content.filter((c: any) => c && c.type === 'text').map((c: any) => c.text).join(' ');
    }
    text = String(text).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    return text.length > 90 ? text.slice(0, 90) + '…' : text;
  }
  return '';
}

export function listChats(dir: string, opts: { minTurns?: number; limit?: number } = {}): ChatEntry[] {
  const minTurns = opts.minTurns ?? 3;
  const limit = opts.limit ?? 200;
  const out: ChatEntry[] = [];
  for (const file of sessionFiles(dir)) {
    if (path.basename(file).startsWith('.')) continue;
    const u = readSession(file).total;
    if (!u.turns || u.turns < minTurns) continue;
    const title = (firstUserText(file) || '').trim();
    if (!title) continue;
    /* Include short titles so Resume does not hide brief conversations. */
    out.push({
      id: idFromName(file),
      at: isoFromName(file),
      title,
      turns: u.turns,
      cost: u.cost,
    });
  }
  /* Session identity, not title text, defines a conversation.
     Deduplicating repeated greetings would hide distinct sessions in Resume. */
  out.sort((a, b) => b.at - a.at);
  return out.slice(0, limit);
}

/* TRANSCRIPT RECONSTRUCTION: convert Pi messages and tool calls to web entries. */
export type SessionMsg = { role: 'me' | 'agent'; text: string; at: number; tools?: any[]; responseMeta?: { model: string; thinking?: string; completedAt: number } };

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c && (c.type === 'text' || typeof c.text === 'string'))
      .map((c: any) => String(c.text || ''))
      .join(' ')
      .trim();
  }
  return '';
}

export function readSessionMessages(file: string, limit = 200): SessionMsg[] {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  // Read-only UI projection. Never send this reconstructed copy to the model.
  const out: SessionMsg[] = [];
  const entries = raw.split('\n').filter(s => s.trim()).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  const hidden = hiddenEntryIds(entries);
  let turn: SessionMsg | null = null;
  let thinking: string | undefined;
  const clip = (text: string) => text.length > 20000
    ? text.slice(0, 20000) + '\n[Display truncated; original session unchanged.]' : text;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type === 'thinking_level_change') thinking = ev.thinkingLevel;
    if (ev?.type !== 'message') continue;
    const msg = ev.message;
    if (!msg) continue;
    if (msg.role === 'user') turn = null;
    if (hidden.has(ev.id)) continue;
    const stamp = ev.timestamp ?? msg.timestamp;
    const at = (typeof stamp === 'number' ? stamp : Date.parse(stamp || '')) || 0;
    if (msg.role === 'user') {
      const text = textOf(msg.content);
      if (text) out.push({ role: 'me', text: clip(text), at });
      turn = null;
    } else if (msg.role === 'assistant') {
      if (!turn) {
        turn = { role: 'agent', text: '', at, tools: [] };
        out.push(turn);
      }
      if (msg.model) turn.responseMeta = { model: String(msg.model), thinking, completedAt: at };
      const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: textOf(msg.content) }];
      for (const part of content) {
        if (part.type === 'text' && part.text) {
          const text = clip(String(part.text));
          turn.text += (turn.text ? '\n\n' : '') + text;
          turn.tools!.push({ id: 'text-' + turn.tools!.length, kind: 'text', text });
        } else if (part.type === 'thinking' && part.thinking) {
          let reasoning = turn.tools!.find(t => t.kind === 'reasoning');
          if (!reasoning) { reasoning = { id: 'reasoning', kind: 'reasoning', text: '' }; turn.tools!.unshift(reasoning); }
          reasoning.text += (reasoning.text ? '\n\n' : '') + String(part.thinking);
        } else if (part.type === 'toolCall') {
          turn.tools!.push({ id: part.id, name: part.name, args: part.arguments || {}, output: '', running: false });
        }
      }
    } else if (msg.role === 'toolResult' && turn) {
      const tool = turn.tools!.find(t => t.id === msg.toolCallId && t.kind !== 'text');
      if (tool) {
        tool.output = clip(textOf(msg.content));
        tool.images = chatImages.fromResult(msg);
        tool.isError = msg.isError === true;
      }
    }
  }
  return out.filter(m => m.text || m.tools?.length).slice(-limit);
}
