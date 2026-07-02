/**
 * Keep AI replies clean while preserving safe Markdown that the chat UI can
 * render, such as headings, bold text, ordered lists, bullets, and inline code.
 */
export function sanitizeReply(text: string): string {
  const cleaned = text
    .replace(/```(?:markdown|md)?\s*/gi, "```")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = cleaned.split("\n");
  const lastLine = lines.at(-1)?.trim() ?? "";
  if (/^(?:[-*+]|\d+\.|•)\s+\S{1,10}$/.test(lastLine)) {
    return lines.slice(0, -1).join("\n").trim();
  }

  return cleaned;
}
