import { requireUser } from "@/lib/auth";
import { guard, ok } from "@/lib/response";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  return guard(async () => {
    await requireUser();
    const { data, error } = await getSupabaseAdmin()
      .from("activity_log")
      .select("*, users(name, avatar), tasks(title)")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      throw error;
    }

    return ok({ activity: data ?? [] });
  });
}
