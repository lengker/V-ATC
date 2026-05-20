from __future__ import annotations

from pathlib import Path

LIVEATC_URL = "https://www.liveatc.net/"


def _format_cookie_header(cookies: list[dict]) -> str:
    pairs = [
        f"{cookie.get('name')}={cookie.get('value')}"
        for cookie in cookies
        if "liveatc" in (cookie.get("domain") or "")
    ]
    return "; ".join(pair for pair in pairs if pair and "None" not in pair)


def export_liveatc_cookie(output_path: str, headless: bool = False, timeout_seconds: int = 120) -> str:
    """Open a real browser session and export cookies to a file."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # pragma: no cover - optional dependency
        raise RuntimeError("playwright is required to export cookies") from exc

    out_path = Path(output_path).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=headless)
        context = browser.new_context()
        page = context.new_page()
        page.goto(LIVEATC_URL, wait_until="domcontentloaded", timeout=timeout_seconds * 1000)
        print("If the page shows a verification step, complete it in the browser window.")
        print("Press Enter here when the page is ready.")
        input()
        cookies = context.cookies()
        cookie_header = _format_cookie_header(cookies)
        if not cookie_header:
            browser.close()
            raise RuntimeError("No LiveATC cookies found in the browser context.")
        out_path.write_text(cookie_header, encoding="utf-8")
        browser.close()
        return cookie_header
