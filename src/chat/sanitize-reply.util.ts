/**
 * AI providers often answer in markdown even when asked not to. The chat UI
 * renders replies as plain text bubbles, so leftover **bold**, # headers, etc.
 * show up as literal symbols. Strip markdown syntax, keep the words.
 */
export function sanitizeReply(text: string): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, "").trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = cleaned.split("\n");
  const lastLine = lines.at(-1)?.trim() ?? "";
  if (/^(?:[-*+]|\d+\.|•)\s+\S{1,10}$/.test(lastLine)) {
    return lines.slice(0, -1).join("\n").trim();
  }

  return cleaned;
}
