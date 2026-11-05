const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const vm = require("node:vm")
const zlib = require("node:zlib")
const { spawnSync } = require("node:child_process")

const root = path.join(__dirname, "..")
const source = fs.readFileSync(path.join(root, "services/FileActions.qml"), "utf8")
const lister = fs.readFileSync(path.join(root, "services/FileLister.qml"), "utf8")

const has = (cmd) => spawnSync("bash", ["-c", 'command -v "$1"', "has", cmd]).status === 0

function qmlString(text, name) {
  return new Function("return " + text.match(new RegExp("property string " + name + ": ('(?:[^'\\\\]|\\\\.)*')"))[1])()
}

// FileActions' pure functions, run the way the QML runs them: each one
// sees the others through `actions`.
function fileActions() {
  const actions = {}
  for (const name of ["textLimit", "imageLimit", "lineLimit"]) actions[name] = Number(source.match(new RegExp("property int " + name + ": (\\d+)"))[1])
  const context = vm.createContext({ actions })
  for (const name of ["listedPath", "trashPath", "previewMode", "limitFor", "parsePreview", "imageSize", "svgSize"]) {
    const start = source.indexOf("\n  function " + name + "(")
    assert.ok(start >= 0, name)
    const end = source.indexOf("\n  }\n", start)
    actions[name] = vm.runInContext("(" + source.slice(start + 3, end + 4) + ")", context)
  }
  return actions
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omacast-actions-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function preview(file) {
  const actions = fileActions()
  const mode = actions.previewMode(path.basename(file))
  const limit = actions.limitFor(mode)
  const r = spawnSync("bash", ["-c", qmlString(source, "previewScript"), "omacast-preview", file, mode, String(limit)], { encoding: "utf8", timeout: 5000 })
  return { result: actions.parsePreview(file, mode, r.status === 0 ? r.stdout : "", limit), status: r.status, bytes: Buffer.byteLength(r.stdout) }
}

test("the trash takes only a listed file under the home dir", () => {
  const actions = fileActions()
  const rows = ["/home/u/notes b.txt", "/home/u2/other.txt", "/etc/hosts"].map((p) => ({ path: p }))
  assert.equal(actions.trashPath("/home/u/notes b.txt", rows, "/home/u"), "/home/u/notes b.txt")
  assert.throws(() => actions.trashPath("/home/u/unlisted.txt", rows, "/home/u"), /not in the file list/)
  assert.throws(() => actions.trashPath("/etc/hosts", rows, "/home/u"), /Only files under \/home\/u go to the Trash/)
  assert.throws(() => actions.trashPath("/home/u2/other.txt", rows, "/home/u"), /Only files under/)
  assert.throws(() => actions.trashPath("notes b.txt", rows, "/home/u"), /Expected an absolute path/)
})

test("gio trash moves a file whose name holds a space and a % with its .trashinfo, and the next listing leaves it out", { skip: !has("gio") || !has("rg") }, (t) => {
  const dir = tempDir(t)
  const home = path.join(dir, "home")
  const data = path.join(dir, "data")
  fs.mkdirSync(home)
  fs.mkdirSync(data)
  const file = path.join(home, "a b%c.txt")
  fs.writeFileSync(file, "trash me\n")
  fs.writeFileSync(path.join(home, "keep.txt"), "keep\n")
  const ignore = path.join(dir, "file-search.ignore")
  const untouched = path.join(dir, "untouched.ignore")
  fs.writeFileSync(ignore, "")
  fs.writeFileSync(untouched, "")
  const list = () => spawnSync("bash", ["-c", qmlString(lister, "listScript"), "omacast-files", home, ignore, untouched], { cwd: home, encoding: "utf8" }).stdout.split("\n").filter(Boolean).sort()
  assert.deepEqual(list(), [file, path.join(home, "keep.txt")])

  const argv = source.match(/command: \["gio", "trash", "--", trashRun\.path\]/)
  assert.ok(argv, "the trash runs gio trash -- <path>")
  const r = spawnSync("gio", ["trash", "--", file], { encoding: "utf8", env: { ...process.env, HOME: home, XDG_DATA_HOME: data } })
  assert.equal(r.status, 0, r.stderr)

  assert.equal(fs.existsSync(file), false)
  assert.equal(fs.readFileSync(path.join(data, "Trash/files/a b%c.txt"), "utf8"), "trash me\n")
  const info = fs.readFileSync(path.join(data, "Trash/info/a b%c.txt.trashinfo"), "utf8")
  const date = info.match(/DeletionDate=(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\n$/)
  assert.ok(date, info)
  assert.equal(info, "[Trash Info]\nPath=" + home.split("/").map(encodeURIComponent).join("/") + "/a%20b%25c.txt\nDeletionDate=" + date[1] + "\n")
  assert.deepEqual(list(), [path.join(home, "keep.txt")])
})

test("a text preview reads 64 KB at most and keeps the first 200 lines", (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, "long notes.md")
  fs.writeFileSync(file, Array.from({ length: 30000 }, (_, i) => "line " + (i + 1)).join("\n") + "\n")
  const { result, bytes } = preview(file)
  assert.equal(result.kind, "text")
  assert.equal(result.name, "long notes.md")
  assert.equal(result.dir, dir)
  assert.equal(result.size, fs.statSync(file).size)
  assert.equal(result.lines, 200)
  assert.equal(result.truncated, true)
  assert.equal(result.text.split("\n").length, 200)
  assert.ok(result.text.startsWith("line 1\nline 2\n"))
  assert.ok(result.text.endsWith("\nline 200"))
  assert.ok(bytes <= 65536 + 64, bytes)
})

test("a short text file shows whole, without a trailing empty line", (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, "README")
  fs.writeFileSync(file, "# Title\n\nbody\n")
  const { result } = preview(file)
  assert.deepEqual({ kind: result.kind, lines: result.lines, truncated: result.truncated, text: result.text }, { kind: "text", lines: 3, truncated: false, text: "# Title\n\nbody" })
})

