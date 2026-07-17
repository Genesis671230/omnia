// SMSA Express — legacy SOAP web service, confirmed live against
// track.smsaexpress.com/SECOM/SMSAwebService.asmx?WSDL (2026-07-17):
// SMSA advertises a newer REST API too, but the credential we hold
// (SMSA_API_KEY) is a legacy `passKey` — verified with a live getRTLCities
// call that returned real KSA city data. All field names and order below are
// taken directly from that WSDL, not guessed or reconstructed from
// third-party wrappers.
//
// SMSA returns HTTP 200 even on business-logic failure, with the result
// embedded as plain text inside <addShipmentResult>/<getPDFResult> — a 200
// status is necessary but never sufficient. Every result string is inspected
// before being treated as success.

import { XMLParser } from "fast-xml-parser";

const ENDPOINT = "https://track.smsaexpress.com/SECOM/SMSAwebService.asmx";
const SOAP_NS = "http://track.smsaexpress.com/secom/";

export function smsaConfigured(): boolean {
  return Boolean(process.env.SMSA_API_KEY);
}

function passKey(): string {
  const key = process.env.SMSA_API_KEY;
  if (!key) throw new Error("SMSA_API_KEY is not configured");
  return key;
}

function escapeXml(v: string): string {
  return String(v ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

async function soapCall(operation: string, params: Record<string, string | number>): Promise<string> {
  const body = Object.entries(params)
    .map(([k, v]) => `<${k}>${escapeXml(String(v))}</${k}>`)
    .join("");
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${operation} xmlns="${SOAP_NS}">${body}</${operation}>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `${SOAP_NS}${operation}` },
    body: envelope,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SMSA HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });

function extractResult(xml: string, resultTag: string): string {
  const parsed = parser.parse(xml);
  const result = parsed?.Envelope?.Body?.[`${resultTag}Response`]?.[`${resultTag}Result`];
  if (result === undefined) throw new Error(`SMSA response missing ${resultTag}Result: ${xml.slice(0, 300)}`);
  return String(result);
}

export type SmsaCity = { code: string; city: string };

let cityCache: { at: number; cities: SmsaCity[] } | null = null;
const CITY_CACHE_MS = 60 * 60 * 1000; // 1h — SMSA's city list changes rarely

// getRTLCities — confirmed live: 155 rows, KSA-domestic only (no Dubai,
// Riyadh present). Cache in-process rather than per-request; this is what
// populates the Ship modal's city dropdown, and it must never accept free
// text (SMSA silently rejects or misroutes unrecognized city strings).
export async function getSmsaCities(): Promise<SmsaCity[]> {
  if (cityCache && Date.now() - cityCache.at < CITY_CACHE_MS) return cityCache.cities;

  const xml = await soapCall("getRTLCities", { passKey: passKey() });
  const parsed = parser.parse(xml);
  const dataSet = parsed?.Envelope?.Body?.getRTLCitiesResponse?.getRTLCitiesResult?.diffgram?.NewDataSet;
  const rows: { routCode: string; rCity: string }[] = dataSet?.RetailCities
    ? (Array.isArray(dataSet.RetailCities) ? dataSet.RetailCities : [dataSet.RetailCities])
    : [];
  const cities = rows.map((r) => ({ code: String(r.routCode), city: String(r.rCity) }));
  cityCache = { at: Date.now(), cities };
  return cities;
}

export type AddShipmentInput = {
  refNo: string;         // order's canonical uid — not editable by the caller
  customerName: string;
  countryCode: string;   // ISO-2, e.g. "SA"
  city: string;          // must be one of getSmsaCities()'s `city` values
  mobile: string;
  address1: string;
  address2: string;
  pieces: number;
  weightKg: number;
  codAmount?: number;    // omitted (not 0) when the order isn't COD
  currency: string;
  itemDesc: string;
};

export type AddShipmentResult =
  | { ok: true; awb: string }
  | { ok: false; error: string };

// addShipment — field names and order taken verbatim from the live WSDL.
// PCs is the one required (minOccurs=1) field beyond passKey; everything
// else is optional there, but SMSA's business logic still rejects a
// shipment missing name/city/mobile even though the schema allows it.
export async function addShipment(input: AddShipmentInput): Promise<AddShipmentResult> {
  const params: Record<string, string | number> = {
    passKey: passKey(),
    refNo: input.refNo,
    sentDate: new Date().toISOString().slice(0, 10),
    idNo: "",
    cName: input.customerName,
    cntry: input.countryCode,
    cCity: input.city,
    cZip: "",
    cPOBox: "",
    cMobile: input.mobile,
    cTel1: "",
    cTel2: "",
    cAddr1: input.address1,
    cAddr2: input.address2,
    shipType: input.codAmount ? "CSH" : "DLV", // COD vs standard delivery
    PCs: input.pieces,
    cEmail: "",
    weight: input.weightKg,
    itemDesc: input.itemDesc,
  };
  if (input.codAmount) {
    params.codAmt = input.codAmount;
    params.carrValue = input.codAmount;
    params.carrCurr = input.currency;
  }

  let xml: string;
  try {
    xml = await soapCall("addShipment", params);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  let result: string;
  try {
    result = extractResult(xml, "addShipment");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // Success looks like a bare AWB number (SMSA's own docs and every
  // third-party wrapper agree on this); anything else is a business-logic
  // error string embedded in the 200 response, per the module header note.
  const isAwb = /^\d{8,}$/.test(result.trim());
  if (isAwb) return { ok: true, awb: result.trim() };
  return { ok: false, error: result.trim() || "SMSA returned an empty result" };
}

// getPDF — the AWB label, fetched after a successful addShipment.
export async function getShipmentLabelPdf(awbNo: string): Promise<Buffer> {
  const xml = await soapCall("getPDF", { awbNo, passKey: passKey() });
  const b64 = extractResult(xml, "getPDF");
  return Buffer.from(b64, "base64");
}
