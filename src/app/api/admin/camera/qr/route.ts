import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateAdmin } from "@/lib/admin-auth";
import { createCameraQrToken } from "@/lib/camera-qr";

const requestSchema = z.object({
  eventId: z.string().trim().min(1).max(60),
  tableCode: z.string().trim().max(60).optional().or(z.literal("")),
  expiresInHours: z.coerce.number().int().min(1).max(720).optional(),
});
const DEFAULT_CAMERA_QR_CODE = "GENERAL";

export const dynamic = "force-dynamic";

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
    const params = new URLSearchParams({
      e: parsed.data.eventId.trim(),
      t: token,
    });
    const url = `${origin}/cam?${params.toString()}`;

    return NextResponse.json({
      ok: true,
      qr: {
        eventId: parsed.data.eventId.trim(),
        tableCode: resolvedCode,
        token,
        expiresAt: expiresAt.toISOString(),
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
