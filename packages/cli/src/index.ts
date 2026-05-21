import { Command } from "commander";
import { Orchestrator, OrchestratorError } from "../../core/src/index.js";

const program = new Command();

program
  .name("co-run")
  .argument("<task>", "task to run through the consensus loop")
  .option("-m, --max-iterations <n>", "maximum review iterations", "3")
  .option("-w, --workspace <path>", "directory for run artifacts", ".agent-workspace")
  .option("--verbose", "print full plan and review text for each event")
  .action(async (task: string, options: { maxIterations: string; workspace: string; verbose: boolean }) => {
    const maxIterations = Number.parseInt(options.maxIterations, 10);

    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10) {
      console.error("--max-iterations must be an integer between 1 and 10");
      process.exit(1);
    }

    const orchestrator = new Orchestrator({
      task,
      maxIterations,
      workspacePath: options.workspace,
      onEvent: (event) => {
        switch (event.type) {
          case "planning_started":
            console.log("Planning...");
            break;
          case "review_started":
            console.log(`Reviewing iteration ${event.iteration}/${event.maxIterations}...`);
            break;
          case "verdict":
            console.log(`Verdict: ${event.verdict}`);
            break;
          case "revision_started":
            console.log("Revising...");
            break;
        }
      },
    });

    try {
      const result = await orchestrator.run();

      console.log("");
      console.log(`Converged: ${result.converged}`);
      console.log(`Iterations: ${result.iterations}`);
      console.log(`Artifacts: ${result.artifacts[0] ? result.artifacts[0].path.replace(/\/[^/]+$/, "") : "none"}`);

      if (options.verbose) {
        console.log("");
        console.log("--- Final Plan ---");
        console.log(result.finalPlan);
      }
    } catch (err) {
      if (err instanceof OrchestratorError) {
        console.error(`\nError during ${err.phase} (iteration ${err.iteration}): ${String(err.cause)}`);
      } else {
        console.error(`\nUnexpected error: ${String(err)}`);
      }
      process.exit(2);
    }
  });

program.parseAsync();
