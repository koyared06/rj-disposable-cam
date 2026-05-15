import { getGuestsSheetName } from "@/lib/env";
import { toGuestRow } from "@/lib/sheet-models";
import { readRows } from "@/lib/sheets";

export async function findGuestByInviteCredentials(
  inviteCode: string,
  inviteToken: string,
) {
  const rows = await readRows(`${getGuestsSheetName()}!A2:I`);
  const normalizedInviteCode = inviteCode.trim().toLowerCase();
  const normalizedInviteToken = inviteToken.trim().toLowerCase();

  return (
    rows
      .map((row, index) => toGuestRow(row, index + 2))
      .find(
        (row) =>
          row.inviteCode.trim().toLowerCase() === normalizedInviteCode &&
          row.inviteToken.trim().toLowerCase() === normalizedInviteToken,
      ) ?? null
  );
}
