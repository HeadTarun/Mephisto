import tasks from "@/data/tasks.json";
import { cleanTasks } from "@/lib/clean";
import { logActivity } from "@/lib/db";
import { notifyChange } from "@/lib/events";
import { requireUser } from "@/lib/auth";
import { guard, ok } from "@/lib/response";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST() {
  return guard(async () => {
    const user = await requireUser();
    const result = cleanTasks(tasks);
    const supabase = getSupabaseAdmin();

    await supabase.from("comments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("activity_log").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("tasks").delete().neq("id", "");

    const { error } = await supabase.from("tasks").insert(result.cleaned);
    if (error) {
      throw error;
    }

    await logActivity({ taskId: null, user, action: "imported", to: String(result.tasksLoaded) });
    notifyChange();

    return ok({
      issuesFixed: result.issuesFixed,
      tasksLoaded: result.tasksLoaded,
      message: `${result.issuesFixed} issues fixed · ${result.tasksLoaded} tasks loaded`,
    });
  });
}
