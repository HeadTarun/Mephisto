import { z } from "zod";
import { canManageTasks, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/types";
import { assertWipAvailable, listTasks, logActivity, nextPosition } from "@/lib/db";
import { notifyChange } from "@/lib/events";
import { requireUser } from "@/lib/auth";
import { fail, guard, ok } from "@/lib/response";
import { getSupabaseAdmin } from "@/lib/supabase";

const createTaskSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional().default(""),
  status: z.enum(TASK_STATUSES).default("Backlog"),
  assignee: z.string().trim().min(1).default("Unassigned"),
  priority: z.enum(TASK_PRIORITIES).default("med"),
  labels: z.array(z.string().trim().min(1)).default([]),
  due_date: z.string().date().nullable().optional().default(null),
  estimate_hours: z.number().int().min(0).default(0),
});

export async function GET() {
  return guard(async () => {
    await requireUser();
    const tasks = await listTasks();
    return ok({ tasks });
  });
}

export async function POST(request: Request) {
  return guard(async () => {
    const user = await requireUser();
    if (!canManageTasks(user.role)) {
      return fail(403, "Forbidden.");
    }

    const body = createTaskSchema.parse(await request.json());
    const status = body.status as TaskStatus;

    if (status === "Done" && user.role === "member") {
      return fail(403, "Members cannot create Done tasks.");
    }

    await assertWipAvailable(status);
    const position = await nextPosition(status);
    const id = `SP-${Date.now().toString(36).toUpperCase()}`;

    const { data, error } = await getSupabaseAdmin()
      .from("tasks")
      .insert({
        id,
        title: body.title,
        description: body.description,
        status,
        assignee: body.assignee || "Unassigned",
        priority: body.priority as TaskPriority,
        labels: body.labels,
        due_date: body.due_date,
        estimate_hours: body.estimate_hours,
        completed_date: status === "Done" ? new Date().toISOString().slice(0, 10) : null,
        position,
        has_warning: false,
        created_by: user.userId,
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    await logActivity({ taskId: id, user, action: "created", to: status });
    if (body.assignee !== "Unassigned") {
      await logActivity({ taskId: id, user, action: "assigned", to: body.assignee });
    }
    notifyChange();

    return ok({ task: data });
  });
}
