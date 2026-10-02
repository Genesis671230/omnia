import { test } from "node:test";
import assert from "node:assert/strict";
import { undoActionFor } from "../../lib/finance/zoho-entry-delete";

test("Zoho undoes an entry by how it got into the books", () => {
  assert.equal(undoActionFor("manually_added"), "delete");
  assert.equal(undoActionFor("categorized"), "uncategorize");
  assert.equal(undoActionFor("matched"), "unmatch");
  assert.equal(undoActionFor(null), "delete");
});
