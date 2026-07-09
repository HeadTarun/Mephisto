import { cookies } from "next/headers";
import { authCookieName } from "@/lib/auth";
import { guard, ok } from "@/lib/response";

export async function POST() {
  return guard(async () => {
    const cookieStore = await cookies();
    cookieStore.delete(authCookieName);
    return ok({ loggedOut: true });
  });
}
