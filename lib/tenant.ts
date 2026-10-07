/** The tenant every query is scoped to. One tenant per deployment today; the
 *  single seam where a request-scoped tenant plugs in for shared SaaS later. */
export function currentTenant(): string {
  return process.env.DEFAULT_TENANT_ID || "omnia";
}
