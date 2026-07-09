import tasks from "../src/data/tasks.json";
import { cleanTasks } from "../src/lib/clean";

const result = cleanTasks(tasks);

if (result.issuesFixed !== 13 || result.tasksLoaded !== 37) {
  console.error(
    `Expected 13 issues fixed and 37 tasks loaded, got ${result.issuesFixed} and ${result.tasksLoaded}.`,
  );
  process.exit(1);
}

console.log("13 issues fixed · 37 tasks loaded");
