import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { z } from "zod";
import { authCookieName } from "@/lib/auth";
import { signToken } from "@/lib/jwt";
import { fail, guard, ok } from "@/lib/response";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { UserRow } from "@/lib/types";

const signupSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  return guard(async () => {
    const body = signupSchema.parse(await request.json());
    const passwordHash = await bcrypt.hash(body.password, 12);
    const { data, error } = await getSupabaseAdmin()
      .from("users")
      .insert({
        name: body.name,
        email: body.email,
        password_hash: passwordHash,
        role: "member",
      })
      .select("*")
      .single();

    if (error) {
      return fail(error.code === "23505" ? 409 : 400, "Could not create user.");
    }

    const user = data as UserRow;
    const token = await signToken({ userId: user.id, role: user.role, name: user.name });
    const cookieStore = await cookies();
    cookieStore.set(authCookieName, token, cookieOptions());

    return ok({ user: publicUser(user) });
  });
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
  };
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 2,
  };
}
