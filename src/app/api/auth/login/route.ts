import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { z } from "zod";
import { authCookieName } from "@/lib/auth";
import { signToken } from "@/lib/jwt";
import { fail, guard, ok } from "@/lib/response";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { UserRow } from "@/lib/types";

const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  return guard(async () => {
    const body = loginSchema.parse(await request.json());
    const { data, error } = await getSupabaseAdmin()
      .from("users")
      .select("*")
      .eq("email", body.email)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const user = data as UserRow | null;
    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      return fail(401, "Invalid email or password.");
    }

    const token = await signToken({ userId: user.id, role: user.role, name: user.name });
    const cookieStore = await cookies();
    cookieStore.set(authCookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 2,
    });

    return ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
      },
    });
  });
}
