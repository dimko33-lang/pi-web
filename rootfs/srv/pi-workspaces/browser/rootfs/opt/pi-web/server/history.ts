import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');

/* One control-panel transcript, independent of any connected project. */
const TRANSCRIPT_FILE = path.join(DATA, 'chat.json');

export type Msg = { role: 'me' | 'agent' | 'err' | 'note'; text: string; at: number; origin?: 'server-error'; responseMeta?: { model: string; thinking?: string; completedAt: number } };

let state: { session: string; messages: Msg[] };
const getState = () => (state || (state = load()));

function load(file = TRANSCRIPT_FILE) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw.session === 'string' && Array.isArray(raw.messages)) return raw;
  } catch { /* Missing or unreadable history starts empty. */ }
  return { session: '', messages: [] };
}

/* Persist the control-panel transcript without changing its existing format. */
function save() {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(TRANSCRIPT_FILE, JSON.stringify(getState()));
  } catch { /* Keep the in-memory transcript if persistence fails. */ }
}

export function getSession() {
  return getState().session;
}

export function setSession(id: string) {
  getState().session = id;
  getState().messages = [];
  save();
}

export function getMessages(): Msg[] {
  return getState().messages;
}

export function pushNote(text: string) {
  getState().messages.push({ role: 'note', text: text.slice(0, 2000), at: Date.now() });
  // Bound retained notes without pruning conversation messages.
  if (getState().messages.length > 500) {
    const notes = getState().messages.filter((m) => m.role === 'note').length;
    if (notes > 400) getState().messages = getState().messages.filter((m) => m.role !== 'note').concat(
      getState().messages.filter((m) => m.role === 'note').slice(-200));
  }
  save();
}

export function pushMessage(role: Msg['role'], text: string) {
  getState().messages.push({ role, text, at: Date.now() });
  save();
}

export function updateLastAgent(text: string, tools?: any[], origin?: Msg['origin'], responseMeta?: Msg['responseMeta']) {
  const last = getState().messages[getState().messages.length - 1];
  if (last && last.role === 'agent') {
    last.text = text;
    if (responseMeta) last.responseMeta = responseMeta;
    if (origin) last.origin = origin;
    else delete last.origin;
    if (tools) (last as any).tools = tools;
  }
  else pushMessage('agent', text);
  save();
}

/* TRANSCRIPT RESET: clear displayed messages without changing the stored session ID. */
export function clearMessages() {
  getState().messages = [];
  save();
}

/* TRANSCRIPT RESTORE: replace displayed messages when reopening a Pi conversation. */
export function fillMessages(msgs: Msg[]) {
  getState().messages = msgs;
  save();
}

/* MESSAGE DELETE: remove by index; access control belongs to the route handler. */
export function deleteMessage(index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= getState().messages.length) return false;
  getState().messages.splice(index, 1);
  save();
  return true;
}

export function restoreMessage(message: Msg, index: number) {
  getState().messages.splice(Math.max(0, Math.min(index, getState().messages.length)), 0, message);
  save();
}

/* Match the newest text/role pair when the client lacks a server timestamp. */
export function deleteMessageByMatch(role: string, text: string) {
  const t = String(text || '');
  if (!t) return false;
  for (let i = getState().messages.length - 1; i >= 0; i--) {
    const m = getState().messages[i];
    if (m.text === t && (!role || m.role === role)) {
      getState().messages.splice(i, 1);
      save();
      return true;
    }
  }
  return false;
}

/* Timestamp fallback with a ten-second matching tolerance. */
export function deleteMessageByAt(at: number, role: string) {
  if (!at) return false;
  for (let i = getState().messages.length - 1; i >= 0; i--) {
    const m = getState().messages[i];
    if (Math.abs(m.at - at) <= 10000 && (!role || m.role === role)) {
      getState().messages.splice(i, 1);
      save();
      return true;
    }
  }
  return false;
}

/* TRANSCRIPT WIPE: clear displayed messages and return the count; retain session ID. */
export function wipeAllMessages(): number {
  const n = getState().messages.length;
  getState().messages = [];
  save();
  return n;
}

