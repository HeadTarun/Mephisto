import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getTask, logActivity } from "@/lib/db";
import { notifyChange } from "@/lib/events";
import { fail, guard, ok } from "@/lib/response";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canManageTasks, TASK_PRIORITIES, type TaskPriority } from "@/lib/types";

const patchTaskSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    assignee: z.string().trim().min(1).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    labels: z.array(z.string().trim().min(1)).optional(),
    due_date: z.string().date().nullable().optional(),
    estimate_hours: z.number().int().min(0).optional(),
  })
  .strict();

type Params = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: Params) {
  return guard(async () => {
    const user = await requireUser();
    if (!canManageTasks(user.role)) {
      return fail(403, "Forbidden.");
    }

    const { id } = await params;
    const existing = await getTask(id);
    if (!existing) {
      return fail(404, "Task not found.");
    }

    const body = patchTaskSchema.parse(await request.json());
    const update = {
      ...body,
      priority: body.priority as TaskPriority | undefined,
    };

    const { data, error } = await getSupabaseAdmin()
      .from("tasks")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    if (body.assignee && body.assignee !== existing.assignee) {
      if (body.assignee === "Unassigned") {
        await logActivity({ taskId: id, user, action: "unassigned", from: existing.assignee, to: body.assignee });
      } else {
        await logActivity({ taskId: id, user, action: "assigned", from: existing.assignee, to: body.assignee });
      }
    }

    notifyChange();
    return ok({ task: data });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return guard(async () => {
    const user = await requireUser();
    if (!canManageTasks(user.role)) {
      return fail(403, "Forbidden.");
    }

    const { id } = await params;
    const existing = await getTask(id);
    if (!existing) {
      return fail(404, "Task not found.");
    }

    const { error } = await getSupabaseAdmin().from("tasks").delete().eq("id", id);
    if (error) {
      throw error;
    }

    await logActivity({ taskId: id, user, action: "deleted", from: existing.status });
    notifyChange();
    return ok({ deleted: true });
  });
}
