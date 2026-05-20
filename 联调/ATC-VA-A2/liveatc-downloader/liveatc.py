import re
from pathlib import Path
from urllib.parse import quote
from typing import Generator
from datetime import datetime, timedelta

import requests
from bs4 import BeautifulSoup

from proxy_utils import ProxyPool, redact_proxy

try:
    import cloudscraper
except Exception:
    cloudscraper = None


def _build_session(
    user_agent: str | None = None,
    cookie: str | None = None,
    proxy: str | None = None,
) -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": user_agent
                          or (
                              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
                          ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Referer": "https://www.liveatc.net/",
            "Upgrade-Insecure-Requests": "1",
        }
    )
    if cookie:
        session.headers["Cookie"] = cookie
    if proxy:
        session.proxies.update({"http": proxy, "https": proxy})
    return session


def _build_cloudscraper(
    user_agent: str | None = None,
    cookie: str | None = None,
    proxy: str | None = None,
):
    if cloudscraper is None:
        return None
    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "mobile": False}
    )
    scraper.headers.update(
        {
            "User-Agent": user_agent
                          or (
                              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
                          ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Referer": "https://www.liveatc.net/",
            "Upgrade-Insecure-Requests": "1",
        }
    )
    if cookie:
        scraper.headers["Cookie"] = cookie
    if proxy:
        scraper.proxies.update({"http": proxy, "https": proxy})
    return scraper


def _proxy_try_count(proxy_pool: ProxyPool | None) -> int:
    if not proxy_pool or not proxy_pool.proxies:
        return 1
    return min(3, len(proxy_pool.proxies))


def _pick_proxy(proxy_pool: ProxyPool | None) -> str | None:
    if not proxy_pool:
        return None
    return proxy_pool.pick()


def _request_liveatc(
    url: str,
    user_agent: str | None = None,
    cookie: str | None = None,
    proxy_pool: ProxyPool | None = None,
):
    # 第一步：先用普通 requests 尝试
    resp = None
    tries = _proxy_try_count(proxy_pool)
    for _ in range(tries):
        proxy = _pick_proxy(proxy_pool)
        if proxy:
            print(f"普通请求使用代理: {redact_proxy(proxy)}")
        session = _build_session(user_agent=user_agent, cookie=cookie, proxy=proxy)
        try:
            print("正在尝试普通请求...")
            session.get("https://www.liveatc.net/", timeout=20, allow_redirects=True)
            resp = session.get(url, timeout=20, allow_redirects=True)
            if resp.status_code == 200:
                print("普通请求成功！")
                return resp
            else:
                print(f"普通请求失败，状态码: {resp.status_code}")
        except Exception as e:
            print(f"普通请求发生异常: {e}")

    # 第二步：如果有提供Cookie，就不要再试cloudscraper了
    if cookie:
        print("已提供Cookie但仍然失败，请检查Cookie是否有效。")
        return resp

    # 第三步：尝试 cloudscraper（仅当没有提供Cookie时）
    print("正在尝试使用 cloudscraper 绕过 Cloudflare...")
    tries = _proxy_try_count(proxy_pool)
    for _ in range(tries):
        proxy = _pick_proxy(proxy_pool)
        if proxy:
            print(f"cloudscraper 使用代理: {redact_proxy(proxy)}")
        scraper = _build_cloudscraper(user_agent=user_agent, cookie=cookie, proxy=proxy)
        if scraper is None:
            print("错误: 未安装 cloudscraper，无法继续。")
            return resp

        try:
            scraper.get("https://www.liveatc.net/", timeout=20, allow_redirects=True)
            resp = scraper.get(url, timeout=20, allow_redirects=True)
            if resp.status_code == 200:
                print("cloudscraper 请求成功！")
                return resp
            else:
                print(f"cloudscraper 也失败了，状态码: {resp.status_code}")
        except Exception as e:
            print(f"cloudscraper 发生异常: {e}")

    print("建议使用手动Cookie或更换代理。")
    return resp


def get_stations(
    icao,
    user_agent: str | None = None,
    cookie: str | None = None,
    proxy_pool: ProxyPool | None = None,
) -> Generator[dict, None, None]:
    page = _request_liveatc(
        f'https://www.liveatc.net/search/?icao={icao}',
        user_agent=user_agent,
        cookie=cookie,
        proxy_pool=proxy_pool,
    )

    # --- 修复点 2: 检查 page 是否为空 ---
    if page is None:
        raise Exception("所有请求方式均失败，无法获取页面。")

    page.raise_for_status()
    soup = BeautifulSoup(page.content, 'html.parser')

    stations = soup.find_all('table', class_='body', border='0', padding=lambda x: x != '0')
    freqs = soup.find_all('table', class_='freqTable', colspan='2')

    for table, freqs in zip(stations, freqs):
        title = table.find('strong').text
        up = table.find('font').text == 'UP'
        href = table.find('a', href=lambda x: x and x.startswith('/archive.php')).attrs['href']

        identifier = re.findall(r'/archive.php\?m=([a-zA-Z0-9_]+)', href)[0]

        frequencies = []
        rows = freqs.find_all('tr')[1:]
        for row in rows:
            cols = row.find_all('td')
            freq_title = cols[0].text
            freq_frequency = cols[1].text

            frequencies.append({'title': freq_title, 'frequency': freq_frequency})

        yield {'identifier': identifier, 'title': title, 'frequencies': frequencies, 'up': up}


def _infer_archive_dir(station: str, archive_identifier: str) -> str:
    prefix = archive_identifier.split('-', 1)[0].strip().lower()
    if len(prefix) == 4 and prefix.isalnum():
        return prefix
    station_token = re.split(r'[_-]', station.strip().lower())[0]
    letters = ''.join(ch for ch in station_token if ch.isalpha())
    if len(letters) >= 4:
        return letters[:4]
    return station_token or "unknown"


def _download_with_session(url: str, path: Path, session) -> tuple[bool, str | None, int]:
    try:
        resp = session.get(url, timeout=30, allow_redirects=True, stream=True)
        if resp.status_code != 200:
            return False, f"HTTP {resp.status_code}", 0
        with open(path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 64):
                if chunk:
                    f.write(chunk)
        size = path.stat().st_size if path.exists() else 0
        if size == 0:
            return False, "下载的文件大小为 0", 0
        return True, None, size
    except Exception as e:
        return False, str(e), 0


def download_archive(
    station,
    date,
    time,
    output_dir=".",
    user_agent: str | None = None,
    cookie: str | None = None,
    archive_base_url: str | None = None,
    proxy_pool: ProxyPool | None = None,
) -> dict:
    """
    下载 LiveATC 历史音频文件。
    
    Args:
        station: 电台标识符，例如 'kpdx5'
        date: 日期，格式 'Oct-01-2021'
        time: Zulu 时间，格式 '2000Z'
        output_dir: 输出目录，默认为当前目录
        user_agent: 自定义 User-Agent
        cookie: 自定义 Cookie
    
    Returns:
        包含下载结果的字典，格式为:
        {
            'success': bool,
            'filename': str,
            'filepath': str,
            'url': str,
            'size': int (成功时),
            'error': str (失败时)
        }
    """
    try:
        # 获取档案页面
        page = _request_liveatc(
            f'https://www.liveatc.net/archive.php?m={station}',
            user_agent=user_agent,
            cookie=cookie,
            proxy_pool=proxy_pool,
        )

        if page is None:
            return {
                'success': False,
                'error': '所有请求方式均失败，无法获取页面'
            }

        page.raise_for_status()
        soup = BeautifulSoup(page.content, 'html.parser')
        
        # 查找选中的选项来获取档案标识符
        selected_option = soup.find('option', selected=True)
        if selected_option is None:
            return {
                'success': False,
                'error': '无法找到选中的电台选项'
            }
        
        archive_identifier = selected_option.attrs.get('value')
        if not archive_identifier:
            return {
                'success': False,
                'error': '选中的电台选项缺少 value 属性'
            }

        filename = f'{archive_identifier}-{date}-{time}.mp3'
        archive_dir = _infer_archive_dir(station=station, archive_identifier=archive_identifier)

        # 优先使用页面中带签名参数的真实下载链接（如果存在）
        signed_url = None
        for link in soup.find_all('a', href=True):
            href = link.get('href', '')
            text = link.get_text(strip=True)
            if filename in href or filename in text:
                base_url = (archive_base_url or "https://archive.liveatc.net").rstrip("/")
                if href.startswith('http'):
                    signed_url = href
                elif href.startswith('/'):
                    signed_url = f"{base_url}{href}"
                else:
                    signed_url = f"{base_url}/{href.lstrip('/')}"
                break

        # 创建输出目录
        out_dir = Path(output_dir).expanduser().resolve()
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / filename
        
        # 检查文件是否已存在
        if path.exists():
            return {
                'success': False,
                'filename': filename,
                'filepath': str(path),
                'error': '文件已存在'
            }
        
        # 构建下载 URL
        encoded_name = quote(filename, safe="-_.()")
        base_url = (archive_base_url or "https://archive.liveatc.net").rstrip("/")
        url = signed_url or f'{base_url}/{archive_dir}/{encoded_name}'
        print(f"正在下载: {url}")

        # 下载文件（支持代理轮换）
        tries = _proxy_try_count(proxy_pool)
        last_error = None
        for _ in range(tries):
            proxy = _pick_proxy(proxy_pool)
            if proxy:
                print(f"下载使用代理: {redact_proxy(proxy)}")
            session = _build_session(user_agent=user_agent, cookie=cookie, proxy=proxy)
            ok, err, size = _download_with_session(url, path, session)
            if ok:
                print(f"✓ 成功保存到: {path} ({size} 字节)")
                return {
                    'success': True,
                    'filename': filename,
                    'filepath': str(path),
                    'url': url,
                    'size': size
                }
            last_error = err
            if path.exists():
                path.unlink()

        # 如果没有 Cookie，再尝试 cloudscraper
        if not cookie and cloudscraper is not None:
            tries = _proxy_try_count(proxy_pool)
            for _ in range(tries):
                proxy = _pick_proxy(proxy_pool)
                if proxy:
                    print(f"cloudscraper 下载使用代理: {redact_proxy(proxy)}")
                scraper = _build_cloudscraper(user_agent=user_agent, cookie=cookie, proxy=proxy)
                if scraper is None:
                    break
                ok, err, size = _download_with_session(url, path, scraper)
                if ok:
                    print(f"✓ 成功保存到: {path} ({size} 字节)")
                    return {
                        'success': True,
                        'filename': filename,
                        'filepath': str(path),
                        'url': url,
                        'size': size
                    }
                last_error = err
                if path.exists():
                    path.unlink()

        return {
            'success': False,
            'filename': filename,
            'filepath': str(path),
            'url': url,
            'error': f'下载失败: {last_error or "未知错误"}'
        }

    except Exception as e:
        return {
            'success': False,
            'error': f'未预期的错误: {str(e)}'
        }


def list_historical_archives(
    station: str,
    user_agent: str | None = None,
    cookie: str | None = None,
    archive_base_url: str | None = None,
    proxy_pool: ProxyPool | None = None,
) -> list[dict]:
    """
    列出特定电台的所有可用历史音频档案。
    
    Args:
        station: 电台标识符
        user_agent: 自定义 User-Agent
        cookie: 自定义 Cookie
    
    Returns:
        包含档案信息的字典列表，每个字典包含:
        {
            'filename': str,
            'date': str,
            'time': str,
            'size': int (可选),
            'url': str
        }
    """
    try:
        page = _request_liveatc(
            f'https://www.liveatc.net/archive.php?m={station}',
            user_agent=user_agent,
            cookie=cookie,
            proxy_pool=proxy_pool,
        )

        if page is None:
            print("错误：无法获取档案列表页面")
            return []

        soup = BeautifulSoup(page.content, 'html.parser')
        archives = []

        # 从表格中提取档案链接
        base_url = (archive_base_url or "https://archive.liveatc.net").rstrip("/")
        for link in soup.find_all('a', href=re.compile(r'archive\.liveatc\.net|\.mp3')):
            href = link.get('href', '')
            text = link.get_text(strip=True)
            
            if '.mp3' not in href.lower():
                continue

            # 尝试从链接文本中提取日期和时间
            match = re.search(r'([A-Za-z]{3})-(\d{1,2})-(\d{4})-(\d{4})Z', text)
            if match:
                month, day, year, time = match.groups()
                archives.append({
                    'filename': text,
                    'month': month,
                    'day': day,
                    'year': year,
                    'time': time,
                    'url': href if href.startswith('http') else f"{base_url}{href}",
                })

        return archives

    except Exception as e:
        print(f"错误：无法列出档案: {str(e)}")
        return []


def download_date_range(
    station: str,
    start_date: datetime,
    end_date: datetime,
    output_dir: str = ".",
    user_agent: str | None = None,
    cookie: str | None = None,
    archive_base_url: str | None = None,
    times: list[str] | None = None,
    proxy_pool: ProxyPool | None = None,
) -> list[dict]:
    """
    下载指定日期范围内的历史音频。
    
    Args:
        station: 电台标识符
        start_date: 开始日期
        end_date: 结束日期
        output_dir: 输出目录
        user_agent: 自定义 User-Agent
        cookie: 自定义 Cookie
        times: 要下载的 Zulu 时间列表，例如 ['0000Z', '0030Z']。如果为 None，则下载所有时间
    
    Returns:
        下载结果列表
    """
    results = []
    current_date = start_date

    # 默认下载每小时的各种时段
    if times is None:
        times = [f"{h:02d}{m:02d}Z" for h in range(24) for m in (0, 30)]

    while current_date <= end_date:
        date_str = current_date.strftime('%b-%d-%Y')
        for time_str in times:
            try:
                print(f"\n下载 {station} {date_str} {time_str}...")
                result = download_archive(
                    station,
                    date_str,
                    time_str,
                    output_dir,
                    user_agent,
                    cookie,
                    archive_base_url=archive_base_url,
                    proxy_pool=proxy_pool,
                )
                results.append(result)
                if result['success']:
                    print(f"✓ 成功: {result['filename']}")
                else:
                    print(f"✗ 失败: {result.get('error', '未知错误')}")
            except Exception as e:
                print(f"✗ 异常: {str(e)}")
                results.append({'success': False, 'error': str(e)})

        current_date += timedelta(days=1)

    # 统计结果
    successful = sum(1 for r in results if r.get('success'))
    total = len(results)
    print(f"\n下载完成: {successful}/{total} 成功")
    
    return results