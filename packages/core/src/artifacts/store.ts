import * as fs from "node:fs";
import * as path from "node:path";

export type ArtifactType = "plan" | "review";

export interface Artifact {
  name: string;
  path: string;
  type: ArtifactType;
  iteration: number;
  createdAt: Date;
}

function generateRunId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export class ArtifactStore {
  private readonly runPath: string;
  private readonly artifacts: Artifact[] = [];
  readonly runId: string;

  constructor(workspacePath: string, runId?: string) {
    this.runId = runId ?? generateRunId();
    this.runPath = path.resolve(workspacePath, "runs", this.runId);
    fs.mkdirSync(this.runPath, { recursive: true });
  }

  savePlan(iteration: number, content: string): Artifact {
    return this.write(`plan_v${iteration}.md`, "plan", iteration, content);
  }

  saveReview(iteration: number, content: string): Artifact {
    return this.write(`review_v${iteration}.md`, "review", iteration, content);
  }

  load(name: string): string {
    const filePath = path.join(this.runPath, name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Artifact not found: ${name}`);
    }
    return fs.readFileSync(filePath, "utf8");
  }

  list(): Artifact[] {
    return [...this.artifacts];
  }

  getRunPath(): string {
    return this.runPath;
  }

  private write(
    name: string,
    type: ArtifactType,
    iteration: number,
    content: string,
  ): Artifact {
    const filePath = path.join(this.runPath, name);
    fs.writeFileSync(filePath, content, "utf8");

    const artifact: Artifact = {
      name,
      path: filePath,
      type,
      iteration,
      createdAt: new Date(),
    };

    this.artifacts.push(artifact);
    return artifact;
  }
}
