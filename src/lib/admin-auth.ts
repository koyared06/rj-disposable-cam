import { NextRequest } from "next/server";

export function validateAdmin(request: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return false;
  }

  const headerToken = request.headers.get("x-admin-token");
  const queryToken = request.nextUrl.searchParams.get("token");
  const provided = headerToken ?? queryToken ?? "";

  return provided.length > 0 && provided === expected;
}

