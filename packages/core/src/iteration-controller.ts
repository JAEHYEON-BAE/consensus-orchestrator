export class IterationController {
  private count = 0;
  private limit: number;

  constructor(maxIterations: number) {
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10) {
      throw new RangeError("maxIterations must be an integer between 1 and 10.");
    }
    this.limit = maxIterations;
  }

  canContinue(): boolean {
    return this.count < this.limit;
  }

  consume(): { iteration: number; remaining: number } {
    if (!this.canContinue()) {
      throw new Error("Iteration limit exceeded.");
    }
    this.count += 1;
    return {
      iteration: this.count,
      remaining: this.limit - this.count,
    };
  }

  extend(additionalIterations: number): void {
    if (!Number.isInteger(additionalIterations) || additionalIterations < 1) {
      throw new RangeError("additionalIterations must be a positive integer.");
    }
    this.limit += additionalIterations;
  }

  current(): number {
    return this.count;
  }

  max(): number {
    return this.limit;
  }

  isExhausted(): boolean {
    return this.count >= this.limit;
  }
}
