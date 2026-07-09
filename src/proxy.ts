import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

const protectedPagePrefixes = ["/board", "/dashboard"];
const protectedApiPrefixes = [
  "/api/tasks",
  "/api/import",
  "/api/board",
  "/api/comments",
  "/api/stats",
  "/api/activity",
  "/api/users",
  "/api/stream",
  "/api/auth/logout",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtectedApi = protectedApiPrefixes.some((prefix) =>
    pathname.startsWith(prefix),
  );
  const isProtectedPage = protectedPagePrefixes.some((prefix) =>
    pathname.startsWith(prefix),
  );

  if (!isProtectedApi && !isProtectedPage) {
    return NextResponse.next();
  }

  const token = request.cookies.get("token")?.value;
  const user = token ? await verifyToken(token) : null;

  if (user) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", user.userId);
    requestHeaders.set("x-user-role", user.role);
    requestHeaders.set("x-user-name", user.name);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  if (isProtectedApi) {
    return NextResponse.json(
      { ok: false, error: "Authentication required." },
      { status: 401 },
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/board/:path*", "/dashboard/:path*", "/api/:path*"],
};
