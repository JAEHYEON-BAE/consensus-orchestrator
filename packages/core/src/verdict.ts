export type Verdict = "APPROVED" | "REVISION" | "MISSING";

export function parseVerdict(text: string): Verdict {
  const lines = text.trimEnd().split("\n");
  const lastLine = lines.at(-1)?.trim();

  if (lastLine === "[APPROVED]") return "APPROVED";
  if (lastLine === "[REVISION]") return "REVISION";

  return "MISSING";
}

function buildRepairPrompt(originalReview: string): string {
  return (
    "Your previous review did not end with a verdict token.\n\n" +
    "Your previous review:\n" +
    "<review>\n" +
    originalReview +
    "\n</review>\n\n" +
    "You must end your review with exactly one of these tokens on its own line:\n" +
    "[APPROVED]\n" +
    "[REVISION]\n\n" +
    "Repeat your complete review and append the correct token as the very last line."
  );
}

export interface VerdictResult {
  text: string;
  verdict: Exclude<Verdict, "MISSING">;
  retries: number;
}

export async function resolveVerdict(
  initialText: string,
  retryFn: (repairPrompt: string) => Promise<string>,
  maxRetries = 2,
): Promise<VerdictResult> {
  let text = initialText;
  let retries = 0;

  while (retries < maxRetries) {
    const verdict = parseVerdict(text);

    if (verdict !== "MISSING") {
      return { text, verdict, retries };
    }

    text = await retryFn(buildRepairPrompt(text));
    retries += 1;
  }

  const finalVerdict = parseVerdict(text);

  return {
    text,
    verdict: finalVerdict === "MISSING" ? "REVISION" : finalVerdict,
    retries,
  };
}