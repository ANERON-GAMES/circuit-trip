import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

test("source files import only sibling modules and perform no I/O", () => {
  const directory = new URL("../src/", import.meta.url);
  const names = readdirSync(directory).sort();
  assert.deepEqual(names, [
    "breaker.js",
    "constants.js",
    "duration.js",
    "index.js",
    "options.js",
    "state.js",
    "window.js"
  ]);
  for (const name of names) {
    const source = readFileSync(new URL(name, directory), "utf8");
    const specifiers = source.match(/from\s+"[^"]+"/g) ?? [];
    assert.equal(specifiers.length > 0 || name === "constants.js" || name === "duration.js", true);
    for (const specifier of specifiers) {
      assert.match(specifier, /^from "\.\/[a-z]+\.js"$/);
    }
    assert.equal(source.includes("node:"), false);
    assert.equal(source.includes("//"), false);
    assert.equal(source.includes("/*"), false);
    assert.equal(source.includes("*/"), false);
    for (const token of [
      "Date.now",
      "setTimeout",
      "setInterval",
      "setImmediate",
      "fetch(",
      "Math.random",
      "process.env"
    ]) {
      assert.equal(source.includes(token), false);
    }
  }
});
