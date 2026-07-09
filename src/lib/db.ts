import { getSupabaseAdmin } from "@/lib/supabase";
import { TASK_STATUSES, type ActivityAction, type AuthUser, type TaskRow, type TaskStatus } from "@/lib/types";

export const wipLimits: Partial<Record<TaskStatus, number>> = {
  "In Progress": 5,
  Review: 3,
};

export async function listTasks(): Promise<TaskRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("tasks")
    .select("*")
    .order("status")
    .order("position");

  if (error) {
    throw error;
  }

  return (data ?? []) as TaskRow[];
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as TaskRow | null;
}

export async function assertWipAvailable(status: TaskStatus, excludeTaskId?: string): Promise<void> {
  const limit = wipLimits[status];
  if (!limit) {
    return;
  }

  let query = getSupabaseAdmin()
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("status", status);

  if (excludeTaskId) {
    query = query.neq("id", excludeTaskId);
  }

  const { count, error } = await query;
  if (error) {
    throw error;
  }

  if ((count ?? 0) >= limit) {
    throw new ApiConflictError(`${status} WIP limit reached.`);
  }
}

export async function nextPosition(status: TaskStatus): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from("tasks")
    .select("position")
    .eq("status", status)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as Pick<TaskRow, "position">[];
  return rows.length ? rows[0].position + 1 : 0;
}

export async function reindexStatus(status: TaskStatus): Promise<void> {
  const { data, error } = await getSupabaseAdmin()
    .from("tasks")
    .select("id")
    .eq("status", status)
    .order("position")
    .order("updated_at");

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as Pick<TaskRow, "id">[];
  await Promise.all(
    rows.map((task, position) =>
      getSupabaseAdmin().from("tasks").update({ position }).eq("id", task.id),
    ),
  );
}

export async function logActivity(input: {
  taskId: string | null;
  user: AuthUser | null;
  action: ActivityAction;
  from?: string | null;
  to?: string | null;
}): Promise<void> {
  const { error } = await getSupabaseAdmin().from("activity_log").insert({
    task_id: input.taskId,
    user_id: input.user?.userId ?? null,
    action: input.action,
    from_status: input.from ?? null,
    to_status: input.to ?? null,
  });

  if (error) {
    throw error;
  }
}

export function orderedStatuses(): TaskStatus[] {
  return [...TASK_STATUSES];
}

export class ApiConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConflictError";
  }
}
