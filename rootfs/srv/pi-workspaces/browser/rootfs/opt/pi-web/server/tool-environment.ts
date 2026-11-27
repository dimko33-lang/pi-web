import fs from 'node:fs';

/** Operational facts only; never override naked or explicitly custom prompts. */
export function toolEnvironmentArgs(withTools: boolean, naked: boolean, custom: string,
  file = process.env.PI_WEB_TOOL_ENVIRONMENT || '/opt/pi-web-tools/ENVIRONMENT.md'): string[] {
  if (!withTools || naked || custom || !fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text || text.length > 12000) throw new Error('Invalid tool environment brief');
  return ['--append-system-prompt', text];
}
