import { describe, it, expect, vi } from "vitest";
import { parseVerdict, resolveVerdict } from "../verdict.js";

describe("parseVerdict", () => {
  it("returns APPROVED when last line is [APPROVED]", () => {
    expect(parseVerdict("Looks good.\n\n[APPROVED]")).toBe("APPROVED");
  });

  it("returns REVISION when last line is [REVISION]", () => {
    expect(parseVerdict("Needs work.\n\n[REVISION]")).toBe("REVISION");
  });

  it("returns MISSING when no token is present", () => {
    expect(parseVerdict("Some review without a token.")).toBe("MISSING");
  });

  it("returns MISSING when token appears mid-text but not on last line", () => {
    expect(parseVerdict("[APPROVED]\n\nSome trailing text.")).toBe("MISSING");
  });

  it("returns MISSING for case-variant tokens", () => {
    expect(parseVerdict("[approved]")).toBe("MISSING");
    expect(parseVerdict("[Approved]")).toBe("MISSING");
  });

  it("handles trailing whitespace on the last line", () => {
    expect(parseVerdict("Review.\n[APPROVED]  ")).toBe("APPROVED");
  });

  it("when both tokens appear, last line wins", () => {
    expect(parseVerdict("[APPROVED]\n[REVISION]")).toBe("REVISION");
    expect(parseVerdict("[REVISION]\n[APPROVED]")).toBe("APPROVED");
  });
});

describe("resolveVerdict", () => {
  it("returns immediately when initial text has a valid verdict", async () => {
    const retryFn = vi.fn();
    const result = await resolveVerdict("Good plan.\n\n[APPROVED]", retryFn);

    expect(result.verdict).toBe("APPROVED");
    expect(result.retries).toBe(0);
    expect(retryFn).not.toHaveBeenCalled();
  });

  it("retries once and succeeds on the first retry", async () => {
    const retryFn = vi.fn().mockResolvedValueOnce("Fixed review.\n\n[REVISION]");
    const result = await resolveVerdict("Missing token.", retryFn);

    expect(result.verdict).toBe("REVISION");
    expect(result.retries).toBe(1);
    expect(retryFn).toHaveBeenCalledOnce();
  });

  it("retries twice and succeeds on the second retry", async () => {
    const retryFn = vi
      .fn()
      .mockResolvedValueOnce("Still missing.")
      .mockResolvedValueOnce("Now fixed.\n\n[APPROVED]");

    const result = await resolveVerdict("Missing token.", retryFn);

    expect(result.verdict).toBe("APPROVED");
    expect(result.retries).toBe(2);
  });

  it("falls back to REVISION after exhausting all retries", async () => {
    const retryFn = vi.fn().mockResolvedValue("Still no token.");
    const result = await resolveVerdict("Missing token.", retryFn, 2);

    expect(result.verdict).toBe("REVISION");
    expect(result.retries).toBe(2);
    expect(retryFn).toHaveBeenCalledTimes(2);
  });

  it("includes the original review text in the repair prompt", async () => {
    const retryFn = vi.fn().mockResolvedValue("Fixed.\n\n[REVISION]");
    await resolveVerdict("My original review without token.", retryFn);

    const repairPrompt = retryFn.mock.calls[0][0] as string;
    expect(repairPrompt).toContain("My original review without token.");
    expect(repairPrompt).toContain("[APPROVED]");
    expect(repairPrompt).toContain("[REVISION]");
  });

  it("includes the most recent (not initial) review in repair prompt on second retry", async () => {
    const retryFn = vi.fn()
      .mockResolvedValueOnce("Second attempt, still no token.")
      .mockResolvedValueOnce("Third attempt.\n\n[APPROVED]");

    await resolveVerdict("First attempt, no token.", retryFn, 2);

    const secondRepairPrompt = retryFn.mock.calls[1][0] as string;
    expect(secondRepairPrompt).toContain("Second attempt, still no token.");
  });

  it("respects custom maxRetries", async () => {
    const retryFn = vi.fn().mockResolvedValue("No token.");
    await resolveVerdict("Missing.", retryFn, 1);

    expect(retryFn).toHaveBeenCalledTimes(1);
  });
});
