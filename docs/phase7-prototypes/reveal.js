// Throwaway: for each prefix of a typed query, name hits (bands 0-3) vs content hits, to pick the content-reveal rule.
const fs = require("fs"), cp = require("child_process");
const HOME = process.env.HOME;
const files = fs.readFileSync("work.txt", "utf8").trim().split("\n").map(p => { const name = p.slice(p.lastIndexOf("/") + 1).toLowerCase(); const dot = name.lastIndexOf("."); return { name, stem: dot > 0 ? name.slice(0, dot) : name }; });
function subseq(q, s) { let i = 0; for (const c of s) if (c === q[i]) i++; return i === q.length; }
function nameHits(q) { let n = 0; for (const f of files) if (f.stem === q || f.name.includes(q) || subseq(q, f.name)) n++; return n; }
function contentHits(q) { const t0 = Date.now(); const out = cp.execFileSync("rg", ["-l", "-F", "-i", "-f", "-", "--max-filesize", "1M", "--ignore-file", `${__dirname}/ignore.txt`, "."], { cwd: HOME, input: q + "\n", maxBuffer: 1 << 26 }).toString(); return [out ? out.trim().split("\n").length : 0, Date.now() - t0]; }
// contains (not subsequence) name hits: the stricter count the gate could use
function containsHits(q) { let n = 0; for (const f of files) if (f.name.includes(q)) n++; return n; }
for (const q of ["frecency", "zoxide query", "omacast", "hyprland", "searchmatch", "Alt+Space", "copyright", "wagertech"]) {
  console.log(`\n${q}`); console.log("  prefix          subseq contains  content  ms   gate(<5 contains or space, >=3 chars)");
  for (let i = 1; i <= q.length; i++) { const p = q.slice(0, i).toLowerCase(); const [c, ms] = p.length >= 3 ? contentHits(p) : [NaN, 0]; const sh = nameHits(p), ch = containsHits(p);
    const gate = p.length >= 3 && (ch < 5 || p.includes(" ")); console.log(`  ${p.padEnd(16)} ${String(sh).padStart(6)} ${String(ch).padStart(8)} ${String(c).padStart(8)} ${String(ms).padStart(4)}   ${gate ? "SHOW" : "-"}`); }
}
