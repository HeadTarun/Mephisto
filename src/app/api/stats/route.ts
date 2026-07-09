import { requireUser } from "@/lib/auth";
import { currentWeekBounds, isWithinIsoRange } from "@/lib/dates";
import { listTasks } from "@/lib/db";
import { guard, ok } from "@/lib/response";
import { TASK_STATUSES } from "@/lib/types";

export async function GET() {
  return guard(async () => {
    await requireUser();
    const tasks = await listTasks();
    const week = currentWeekBounds();
    const tasksPerStatus = TASK_STATUSES.map((status) => ({
      status,
      count: tasks.filter((task) => task.status === status).length,
    }));
    const hoursByAssignee = Array.from(
      tasks.reduce((map, task) => {
        map.set(task.assignee, (map.get(task.assignee) ?? 0) + task.estimate_hours);
        return map;
      }, new Map<string, number>()),
      ([assignee, hours]) => ({ assignee, hours }),
    );
    const completedThisWeek = tasks
      .filter((task) => task.status === "Done" && isWithinIsoRange(task.completed_date, week.start, week.end))
      .reduce((sum, task) => sum + task.estimate_hours, 0);

    return ok({ tasksPerStatus, hoursByAssignee, completedThisWeek, week });
  });
}
