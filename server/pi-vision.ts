import './legacy-compat.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { request } from 'node:http';

/* Loopback control traffic must never inherit the model provider's fetch proxy. */
function captureRequest(endpoint: string, token: string, target: string, signal: AbortSignal): Promise<any> {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/api/vision/capture') {
    throw new Error('Invalid local vision endpoint');
  }
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST', signal,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('error', reject);
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 12 * 1024 * 1024) { req.destroy(new Error('Screenshot response exceeds the size limit')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          const image = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!res.statusCode || res.statusCode >= 400) throw new Error(image.error || 'Screenshot failed');
          resolve(image);
        } catch (error) { reject(error); }
      });
    });
    req.on('error', error => reject(new Error('Local vision connection failed: ' + error.message)));
    req.end(JSON.stringify({ target }));
  });
}

/** Explicit CLI extension, loaded only by pi-web's tool-enabled agent. */
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'capture_workspace',
    label: 'Capture workspace',
    description: 'Take a real screenshot of this chat in a fresh read-only agent browser. Not the user tab or desktop. Available automatically during an authenticated tool-enabled turn. Returns the image to the model and displays it in web chat. At most eight captures per turn.',
    promptSnippet: 'Inspect the chat with a real browser screenshot when needed',
    promptGuidelines: [
      'Use capture_workspace to verify visual changes when authorized. Choose chat explicitly. Inspect the returned image before judging the result.',
      'Use the authenticated capture capability for chat screenshots. capture_workspace does not show the user tab or desktop.',
      'Separately, when the user explicitly requests a desktop screenshot on the local Mac, you may use the shell screencapture command and read the resulting image. This user-requested desktop capture is distinct from automatic chat capture and does not require adding another tool or changing this extension. Only claim to see the desktop after inspecting the captured image. A remote server cannot capture the user computer desktop this way; do not substitute the server desktop for it.'
    ],
    executionMode: 'sequential',
    parameters: {
      type: 'object', properties: { target: { type: 'string', enum: ['chat'] } },
      required: ['target'], additionalProperties: false
    } as any,
    async execute(_id, params: { target: 'chat' }, signal, _update, ctx) {
      const endpoint = process.env.PI_WEB_VISION_ENDPOINT;
      const token = process.env.PI_WEB_VISION_TOKEN;
      if (!endpoint || !token) throw new Error('Chat capture is available only during an active tool-enabled turn.');
      if (!ctx.model?.input?.includes('image')) throw new Error('The selected model does not support image input.');
      const image = await captureRequest(endpoint, token, params.target,
        signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000));
      return {
        content: [
          { type: 'text' as const, text: `${params.target} screenshot from the agent browser. This is not the user's current tab. The same PNG is shown in web chat.` },
          { type: 'image' as const, data: image.data, mimeType: image.mimeType }
        ],
        details: { capture: { target: image.target, capturedAt: image.capturedAt, source: image.source } }
      };
    }
  });
}
