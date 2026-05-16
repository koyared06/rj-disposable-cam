import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateAdmin } from "@/lib/admin-auth";
import { createCameraQrToken } from "@/lib/camera-qr";
import {
  appendCameraQrSession,
  deleteCameraQrSessionById,
  readCameraQrSessions,
  setCameraQrSessionRevokedState,
} from "@/lib/camera-qr-sessions";

const requestSchema = z.object({
  eventId: z.string().trim().min(1).max(60),
  tableCode: z.string().trim().max(60).optional().or(z.literal("")),
  expiresInHours: z.coerce.number().int().min(1).max(720).optional(),
});
const updateSchema = z.object({
  id: z.string().trim().min(1),
  action: z.enum(["revoke", "restore"]).default("revoke"),
});
const DEFAULT_CAMERA_QR_CODE = "GENERAL";

export const dynamic = "force-dynamic";

function toTimeValue(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: NextRequest) {
  try {
    if (!validateAdmin(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "250");
    const limit = Math.min(
      500,
      Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 250),
    );
    const nowMs = Date.now();
    const sessions = await readCameraQrSessions();
    const items = sessions
      .map((session) => {
        const expiresAtMs = toTimeValue(session.expiresAt);
        const isExpired = expiresAtMs > 0 ? expiresAtMs <= nowMs : true;
        const isRevoked = Boolean(session.revokedAt.trim());

        return {
          id: session.id,
          createdAt: session.createdAt,
          eventId: session.eventId,
          tableCode: session.tableCode || DEFAULT_CAMERA_QR_CODE,
          expiresAt: session.expiresAt,
          url: session.url,
          isExpired,
          isRevoked,
          isActive: !isExpired && !isRevoked,
        };
      })
      .sort((a, b) => toTimeValue(b.createdAt) - toTimeValue(a.createdAt))
      .slice(0, limit);

    return NextResponse.json({
      ok: true,
      items,
    });
  } catch (error) {
    console.error("Admin camera QR list error:", error);
    const details =
      error instanceof Error ? error.message : "Unknown admin camera QR list error.";
    return NextResponse.json(
      {
        error: "Unable to load camera QR history right now.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!validateAdmin(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid QR payload." },
        { status: 400 },
      );
    }

    const expiresInHours = parsed.data.expiresInHours ?? 48;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    const resolvedCode = parsed.data.tableCode?.trim() || DEFAULT_CAMERA_QR_CODE;
    const token = createCameraQrToken({
      eventId: parsed.data.eventId,
      tableCode: resolvedCode,
      expiresAt,
    });

    const origin = request.nextUrl.origin;
    const eventId = parsed.data.eventId.trim();
    const params = new URLSearchParams({
      e: eventId,
      t: token,
    });
    const url = `${origin}/cam?${params.toString()}`;
    const nowIso = new Date().toISOString();

    const savedSession = await appendCameraQrSession({
      eventId,
      tableCode: resolvedCode,
      expiresAt: expiresAt.toISOString(),
      url,
      token,
      revokedAt: "",
      createdAt: nowIso,
    });

    return NextResponse.json({
      ok: true,
      qr: {
        id: savedSession.id,
        eventId,
        tableCode: resolvedCode,
        token,
        expiresAt: expiresAt.toISOString(),
        generatedAt: nowIso,
        url,
      },
    });
  } catch (error) {
    console.error("Admin camera QR generation error:", error);
    const details =
      error instanceof Error ? error.message : "Unknown admin camera QR generation error.";
    return NextResponse.json(
      {
        error: "Unable to generate camera QR right now.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (!validateAdmin(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid QR update payload." },
        { status: 400 },
      );
    }

    const updated = await setCameraQrSessionRevokedState(
      parsed.data.id,
      parsed.data.action === "revoke",
    );

    if (!updated) {
      return NextResponse.json({ error: "QR history item not found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      item: {
        id: updated.id,
        eventId: updated.eventId,
        tableCode: updated.tableCode || DEFAULT_CAMERA_QR_CODE,
        expiresAt: updated.expiresAt,
        createdAt: updated.createdAt,
        url: updated.url,
        isRevoked: Boolean(updated.revokedAt.trim()),
      },
    });
  } catch (error) {
    console.error("Admin camera QR update error:", error);
    const details =
      error instanceof Error ? error.message : "Unknown admin camera QR update error.";
    return NextResponse.json(
      {
        error: "Unable to update camera QR right now.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!validateAdmin(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let id = (request.nextUrl.searchParams.get("id") ?? "").trim();
    if (!id) {
      const body = await request.json().catch(() => ({}));
      id = typeof body.id === "string" ? body.id.trim() : "";
    }

    if (!id) {
      return NextResponse.json({ error: "Missing QR item ID." }, { status: 400 });
    }

    const deleted = await deleteCameraQrSessionById(id);
    if (!deleted) {
      return NextResponse.json({ error: "QR history item not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Admin camera QR delete error:", error);
    const details =
      error instanceof Error ? error.message : "Unknown admin camera QR delete error.";
    return NextResponse.json(
      {
        error: "Unable to delete camera QR right now.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}
