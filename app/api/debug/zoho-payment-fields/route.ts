import { NextResponse } from "next/server";
import { getAccessToken, listCustomerPaymentCustomFields } from "@/lib/integrations/zoho";

export async function GET() {
  const token = await getAccessToken();
  const schema = await listCustomerPaymentCustomFields(token, { sampleSize: 50 });
  return NextResponse.json({ schema });
}