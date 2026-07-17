import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { getShipmentLabelPdf } from "@/lib/integrations/smsa";

// GET /api/orders/:uid/label — re-fetches the AWB label PDF from SMSA on
// demand (getPDF) rather than storing the PDF bytes ourselves; label_url
// on the order just points back here.
export async function GET(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const order = await OrdersRepository.getByUid(uid);
  if (!order || !order.awb_number) {
    return NextResponse.json({ error: "No AWB on this order" }, { status: 404 });
  }

  try {
    const pdf = await getShipmentLabelPdf(order.awb_number);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="smsa-label-${order.awb_number}.pdf"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
