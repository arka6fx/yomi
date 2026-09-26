import assert from "node:assert/strict"
import { test } from "node:test"
import { MAX_SUBJECT, checkSubject } from "./commit-msg.mjs"

test("accepts short conventional subjects", () => {
  for (const ok of [
    "feat: add the docs palette",
    "fix(api): stop routines failing with 401",
    "chore(main): release 1.3.0",
    "feat(web)!: drop the old docs",
    "docs: explain D1 migrations",
    "fix: link the character picture credit (#152)",
  ]) {
    assert.deepEqual(checkSubject(ok), [], ok)
  }
})

test("lets git- and github-made subjects through", () => {
  for (const ok of ["Merge pull request #1 from a/b", 'Revert "feat: x"', "fixup! feat: x"]) {
    assert.deepEqual(checkSubject(ok), [], ok)
  }
})

test("rejects missing types, capitals, periods and long subjects", () => {
  assert.equal(checkSubject("added yomi mascot variations").length, 1)
  assert.match(checkSubject("feat: Add a thing")[0], /lowercase/)
  assert.match(checkSubject("fix: handle it.")[0], /period/)
  const long = `feat: ${"a".repeat(MAX_SUBJECT)}`
  assert.match(checkSubject(long)[0], /characters/)
})

test("does not count the pull request suffix", () => {
  const subject = `feat: ${"a".repeat(MAX_SUBJECT - 6)} (#1234)`
  assert.deepEqual(checkSubject(subject), [])
})

test("allows acronyms at the start of the summary", () => {
  assert.deepEqual(checkSubject("docs: README badges for CI"), [])
})
