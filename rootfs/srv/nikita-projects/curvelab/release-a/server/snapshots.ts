/* EDITOR FILE VERSIONS: watch project/ and retain file snapshots in .snapshots/.
   This is file history, not the scene's gesture-level undo/redo stack. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PROJECT = path.join(ROOT, 'project');
const SNAP = path.join(ROOT, '.snapshots');
const INDEX = path.join(SNAP, 'index.json');
const IGNORE = new Set(['node_modules', '.git', '.snapshots', 'dist']);
const MAX_SNAPSHOTS = 500;
const GIT_IDLE_MS = 60_000;

type FileState = { hash: string; size: number; mtime: number };
type Snapshot = {
  id: string;
  kind?: 'auto' | 'restore';   // restore — служебный, в историю для стрелок не идёт
  at: number;
  source: string;
  files: Record<string, FileState>;
  changed: { added: string[]; modified: string[]; removed: string[] };
};
type Index = { snapshots: Snapshot[]; // старые → новые
};

/* FILE FINGERPRINTS: lightweight change detection, not a cryptographic checksum. */
function hash(buf: Buffer) {
  // Combine two 32-bit accumulators and file length.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < buf.length; i++) {
    h1 ^= buf[i]; h1 = Math.imul(h1, 16777619);
    h2 = (h2 + buf[i] * (i % 7 + 1)) | 0; h2 = Math.imul(h2, 2654435761);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + ':' + buf.length.toString(16);
}

function walk(dir: string, base = ''): string[] {
  let out: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
    const rel = base ? base + '/' + e.name : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(full, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

/* PROJECT SCAN: record file fingerprints and metadata. */
function scan(): Record<string, FileState> {
  const state: Record<string, FileState> = {};
  for (const rel of walk(PROJECT)) {
    const full = path.join(PROJECT, rel);
    try {
      const st = fs.statSync(full);
      const buf = fs.readFileSync(full);
      state[rel] = { hash: hash(buf), size: st.size, mtime: st.mtimeMs };
    } catch { /* файл исчез между readdir и stat — пропускаем */ }
  }
  return state;
}

/* VERSION INDEX: persisted metadata in chronological order. */
function loadIndex(): Index {
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    if (raw && Array.isArray(raw.snapshots)) return raw;
  } catch { /* первый запуск */ }
  return { snapshots: [] };
}

let index: Index = loadIndex();
let last: Record<string, FileState> = index.snapshots.at(-1)?.files || {};
let timer: NodeJS.Timeout | null = null;
let scanBusy = false;
let gitTimer: NodeJS.Timeout | null = null;
let lastGit = 0;

function saveIndex() {
  fs.mkdirSync(SNAP, { recursive: true });
  fs.writeFileSync(INDEX, JSON.stringify(index));
}

/* VERSION CAPTURE: detect changes, copy files and enforce retention. */
function snapshot(source: string, force = false, kind: 'auto' | 'restore' = 'auto') {
  const files = scan();
  const added: string[] = [];
  const modified: string[] = [];
  for (const [rel, st] of Object.entries(files)) {
    const old = last[rel];
    if (!old) added.push(rel);
    else if (old.hash !== st.hash) modified.push(rel);
  }
  const removed = Object.keys(last).filter((r) => !files[r]);
  if (!force && !added.length && !modified.length && !removed.length) return null;

  const snap: Snapshot = { id: String(Date.now()), kind, at: Date.now(), source, files, changed: { added, modified, removed } };
  // Физическая копия ВСЕХ файлов проекта. Иначе откат на «спокойный» снимок
  // (без изменений) нечего восстанавливать — это и ломало стрелки.
  const dir = path.join(SNAP, snap.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of Object.keys(files)) {
    const src = path.join(PROJECT, rel);
    const dst = path.join(dir, rel);
    try { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); } catch { /* ignore */ }
  }
  try {
    fs.writeFileSync(path.join(dir, '_changed.json'), JSON.stringify({ at: snap.at, source, ...snap.changed }));
  } catch { /* ignore */ }

  index.snapshots.push(snap);
  if (index.snapshots.length > MAX_SNAPSHOTS) {
    const drop = index.snapshots.splice(0, index.snapshots.length - MAX_SNAPSHOTS);
    for (const d of drop) { try { fs.rmSync(path.join(SNAP, d.id), { recursive: true, force: true }); } catch { /* ignore */ } }
  }
  last = files;
  saveIndex();
  scheduleGit();
  return snap;
}

// Раз в минуту тишины — коммит в git: история в двух местах (снапшоты + коммиты).
/* GIT CHECKPOINT: debounce repository snapshots independently of file versions. */
function scheduleGit() {
  const now = Date.now();
  if (gitTimer) clearTimeout(gitTimer);
  const wait = Math.max(2000, lastGit + GIT_IDLE_MS - now);
  gitTimer = setTimeout(async () => {
    gitTimer = null;
    lastGit = Date.now();
    try {
      const { execFile } = await import('node:child_process');
      const run = (args: string[]) => new Promise<void>((res) => execFile('git', args, { cwd: ROOT }, () => res()));
      await run(['add', '-A', 'project']);
      const msg = `snapshot: ${new Date().toISOString()} (${index.snapshots.at(-1)?.changed?.modified?.join(', ') || 'auto'})`;
      await run(['commit', '-m', msg, '--no-verify', '--quiet']);
    } catch { /* git не обязателен */ }
  }, wait);
  gitTimer.unref?.();
}

