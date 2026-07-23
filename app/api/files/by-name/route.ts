import { NextResponse } from "next/server";
import { FilesRepository } from "@/lib/repositories/files.repository";

// GET /api/files/by-name?filename=…&provider=…
//
// Downloads the original payout file behind a reconciliation row. A payout
// records the filename it was parsed from (payouts.source) but not the
// uploaded_files id, so the row can only name the file — this resolves that
// name to the stored bytes and redirects to the existing byte-exact download.
//
// Newest match wins: re-uploading a corrected file for the same period should
// hand back the correction, not the superseded original.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filename = url.searchParams.get("filename");
  const provider = url.searchParams.get("provider");
  if (!filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }

  try {
    const files = await FilesRepository.list();
    const match =
      files.find((f) => f.filename === filename && (!provider || f.provider === provider)) ??
      files.find((f) => f.filename === filename);

    if (!match) {
      return NextResponse.json(
        {
          error:
            `No stored upload named "${filename}". This payout was most likely pulled from the ` +
            `gateway's API rather than uploaded as a file, so there is no original document to return.`,
        },
        { status: 404 },
      );
    }

    return NextResponse.redirect(new URL(`/api/files/${match.id}`, request.url));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
