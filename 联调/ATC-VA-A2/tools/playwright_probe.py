#!/usr/bin/env python3
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

STORAGE = Path('.').joinpath('.local', 'liveatc_storage.json')
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
)
ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9"

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        storage = str(STORAGE) if STORAGE.exists() else None
        ctx = browser.new_context(user_agent=USER_AGENT, extra_http_headers={"Accept-Language": ACCEPT_LANGUAGE}, storage_state=storage, ignore_https_errors=True)
        last_request_headers = None
        def on_request(req):
            nonlocal last_request_headers
            try:
                last_request_headers = req.headers
            except Exception:
                last_request_headers = None

        page = ctx.new_page()
        page.on('request', on_request)
        root = 'https://www.liveatc.net/'
        print('Navigating to root', root)
        try:
            page.goto(root, wait_until='networkidle', timeout=120000)
        except Exception as exc:
            print('Root navigation failed:', exc)
        url = 'https://www.liveatc.net/search/?icao=VHHH'
        print('Navigating to', url)
        try:
            resp = page.goto(url, wait_until='networkidle', timeout=120000, referer=root)
            status = resp.status if resp else None
            length = len(page.content()) if page else 0
            print('status=', status, 'content_len=', length)
            snippet = page.content()[:2000]
            print('---HTML snippet---')
            print(snippet)
        except Exception as exc:
            print('Navigation failed:', exc)
            try:
                # save current page screenshot for debugging
                out = Path('.').joinpath('.local','probe_screenshot.png')
                page.screenshot(path=str(out), full_page=True)
                print('Saved screenshot to', out)
            except Exception:
                pass
        print('\n---Captured request headers---')
        if last_request_headers:
            for k, v in last_request_headers.items():
                print(k, v)
        else:
            print('No request headers captured')
        print('\n---Context cookies---')
        try:
            cookies = ctx.cookies()
            print(json.dumps(cookies, indent=2))
        except Exception as e:
            print('Failed to read cookies:', e)
        # Save a screenshot for inspection
        out = Path('.').joinpath('.local','probe_screenshot.png')
        out.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(out), full_page=True)
        print('Saved screenshot to', out)
        try:
            ctx.close()
        except Exception:
            pass
        try:
            browser.close()
        except Exception:
            pass

if __name__ == '__main__':
    main()
