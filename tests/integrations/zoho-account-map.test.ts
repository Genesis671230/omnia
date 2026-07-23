import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { mergeAccountMaps, missingMappingFor } from "@/lib/integrations/zoho-banking";

describe("mergeAccountMaps", () => {
  const env = {
    bankAccountId: "ENV_BANK",
    feeAccountId: "ENV_FEE",
    clearingByGateway: { Tabby: "ENV_TABBY", Tamara: "ENV_TAMARA" },
  };

  test("a saved mapping wins over env", () => {
    const m = mergeAccountMaps(env, { bankAccountId: "DB_BANK", feeAccountId: "DB_FEE", clearingByGateway: {} });
    assert.equal(m.bankAccountId, "DB_BANK");
    assert.equal(m.feeAccountId, "DB_FEE");
  });

  test("a field left blank in the UI falls back instead of blanking a working mapping", () => {
    const m = mergeAccountMaps(env, { bankAccountId: "", feeAccountId: "DB_FEE", clearingByGateway: {} });
    assert.equal(m.bankAccountId, "ENV_BANK");
    assert.equal(m.feeAccountId, "DB_FEE");
  });

  test("clearing accounts merge per gateway — mapping one must not unmap another", () => {
    const m = mergeAccountMaps(env, { clearingByGateway: { Tabby: "DB_TABBY" } });
    assert.equal(m.clearingByGateway.Tabby, "DB_TABBY", "the mapped one is overridden");
    assert.equal(m.clearingByGateway.Tamara, "ENV_TAMARA", "the untouched one survives");
  });

  test("no env and no db is an empty map, not a throw — the UI reports it", () => {
    const m = mergeAccountMaps(null, null);
    assert.deepEqual(m, {
      bankAccountId: "", feeAccountId: "", clearingByGateway: {},
      defaultIncomeAccountId: "", expenseAccountByKind: {},
    });
  });

  test("db alone is sufficient — env is not required once a mapping is saved", () => {
    const m = mergeAccountMaps(null, { bankAccountId: "B", feeAccountId: "F", clearingByGateway: { COD: "C" } });
    assert.equal(m.bankAccountId, "B");
    assert.equal(m.clearingByGateway.COD, "C");
  });
});

describe("missingMappingFor", () => {
  const full = { bankAccountId: "B", feeAccountId: "F", clearingByGateway: { Tabby: "T" } };

  test("a fully mapped gateway is ready", () => {
    assert.deepEqual(missingMappingFor("Tabby", full), []);
  });

  test("names the gateway whose clearing account is missing", () => {
    assert.deepEqual(missingMappingFor("Tamara", full), ["Tamara clearing account"]);
  });

  test("reports every missing piece at once rather than one per attempt", () => {
    const missing = missingMappingFor("COD", { bankAccountId: "", feeAccountId: "", clearingByGateway: {} });
    assert.deepEqual(missing, ["bank account", "fee account", "COD clearing account"]);
  });
});
