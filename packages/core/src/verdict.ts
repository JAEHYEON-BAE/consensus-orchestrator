export type Verdict = "APPROVED" | "REVISION" | "MISSING";

export function parseVerdict(text: string): Verdict {
  const lines = text.trimEnd().split("\n");
  const lastLine = lines.at(-1)?.trim();

  if (lastLine === "[APPROVED]") return "APPROVED";
  if (lastLine === "[REVISION]") return "REVISION";

  return "MISSING";
}