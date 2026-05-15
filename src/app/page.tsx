import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-8">
      <section className="w-full rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-soft)]">
          Standalone
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-[var(--ink-deep)]">
          RJ Disposable Camera
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          This project is separated from RSVP. Use the links below.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            href="/cam"
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm font-medium text-[var(--ink-deep)] hover:bg-[var(--surface)]"
          >
            Open Guest Camera
          </Link>
          <Link
            href="/admin/camera"
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm font-medium text-[var(--ink-deep)] hover:bg-[var(--surface)]"
          >
            Open Camera Admin
          </Link>
        </div>
      </section>
    </main>
  );
}
