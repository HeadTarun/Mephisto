import { cookies } from "next/headers";
import { verifyToken } from "@/lib/jwt";
import type { AuthUser, UserRole } from "@/lib/types";

export const authCookieName = "token";

export async function currentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(authCookieName)?.value;

  if (!token) {
    return null;
  }

  return verifyToken(token);
}

export async function requireUser(): Promise<AuthUser> {
  const user = await currentUser();

  if (!user) {
    throw new AuthError("Authentication required.", 401);
  }

  return user;
}

export function requireRole(user: AuthUser, allowed: UserRole[]): void {
  if (!allowed.includes(user.role)) {
    throw new AuthError("Forbidden.", 403);
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
