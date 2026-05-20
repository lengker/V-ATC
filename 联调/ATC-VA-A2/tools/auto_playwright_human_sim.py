#!/usr/bin/env python3
"""自动化：在真实浏览器中模拟人类鼠标/键盘交互并导出 storage_state。

用途：尝试通过 Playwright 在 liveatc 页面上触发 Cloudflare 验证（Turnstile），并在成功后保存 storage_state（包含 cf_clearance）。

示例：
  python tools/auto_playwright_human_sim.py --profile "C:\\Users\\Lenovo\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 3" --out ./.local/liveatc_storage.json

注意：Turnstile 专为抵抗自动化设计，脚本只能尽力模拟人类行为。请在本地允许可视化浏览器并在需要时手动完成验证。
"""
import argparse
import json
import os
import random
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


def rand_delay(a=0.2, b=1.0):
    time.sleep(random.uniform(a, b))


def human_move_and_click(page, center_x, center_y, clicks=1):
    # 分段移动到目标位置并做轻微扰动
    steps = random.randint(8, 18)
    for _ in range(steps):
        x = center_x + random.uniform(-8, 8)
        y = center_y + random.uniform(-8, 8)
        page.mouse.move(x, y, steps=1)
        rand_delay(0.01, 0.08)
    for _ in range(clicks):
        page.mouse.down()
        rand_delay(0.03, 0.12)
        page.mouse.up()
        rand_delay(0.05, 0.2)


def human_scroll_and_read(page):
    # 随机滚动并停留
    try:
        view_h = page.viewport_size['height'] if page.viewport_size else 900
    except Exception:
        view_h = 900
    positions = [int(view_h * i / 4) for i in range(1, 4)]
    for p in positions:
        # 有时页面可能已被关闭或上下文失效，保护调用并在失败时退回到 JS 滚动
        try:
            if getattr(page, 'is_closed', lambda: False)() :
                return
            page.mouse.wheel(0, p)
        except Exception:
            try:
                # JS 滚动作为降级方案
                page.evaluate(f"() => window.scrollBy(0, {p})")
            except Exception:
                # 无法滚动则跳过
                return
        rand_delay(0.5, 1.6)


def try_interact_turnstile(page):
    # 试图找到 Turnstile iframe 并点击中心位置
    for elem in page.query_selector_all("iframe[src*='challenges.cloudflare.com']"):
        try:
            box_el = elem.bounding_box()
            if box_el:
                cx = box_el['x'] + box_el['width'] / 2
                cy = box_el['y'] + box_el['height'] / 2
                human_move_and_click(page, cx, cy)
                return True
        except Exception:
            continue
    return False


def run(args):
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser_type = p.chromium
        launch_kwargs = {}
        if args.channel:
            launch_kwargs['channel'] = args.channel

        context = None
        if args.profile:
            user_data = Path(args.profile)
            if user_data.exists() and user_data.is_file():
                user_data = user_data.parent
            user_data_dir = str(user_data)
            print(f"Using persistent profile: {user_data_dir}")
            context = browser_type.launch_persistent_context(user_data_dir, headless=args.headless, **launch_kwargs)
        elif args.storage_state and Path(args.storage_state).exists():
            browser = browser_type.launch(headless=args.headless, **launch_kwargs)
            context = browser.new_context(storage_state=str(args.storage_state))
        else:
            browser = browser_type.launch(headless=args.headless, **launch_kwargs)
            context = browser.new_context()

        page = context.new_page()
        page.set_default_navigation_timeout(args.timeout * 1000)

        target = args.url or 'https://www.liveatc.net/'
        print(f"Opening {target}")
        page.goto(target)

        rand_delay(0.6, 1.8)
        try:
            for _ in range(random.randint(3, 6)):
                try:
                    w = page.evaluate('() => window.innerWidth')
                    h = page.evaluate('() => window.innerHeight')
                except Exception:
                    w, h = 1200, 800
                x = random.uniform(w * 0.2, w * 0.8)
                y = random.uniform(h * 0.2, h * 0.8)
                human_move_and_click(page, x, y, clicks=1)
                rand_delay(0.4, 1.8)
                human_scroll_and_read(page)

            found = try_interact_turnstile(page)
            if found:
                print("Attempted Turnstile iframe interaction")
            else:
                print("No Turnstile iframe detected — still performing human-like interactions")

            page.keyboard.press('Tab')
            rand_delay(0.2, 0.6)
            page.keyboard.press('Tab')
            rand_delay(0.2, 0.6)
            page.keyboard.press('Enter')
            rand_delay(1.0, 2.4)

            wait_total = args.wait
            print(f"Waiting up to {wait_total}s for cf_clearance to appear...")
            seen = False
            for _ in range(int(max(1, wait_total / 2))):
                cookies = context.cookies()
                for c in cookies:
                    if c.get('name') == 'cf_clearance':
                        print('cf_clearance found in cookies')
                        seen = True
                        break
                if seen:
                    break
                rand_delay(1.0, 2.0)

            try:
                print(f"Saving storage_state to {out_path}")
                context.storage_state(path=str(out_path))
            except Exception as e:
                print(f"Failed to save storage_state: {e}")

            cookies = context.cookies()
            cf = [c for c in cookies if c.get('name') and 'cf' in c.get('name')]
            print('Cookies with cf*:')
            print(json.dumps(cf, indent=2))

        finally:
            try:
                context.close()
            except Exception:
                pass


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--profile', help='Chrome user data dir or profile path to use (优先)')
    p.add_argument('--storage-state', help='Existing storage_state json to load')
    p.add_argument('--out', default='.local/liveatc_storage.json', help='保存的 storage_state 路径')
    p.add_argument('--headless', action='store_true', help='以 headless 模式运行（建议 false）')
    p.add_argument('--timeout', type=int, default=30, help='导航超时（秒）')
    p.add_argument('--wait', type=int, default=60, help='在交互后等待 cf_clearance 的秒数')
    p.add_argument('--url', help='起始 URL，默认 https://www.liveatc.net/')
    p.add_argument('--channel', help='Playwright 浏览器 channel, e.g. chrome')
    return p.parse_args()


if __name__ == '__main__':
    args = parse_args()
    run(args)
