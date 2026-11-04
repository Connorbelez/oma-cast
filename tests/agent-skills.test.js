// Project skills live in .agents/skills (read by Codex and T3 Code) and are
// copied to .claude/skills (read by Claude Code). The copy is plain files, not a
// symlink, because `omarchy plugin validate` rejects symlinks inside a plugin.
// This keeps the two trees identical, executable bits included.
const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")

const root = path.join(__dirname, "..")
const source = path.join(root, ".agents", "skills")
const copy = path.join(root, ".claude", "skills")

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`${path.relative(root, full)} is a symlink`)
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full)]
  }).sort()
}

const sync = "rm -rf .claude/skills && mkdir -p .claude && cp -a .agents/skills .claude/skills"

test(".claude/skills holds the same files as .agents/skills", () => {
  assert.deepStrictEqual(walk(copy), walk(source), `skill trees differ; resync with: ${sync}`)
})

test("every copied skill file matches its source, mode included", () => {
  for (const file of walk(source)) {
    const a = path.join(source, file), b = path.join(copy, file)
    assert.ok(fs.existsSync(b), `${file} is missing from .claude/skills; resync with: ${sync}`)
    assert.ok(fs.readFileSync(a).equals(fs.readFileSync(b)), `${file} differs; resync with: ${sync}`)
    assert.strictEqual(fs.statSync(a).mode & 0o111, fs.statSync(b).mode & 0o111, `${file} executable bit differs`)
  }
})

test("every skill has frontmatter with a name matching its directory", () => {
  for (const name of fs.existsSync(source) ? fs.readdirSync(source) : []) {
    const text = fs.readFileSync(path.join(source, name, "SKILL.md"), "utf8")
    assert.match(text, /^---\n/, `${name}/SKILL.md has no frontmatter`)
    assert.match(text, new RegExp(`^name: ${name}$`, "m"), `${name}/SKILL.md name differs from its directory`)
    assert.match(text, /^description: \S/m, `${name}/SKILL.md has no description`)
  }
})
