import sys, collections, subprocess, os, time
T = int(sys.argv[2]); home = os.path.expanduser('~')
t0 = time.time()
counts = collections.Counter(); children = collections.defaultdict(set)
for line in open(sys.argv[1]):
    parts = line.rstrip('\n').split('/')
    for i in range(3, len(parts)):
        d = '/'.join(parts[:i]); counts[d] += 1
        if i > 3: children['/'.join(parts[:i-1])].add(d)
# usage signals: zoxide dirs + git repos whose HEAD reflog changed in 14 days
signals = set(l.strip().split(None,1)[1] for l in subprocess.run(['zoxide','query','-l','-s'],capture_output=True,text=True).stdout.splitlines())
now = time.time()
for repo in subprocess.run(['fd','-H','-t','d','^\\.git$',home,'--max-depth','6','--exclude','node_modules'],capture_output=True,text=True).stdout.splitlines():
    f = repo.rstrip('/') + '/logs/HEAD'
    if os.path.exists(f) and now - os.stat(f).st_mtime < 14*86400: signals.add(os.path.dirname(repo.rstrip('/')))
def touched(d): return any(s == d or s.startswith(d + '/') for s in signals)
large = []
def walk(d):
    if counts[d] > T and not touched(d): large.append((counts[d], d)); return
    for c in sorted(children[d]): walk(c)
walk(home)
print(f"T={T} walk+signals {1000*(time.time()-t0):.0f} ms, {len(signals)} signal dirs")
for c,d in sorted(large, reverse=True): print(f"  {c:7d} {d}")
if len(sys.argv) > 3:
    with open(sys.argv[3],'w') as out:
        for line in open(sys.argv[1]):
            p = line.rstrip('\n')
            if not any(p.startswith(d + '/') for c,d in large): out.write(line)
