import { NextResponse } from "next/server";
import {
  gateConfigured,
  passwordMatches,
  sessionCookie,
  signSession,
} from "@/lib/gate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!gateConfigured()) {
    return NextResponse.json(
      { error: "The site gate is not configured." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON password." }, { status: 400 });
  }

  const password =
    body && typeof body === "object" && "password" in body
      ? (body as { password?: unknown }).password
      : undefined;

  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json({ error: "Password required." }, { status: 400 });
  }

  if (!(await passwordMatches(password))) {
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  const token = signSession();
  if (!token) {
    return NextResponse.json(
      { error: "The site gate is not configured." },
      { status: 503 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookie(token));
  return response;
}
