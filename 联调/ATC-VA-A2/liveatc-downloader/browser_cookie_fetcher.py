from __future__ import annotations

import json
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

LIVEATC_URL = "https://www.liveatc.net/"

_EDGE_PATHS = (
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
)


def _format_cookie_header(cookies: list[dict]) -> str:
    pairs = [
        f"{cookie.get('name')}={cookie.get('value')}"
        for cookie in cookies
        if "liveatc" in (cookie.get("domain") or "")
    ]
    return "; ".join(pair for pair in pairs if pair and "None" not in pair)


def _has_cf_clearance(cookie_header: str) -> bool:
    return "cf_clearance=" in cookie_header


def _find_edge_exe() -> Path:
    for path in _EDGE_PATHS:
        if path.is_file():
            return path
    raise RuntimeError("Microsoft Edge not found on this machine")


def _pick_debug_port() -> int:
    for port in range(9222, 9232):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("No free local port for Edge remote debugging")


def _wait_cdp_ready(port: int, *, timeout_seconds: int = 45) -> None:
    url = f"http://127.0.0.1:{port}/json/version"
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                json.loads(resp.read().decode("utf-8"))
                return
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(0.5)
    raise RuntimeError("Edge remote debugging did not become ready in time")


def _wait_for_cf_clearance(context, *, wait_timeout_seconds: int) -> str:
    print("")
    print("In the Edge window: tick the Cloudflare checkbox and wait for LiveATC to load.")
    print("Cookie saves automatically when cf_clearance appears.")
    print(f"(timeout {wait_timeout_seconds}s)")
    print("")

    deadline = time.time() + wait_timeout_seconds
    last_cookie_count = -1
    while time.time() < deadline:
        try:
            cookies = context.cookies()
        except Exception as exc:  # noqa: BLE001
            err = str(exc).lower()
            if "closed" in err or "target" in err:
                raise RuntimeError(
                    "Edge window was closed before cf_clearance appeared. "
                    "Keep the window open until LiveATC loads, or use -Manual mode."
                ) from exc
            raise
        cookie_header = _format_cookie_header(cookies)
        if _has_cf_clearance(cookie_header):
            print("cf_clearance detected.")
            return cookie_header
        if len(cookies) != last_cookie_count:
            print(f"  waiting... ({len(cookies)} cookie(s) so far)")
            last_cookie_count = len(cookies)
        time.sleep(2)

    cookies = context.cookies()
    cookie_header = _format_cookie_header(cookies)
    if cookie_header:
        print("Timeout: saving cookies without cf_clearance (download may fail).")
        return cookie_header
    raise RuntimeError("Timeout: no LiveATC cookies found.")


def _export_via_native_edge(
    out_path: Path,
    *,
    auto_wait: bool,
    wait_timeout_seconds: int,
) -> str:
    """Launch real Edge (not Playwright-controlled) and attach over CDP."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("playwright is required to read cookies over CDP") from exc

    edge_exe = _find_edge_exe()
    profile_dir = out_path.parent / "edge-liveatc-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    port = _pick_debug_port()

    print(f"Launching native Edge (profile: {profile_dir.name}, port {port})")
    print("This is your normal Edge engine without Playwright automation flags.")

    proc = subprocess.Popen(  # noqa: S603
        [
            str(edge_exe),
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            LIVEATC_URL,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        _wait_cdp_ready(port)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            context = browser.contexts[0] if browser.contexts else browser.new_context()

            if auto_wait:
                cookie_header = _wait_for_cf_clearance(context, wait_timeout_seconds=wait_timeout_seconds)
            else:
                print("Complete verification, then press Enter.")
                input()
                cookie_header = _format_cookie_header(context.cookies())

            if not cookie_header:
                raise RuntimeError("No LiveATC cookies found in Edge session.")
            if not _has_cf_clearance(cookie_header):
                print("Warning: cf_clearance not found; download may still fail.")

            out_path.write_text(cookie_header, encoding="utf-8")
            return cookie_header
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()


def _launch_browser(playwright, *, headless: bool, channel: str | None = None):
    order: tuple[str | None, ...]
    if channel == "chromium":
        order = (None,)
    elif channel:
        order = (channel, "msedge", "chrome", None)
    else:
        order = ("msedge", "chrome", None)

    last_error: Exception | None = None
    for ch in order:
        label = ch or "playwright-chromium"
        try:
            kwargs: dict[str, object] = {"headless": headless}
            if ch:
                kwargs["channel"] = ch
            browser = playwright.chromium.launch(**kwargs)
            print(f"Browser: {label} (Playwright-controlled; Cloudflare may loop)")
            return browser
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            print(f"Could not launch {label}: {exc}")
    raise RuntimeError("No browser available for cookie export") from last_error


def _export_via_playwright(
    out_path: Path,
    *,
    headless: bool,
    timeout_seconds: int,
    browser_channel: str,
    auto_wait: bool,
    wait_timeout_seconds: int,
) -> str:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = _launch_browser(
            playwright,
            headless=headless,
            channel=browser_channel if browser_channel != "chromium" else "chromium",
        )
        context = browser.new_context()
        page = context.new_page()
        page.goto(LIVEATC_URL, wait_until="domcontentloaded", timeout=timeout_seconds * 1000)

        if auto_wait:
            cookie_header = _wait_for_cf_clearance(context, wait_timeout_seconds=wait_timeout_seconds)
        else:
            print("Complete verification, then press Enter.")
            input()
            cookie_header = _format_cookie_header(context.cookies())

        if not cookie_header:
            browser.close()
            raise RuntimeError("No LiveATC cookies found in the browser context.")

        out_path.write_text(cookie_header, encoding="utf-8")
        browser.close()
        return cookie_header


def export_liveatc_cookie(
    output_path: str,
    headless: bool = False,
    timeout_seconds: int = 120,
    *,
    browser_channel: str = "msedge",
    auto_wait: bool = True,
    wait_timeout_seconds: int = 600,
    native_edge: bool = True,
) -> str:
    """Export LiveATC cookies. Default: native Edge + CDP (avoids Cloudflare refresh loop)."""
    out_path = Path(output_path).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if native_edge and browser_channel == "msedge":
        return _export_via_native_edge(
            out_path,
            auto_wait=auto_wait,
            wait_timeout_seconds=wait_timeout_seconds,
        )

    return _export_via_playwright(
        out_path,
        headless=headless,
        timeout_seconds=timeout_seconds,
        browser_channel=browser_channel,
        auto_wait=auto_wait,
        wait_timeout_seconds=wait_timeout_seconds,
    )
