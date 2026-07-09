import { requireUser } from "@/lib/auth";
import { guard, ok } from "@/lib/response";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TaskRow, UserRow } from "@/lib/types";

export async function GET() {
  return guard(async () => {
    await requireUser();
    const supabase = getSupabaseAdmin();
    const [usersResult, tasksResult] = await Promise.all([
      supabase.from("users").select("id,name,email,role,avatar,created_at").order("name"),
      supabase.from("tasks").select("assignee"),
    ]);

    if (usersResult.error) {
      throw usersResult.error;
    }
    if (tasksResult.error) {
      throw tasksResult.error;
    }

    const users = (usersResult.data ?? []) as Omit<UserRow, "password_hash">[];
    const assignees = new Set(["Unassigned", ...users.map((user) => user.name)]);
    for (const task of (tasksResult.data ?? []) as Pick<TaskRow, "assignee">[]) {
      assignees.add(task.assignee);
    }

    return ok({ users, assignees: Array.from(assignees).sort() });
  });
}
