import os
from pathlib import Path
from urllib.parse import quote

try:
    import cloudscraper
    from bs4 import BeautifulSoup
except Exception as e:
    print('缺少依赖:', e)
    raise

import os

# Cookie 必须通过环境变量提供，切勿硬编码在脚本中
COOKIE = os.environ.get('LIVEATC_COOKIE')
if not COOKIE:
    print('错误: 环境变量 LIVEATC_COOKIE 未设置，脚本将退出（不要将 Cookie 写入代码）。')
    raise SystemExit(1)

STATION = os.environ.get('LIVEATC_STATION', 'vhhh5')
OUT_DIR = Path('./downloads')
OUT_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
)

def _infer_archive_dir(station: str, archive_identifier: str) -> str:
    prefix = archive_identifier.split('-', 1)[0].strip().lower()
    if len(prefix) == 4 and prefix.isalnum():
        return prefix
    station_token = station.strip().lower().split('_')[0]
    letters = ''.join(ch for ch in station_token if ch.isalpha())
    if len(letters) >= 4:
        return letters[:4]
    return station_token or 'unknown'

scraper = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'windows', 'mobile': False})
scraper.headers.update({
    'User-Agent': USER_AGENT,
    'Cookie': COOKIE,
    'Referer': 'https://www.liveatc.net/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
})

# 会话预热：访问主页和搜索页以便 Cloudflare/站点设置会话 cookie
base_url = 'https://www.liveatc.net/'
search_url = f'https://www.liveatc.net/search/?icao=VHHH'
archive_page = f'https://www.liveatc.net/archive.php?m={STATION}'

for url in (base_url, search_url, archive_page):
    try:
        r = scraper.get(url, timeout=20)
        print('预热请求:', url, '->', r.status_code)
    except Exception as e:
        print('预热请求失败:', url, e)

# 再次请求 archive 页面并解析
resp = scraper.get(archive_page, timeout=30)
print('最终请求状态:', resp.status_code)
if resp.status_code >= 400:
    print('页面请求失败，状态码:', resp.status_code)
    raise SystemExit(1)

soup = BeautifulSoup(resp.text, 'html.parser')
selected = soup.find('option', selected=True)
if not selected:
    selected = soup.find('option')
if not selected:
    print('页面中没有 option 元素，无法确定档案标识符')
    raise SystemExit(1)

archive_identifier = selected.attrs.get('value')
print('archive_identifier:', archive_identifier)

# 尝试从页面中列举可用的 mp3 文件并下载首个匹配项（如果存在）
found = None
for a in soup.find_all('a', href=True):
    href = a['href']
    if '.mp3' in href.lower():
        if href.startswith('http'):
            found = href
        else:
            # 推测 archive 目录
            archive_dir = _infer_archive_dir(STATION, archive_identifier)
            fname = href.split('/')[-1]
            found = f'https://archive.liveatc.net/{archive_dir}/{quote(fname, safe="-_.()")}'
        break

if not found:
    # 作为回退，构造一个典型文件名并尝试下载
    filename = f'{archive_identifier}-{(Path().name)}-0000Z.mp3'
    archive_dir = _infer_archive_dir(STATION, archive_identifier)
    found = f'https://archive.liveatc.net/{archive_dir}/{quote(filename, safe="-_.()")}'

print('尝试下载 URL:', found)

out_path = OUT_DIR / found.split('/')[-1]
with scraper.get(found, stream=True, timeout=60) as r:
    print('下载响应状态:', r.status_code)
    if r.status_code >= 400:
        print('下载失败，状态码:', r.status_code)
        raise SystemExit(1)
    total = 0
    with open(out_path, 'wb') as f:
        for chunk in r.iter_content(chunk_size=8192):
            if not chunk:
                continue
            f.write(chunk)
            total += len(chunk)

print('下载完成，保存到:', out_path)
print('大小:', total)
