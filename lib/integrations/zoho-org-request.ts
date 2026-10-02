import { zohoOrgForBankLine, zohoOrgFromRequest } from "./zoho-org";

/** The books a supplier request reads or writes: the bank line's own
 *  statement account's when `?bankLine=` is given, else `?zohoOrg=`. */
export async function zohoOrgForSupplierRequest(req: Request): Promise<string> {
  const bankLine = (new URL(req.url).searchParams.get("bankLine") ?? "").trim();
  return bankLine ? zohoOrgForBankLine(bankLine) : zohoOrgFromRequest(req);
}
