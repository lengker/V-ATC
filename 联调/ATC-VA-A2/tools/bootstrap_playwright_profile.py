#!/usr/bin/env python3
"""Interactive helper: launch a persistent Playwright browser for LiveATC

Usage: run this script, complete Cloudflare / Turnstile verification in the opened
browser window, then exit. The script will save storage state to the file path
specified below (default: ./.local/liveatc_storage.json).
"""
from pathlib import Path
import os
import sys
import shutil
import tempfile
import random
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    from playwright.sync_api import sync_playwright
except Exception as exc:
    raise SystemExit("playwright is required to run this helper") from exc

from app.core.config import settings
from app.services.proxy_provider import ProxyProvider

DEFAULT_STORAGE_PATH = Path('.').joinpath('.local', 'liveatc_storage.json')
DEFAULT_STORAGE_PATH.parent.mkdir(parents=True, exist_ok=True)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
)
ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9"


def split_user_data_profile(path_value: str) -> tuple[str, str | None]:
    path = Path(path_value).expanduser()
    if path.name.lower().startswith('profile') or path.name.lower() == 'default':
        return str(path.parent), path.name
    return str(path), None


def clone_user_data_root(user_data_root: str, profile_directory: str | None) -> tuple[str, str | None]:
    source_root = Path(user_data_root).expanduser()
    temp_root = Path(tempfile.mkdtemp(prefix='liveatc-playwright-profile-'))
    ignore_dirs = {
        'Extensions',
        'Cache',
        'Code Cache',
        'GPUCache',
        'GrShaderCache',
        'ShaderCache',
        'Shared Dictionary',
        'Service Worker',
        'DawnCache',
    }
    for item in source_root.iterdir():
        if item.name in {'.', '..'}:
            continue
        destination = temp_root / item.name
        if item.is_dir():
            if profile_directory and item.name.lower() not in {profile_directory.lower(), 'default'}:
                continue
            shutil.copytree(item, destination, dirs_exist_ok=True, ignore=shutil.ignore_patterns(*ignore_dirs))
        else:
            shutil.copy2(item, destination)
    return str(temp_root), profile_directory


def wait_for_clearance(context, timeout_seconds: int = 120) -> bool:
    deadline = timeout_seconds * 1000
    waited = 0
    while waited < deadline:
        try:
            cookies = context.cookies()
        except Exception:
            return False
        if any(cookie.get('name') == 'cf_clearance' for cookie in cookies):
            return True
        try:
            context.pages[0].wait_for_timeout(2000)
        except Exception:
            return False
        waited += 2000
    return False


def pick_static_proxy() -> str | None:
    if not settings.a2_proxy_enabled:
        return None
    proxy_file = Path(settings.a2_proxy_file)
    if not proxy_file.exists():
        return None
    proxies = []
    for line in proxy_file.read_text(encoding='utf-8').splitlines():
        normalized = ProxyProvider._normalize_proxy(line)
        if normalized:
            proxies.append(normalized)
    if not proxies:
        return None
    return random.choice(proxies)

def main(headless: bool = False, user_data_dir: str | None = None, storage_state_file: str | None = None, no_seed: bool = False):
    user_data_dir = user_data_dir or os.environ.get("A2_PLAYWRIGHT_USER_DATA_DIR", "").strip() or None
    storage_state_file = storage_state_file or os.environ.get("A2_PLAYWRIGHT_STORAGE_STATE_FILE", "").strip() or None
    out_path = Path(storage_state_file).expanduser() if storage_state_file else DEFAULT_STORAGE_PATH
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = None
        if user_data_dir:
            user_data_dir, profile_directory = split_user_data_profile(user_data_dir)
            cloned_user_data_dir, cloned_profile_directory = clone_user_data_root(user_data_dir, profile_directory)
            user_data_dir = cloned_user_data_dir
            profile_directory = cloned_profile_directory
            launch_args = [f'--profile-directory={profile_directory}'] if profile_directory else []
            print('Using user_data_dir:', user_data_dir)
            if profile_directory:
                print('Using profile_directory:', profile_directory)
            proxy = pick_static_proxy()
            if proxy:
                print('Using proxy:', proxy)
            ctx = p.chromium.launch_persistent_context(
                user_data_dir=user_data_dir,
                headless=headless,
                channel='chrome',
                user_agent=USER_AGENT,
                locale='zh-CN',
                extra_http_headers={'Accept-Language': ACCEPT_LANGUAGE},
                ignore_https_errors=True,
                args=launch_args,
                proxy={'server': proxy} if proxy else None,
            )
        else:
            proxy = pick_static_proxy()
            if proxy:
                print('Using proxy:', proxy)
            browser = p.chromium.launch(headless=headless, channel='chrome', proxy={'server': proxy} if proxy else None)
            # If --no-seed was passed, do not load any existing storage_state into
            # the new context; open a clean context to allow manual verification.
            storage_state_arg = None
            if not no_seed and storage_state_file and Path(storage_state_file).expanduser().exists():
                storage_state_arg = str(Path(storage_state_file).expanduser())
            ctx = browser.new_context(
                user_agent=USER_AGENT,
                locale='zh-CN',
                extra_http_headers={'Accept-Language': ACCEPT_LANGUAGE},
                ignore_https_errors=True,
                storage_state=storage_state_arg,
            )
        page = ctx.new_page()
        print('Opening https://www.liveatc.net/ — complete any verification in the browser.')
        page.goto('https://www.liveatc.net/')
        print('Waiting for cf_clearance to appear in cookies...')
        saved = False
        if wait_for_clearance(ctx, timeout_seconds=120):
            try:
                ctx.storage_state(path=str(out_path))
                print('Saved storage state to', out_path)
                saved = True
            except Exception as exc:
                print('Failed to save storage state:', exc)
        else:
            try:
                print('cf_clearance did not appear; waiting for ENTER as a fallback...')
                input()
            except (EOFError, KeyboardInterrupt):
                pass
        if not saved:
            try:
                ctx.storage_state(path=str(out_path))
                print('Saved storage state to', out_path)
            except Exception as exc:
                print('Failed to save storage state:', exc)
        try:
            ctx.close()
        except Exception:
            pass
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass

if __name__ == '__main__':
    head = False
    ud = None
    state = None
    no_seed = False
    if len(sys.argv) > 1:
        head = '--headless' in sys.argv
        no_seed = '--no-seed' in sys.argv
        for a in sys.argv[1:]:
            if a.startswith('--user-data='):
                ud = a.split('=',1)[1]
            if a.startswith('--profile='):
                ud = a.split('=',1)[1]
            if a.startswith('--storage-state='):
                state = a.split('=',1)[1]
    main(headless=head, user_data_dir=ud, storage_state_file=state, no_seed=no_seed)
