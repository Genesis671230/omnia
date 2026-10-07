import { NextResponse } from "next/server";
import { allConnectors, listPublicConnections, resolveApp } from "@/lib/connectors";

export const dynamic = "force-dynamic";

// GET /api/connections → { connections: PublicConnection[], catalogue }
// Any signed-in role (status only). Never returns secrets.
export async function GET() {
  try {
    const catalogue = allConnectors().map((d) => ({
      provider: d.provider, label: d.label, category: d.category, authModes: d.authModes, grantTypes: d.grantTypes,
      startParams: d.startParams ?? [], configFields: d.configFields,
      platformAvailable: Boolean(resolveApp({ provider: d.provider, authMode: "platform", secrets: {} })),
    }));
    return NextResponse.json({ connections: await listPublicConnections(), catalogue });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
