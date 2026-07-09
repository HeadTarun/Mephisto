import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertWipAvailable, getTask, logActivity, reindexStatus } from "@/lib/db";
import { notifyChange } from "@/lib/events";
import { fail, guard, ok } from "@/lib/response";
import { getSupabaseAdmin } from "@/lib/supabase";
import { TASK_STATUSES, type TaskStatus } from "@/lib/types";

const moveSchema = z.object({
  id: z.string().min(1),
  toStatus: z.enum(TASK_STATUSES),
  toPosition: z.number().int().min(0).optional(),
});

export async function PATCH(request: Request) {
  return guard(async () => {
    const user = await requireUser();
    const body = moveSchema.parse(await request.json());
    const task = await getTask(body.id);

    if (!task) {
      return fail(404, "Task not found.");
    }

    const toStatus = body.toStatus as TaskStatus;
    const touchesDone = task.status === "Done" || toStatus === "Done";
    if (user.role === "member" && touchesDone) {
      return fail(403, "Members cannot move tasks into or out of Done.");
    }

    if (task.status !== toStatus) {
      await assertWipAvailable(toStatus, task.id);
    }

    const position = body.toPosition ?? 999_999;
    const completedDate = toStatus === "Done" ? new Date().toISOString().slice(0, 10) : null;
    const supabase = getSupabaseAdmin();
    const affectedStatuses = Array.from(new Set([task.status, toStatus]));
    const { data: affectedRows, error: affectedError } = await supabase
      .from("tasks")
      .select("*")
      .in("status", affectedStatuses)
      .order("position");

    if (affectedError) {
      throw affectedError;
    }

    const affectedTasks = (affectedRows ?? []) as Array<typeof task>;
    const sourceTasks = affectedTasks
      .filter((item) => item.status === task.status && item.id !== task.id)
      .sort((left, right) => left.position - right.position);
    const destinationBase =
      task.status === toStatus
        ? sourceTasks
        : affectedTasks
            .filter((item) => item.status === toStatus)
            .sort((left, right) => left.position - right.position);
    const nextDestination = [...destinationBase];
    nextDestination.splice(Math.min(position, nextDestination.length), 0, {
      ...task,
      status: toStatus,
      completed_date: completedDate,
    });

    const updates =
      task.status === toStatus
        ? nextDestination.map((item, index) => ({
            id: item.id,
            status: toStatus,
            position: index,
            completed_date: item.id === task.id ? completedDate : item.completed_date,
          }))
        : [
            ...sourceTasks.map((item, index) => ({
              id: item.id,
              status: task.status,
              position: index,
              completed_date: item.completed_date,
            })),
            ...nextDestination.map((item, index) => ({
              id: item.id,
              status: toStatus,
              position: index,
              completed_date: item.id === task.id ? completedDate : item.completed_date,
            })),
          ];

    const updateResults = await Promise.all(
      updates.map((item) =>
        supabase
          .from("tasks")
          .update({
            status: item.status,
            position: item.position,
            completed_date: item.completed_date,
          })
          .eq("id", item.id),
      ),
    );
    const updateError = updateResults.find((result) => result.error)?.error;
    if (updateError) {
      throw updateError;
    }

    const data = {
      ...task,
      status: toStatus,
      position,
      completed_date: completedDate,
    };

    await reindexStatus(task.status);
    await reindexStatus(toStatus);

    await logActivity({
      taskId: task.id,
      user,
      action: task.status === toStatus ? "reordered" : toStatus === "Done" ? "completed" : "moved",
      from: task.status,
      to: toStatus,
    });
    notifyChange();

    return ok({ task: data });
  });
}
