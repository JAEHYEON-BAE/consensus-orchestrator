import { Command } from "commander";
import { Orchestrator } from "../../core/src/index.js";

const program = new Command();

program
  .name("co-run")
  .argument("<task>", "task to run through the consensus loop")
  .option("-m, --max-iterations <n>", "maximum review iterations", "3")
  .action(async (task: string, options: { maxIterations: string }) => {
    const maxIterations = Number.parseInt(options.maxIterations, 10);

    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10) {
      console.error("--max-iterations must be an integer between 1 and 10");
      process.exit(1);
    }

    const orchestrator = new Orchestrator({
      task,
      maxIterations,
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

    const result = await orchestrator.run();

    console.log("");
    console.log("Done.");
    console.log(`Converged: ${result.converged}`);
    console.log(`Iterations: ${result.iterations}`);
  });

program.parseAsync();