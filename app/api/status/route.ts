import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const configured = Boolean(process.env.TYPESAFE_API_KEY?.trim());
  return NextResponse.json({ hasApiKey: configured });
}
