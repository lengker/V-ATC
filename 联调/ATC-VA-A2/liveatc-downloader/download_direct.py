import os
from pathlib import Path

try:
    import cloudscraper
except Exception as e:
    print('缺少依赖:', e)
    raise

URL = os.environ.get('LIVEATC_URL')
COOKIE = os.environ.get('LIVEATC_COOKIE')
OUT_DIR = Path('./downloads')
OUT_DIR.mkdir(parents=True, exist_ok=True)

if not URL:
    print('错误: 请在环境变量 LIVEATC_URL 中提供要下载的 URL')
    raise SystemExit(1)
if not COOKIE:
    print('错误: 请在环境变量 LIVEATC_COOKIE 中提供 Cookie')
    raise SystemExit(1)

USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
)

scraper = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'windows', 'mobile': False})
headers = {
    'User-Agent': USER_AGENT,
    'Cookie': COOKIE,
    'Referer': 'https://www.liveatc.net/',
    'Accept': 'audio/mpeg,application/octet-stream,*/*;q=0.8',
}

print('开始请求 URL（不会打印 Cookie）')
with scraper.get(URL, headers=headers, stream=True, timeout=60) as r:
    print('响应状态码:', r.status_code)
    if r.status_code >= 400:
        print('请求被拒绝或返回错误状态码')
        raise SystemExit(1)
    fname = Path(URL).name
    out_path = OUT_DIR / fname
    total = 0
    with open(out_path, 'wb') as f:
        for chunk in r.iter_content(chunk_size=8192):
            if not chunk:
                continue
            f.write(chunk)
            total += len(chunk)

print('下载完成，保存到:', out_path)
print('大小:', total)
