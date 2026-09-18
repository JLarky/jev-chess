"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs, PieceHandlerArgs } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import { GateSetup } from "@/components/gate-setup";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JevDistribution } from "@/components/jev-distribution";
import { MoveList } from "@/components/move-list";
import { PromotionDialog } from "@/components/promotion-dialog";
import {
  applyUci,
  describeOutcome,
  findLegalMove,
  getLegalMoves,
  isPromotionAttempt,
  sideToMove,
  type PromotionPiece,
  type Side,
} from "@/lib/chess";
import type { JevAnalysis, JevError, PlayedMove } from "@/lib/types";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type PendingPromotion = { from: string; to: string };

export function Game() {
  const [fen, setFen] = useState(START_FEN);
  const [humanSide, setHumanSide] = useState<Side>("white");
  const [moves, setMoves] = useState<PlayedMove[]>([]);
  const [analysis, setAnalysis] = useState<JevAnalysis | null>(null);
  const [error, setError] = useState<JevError | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [gateConfigured, setGateConfigured] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const requestGen = useRef(0);

  const chess = useMemo(() => new Chess(fen), [fen]);
  const outcome = describeOutcome(chess);
  const turn = sideToMove(chess);
  const humanToMove = unlocked === true && !outcome.over && turn === humanSide && !thinking;
  const lastMove = moves.at(-1);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((res) => res.json())
      .then((data: { hasApiKey?: boolean; unlocked?: boolean; gateConfigured?: boolean }) => {
        if (cancelled) return;
        setHasApiKey(Boolean(data.hasApiKey));
        setUnlocked(Boolean(data.unlocked));
        setGateConfigured(Boolean(data.gateConfigured));
      })
      .catch(() => {
        if (!cancelled) setHasApiKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);


  const unlock = async () => {
    setGateError(null);
    const response = await fetch("/api/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setGateError(payload?.error ?? "Could not unlock.");
      return;
    }
    setPassword("");
    setUnlocked(true);
  };

  const askJev = useCallback(async (position: string) => {
    if (gateConfigured !== true || unlocked !== true) return;
    const gen = ++requestGen.current;
    setThinking(true);
    setError(null);
    try {
      const response = await fetch("/api/jev-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: position }),
      });
      const payload = (await response.json()) as {
        error?: string;
        retryable?: boolean;
        uci?: string;
        san?: string;
        fen?: string;
        probabilities?: Record<string, number>;
        confidence?: number | null;
        droppedMoveCount?: number;
      };
      if (gen !== requestGen.current) return;
      if (!response.ok || !payload.uci || !payload.san || !payload.fen) {
        setError({
          message: payload.error ?? "Jev did not return a legal move. Nothing was applied.",
          retryable: payload.retryable !== false,
        });
        return;
      }
      setFen(payload.fen);
      setMoves((current) => [
        ...current,
        {
          san: payload.san!,
          uci: payload.uci!,
          by: "jev",
          ply: current.length + 1,
        },
      ]);
      setAnalysis({
        chosenUci: payload.uci,
        chosenSan: payload.san,
        probabilities: payload.probabilities ?? {},
        confidence: payload.confidence ?? null,
        droppedMoveCount: payload.droppedMoveCount ?? 0,
      });
    } catch {
      if (gen !== requestGen.current) return;
      setError({
        message: "Could not reach the Jev proxy. Check that the app is running and retry.",
        retryable: true,
      });
    } finally {
      if (gen === requestGen.current) setThinking(false);
    }
  }, [gateConfigured, unlocked]);

  const startGame = useCallback(
    (side: Side) => {
      requestGen.current += 1;
      setFen(START_FEN);
      setHumanSide(side);
      setMoves([]);
      setAnalysis(null);
      setError(null);
      setThinking(false);
      setSelectedSquare(null);
      setPendingPromotion(null);
      if (side === "black") {
        void askJev(START_FEN);
      }
    },
    [askJev],
  );

  const tryHumanMove = useCallback(
    (from: string, to: string, promotion?: PromotionPiece) => {
      if (!humanToMove) return false;
      const board = new Chess(fen);
      if (isPromotionAttempt(board, from, to) && !promotion) {
        setPendingPromotion({ from, to });
        return false;
      }
      const legal = findLegalMove(board, from, to, promotion);
      if (!legal) return false;
      applyUci(board, legal.uci);
      const nextFen = board.fen();
      setFen(nextFen);
      setMoves((current) => [
        ...current,
        { san: legal.san, uci: legal.uci, by: "human", ply: current.length + 1 },
      ]);
      setSelectedSquare(null);
      setPendingPromotion(null);
      setError(null);
      if (!describeOutcome(board).over) {
        void askJev(nextFen);
      }
      return true;
    },
    [askJev, fen, humanToMove],
  );

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: PieceDropHandlerArgs) => {
      if (!targetSquare) return false;
      return tryHumanMove(sourceSquare, targetSquare);
    },
    [tryHumanMove],
  );

  const canDragPiece = useCallback(
    ({ piece }: PieceHandlerArgs) => {
      if (!humanToMove) return false;
      const isWhitePiece = piece.pieceType.startsWith("w");
      return humanSide === "white" ? isWhitePiece : !isWhitePiece;
    },
    [humanSide, humanToMove],
  );

  const destinations = useMemo(() => {
    if (!selectedSquare) return [];
    return getLegalMoves(chess)
      .filter((move) => move.from === selectedSquare)
      .map((move) => move.to);
  }, [chess, selectedSquare]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (lastMove) {
      styles[lastMove.uci.slice(0, 2)] = { backgroundColor: "rgba(212, 165, 116, 0.38)" };
      styles[lastMove.uci.slice(2, 4)] = { backgroundColor: "rgba(212, 165, 116, 0.55)" };
    }
    if (selectedSquare) {
      styles[selectedSquare] = { backgroundColor: "rgba(250, 204, 21, 0.45)" };
    }
    for (const square of destinations) {
      styles[square] = {
        background:
          "radial-gradient(circle at center, rgba(250, 204, 21, 0.45) 18%, transparent 20%)",
      };
    }
    return styles;
  }, [destinations, lastMove, selectedSquare]);

  const pageClass = "mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10";

  const heading = (
    <div className="space-y-2">
      <p className="text-xs font-medium tracking-[0.22em] text-amber-200/80 uppercase">
        TypeSafe · System One
      </p>
      <h1 className="font-heading text-4xl text-balance md:text-5xl">Jev Chess</h1>
      {gateConfigured === true && (
        <p className="max-w-xl text-sm text-muted-foreground text-pretty">
          The rules live in chess.js. Jev only chooses among the legal UCI moves you send it —
          it is not a chat model and never writes a move from scratch.
        </p>
      )}
    </div>
  );

  if (gateConfigured === null) {
    return (
      <div className={pageClass}>
        {heading}
        <p className="text-sm text-muted-foreground">Checking gate…</p>
      </div>
    );
  }

  if (gateConfigured === false) {
    return (
      <div className={pageClass}>
        {heading}
        <Alert>
          <AlertTitle>Gate is not configured</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Jev will not play until the gate is configured. Set{" "}
              <span className="font-mono">SITE_HMAC_KEY</span> and{" "}
              <span className="font-mono">SITE_PASSWORD_HMAC</span> on the Vercel project
              for Production. The password itself is never stored. Redeploy after saving
              the variables.
            </p>
            <GateSetup />
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        {heading}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => startGame(humanSide === "white" ? "black" : "white")}>
            Play as {humanSide === "white" ? "Black" : "White"}
          </Button>
          <Button onClick={() => startGame(humanSide)}>New game</Button>
        </div>
      </header>

      {unlocked !== true && (
        <Alert>
          <AlertTitle>Password required</AlertTitle>
          <AlertDescription className="space-y-3">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void unlock();
              }}
            >
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
                placeholder="Password"
              />
              <Button type="submit" size="sm">
                Unlock
              </Button>
            </form>
            {gateError && <p>{gateError}</p>}
          </AlertDescription>
        </Alert>
      )}

      {hasApiKey === false && (
        <Alert>
          <AlertTitle>API key required to play</AlertTitle>
          <AlertDescription>
            Set <span className="font-mono">TYPESAFE_API_KEY</span> in your environment and restart
            the dev server. Get a key from the TypeSafe dashboard. The key stays on the server and
            is never committed.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Board</CardTitle>
                <CardDescription>
                  You are {humanSide}. Jev is {humanSide === "white" ? "Black" : "White"}.
                </CardDescription>
              </div>
              <Badge variant={outcome.over ? "secondary" : thinking ? "outline" : "default"}>
                {thinking ? "Jev is choosing" : outcome.label}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="mx-auto aspect-square w-full max-w-[min(100%,560px)]">
              <Chessboard
                options={{
                  id: "jev-chess",
                  position: fen,
                  boardOrientation: humanSide,
                  allowDragging: humanToMove,
                  canDragPiece,
                  onPieceDrop,
                  onSquareClick: ({ square }) => {
                    if (!humanToMove) return;
                    if (selectedSquare) {
                      if (selectedSquare === square) {
                        setSelectedSquare(null);
                        return;
                      }
                      if (tryHumanMove(selectedSquare, square)) return;
                    }
                    const piece = chess.get(square as Square);
                    const isHumanPiece =
                      piece &&
                      ((humanSide === "white" && piece.color === "w") ||
                        (humanSide === "black" && piece.color === "b"));
                    setSelectedSquare(isHumanPiece ? square : null);
                  },
                  squareStyles,
                  lightSquareStyle: { backgroundColor: "#ead7b3" },
                  darkSquareStyle: { backgroundColor: "#6e4b35" },
                  boardStyle: {
                    borderRadius: "12px",
                    overflow: "hidden",
                    boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
                  },
                  animationDurationInMs: 220,
                  showNotation: true,
                }}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Drag or click to move. Castle by moving the king two squares. Promotions open a
              piece picker — Jev&apos;s promotions come from the UCI option it picked.
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Jev did not move</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{error.message}</p>
                {error.retryable && humanSide !== turn && !outcome.over && (
                  <Button size="sm" variant="outline" onClick={() => void askJev(fen)}>
                    Ask Jev again
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Jev&apos;s distribution</CardTitle>
              <CardDescription>
                Top of the last Choice probabilities. Bars sum toward 1 across every option sent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <JevDistribution analysis={analysis} thinking={thinking} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Move list</CardTitle>
              <CardDescription>{moves.length} ply · FEN stays in sync with chess.js</CardDescription>
            </CardHeader>
            <CardContent>
              <MoveList moves={moves} />
            </CardContent>
          </Card>
        </div>
      </div>

      <PromotionDialog
        open={pendingPromotion !== null}
        side={humanSide}
        onCancel={() => setPendingPromotion(null)}
        onPick={(piece) => {
          if (!pendingPromotion) return;
          tryHumanMove(pendingPromotion.from, pendingPromotion.to, piece);
        }}
      />
    </div>
  );
}
