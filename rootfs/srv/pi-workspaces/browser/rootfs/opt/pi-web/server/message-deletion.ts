import fs from 'node:fs';
import { normalizeLegacyMarker } from './legacy-compat.ts';
import { randomUUID } from 'node:crypto';

export function readEntries(file: string): any[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter(s => s.trim()).map(s => {
    const entry = JSON.parse(s);
    if (entry.type === 'custom') entry.customType = normalizeLegacyMarker(entry.customType);
    return entry;
  });
}

export function hiddenEntryIds(entries: any[]): Set<string> {
  const hidden = new Set<string>();
  for (const entry of entries) {
    if (entry.type === 'custom' && normalizeLegacyMarker(entry.customType) === 'pi-web.deleted-message') {
      for (const id of entry.data?.entryIds || []) hidden.add(id);
    }
    if (entry.type === 'custom' && normalizeLegacyMarker(entry.customType) === 'pi-web.restored-message') {
      for (const id of entry.data?.entryIds || []) hidden.delete(id);
    }
  }
  return hidden;
}

const textOf = (content: any) => typeof content === 'string' ? content :
  (Array.isArray(content) ? content.filter(p => p.type === 'text').map(p => p.text || '').join('\n\n') : '');
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/* Pi stores entry timestamps (and sometimes message timestamps) as ISO strings.
   The web projection converts them to numbers, so compare milliseconds, never types. */
const millis = (value: any): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Append context omissions; never rewrite message/tool records or their parent links. */
export function omitSessionMessage(file: string, message: { role: string; text: string; at: number }, index = 0) {
  const entries = readEntries(file);
  const hidden = hiddenEntryIds(entries);
  const groups: { role: string; entries: any[]; text: string }[] = [];
  let turn: typeof groups[number] | null = null;
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const msg = entry.message;
    if (msg?.role === 'user') {
      turn = null;
      if (!hidden.has(entry.id)) groups.push({ role: 'me', entries: [entry], text: textOf(msg.content) });
    } else if (msg?.role === 'assistant') {
      if (!turn) { turn = { role: 'agent', entries: [], text: '' }; groups.push(turn); }
      turn.entries.push(entry);
      const text = textOf(msg.content);
      if (text) turn.text += (turn.text ? '\n\n' : '') + text;
    } else if (msg?.role === 'toolResult' && turn) turn.entries.push(entry);
  }
  const wanted = normalize(message.text);
  const candidates = groups.filter(g => g.role === message.role &&
    !g.entries.some(e => hidden.has(e.id)) && wanted &&
    (normalize(g.text) === wanted || (message.role === 'agent' &&
      normalize(textOf(g.entries.filter(e => e.message.role === 'assistant').at(-1)?.message.content)) === wanted)));
  candidates.sort((a, b) => distance(a) - distance(b));
  function distance(g: typeof groups[number]) {
    const at = millis(message.at);
    const entry = g.entries[0];
    // The entry and its message can differ by a few milliseconds; the web table stores both.
    const own = [millis(entry.message.timestamp), millis(entry.timestamp)].filter(Boolean);
    return own.length ? Math.min(...own.map(v => Math.abs(v - at))) : Infinity;
  }
  if (!candidates.length) {
    throw new Error('Cannot safely identify this message in the model session. Nothing was deleted.');
  }
  // Repeated identical messages are safe only when exactly one candidate is within
  // the timestamp window. Equal or nearby timestamps are ambiguous: never guess.
  const nearby = candidates.filter(candidate => distance(candidate) <= 5000);
  if (nearby.length !== 1) {
    throw new Error('Cannot safely identify this message in the model session. Nothing was deleted.');
  }
  const target = nearby[0];
  const ids = target.entries.map(e => e.id);
  if (ids.some(id => typeof id !== 'string')) throw new Error('Legacy session format is not supported for deletion.');
  // The UI may borrow one timestamp for both bubbles of a turn, so an exact time match alone
  // can also match the assistant group. User records are atomic parent links; an assistant
  // group must contain a projected text part, exactly as the rendered bubble did.
  const assistantText = (entry: any) => (Array.isArray(entry.message.content) ? entry.message.content : [])
    .some((part: any) => part?.type === 'text' && String(part.text || '').trim());
  const valid = message.role === 'me'
    ? target.entries.length === 1
    : target.entries.some(assistantText);
  if (!valid) {
    throw new Error('Cannot safely identify this message in the model session. Nothing was deleted.');
  }
  const firstIndex = entries.indexOf(target.entries[0]);
  if (entries.slice(firstIndex).some(e => e.type === 'compaction' || e.type === 'branch_summary')) {
    throw new Error('This message may be included in a context summary. Safe deletion is not available yet.');
  }
  // The web host currently runs linear sessions. Refuse branches rather than edit a wrong leaf.
  const children = new Map<string, number>();
  for (const e of entries) if (e.parentId) children.set(e.parentId, (children.get(e.parentId) || 0) + 1);
  if ([...children.values()].some(n => n > 1)) throw new Error('Deletion in branched sessions is not supported yet.');
  let parentId = entries.filter(e => e.id && e.type !== 'session').at(-1)?.id || null;
  const timestamp = new Date().toISOString();
  const added: any[] = [];
  for (const targetId of ids) {
    const entry = { type: 'context_edit', id: randomUUID(), parentId, timestamp, targetId, replacement: null };
    added.push(entry); parentId = entry.id;
  }
  const token = randomUUID();
  const previous = ids.map(id => {
    const edit = entries.filter(e => e.type === 'context_edit' && e.targetId === id).at(-1);
    return { id, content: edit ? edit.replacement?.content ?? null : entries.find(e => e.id === id).message.content };
  });
  added.push({ type: 'custom', id: token, parentId, timestamp,
    customType: 'pi-web.deleted-message', data: { entryIds: ids, previous, message, index } });
  // One synchronous append while the host is idle; preserve raw history for recovery.
  fs.appendFileSync(file, (fs.readFileSync(file, 'utf8').endsWith('\n') ? '' : '\n') + added.map(e => JSON.stringify(e)).join('\n') + '\n');
  return { entryIds: ids, token };
}

/** Restore only before another model turn: do not rewind work already sent to a provider. */
export function restoreSessionMessage(file: string, token: string) {
  const entries = readEntries(file);
  const at = entries.findIndex(e => e.id === token && e.customType === 'pi-web.deleted-message');
  if (at < 0) throw new Error('Deletion not found in this session.');
  const record = entries[at];
  if (entries.some(e => e.customType === 'pi-web.restored-message' && e.data?.token === token)) throw new Error('Message already restored.');
  if (entries.slice(at + 1).some(e => ['message', 'compaction', 'branch_summary'].includes(e.type))) throw new Error('Cannot undo deletion after the next model turn has started.');
  let parentId = entries.at(-1).id;
  const timestamp = new Date().toISOString();
  const added = record.data.previous.map(({ id, content }) => {
    // Native context edits wrap replacement content; a bare array corrupts projection.
    const entry = { type: 'context_edit', id: randomUUID(), parentId, timestamp, targetId: id, replacement: content === null ? null : { content } };
    parentId = entry.id;
    return entry;
  });
  added.push({ type: 'custom', id: randomUUID(), parentId, timestamp, customType: 'pi-web.restored-message', data: { token, entryIds: record.data.entryIds } });
  fs.appendFileSync(file, added.map(e => JSON.stringify(e)).join('\n') + '\n');
  return { message: record.data.message, index: record.data.index };
}