/* VERSION WATCHER: initialize capture and periodic scans. */
export function startSnapshots() {
  // первый снапшот — точка отсчёта
  snapshot('start', true);
  // поллинг лёгкий: хеши только когда mtime/size поменялись
  timer = setInterval(() => {
    if (scanBusy) return;
    scanBusy = true;
    try { snapshot('auto'); } finally { scanBusy = false; }
  }, 2000);
  timer.unref?.();
  return index.snapshots.length;
}

// «Стартовая точка»: id снапшота, левее которого история не листается.
// Всё старше остаётся на диске в .snapshots/archive, но в стрелках не видно.
let baselineId: string | null = null;
try {
  const raw = JSON.parse(fs.readFileSync(path.join(SNAP, 'baseline.json'), 'utf8'));
  if (raw && typeof raw.id === 'string') baselineId = raw.id;
} catch { /* не задана — показываем всё */ }

export function getBaseline() {
  return baselineId;
}

// Сделать текущее состояние новой стартовой точкой.
/* VERSION BASELINE: mark the current editor version and archive older entries. */
export function setBaseline(): { id: string; archived: number; at: number } {
  const snap = snapshot('baseline', true);
  if (!snap) throw new Error('не удалось снять снимок');
  baselineId = snap.id;
  fs.mkdirSync(SNAP, { recursive: true });
  fs.writeFileSync(path.join(SNAP, 'baseline.json'), JSON.stringify({ id: snap.id, at: snap.at }));
  const archived = archiveOlderThan(snap.id);
  return { id: snap.id, archived, at: snap.at };
}

// Старые снапшоты переносятся в .snapshots/archive — не удаляются, но и не мешают.
function archiveOlderThan(id: string) {
  const cut = index.snapshots.findIndex((s) => s.id === id);
  if (cut <= 0) return 0;
  const old = index.snapshots.slice(0, cut);
  const archDir = path.join(SNAP, 'archive');
  fs.mkdirSync(archDir, { recursive: true });
  let moved = 0;
  for (const snap of old) {
    const from = path.join(SNAP, snap.id);
    const to = path.join(archDir, snap.id);
    try { if (fs.existsSync(from)) { fs.renameSync(from, to); moved++; } } catch { /* ignore */ }
  }
  index.snapshots = index.snapshots.slice(cut);
  saveIndex();
  return moved;
}

export function listSnapshots(limit = 50) {
  // Служебные снапшоты (порождённые откатом) в историю не попадают:
  // иначе каждый откат добавлял бы новую «версию» и сбивал навигацию.
  let snaps = index.snapshots.filter((s) => s.kind !== 'restore');
  // Граница: ничего старше стартовой точки в стрелки не попадает.
  if (baselineId) {
    const cut = snaps.findIndex((s) => s.id === baselineId);
    if (cut >= 0) snaps = snaps.slice(cut);
  }
  return snaps
    .slice(-limit)
    .reverse()
    .map((s) => ({
      id: s.id, at: s.at, source: s.source, changed: s.changed,
      files: Object.keys(s.files).length,
      baseline: s.id === baselineId
    }));
}

// Восстановление: пишет файлы из снапшота обратно в project/.
/* VERSION RESTORE: restore selected editor files, not web-chat or Pi sessions. */
export function restoreSnapshot(id: string, relFiles?: string[]) {
  const snap = index.snapshots.find((s) => s.id === id);
  if (!snap) throw new Error('нет такого снапшота');
  const dir = path.join(SNAP, snap.id);
  const targets = relFiles && relFiles.length
    ? relFiles
    : (snap.changed.modified.concat(snap.changed.added).length
        ? snap.changed.modified.concat(snap.changed.added)
        : Object.keys(snap.files));  // «спокойный» снимок — восстанавливаем все файлы
  // Reject the whole request before writing; callers may only restore indexed editor files.
  if (targets.some(rel => typeof rel !== 'string' || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..') || !Object.hasOwn(snap.files, rel))) {
    throw new Error('Snapshot file is outside the editor version');
  }
  const restored: string[] = [];
  for (const rel of targets) {
    // файл мог не попасть в физическую копию — тогда берём из ближайшего снапшота, где он был
    let src = path.join(dir, rel);
    if (!fs.existsSync(src)) {
      for (let i = index.snapshots.indexOf(snap); i >= 0; i--) {
        const cand = path.join(SNAP, index.snapshots[i].id, rel);
        if (fs.existsSync(cand)) { src = cand; break; }
      }
    }
    if (!fs.existsSync(src)) continue;
    const dst = path.join(PROJECT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    restored.push(rel);
  }
  // Пересобираем «эталон» из реальных файлов: иначе следующее сравнение
  // считает файл изменённым и множит пустые снапшоты.
  const fresh = scan();
  const snap2 = snapshot('restore-' + id, false, 'restore');
  if (!snap2) {
    last = fresh;
    saveIndex();
  }
  return restored;
}
