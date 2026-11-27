import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
function cleanName(value: string) {
  // Multipart headers from browsers may have been decoded as Latin-1 by Busboy.
  if ([...value].every(c => c.charCodeAt(0) <= 255)) {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    if (!decoded.includes('\ufffd')) value = decoded;
  }
  return Array.from(path.posix.basename(value.replace(/\\/g, '/')).normalize('NFC').replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 180).join('') || 'file';
}

/** Storage is private runtime data, never a static directory or source-backup input. */
export async function createFilesRouter({ directory, publicDirectory, maxBytes = 1024 ** 3 }: {
  directory: string; publicDirectory: string; maxBytes?: number;
}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid upload size limit');
  const incoming = path.join(directory, '.incoming');
  await fs.mkdir(incoming, { recursive: true, mode: 0o700 });
  const upload = multer({ dest: incoming, limits: { fileSize: maxBytes, files: 1, fields: 2, fieldSize: 1024 } });
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  async function entry(id: string) {
    if (!validId(id)) throw new Error('File not found');
    const folder = path.join(directory, id);
    if (!(await fs.lstat(folder)).isDirectory()) throw new Error('File not found');
    const metaFile = path.join(folder, 'metadata.json');
    if (!(await fs.lstat(metaFile)).isFile()) throw new Error('File not found');
    const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
    if (typeof meta.name !== 'string' || !/^content(?:\.[a-z0-9]{1,16})?$/.test(meta.storedName)) throw new Error('Invalid file record');
    const full = path.join(folder, meta.storedName);
    const stat = await fs.lstat(full);
    if (!stat.isFile()) throw new Error('File not found');
    return { id, name: meta.name, size: stat.size, createdAt: meta.createdAt, url: '/files/download/' + id, localPath: full };
  }
  router.get('/', (_req, res) => res.sendFile(path.join(publicDirectory, 'files.html')));
  router.get('/api/list', async (_req, res) => {
    try {
      const files = [];
      for (const id of await fs.readdir(directory)) {
        if (!validId(id)) continue;
        try { files.push(await entry(id)); } catch { /* Ignore incomplete or invalid records. */ }
      }
      files.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      res.json({ files, maxBytes });
    } catch { res.status(500).json({ error: 'Could not list files.' }); }
  });
  router.post('/upload', async (req, res) => {
    try {
      const disk = await fs.statfs(directory);
      const available = disk.bavail * disk.bsize - 64 * 1024 ** 2;
      if (available < 1 || Number(req.headers['content-length'] || 0) > available) return res.status(507).json({ error: 'Not enough free disk space.' });
    } catch { return res.status(503).json({ error: 'File storage is unavailable.' }); }
    upload.single('file')(req, res, async error => {
      if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the upload limit.' : 'Upload failed. Send one file at a time.' });
      const uploaded = (req as any).file;
      if (!uploaded) return res.status(400).json({ error: 'Choose a file to upload.' });
      const id = randomUUID();
      const folder = path.join(directory, id);
      try {
        const name = cleanName(uploaded.originalname);
        const extension = path.extname(name).slice(1).toLowerCase();
        const storedName = 'content' + (/^[a-z0-9]{1,16}$/.test(extension) ? '.' + extension : '');
        await fs.mkdir(folder, { mode: 0o700 });
        await fs.rename(uploaded.path, path.join(folder, storedName));
        await fs.chmod(path.join(folder, storedName), 0o600);
        await fs.writeFile(path.join(folder, 'metadata.json'), JSON.stringify({ name, storedName, createdAt: new Date().toISOString() }), { mode: 0o600 });
        res.status(201).json(await entry(id));
      } catch {
        await fs.rm(uploaded.path, { force: true }).catch(() => {});
        await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
        if (!res.destroyed) res.status(500).json({ error: 'Could not save the uploaded file.' });
      }
    });
  });
  router.get('/download/:id', async (req, res) => {
    try {
      const file = await entry(String(req.params.id));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', 'sandbox');
      res.download(file.localPath, file.name, error => { if (error && !res.headersSent) res.status(404).end(); });
    } catch { res.status(404).json({ error: 'File not found.' }); }
  });
  router.delete('/api/:id', async (req, res) => {
    try {
      const id = String(req.params.id);
      await entry(id);
      await fs.rm(path.join(directory, id), { recursive: true });
      res.json({ ok: true });
    } catch { res.status(404).json({ error: 'File not found.' }); }
  });
  return router;
}
