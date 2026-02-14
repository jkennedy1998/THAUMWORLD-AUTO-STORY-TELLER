import re
import sys
from pathlib import Path


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    root = Path("docs/plans")
    files = [
        p
        for p in root.rglob("*.md")
        if p.is_file() and p.name.lower() != "readme.md"
    ]
    pat = re.compile(r"^\s*[-*]\s*\[( |x|~)\]\s*(.*)$", re.IGNORECASE)

    for p in sorted(files, key=lambda x: x.as_posix()):
        total = 0
        done = 0
        impl = 0
        unchecked: list[tuple[int, str]] = []

        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), start=1):
            m = pat.match(line)
            if not m:
                continue
            total += 1
            state = m.group(1).lower()
            if state == "x":
                done += 1
            elif state == "~":
                impl += 1
            else:
                unchecked.append((i, m.group(2).strip()))

        if total == 0:
            print(f"{p.as_posix()} :: no task checkboxes")
            continue

        pct = (done / total) * 100.0
        print(f"{p.as_posix()} :: {done}x + {impl}~ / {total} total = {pct:.0f}% tested")
        for ln, txt in unchecked[:5]:
            print(f"  [ ] {ln}: {txt[:120]}")
        if len(unchecked) > 5:
            print(f"  ... {len(unchecked) - 5} more unchecked")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
