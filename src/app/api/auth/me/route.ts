import { requireUser } from "@/lib/auth";
import { guard, ok } from "@/lib/response";

export async function GET() {
  return guard(async () => {
    const user = await requireUser();
    return ok({ user });
  });
}
