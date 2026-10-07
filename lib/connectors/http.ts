/* Tiny fetch helpers shared by connectors. They never throw on an HTTP status
 * — the connector decides what a status means (revoked vs transient). A body
 * that isn't JSON comes back as {}. */

type Result = { status: number; json: any };

async function parse(res: Response): Promise<Result> {
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

export async function postForm(url: string, body: Record<string, string>, headers: Record<string, string> = {}): Promise<Result> {
  return parse(await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...headers },
    body: new URLSearchParams(body),
    cache: "no-store",
  }));
}

export async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Result> {
  return parse(await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
    cache: "no-store",
  }));
}

export async function getJson(url: string, headers: Record<string, string> = {}): Promise<Result> {
  return parse(await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store" }));
}
