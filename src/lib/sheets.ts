import { google } from "googleapis";
import { getSheetsEnv } from "@/lib/env";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

type SheetsClient = ReturnType<typeof google.sheets>;

const ENSURE_SHEET_CACHE_TTL_MS = 10 * 60 * 1000;
const ensuredSheetCache = new Map<string, number>();

function getClient(): SheetsClient {
  const env = getSheetsEnv();
  const auth = new google.auth.JWT({
    email: env.serviceAccountEmail,
    key: env.privateKey,
    scopes: SCOPES,
  });

  return google.sheets({ version: "v4", auth });
}

function getSpreadsheetId() {
  return getSheetsEnv().spreadsheetId;
}

export async function readRows(range: string): Promise<string[][]> {
  const sheets = getClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range,
  });

  const values = response.data.values ?? [];
  return values as string[][];
}

export async function appendRow(range: string, row: string[]) {
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row],
    },
  });
}

export async function updateRow(
  sheetName: string,
  rowNumber: number,
  row: string[],
) {
  const sheets = getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!A${rowNumber}:Z${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });
}

export async function writeRows(range: string, rows: string[][]) {
  const sheets = getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: rows,
    },
  });
}

export async function deleteRow(sheetName: string, rowNumber: number) {
  const sheets = getClient();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
  });

  const sheet = metadata.data.sheets?.find((item) => item.properties?.title === sheetName);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId === undefined) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
}

export async function ensureSheetWithHeaders(
  sheetName: string,
  headers: string[],
) {
  const cacheKey = `${getSpreadsheetId()}::${sheetName}`;
  const cachedUntil = ensuredSheetCache.get(cacheKey) ?? 0;
  if (cachedUntil > Date.now()) {
    return;
  }

  const sheets = getClient();
  const spreadsheetId = getSpreadsheetId();

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });

  const sheetExists = metadata.data.sheets?.some(
    (item) => item.properties?.title === sheetName,
  );

  if (!sheetExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      },
    });
  }

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:Z1`,
  });
  const existingHeader = (headerResponse.data.values?.[0] ?? []) as string[];
  const shouldWriteHeader =
    headers.length > existingHeader.length ||
    headers.some((header, index) => existingHeader[index] !== header);

  if (shouldWriteHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:Z1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [headers],
      },
    });
  }

  ensuredSheetCache.set(cacheKey, Date.now() + ENSURE_SHEET_CACHE_TTL_MS);
}
