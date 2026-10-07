import type { ConnectorDef } from "./types";

/* provider → ConnectorDef. Providers register themselves on import; app code
 * imports "@/lib/connectors" (index.ts), which imports every provider. */

const defs = new Map<string, ConnectorDef>();

export function registerConnector(def: ConnectorDef): void {
  defs.set(def.provider, def);
}

export function getConnector(provider: string): ConnectorDef {
  const d = defs.get(provider);
  if (!d) throw new Error(`Unknown connector "${provider}"`);
  return d;
}

export function hasConnector(provider: string): boolean {
  return defs.has(provider);
}

export function allConnectors(): ConnectorDef[] {
  return [...defs.values()];
}
