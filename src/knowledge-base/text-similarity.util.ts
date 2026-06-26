// Tokenizes keywords/title/symptoms into individual words so that e.g.
// "Windows 11" and "Windows" or "0x80070005" and "error 0x80070005"
// still overlap — text describing the same problem is phrased differently
// every time (by users or by the AI extraction step), so comparing whole
// phrases is too brittle. Shared by the dedup/merge check (KnowledgeLearningService)
// and the recommendation engine (RecommendationService) so both use identical scoring.
export function buildFingerprint(parts: string[]): Set<string> {
  const text = parts.join(" ").toLowerCase();
  const tokens = text.match(/[a-z0-9ก-๙]+/g) ?? [];
  return new Set(tokens.filter((token) => token.length >= 3));
}

export function sharedTokens(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((token) => b.has(token));
}

// Standard Jaccard index: |intersection| / |union|, in [0, 1].
export function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const shared = sharedTokens(a, b).length;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}
