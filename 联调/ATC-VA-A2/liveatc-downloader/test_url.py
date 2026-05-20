#!/usr/bin/env python
"""单 URL 测试工具：尝试用 httpx（和 cloudscraper 作为回退）请求给定的带签名 URL。

用法示例：
  .\.venv\Scripts\python test_url.py \
    --url "https://archive.liveatc.net/..mp3?md5=...&expires=..." \
    --cookie "_ga=...; cf_clearance=..."

输出：HTTP 状态码、响应头、前 1KB 响应体片段；若 200 则会保存文件到当前目录。
"""
import argparse
import sys
from urllib.parse import urlparse

try:
    import httpx
except Exception as e:
    print("缺少 httpx:", e)
    sys.exit(2)

try:
    import cloudscraper
    HAS_CLOUDSCRAPER = True
except Exception:
    HAS_CLOUDSCRAPER = False


def parse_cookie_string(cookie: str) -> dict:
    d = {}
    if not cookie:
        return d
    parts = [p.strip() for p in cookie.split(';') if p and '=' in p]
    for part in parts:
        k, v = part.split('=', 1)
        d[k.strip()] = v.strip()
    return d


def filename_from_url(url: str) -> str:
    p = urlparse(url)
    return p.path.split('/')[-1].split('?')[0] or 'downloaded.bin'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--url', required=True)
    p.add_argument('--cookie', default='')
    args = p.parse_args()

    url = args.url
    cookies = parse_cookie_string(args.cookie)
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.liveatc.net/',
    }

    print('尝试 httpx 请求...')
    try:
        with httpx.Client(headers=headers, cookies=cookies, follow_redirects=True, timeout=30.0) as client:
            r = client.get(url)
            print('状态:', r.status_code)
            print('Content-Type:', r.headers.get('content-type'))
            print('响应头样本:')
            for k in ('server', 'set-cookie', 'x-cache', 'cf-cache-status'):
                if k in r.headers:
                    print(f'  {k}:', r.headers[k])
            if r.status_code == 200 and r.content:
                fname = filename_from_url(url)
                open(fname, 'wb').write(r.content)
                print('文件已保存到', fname)
                return 0
            else:
                snippet = (r.text[:1024] if r.text else '')
                print('失败，状态码:', r.status_code)
                print('响应体前1KB:', snippet)
    except Exception as e:
        print('httpx 请求异常:', e)

    if HAS_CLOUDSCRAPER:
        print('\n尝试 cloudscraper 请求...')
        try:
            scraper = cloudscraper.create_scraper(
                browser={"browser": "chrome", "platform": "windows", "mobile": False}
            )
            if cookies:
                try:
                    scraper.cookies.update(cookies)
                except Exception:
                    scraper.headers['Cookie'] = '; '.join(f"{k}={v}" for k, v in cookies.items())
            resp = scraper.get(url, timeout=30)
            print('状态:', resp.status_code)
            for k in ('server', 'set-cookie', 'x-cache', 'cf-cache-status'):
                if k in resp.headers:
                    print(f'  {k}:', resp.headers[k])
            if resp.status_code == 200 and resp.content:
                fname = filename_from_url(url)
                open(fname, 'wb').write(resp.content)
                print('文件已保存到', fname)
                return 0
            else:
                print('失败，状态码:', resp.status_code)
                print('响应体前1KB:', (resp.text[:1024] if hasattr(resp, 'text') else ''))
        except Exception as e:
            print('cloudscraper 请求异常:', e)
    else:
        print('\ncloudscraper 未安装，无法执行 cloudscraper 回退')

    return 1


if __name__ == '__main__':
    raise SystemExit(main())
