# RJ Disposable Camera (Standalone)

Separated disposable camera app extracted from `rj-rsvp`.

## Routes

- `/cam` - guest disposable camera flow (QR/session based)
- `/admin/camera` - camera studio admin (settings, moderation, diagnostics, QR generator)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. Fill `.env.local` values.

4. Run local dev:

```bash
npm run dev
```

5. Open:

- `http://localhost:3000/cam`
- `http://localhost:3000/admin/camera`

## Required Google Sheet Tabs

`Settings` headers:

```text
key | value
```

`Guests` headers:

```text
id | inviteCode | inviteToken | fullName | email | maxGuests | status | lastUpdated | notes
```

`CameraPhotos` headers:

```text
id | createdAt | inviteCode | uploaderName | driveFileId | previewDriveFileId | mimeType | fileSizeBytes | width | height | status | visibilityAt | rejectionReason | hiddenAt
```

## Hostinger Deploy Notes

- Use Node.js `20.9+` runtime.
- Build command: `npm run build`
- Start command: `npm run start`
- Set the environment variables from `.env.example` in Hostinger panel.
