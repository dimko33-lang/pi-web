/** Remove only Pi's default brevity rule; add no response-length preference. */
export default function (pi: any) {
  pi.on('before_agent_start', (event: any) => {
    const rules = event.systemPrompt.match(/<rules>\n([\s\S]*?)\n<\/rules>/)?.[1];
    if (rules === undefined) return;
    const filtered = rules.split('\n').filter((line: string) =>
      line.trim() !== '- Be concise in your responses').join('\n');
    if (filtered !== rules) event.systemPromptOptions.sections.rules = filtered;
  });
}
