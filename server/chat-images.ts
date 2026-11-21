import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export type ChatImage = { url: string; mimeType: string; capturedAt?: number; target?: string; source?: string };
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'chat-images');
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function createChatImages(directory: string) {
  function file(name: string) {
    if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(name)) return null;
    const full = path.join(directory, name);
    return fs.existsSync(full) ? full : null;
  }
  function save(data: string, mimeType: string, metadata: Partial<ChatImage> = {}): ChatImage {
    const ext = extensions[mimeType];
    if (!ext || !data || data.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Invalid or oversized tool image');
    const bytes = Buffer.from(data, 'base64');
    const valid = ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : ext === 'jpg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw new Error('Tool image signature does not match its type');
    const name = crypto.createHash('sha256').update(bytes).digest('hex') + '.' + ext;
    fs.mkdirSync(directory, { recursive: true });
    if (!file(name)) fs.writeFileSync(path.join(directory, name), bytes, { mode: 0o600, flag: 'wx' });
    return { ...metadata, mimeType, url: '/api/chat/images/' + name };
  }
  function fromResult(result: any): ChatImage[] {
    const metadata = result?.details?.capture || {};
    return (Array.isArray(result?.content) ? result.content : [])
      .filter(part => part?.type === 'image').slice(0, 4).flatMap(part => {
        try {
          return [save(part.data, part.mimeType, {
            ...(Number.isFinite(metadata.capturedAt) ? { capturedAt: metadata.capturedAt } : {}),
            ...(metadata.target === 'chat' ? { target: metadata.target } : {}),
            ...(metadata.source === 'agent-browser' ? { source: metadata.source } : {})
          })];
        } catch { return []; }
      });
  }
  return { save, file, fromResult };
}
export const chatImages = createChatImages(root);
