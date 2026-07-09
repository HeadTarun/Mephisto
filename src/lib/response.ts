import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth";
import { ApiConflictError } from "@/lib/db";
import type { ApiFailure, ApiSuccess } from "@/lib/types";

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json(
    {
      ok: true,
      data,
    },
    init,
  );
}

export function fail(
  status: number,
  error: string,
  init?: Omit<ResponseInit, "status">,
): NextResponse<ApiFailure> {
  return NextResponse.json(
    {
      ok: false,
      error,
    },
    {
      ...init,
      status,
    },
  );
}

export async function guard(
  handler: () => Promise<Response> | Response,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AuthError) {
      return fail(error.status, error.message);
    }

    if (error instanceof ZodError) {
      return fail(400, error.issues[0]?.message ?? "Invalid request.");
    }

    if (error instanceof ApiConflictError) {
      return fail(409, error.message);
    }

    console.error(error);
    return fail(500, "Internal server error.");
  }
}
