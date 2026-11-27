/** Pi sends cumulative snapshots within each reasoning segment, not new paragraphs. */
export function createReasoningAccumulator() {
  const segments = new Map<number, string>();
  return {
    update(segment: number, text: string) {
      segments.set(segment, text);
      return [...segments.values()].filter(Boolean).join('\n\n');
    }
  };
}
