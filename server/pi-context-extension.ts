import './legacy-compat.ts';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { writeSync } from 'node:fs';

/** Observation only: FD 3 is private telemetry, never JSON chat output or history. */
export default function (pi: ExtensionAPI) {
  if (process.env.PI_WEB_CONTEXT_FD !== '3') return;
  let last = '';
  const publish = (_event: unknown, ctx: ExtensionContext) => {
    try {
      const data = JSON.stringify({
        type: 'context_usage',
        session: ctx.sessionManager.getSessionId(),
        model: ctx.model ? ctx.model.provider + '/' + ctx.model.id : null,
        usage: ctx.getContextUsage() ?? null
      });
      if (data !== last) { writeSync(3, data + '\n'); last = data; }
    } catch { /* Telemetry failure must not affect agent execution. */ }
  };
  pi.on('session_start', publish);
  pi.on('model_select', publish);
  pi.on('agent_start', publish);
  pi.on('message_end', publish);
  pi.on('turn_start', publish);
  pi.on('turn_end', publish);
  pi.on('session_compact', publish);
  pi.on('session_tree', publish);
  pi.on('agent_settled', publish);
  pi.on('session_shutdown', publish);
}
