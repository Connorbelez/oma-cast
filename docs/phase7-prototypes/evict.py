import os, sys
n = 0
for line in open(sys.argv[1]):
    p = line.rstrip('\n')
    try:
        fd = os.open(p, os.O_RDONLY); os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED); os.close(fd); n += 1
    except OSError: pass
print(f"evicted {n}", file=sys.stderr)
