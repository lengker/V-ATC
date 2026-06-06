from __future__ import annotations

import subprocess
import sys
from pathlib import Path

LIVEATC_URL = "https://www.liveatc.net/archive.php?m=vhhh5"

_EDGE_PATHS = (
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
)


def _find_edge_exe() -> Path | None:
    for path in _EDGE_PATHS:
        if path.is_file():
            return path
    return None


def open_liveatc_in_user_edge() -> None:
    """Open LiveATC in the user's normal Edge profile (no automation flags)."""
    edge = _find_edge_exe()
    if edge:
        subprocess.Popen([str(edge), LIVEATC_URL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # noqa: S603
    else:
        import webbrowser

        webbrowser.open(LIVEATC_URL)
    print(f"Opened: {LIVEATC_URL}")


def prompt_and_save_cookie(output_path: str) -> str:
    out_path = Path(output_path).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print("")
    print("=== Copy Cookie from your normal Edge window ===")
    print("1. In the Edge window that just opened, wait until LiveATC loads (NOT the verify page)")
    print("2. Press F12 -> Network (网络) -> F5 refresh")
    print("3. Click the first archive.php request")
    print("4. Headers (标头) -> Request Headers -> copy the entire Cookie value")
    print("5. Paste below (must contain cf_clearance=...)")
    print("")

    cookie_line = input("Paste Cookie here: ").strip()
    if not cookie_line:
        raise RuntimeError("Empty cookie input.")

    if cookie_line.lower().startswith("cookie:"):
        cookie_line = cookie_line.split(":", 1)[1].strip()

    if "cf_clearance=" not in cookie_line:
        print("Warning: cf_clearance not found; download may fail.", file=sys.stderr)

    out_path.write_text(cookie_line, encoding="utf-8")
    preview = cookie_line[:72] + ("..." if len(cookie_line) > 72 else "")
    print(f"Saved to {out_path}")
    print(f"Preview: {preview}")
    return cookie_line


def main() -> int:
    output = sys.argv[1] if len(sys.argv) > 1 else "./.local/liveatc_cookie.txt"
    open_liveatc_in_user_edge()
    try:
        prompt_and_save_cookie(output)
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
