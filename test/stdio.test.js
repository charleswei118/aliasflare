import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../bin/aliasflare-mcp.js";

test("stdio server introspects without config", async () => {
  const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.result.serverInfo.name, "aliasflare");
  const list = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.ok(list.result.tools.some((t) => t.name === "create_alias"));
});

test("tool call without config returns a tool error", async () => {
  const r = await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_aliases", arguments: {} } });
  assert.equal(r.result.isError, true);
});
