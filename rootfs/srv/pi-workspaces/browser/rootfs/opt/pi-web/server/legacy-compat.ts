/** Migration only: no editor routes, tools, prompts or project files are loaded. */
export function normalizeLegacyMarker(type: unknown): unknown {
  if (type === 'curvelab.deleted-message') return 'pi-web.deleted-message';
  if (type === 'curvelab.restored-message') return 'pi-web.restored-message';
  return type;
}

// Existing deployments may migrate their environment independently of the code.
// Prefer PI_WEB_*; retain old configuration names only at this boundary.
for (const [name, value] of Object.entries(process.env)) {
  if (!name.startsWith('CURVELAB_')) continue;
  const next = 'PI_WEB_' + name.slice('CURVELAB_'.length);
  if (process.env[next] === undefined) process.env[next] = value;
}
