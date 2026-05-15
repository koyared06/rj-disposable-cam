import { z } from "zod";

export const guestLookupSchema = z.object({
  query: z.string().trim().min(2, "Enter at least 2 characters."),
});

export const rsvpSubmitSchema = z.object({
  inviteCode: z.string().trim().min(1),
  inviteToken: z.string().trim().min(8),
  fullName: z.string().trim().min(2),
  email: z.string().trim().email().optional().or(z.literal("")),
  attendance: z.enum(["attending", "declined"]),
  guestCount: z.coerce.number().int().min(0).max(20),
  companionNames: z.array(z.string().trim().min(1).max(120)).optional().default([]),
  message: z.string().trim().max(500).optional().or(z.literal("")),
}).superRefine((data, ctx) => {
  if (data.attendance === "declined" && data.guestCount !== 0) {
    ctx.addIssue({
      code: "custom",
      message: "Guest count must be 0 when declining.",
      path: ["guestCount"],
    });
  }

  if (data.attendance === "attending" && data.guestCount < 1) {
    ctx.addIssue({
      code: "custom",
      message: "Guest count must be at least 1 when attending.",
      path: ["guestCount"],
    });
  }
});

export const createGuestSchema = z.object({
  inviteCode: z.string().trim().max(30).optional().or(z.literal("")),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().optional().or(z.literal("")),
  maxGuests: z.coerce.number().int().min(1).max(20),
  notes: z.string().trim().max(250).optional().or(z.literal("")),
});

export const updateGuestSchema = z.object({
  rowNumber: z.coerce.number().int().min(2),
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().optional().or(z.literal("")).optional(),
  maxGuests: z.coerce.number().int().min(1).max(20).optional(),
  status: z.enum(["pending", "attending", "declined"]).optional(),
  notes: z.string().trim().max(250).optional().or(z.literal("")).optional(),
});

export const deleteGuestSchema = z.object({
  rowNumber: z.coerce.number().int().min(2),
});

export const updateWeddingDateSchema = z.object({
  weddingDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Wedding date must be in YYYY-MM-DD format.")
    .or(z.literal("")),
  weddingTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Wedding time must be in HH:mm format.")
    .or(z.literal(""))
    .optional(),
  showCountdown: z.boolean().optional(),
  cameraEnabled: z.boolean().optional(),
  cameraRequireApproval: z.boolean().optional(),
  cameraGalleryUnlockDate: z
    .string()
    .trim()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      "Camera gallery unlock date must be in YYYY-MM-DD format.",
    )
    .or(z.literal(""))
    .optional(),
  cameraGalleryUnlockTime: z
    .string()
    .trim()
    .regex(
      /^([01]\d|2[0-3]):[0-5]\d$/,
      "Camera gallery unlock time must be in HH:mm format.",
    )
    .or(z.literal(""))
    .optional(),
  cameraMaxUploadMb: z.coerce.number().int().min(0).max(100).optional(),
  cameraShotLimitPerInvite: z.coerce.number().int().min(0).max(500).optional(),
  cameraLandingEnabled: z.boolean().optional(),
  cameraEventTitle: z.string().trim().max(120).optional().or(z.literal("")),
  cameraEventSubtitle: z.string().trim().max(240).optional().or(z.literal("")),
  cameraCoverImageUrl: z.string().trim().url().optional().or(z.literal("")),
  cameraStartButtonLabel: z.string().trim().max(40).optional().or(z.literal("")),
});

const entourageSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must use lowercase letters, numbers, and hyphens only.",
  );

export const createEntourageCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: entourageSlugSchema.optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isVisible: z.boolean().optional(),
});

export const updateEntourageCategorySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(2).max(120).optional(),
  slug: entourageSlugSchema.optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isVisible: z.boolean().optional(),
});

export const deleteEntourageCategorySchema = z.object({
  id: z.string().trim().min(1),
});

export const createEntourageMemberSchema = z.object({
  categoryId: z.string().trim().min(1),
  fullName: z.string().trim().min(2).max(120),
  side: z.enum(["bride", "groom", "none"]).optional(),
  memberOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isVisible: z.boolean().optional(),
  notes: z.string().trim().max(250).optional().or(z.literal("")),
});

export const updateEntourageMemberSchema = z.object({
  id: z.string().trim().min(1),
  categoryId: z.string().trim().min(1).optional(),
  fullName: z.string().trim().min(2).max(120).optional(),
  side: z.enum(["bride", "groom", "none"]).optional(),
  memberOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isVisible: z.boolean().optional(),
  notes: z.string().trim().max(250).optional().or(z.literal("")).optional(),
});

export const deleteEntourageMemberSchema = z.object({
  id: z.string().trim().min(1),
});

export const cameraUploadMetaSchema = z.object({
  inviteCode: z.string().trim().min(1).optional().or(z.literal("")),
  inviteToken: z.string().trim().min(8).optional().or(z.literal("")),
  eventId: z.string().trim().min(1).max(60).optional().or(z.literal("")),
  cameraToken: z.string().trim().min(20).optional().or(z.literal("")),
  deviceId: z.string().trim().min(8).max(120).optional().or(z.literal("")),
  uploaderName: z.string().trim().min(2).max(120).optional().or(z.literal("")),
});

export const cameraModerationSchema = z.object({
  id: z.string().trim().min(1),
  action: z.enum(["approve", "hide", "reject"]),
  rejectionReason: z.string().trim().max(250).optional().or(z.literal("")),
});
