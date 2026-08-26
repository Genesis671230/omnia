import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";

export const maxDuration = 60;

const BOOKS_BASE = process.env.ZOHO_BOOKS_BASE ?? "https://www.zohoapis.com/books/v3";
const ORG_ID = process.env.ZOHO_ORGANIZATION_ID ?? "";



async function fetchZoho(path: string, token: string, query: Record<string, string> = {}) {

  try {
    
    
    const url = new URL(`${BOOKS_BASE}${path}`);
    url.searchParams.set("organization_id", ORG_ID);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const json = await res.json().catch((e) => {
      console.log(e,"gt error ")
    });
    
    console.log(json,"the response is here")
    // if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    //   throw new Error(json.message || `Zoho ${path} failed HTTP ${res.status}`);
    // }
    return json;
  } catch (error) {
    console.log(error,"here is error of fetchzoho")
  }
}

async function main() {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });


    const token = await getAccessToken();
    const  taxes = await fetchZoho("/settings/taxes", token)
    console.log(taxes,"we got tades")

return taxes


}

main()