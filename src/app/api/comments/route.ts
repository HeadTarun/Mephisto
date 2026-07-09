import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { notifyChange } from "@/lib/events";
import { guard, ok } from "@/lib/response";
import { getSupabaseAdmin } from "@/lib/supabase";

const getSchema = z.object({
  taskId: z.string().min(1),
});

const postSchema = z.object({
  taskId: z.string().min(1),
  text: z.string().trim().min(1),
});

export async function GET(request: Request) {
  return guard(async () => {
    await requireUser();
    const url = new URL(request.url);
    const { taskId } = getSchema.parse({ taskId: url.searchParams.get("taskId") });
    const { data, error } = await getSupabaseAdmin()
      .from("comments")
      .select("*, users(name, avatar)")
      .eq("task_id", taskId)
      .order("created_at");

    if (error) {
      throw error;
    }

    return ok({ comments: data ?? [] });
  });
}

export async function POST(request: Request) {
  return guard(async () => {
    const user = await requireUser();
    const body = postSchema.parse(await request.json());
    const { data, error } = await getSupabaseAdmin()
      .from("comments")
      .insert({
        task_id: body.taskId,
        user_id: user.userId,
        text: body.text,
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    notifyChange();
    return ok({ comment: data });
  });
}
