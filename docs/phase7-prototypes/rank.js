// Throwaway: compares three usage-vs-band policies on the real working list.
const fs = require("fs");
const HOME = process.env.HOME;
const files = fs.readFileSync("mtimes.txt", "utf8").trim().split("\n").map(l => {
  const [mtime, size, ...rest] = l.split(" "); const path = rest.join(" ");
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf("."); const stem = dot > 0 ? name.slice(0, dot) : name;
  return { path, dir: path.slice(0, path.lastIndexOf("/")), name, lname: name.toLowerCase(), lstem: stem.toLowerCase(), mtime: +mtime };
});
const NOW = Date.now() / 1000;
// Real signals on this machine
const zoxide = { [`${HOME}/Projects/oma-cast`]: 2.0, [`${HOME}/Projects`]: 2.0, [`${HOME}/Dev/sales-crm`]: 0.8, [`${HOME}/Dev`]: 0.8, [`${HOME}/Work`]: 0.8, [`${HOME}/Work/cms-crm`]: 0.5, [`${HOME}/Work/cms-crm/wagertech-cms-v2`]: 0.2, [`${HOME}/Work/tries`]: 0.2 };
const activeRepos = [`${HOME}/Projects/oma-cast`, `${HOME}/Applications/uml-viewer`, `${HOME}/Dev/sales-crm`, `${HOME}/wagertech/cmsv2/wagertech-cms-v2-migration`];
// Synthetic omacast frecency for the scenarios (score = +100 per open, decayed; two opens = 200)
const frecency = {
  [`${HOME}/Dev/sales-crm/package.json`]: 200,
  [`${HOME}/p3-stack/skills/how/SKILL.md`]: 200,
  [`${HOME}/Work/cms-crm/wagertech-cms-v2/views/cms/partials/pager.ejs`]: 2000, // heavily used file whose name only subsequence-matches "launch"? no: used for the lift test below
};
const liftVictim = files.find(f => !f.path.includes("oma-cast") && /l.*a.*u.*n.*c.*h/.test(f.lname) && !/(^|[-_. ])launch/.test(f.lname));
if (liftVictim) frecency[liftVictim.path] = 2000;
const specVictim = files.find(f => f.lname.startsWith("spec") && f.lstem !== "spec");
if (specVictim) frecency[specVictim.path] = 5000;
console.log("spec victim:", specVictim && specVictim.path.replace(HOME + "/", ""));

// Folder prior: zoxide + active repo + decayed sum of descendants' frecency; a file inherits the nearest ancestor's weight, decayed by distance
const dirScore = {};
for (const [d, s] of Object.entries(zoxide)) dirScore[d] = (dirScore[d] || 0) + s;
for (const d of activeRepos) dirScore[d] = (dirScore[d] || 0) + 2;
for (const [p, s] of Object.entries(frecency)) { let d = p; while ((d = d.slice(0, d.lastIndexOf("/"))).length > HOME.length) dirScore[d] = (dirScore[d] || 0) + Math.log1p(s / 100); }
function prior(f) { let d = f.dir, dist = 0; while (d.length >= HOME.length) { if (dirScore[d]) return dirScore[d] / (1 + 0.5 * dist); d = d.slice(0, d.lastIndexOf("/")); dist++; } return 0; }
function recency(f) { const days = (NOW - f.mtime) / 86400; return Math.pow(0.5, days / 30); }
function usage(f) { return 1.0 * Math.log1p((frecency[f.path] || 0) / 100) + 0.5 * recency(f) + 0.5 * prior(f); }

// Bands on the file name: 0 exact, 1 prefix, 2 word start, 3 subsequence, 4 path-only (every word hits a path segment, last word hits the name)
function subseq(q, s) { let i = 0; for (const c of s) if (c === q[i]) i++; return i === q.length; }
function wordStart(q, s) { return new RegExp("(^|[-_. ])" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(s); }
function band(q, f) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 1) { const w = words[0];
    if (f.lname === w || f.lstem === w) return 0; if (f.lname.startsWith(w)) return 1; if (wordStart(w, f.lname)) return 2; if (subseq(w, f.lname)) return 3; return -1; }
  if (words.every(w => wordStart(w, f.lname))) return 2;
  const last = words[words.length - 1]; if (!(f.lname.startsWith(last) || wordStart(last, f.lname) || f.lstem === last)) return -1;
  const segs = f.dir.slice(HOME.length + 1).toLowerCase().split("/");
  return words.slice(0, -1).every(w => segs.some(s => s.startsWith(w) || wordStart(w, s))) ? 4 : -1;
}
const policies = {
  A_strict: (b, u) => [b, -u],
  B_lift1:  (b, u, f) => [(frecency[f.path] || 0) >= 100 && b > 1 ? b - 1 : b, -u],   // one direct open within the half-life moves up one band, never into exact
  C_blend:  (b, u) => [0, -( (5 - b) * 0.8 + u )],                     // single score, bands worth 0.8 each
};
const queries = [
  ["spec", "Projects/oma-cast/SPEC.md"], ["oma spec", "Projects/oma-cast/SPEC.md"], ["claude", "Projects/oma-cast/CLAUDE.md"],
  ["readme", "Projects/oma-cast/README.md"], ["launcher", "Projects/oma-cast/Launcher.qml"], ["rootsearch", "Projects/oma-cast/core/RootSearch.js"],
  ["package json", "Dev/sales-crm/package.json"], ["package", "Dev/sales-crm/package.json"], ["skill", "p3-stack/skills/how/SKILL.md"],
  ["sales readme", "Dev/sales-crm/README.md"], ["app tsx", "Dev/sales-crm"], ["launch", "Projects/oma-cast/Launcher.qml"], ["cms users", "Work/cms-crm/wagertech-cms-v2/src/modules/cms-auth/domain/cms-users.rules.ts"],
];
console.log("lift victim:", liftVictim && liftVictim.path.replace(HOME + "/", ""));
console.log("query".padEnd(14), "hits".padStart(5), "A", "B", "C", "  (rank of expected target, 1 = first)");
for (const [q, expect] of queries) {
  const t0 = process.hrtime.bigint();
  const matched = files.map(f => ({ f, b: band(q, f) })).filter(m => m.b >= 0).map(m => ({ ...m, u: usage(m.f) }));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const ranks = Object.entries(policies).map(([n, key]) => {
    const sorted = [...matched].sort((x, y) => { const a = key(x.b, x.u, x.f), b = key(y.b, y.u, y.f); return a[0] - b[0] || a[1] - b[1] || x.f.lname.length - y.f.lname.length; });
    const i = sorted.findIndex(m => m.f.path.replace(HOME + "/", "").startsWith(expect)); return i < 0 ? "-" : String(i + 1);
  });
  console.log(q.padEnd(14), String(matched.length).padStart(5), ...ranks.map(r => r.padStart(2)), `  ${ms.toFixed(1)} ms`);
  if (["launch","spec","readme","sales readme"].includes(q)) { for (const [n, key] of Object.entries(policies)) { const s = [...matched].sort((x, y) => { const a = key(x.b, x.u, x.f), b = key(y.b, y.u, y.f); return a[0] - b[0] || a[1] - b[1]; }); console.log("   ", n, s.slice(0, 4).map(m => `${m.f.name}[b${m.b} u${m.u.toFixed(1)}]`).join("  ")); } }
}
