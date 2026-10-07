// Importing this module registers every built connector. App code imports
// connector functions from "@/lib/connectors", never from ./runtime directly,
// so a provider is always registered before its rows are read.
import "./zoho";
import "./gmail";
import "./shopify";

export * from "./runtime";
export * from "./types";
export { allConnectors, getConnector } from "./registry";
export { startConnect, completeCallback, completePending, registerSyncHandler, runSync } from "./flow";
export { peekPendingAccounts } from "./oauth";