test("a text file over 1 MB shows metadata only, and one at 1 MB shows its text", (t) => {
  const dir = tempDir(t)
  const over = path.join(dir, "over.log")
  const at = path.join(dir, "at.log")
  fs.writeFileSync(over, "x".repeat(1048577))
  fs.writeFileSync(at, "y".repeat(1048576))
  const big = preview(over)
  assert.equal(big.result.kind, "meta")
  assert.equal(big.result.size, 1048577)
  assert.equal(big.result.text, undefined)
  assert.ok(big.bytes < 100, big.bytes)
  assert.equal(preview(at).result.kind, "text")
})

test("binary content and binary extensions show metadata only", (t) => {
  const dir = tempDir(t)
  const blob = path.join(dir, "data.txt")
  fs.writeFileSync(blob, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 1, 2, 0, 3]))
  assert.equal(preview(blob).result.kind, "meta")
  const archive = path.join(dir, "backup.tar.gz")
  fs.writeFileSync(archive, "not read")
  const r = preview(archive)
  assert.equal(r.result.kind, "meta")
  assert.equal(r.result.size, 8)
})

test("a FIFO in the list is never opened", (t) => {
  const dir = tempDir(t)
  const fifo = path.join(dir, "pipe.txt")
  assert.equal(spawnSync("mkfifo", [fifo]).status, 0)
  const r = preview(fifo)
  assert.equal(r.status, 4)
  assert.equal(r.result.kind, "meta")
})

function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const raw = Buffer.alloc((width * 3 + 1) * height)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

test("an image reports its dimensions and a file URL Qt can load", { skip: !has("file") }, (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, "shot #1.png")
  fs.writeFileSync(file, png(3, 2))
  const { result } = preview(file)
  assert.deepEqual({ kind: result.kind, width: result.width, height: result.height }, { kind: "image", width: 3, height: 2 })
  assert.equal(result.imageSource, "file://" + dir.split("/").map(encodeURIComponent).join("/") + "/shot%20%231.png")
  const svg = path.join(dir, "logo.svg")
  fs.writeFileSync(svg, '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32"><rect width="4" height="4"/></svg>\n')
  assert.deepEqual((({ kind, width, height }) => ({ kind, width, height }))(preview(svg).result), { kind: "image", width: 48, height: 32 })
})

// Lines from `file -Lb`. JFIF prints its density before the pixel size,
// and a BMP its bit depth after it.
test("an image's dimensions come from its pixel size in file's output, never its density", () => {
  const actions = fileActions()
  const size = (info) => (({ width, height }) => ({ width, height }))(actions.parsePreview("/home/u/a.jpg", "image", "1000 1700000000\n" + info + "\n", actions.imageLimit))
  const cases = [
    ["JPEG image data, JFIF standard 1.01, aspect ratio, density 96x96, segment length 16, baseline, precision 8, 5120x2880, components 3", 5120, 2880],
    ["JPEG image data, JFIF standard 1.01, aspect ratio, density 1x1, segment length 16, baseline, precision 8, 4000x3000, components 3", 4000, 3000],
    ["JPEG image data, JFIF standard 1.01, resolution (DPI), density 300x300, segment length 16, baseline, precision 8, 640x480, components 3", 640, 480],
    ["JPEG image data, Exif standard: [TIFF image data, big-endian, direntries=12, height=3000, bps=0, PhotometricInterpretation=RGB, orientation=upper-left, width=4000], baseline, precision 8, 4000x3000, components 3", 4000, 3000],
    ["PNG image data, 1712 x 1158, 8-bit/color RGBA, non-interlaced", 1712, 1158],
    ["GIF image data, version 89a, 640 x 480", 640, 480],
    ["PC bitmap, Windows 3.x format, 100 x 100 x 24, image size 30000, resolution 2835 x 2835 px/m, cbSize 30054, bits offset 54", 100, 100],
    ["RIFF (little-endian) data, Web/P image, VP8 encoding, 640x480, Scaling: [none]x[none], YUV color, decoders should clamp", 640, 480],
    ["TIFF image data, little-endian, direntries=15, width=640, height=480, bps=8386, compression=none, PhotometricInterpretation=RGB, orientation=upper-left", 640, 480],
    ["TIFF image data, big-endian, direntries=14, height=300, bps=8, compression=none, width=200", 200, 300]
  ]
  for (const [info, width, height] of cases) assert.deepEqual(size(info), { width, height }, info)
  assert.deepEqual(size("JPEG image data"), { width: undefined, height: undefined })
})

function pdf(text) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ]
  const stream = "BT /F1 12 Tf 20 50 Td (" + text + ") Tj ET"
  objects[3] = "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream"
  let out = "%PDF-1.4\n"
  const offsets = objects.map((body, i) => { const at = out.length; out += (i + 1) + " 0 obj\n" + body + "\nendobj\n"; return at })
  const xref = out.length
  out += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n" + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")
  out += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n"
  return out
}

test("a PDF shows its first page's text through pdftotext", { skip: !has("pdftotext") }, (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, "report one.pdf")
  fs.writeFileSync(file, pdf("Hello from omacast"))
  const { result } = preview(file)
  assert.equal(result.kind, "pdf")
  assert.equal(result.text, "Hello from omacast")
  assert.equal(result.lines, 1)
})
