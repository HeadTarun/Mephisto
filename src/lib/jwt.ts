import { SignJWT, jwtVerify } from "jose";
import { USER_ROLES, type AuthUser, type UserRole } from "@/lib/types";

const encoder = new TextEncoder();
const tokenTtl = "2h";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters.");
  }

  return encoder.encode(secret);
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export async function signToken(user: AuthUser): Promise<string> {
  return new SignJWT({
    role: user.role,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(tokenTtl)
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const userId = payload.sub;
    const { role, name } = payload;

    if (!userId || !isUserRole(role) || typeof name !== "string") {
      return null;
    }

    return {
      userId,
      role,
      name,
    };
  } catch {
    return null;
  }
}
