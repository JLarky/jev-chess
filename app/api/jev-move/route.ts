import { NextResponse } from "next/server";
import { JevRequestError, playJevMove } from "@/lib/jev";
import { validateFen } from "chess.js";

export const runtime = "nodejs";

function apiKey(): string | undefined {
  const value = process.env.TYPESAFE_API_KEY;
  return value && value.trim().length > 0 ? value : undefined;
}

export async function POST(request: Request) {
  const key = apiKey();
  if (!key) {
    return NextResponse.json(
      {
        error:
          "TYPESAFE_API_KEY is not set. Add your TypeSafe API key to play against Jev.",
        retryable: false,
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON with a fen field.", retryable: false },
      { status: 400 },
    );
  }

  const fen =
    body && typeof body === "object" && "fen" in body
      ? (body as { fen?: unknown }).fen
      : undefined;

  if (typeof fen !== "string") {
    return NextResponse.json(
      { error: "Missing fen. Send the current position as a FEN string.", retryable: false },
      { status: 400 },
    );
  }

  const fenCheck = validateFen(fen);
  if (!fenCheck.ok) {
    return NextResponse.json(
      { error: fenCheck.error ?? "Invalid FEN.", retryable: false },
      { status: 400 },
    );
  }

  try {
    const result = await playJevMove(fen, { apiKey: key });
    return NextResponse.json({
      uci: result.uci,
      san: result.san,
      fen: result.fen,
      probabilities: result.probabilities,
      confidence: result.confidence,
      droppedMoveCount: result.droppedMoveCount,
      outcome: result.outcome,
    });
  } catch (error) {
    if (error instanceof JevRequestError) {
      return NextResponse.json(
        { error: error.message, retryable: error.retryable },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Jev could not pick a move. Nothing was applied.",
        retryable: true,
      },
      { status: 502 },
    );
  }
}
