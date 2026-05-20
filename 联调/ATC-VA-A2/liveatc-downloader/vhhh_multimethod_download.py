#!/usr/bin/env python
"""
VHHH 机场历史音频多方式下载工具

尝试所有可能的方式下载 LiveATC VHHH 历史音频：
1. 直接 HTTP（带 Cookie）
2. cloudscraper 自动绕过 Cloudflare
3. 浏览器辅助 Cookie 导出
4. 多个存档镜像 URL
5. 最近时段文件自动生成
6. 并行重试机制

用法：
    python vhhh_multimethod_download.py
    python vhhh_multimethod_download.py --cookie "your-cookie-here"
    python vhhh_multimethod_download.py --export-cookie  # 启动浏览器导出
    python vhhh_multimethod_download.py --date 2024-10-28 --count 10
"""

import asyncio
import argparse
import os
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import quote, urlparse
import logging

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('./downloads/vhhh_download.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger(__name__)

try:
    import httpx
    from bs4 import BeautifulSoup
except ImportError:
    logger.error("缺少依赖: httpx 或 beautifulsoup4")
    sys.exit(1)

try:
    import cloudscraper
    HAS_CLOUDSCRAPER = True
except ImportError:
    HAS_CLOUDSCRAPER = False
    logger.warning("cloudscraper 未安装，某些功能不可用")

try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False
    logger.warning("playwright 未安装，浏览器辅助模式不可用")


# ============================================================================
# 常量定义
# ============================================================================

STATION_CODE = "vhhh5"  # VHHH 机场 APP 方向
ARCHIVE_BASE_URLS = [
    "https://archive.liveatc.net",
    "https://archive2.liveatc.net",  # 备用镜像（如有）
    "https://liveatc-archive.example.com",  # 用户可配置的镜像
]

ARCHIVE_IDENTIFIERS = [
    "VHHH5-App-Dep-Dir-Zone",  # 最常见的标识符
    "VHHH5-Ground",
    "VHHH5-Delivery",
    "VHHH5-Approach",
    "VHHH-Ground",
    "VHHH-Tower",
]

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

OUTPUT_DIR = Path("./downloads")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================================
# Cookie 管理
# ============================================================================

def resolve_cookie() -> Optional[str]:
    """从多个来源获取 Cookie（优先级：ENV -> 文件 -> None）"""
    
    # 1. 环境变量直接提供
    cookie = os.environ.get("LIVEATC_COOKIE", "").strip()
    if cookie:
        logger.info("从环境变量 LIVEATC_COOKIE 获取 Cookie")
        return cookie
    
    # 2. 从文件读取
    cookie_file = os.environ.get("LIVEATC_COOKIE_FILE", "./.local/liveatc_cookie.txt")
    cookie_path = Path(cookie_file)
    if cookie_path.exists():
        try:
            cookie = cookie_path.read_text(encoding='utf-8').strip()
            if cookie:
                logger.info(f"从文件 {cookie_file} 读取 Cookie")
                return cookie
        except Exception as e:
            logger.warning(f"无法读取 Cookie 文件：{e}")
    
    return None


def parse_cookie_string(cookie: str) -> dict:
    """把 Cookie header 字符串解析成字典，用于 httpx/cloudscraper 的 cookies 参数

    支持格式: "k1=v1; k2=v2; ..."
    """
    d: dict = {}
    if not cookie:
        return d

    parts = [p.strip() for p in cookie.split(';') if p and '=' in p]
    for part in parts:
        try:
            k, v = part.split('=', 1)
            d[k.strip()] = v.strip()
        except ValueError:
            continue
    return d


def cookie_dict_to_header(cookies: dict) -> str:
    return '; '.join(f"{k}={v}" for k, v in cookies.items())


def normalize_proxy(proxy: str) -> Optional[str]:
    if not proxy:
        return None
    proxy = proxy.strip()
    if not proxy:
        return None
    if '://' not in proxy:
        proxy = f"http://{proxy}"
    return proxy


def redact_proxy(proxy: str) -> str:
    try:
        parsed = urlparse(proxy)
        if parsed.hostname:
            scheme = parsed.scheme or 'http'
            port = f":{parsed.port}" if parsed.port else ''
            return f"{scheme}://{parsed.hostname}{port}"
    except Exception:
        pass
    if '@' in proxy:
        return proxy.split('@', 1)[1]
    return proxy


def load_proxy_pool(cli_proxy: Optional[str], cli_proxy_file: Optional[str]) -> list[str]:
    proxies: list[str] = []

    pool_str = (cli_proxy or os.environ.get('LIVEATC_PROXY_POOL', '')).strip()
    pool_file = (cli_proxy_file or os.environ.get('LIVEATC_PROXY_FILE', '')).strip()

    if pool_str:
        if '\n' in pool_str:
            parts = [p.strip() for p in pool_str.splitlines()]
        else:
            parts = [p.strip() for p in pool_str.split(',')]
        for p in parts:
            norm = normalize_proxy(p)
            if norm:
                proxies.append(norm)

    if pool_file:
        path = Path(pool_file)
        if path.exists():
            lines = [l.strip() for l in path.read_text(encoding='utf-8').splitlines()]
            for l in lines:
                norm = normalize_proxy(l)
                if norm:
                    proxies.append(norm)

    # 去重，保持顺序
    unique: list[str] = []
    seen = set()
    for p in proxies:
        if p not in seen:
            unique.append(p)
            seen.add(p)
    return unique


class ProxyPool:
    def __init__(self, proxies: list[str], mode: str = 'round_robin'):
        self.proxies = proxies
        self.mode = mode
        self._index = 0
        self._lock = asyncio.Lock()

    async def pick(self) -> Optional[str]:
        if not self.proxies:
            return None
        if self.mode == 'random':
            return random.choice(self.proxies)
        async with self._lock:
            proxy = self.proxies[self._index % len(self.proxies)]
            self._index += 1
            return proxy


async def preflight_session_establish(
    base_urls: list[str],
    cookie: Optional[str] = None,
    proxy_pool: Optional[ProxyPool] = None,
):
    """对 liveatc 和每个 archive base url 做简单的 GET 以建立会话和验证 Cookie 是否生效"""
    cookies = parse_cookie_string(cookie) if cookie else {}
    cookie_header = cookie_dict_to_header(cookies) if cookies else None

    headers = {
        "User-Agent": USER_AGENT,
        "Referer": "https://www.liveatc.net/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
    }

    # 访问主站以建立 cf_clearance 关联
    try:
        proxy = await proxy_pool.pick() if proxy_pool else None
        client_kwargs = {"timeout": 20.0}
        if proxy:
            client_kwargs["proxies"] = proxy
            logger.debug(f"预检使用代理: {redact_proxy(proxy)}")
        async with httpx.AsyncClient(**client_kwargs) as client:
            logger.info("预检: 访问 https://www.liveatc.net/ 建立会话")
            resp = await client.get("https://www.liveatc.net/", headers=headers, cookies=cookies, follow_redirects=True)
            logger.info(f"预检 liveatc 状态: {resp.status_code}")
            if resp.status_code != 200:
                logger.debug(f"预检 liveatc 响应头: {resp.headers}")
    except Exception as e:
        logger.debug(f"预检 liveatc 失败: {e}")

    # 对每个 archive base url 请求根路径
    for base in base_urls:
        try:
            proxy = await proxy_pool.pick() if proxy_pool else None
            client_kwargs = {"timeout": 20.0}
            if proxy:
                client_kwargs["proxies"] = proxy
                logger.debug(f"预检使用代理: {redact_proxy(proxy)}")

            async with httpx.AsyncClient(**client_kwargs) as client:
                url = base.rstrip('/') + '/'
                h = headers.copy()
                if cookie_header:
                    h['Cookie'] = cookie_header
                logger.info(f"预检: 访问 {url}")
                r = await client.get(url, headers=h, cookies=cookies, follow_redirects=True)
                logger.info(f"预检 {base} 状态: {r.status_code}")
                if r.status_code != 200:
                    logger.debug(f"预检 {base} 响应头: {r.headers}")
        except Exception as e:
            logger.debug(f"预检 {base} 失败: {e}")


def export_cookie_via_browser() -> Optional[str]:
    """通过浏览器手动导出 Cookie"""
    
    if not HAS_PLAYWRIGHT:
        logger.error("playwright 未安装，无法启动浏览器")
        return None
    
    logger.info("启动浏览器进行 Cookie 导出...")
    
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=False)
            context = browser.new_context()
            page = context.new_page()
            
            logger.info("正在访问 https://www.liveatc.net/")
            page.goto("https://www.liveatc.net/", wait_until="domcontentloaded", timeout=60000)
            
            logger.info("请在浏览器窗口中完成验证（如有），然后按 Enter 键继续...")
            input()
            
            # 获取所有 Cookie
            cookies = context.cookies()
            cookie_header = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
            
            # 保存到文件
            cookie_file = Path("./.local/liveatc_cookie.txt")
            cookie_file.parent.mkdir(parents=True, exist_ok=True)
            cookie_file.write_text(cookie_header, encoding='utf-8')
            
            browser.close()
            logger.info(f"Cookie 已保存到 {cookie_file}")
            return cookie_header
            
    except Exception as e:
        logger.error(f"浏览器导出失败: {e}")
        return None


# ============================================================================
# 文件候选生成
# ============================================================================

def generate_candidate_files(
    reference_date: Optional[datetime] = None,
    num_slots: int = 8
) -> list[Tuple[str, str, datetime]]:
    """生成候选历史音频文件名
    
    返回: [(identifier, filename, datetime), ...]
    """
    
    if reference_date is None:
        reference_date = datetime.utcnow()
    
    # 舍入到最近的 30 分钟时段
    minute_slot = (reference_date.minute // 30) * 30
    start_time = reference_date.replace(minute=minute_slot, second=0, microsecond=0)
    
    candidates = []
    
    for identifier in ARCHIVE_IDENTIFIERS:
        for slot_offset in range(num_slots):
            slot_time = start_time - timedelta(minutes=30 * slot_offset)
            
            # 文件名格式: IDENTIFIER-Mon-DD-YYYY-HHMM Z.mp3
            # 例: VHHH5-App-Dep-Dir-Zone-Oct-28-2024-1200Z.mp3
            filename = f"{identifier}-{slot_time.strftime('%b-%d-%Y-%H%MZ')}.mp3"
            candidates.append((identifier, filename, slot_time))
    
    logger.info(f"生成了 {len(candidates)} 个文件候选")
    return candidates


# ============================================================================
# 下载方法
# ============================================================================

async def download_with_httpx(
    url: str,
    cookie: Optional[str] = None,
    proxy: Optional[str] = None,
    timeout: float = 30.0
) -> Tuple[bool, Optional[bytes]]:
    """使用 httpx 直接下载（适合无 CF 保护的 URL）"""
    
    headers = {
        "User-Agent": USER_AGENT,
        "Referer": "https://www.liveatc.net/",
        "Accept": "audio/mpeg,application/octet-stream,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
    }
    
    cookies = parse_cookie_string(cookie) if cookie else {}
    try:
        client_kwargs = {"timeout": timeout}
        if proxy:
            client_kwargs["proxies"] = proxy
            logger.debug(f"httpx 使用代理: {redact_proxy(proxy)}")
        async with httpx.AsyncClient(**client_kwargs) as client:
            # 同时通过 cookies 参数和显式 Cookie 头发起请求
            cookie_header = cookie_dict_to_header(cookies) if cookies else None
            hdrs = headers.copy()
            if cookie_header:
                hdrs['Cookie'] = cookie_header

            response = await client.get(url, headers=hdrs, cookies=cookies, follow_redirects=True)

            if response.status_code == 200 and len(response.content) > 1000:
                logger.info(f"[OK] httpx 下载成功: {url} ({len(response.content)} bytes)")
                return True, response.content
            elif response.status_code == 403:
                # 记录部分响应体以便分析（安全考虑：仅记录前 1024 字节）
                body_snippet = response.text[:1024]
                logger.debug(f"[FAIL] httpx 遇到 403，响应头: {response.headers}")
                logger.debug(f"[FAIL] 响应体前段: {body_snippet}")
                return False, None
            else:
                logger.debug(f"[FAIL] httpx 返回状态码 {response.status_code}: {url}")
                return False, None
                
    except asyncio.TimeoutError:
        logger.debug(f"[FAIL] httpx 超时: {url}")
        return False, None
    except Exception as e:
        logger.debug(f"[FAIL] httpx 错误: {url} - {e}")
        return False, None


def download_with_cloudscraper(
    url: str,
    cookie: Optional[str] = None,
    proxy: Optional[str] = None,
    timeout: float = 30.0
) -> Tuple[bool, Optional[bytes]]:
    """使用 cloudscraper 绕过 Cloudflare"""
    
    if not HAS_CLOUDSCRAPER:
        logger.debug("cloudscraper 未安装，跳过此方法")
        return False, None
    
    headers = {
        "User-Agent": USER_AGENT,
        "Referer": "https://www.liveatc.net/",
        "Accept": "audio/mpeg,application/octet-stream,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
    }
    
    cookies = parse_cookie_string(cookie) if cookie else {}
    
    try:
        scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "mobile": False}
        )
        scraper.headers.update(headers)
        if proxy:
            scraper.proxies.update({"http": proxy, "https": proxy})
            logger.debug(f"cloudscraper 使用代理: {redact_proxy(proxy)}")
        if cookies:
            try:
                scraper.cookies.update(cookies)
            except Exception:
                # fallback: set Cookie header
                scraper.headers['Cookie'] = '; '.join(f"{k}={v}" for k, v in cookies.items())

        response = scraper.get(url, timeout=timeout, stream=False)
        
        if response.status_code == 200 and len(response.content) > 1000:
            logger.info(f"[OK] cloudscraper 下载成功: {url} ({len(response.content)} bytes)")
            return True, response.content
        else:
            logger.debug(f"[FAIL] cloudscraper 返回状态码 {response.status_code}: {url}")
            return False, None
            
    except Exception as e:
        logger.debug(f"[FAIL] cloudscraper 错误: {url} - {e}")
        return False, None


# ============================================================================
# 主下载流程
# ============================================================================

async def download_file(
    filename: str,
    base_urls: list[str],
    cookie: Optional[str] = None,
    proxy_pool: Optional[ProxyPool] = None,
    output_dir: Path = OUTPUT_DIR
) -> Tuple[bool, Optional[Path]]:
    """尝试从所有可用的 URL 下载文件
    
    策略：
    1. 对每个 base_url 构造完整 URL
    2. 先用 httpx 尝试（快）
    3. 失败则用 cloudscraper 尝试（慢但能绕 CF）
    4. 成功则保存并返回
    """
    
    encoded_filename = quote(filename, safe="-_.()")
    
    for base_url in base_urls:
        # 推断存档目录
        archive_dir = "vhhh"  # 或从 filename 推断
        full_url = f"{base_url}/{archive_dir}/{encoded_filename}"
        
        proxy = await proxy_pool.pick() if proxy_pool else None
        logger.info(f"尝试 httpx 下载: {full_url}")
        success, content = await download_with_httpx(full_url, cookie, proxy=proxy, timeout=30.0)
        
        if success and content:
            output_path = output_dir / filename
            output_path.write_bytes(content)
            logger.info(f"[OK] 文件已保存: {output_path}")
            return True, output_path
        
        # httpx 失败则尝试 cloudscraper
        proxy = await proxy_pool.pick() if proxy_pool else None
        logger.info(f"尝试 cloudscraper 下载: {full_url}")
        success, content = download_with_cloudscraper(full_url, cookie, proxy=proxy, timeout=30.0)
        
        if success and content:
            output_path = output_dir / filename
            output_path.write_bytes(content)
            logger.info(f"[OK] 文件已保存: {output_path}")
            return True, output_path
        
        # 该 URL 失败，尝试下一个
        logger.debug(f"[FAIL] 所有方法都失败了: {full_url}")
    
    logger.warning(f"[FAIL] 无法下载文件: {filename}")
    return False, None


async def download_multiple_files(
    candidates: list[Tuple[str, str, datetime]],
    base_urls: list[str],
    cookie: Optional[str] = None,
    proxy_pool: Optional[ProxyPool] = None,
    max_concurrent: int = 3,
    output_dir: Path = OUTPUT_DIR
) -> dict:
    """并行下载多个文件
    
    返回: {filename: (success, path), ...}
    """
    
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async def download_with_semaphore(filename):
        async with semaphore:
            return await download_file(filename, base_urls, cookie, proxy_pool, output_dir)
    
    # 只取文件名，去重
    unique_files = list(dict.fromkeys(filename for _, filename, _ in candidates))
    
    logger.info(f"开始下载 {len(unique_files)} 个文件（最多并发 {max_concurrent}）...")
    
    tasks = [download_with_semaphore(fname) for fname in unique_files]
    results = await asyncio.gather(*tasks)
    
    return {
        fname: result
        for fname, result in zip(unique_files, results)
    }


# ============================================================================
# 命令行接口
# ============================================================================

async def main():
    """主程序"""
    
    parser = argparse.ArgumentParser(
        description="VHHH 机场 LiveATC 历史音频多方式下载工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  python vhhh_multimethod_download.py
  python vhhh_multimethod_download.py --cookie "Cookie_xxxx"
  python vhhh_multimethod_download.py --export-cookie
  python vhhh_multimethod_download.py --date 2024-10-28 --count 10
        """
    )
    
    parser.add_argument(
        "--cookie",
        type=str,
        help="直接提供 Cookie 字符串（覆盖环境变量和文件）"
    )
    parser.add_argument(
        "--export-cookie",
        action="store_true",
        help="启动浏览器手动导出 Cookie"
    )
    parser.add_argument(
        "--cookie-file",
        type=str,
        default="./.local/liveatc_cookie.txt",
        help="Cookie 文件路径（默认: ./.local/liveatc_cookie.txt）"
    )
    parser.add_argument(
        "--date",
        type=str,
        help="参考日期 (YYYY-MM-DD)，默认为当前时间"
    )
    parser.add_argument(
        "--count",
        type=int,
        default=5,
        help="下载最近 N 个 30 分钟时段（默认: 5）"
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="./downloads",
        help="输出目录（默认: ./downloads）"
    )
    parser.add_argument(
        "--base-url",
        type=str,
        help="指定存档基 URL（覆盖默认）"
    )
    parser.add_argument(
        "--proxy",
        type=str,
        help="代理池字符串（逗号或换行分隔，例如: http://user:pass@ip:port, http://ip2:port）"
    )
    parser.add_argument(
        "--proxy-file",
        type=str,
        help="代理池文件路径（每行一个代理）"
    )
    parser.add_argument(
        "--proxy-mode",
        type=str,
        default="round_robin",
        choices=["round_robin", "random"],
        help="代理轮换模式（默认: round_robin）"
    )
    
    args = parser.parse_args()
    
    logger.info("=" * 70)
    logger.info("VHHH 机场历史音频多方式下载工具")
    logger.info("=" * 70)
    
    # ========================================================================
    # 第一步：获取或导出 Cookie
    # ========================================================================
    
    cookie = None
    
    if args.cookie_file:
        os.environ["LIVEATC_COOKIE_FILE"] = args.cookie_file

    if args.export_cookie:
        logger.info("► 模式: 浏览器辅助 Cookie 导出")
        cookie = await asyncio.to_thread(export_cookie_via_browser)
        if not cookie:
            logger.error("[FAIL] 浏览器导出失败")
            sys.exit(1)
    elif args.cookie:
        cookie = args.cookie
        logger.info("► 模式: 命令行提供的 Cookie")
    else:
        logger.info("► 模式: 自动检测 Cookie")
        cookie = resolve_cookie()
        if not cookie:
            logger.warning("[WARN] 未找到 Cookie，将尝试无 Cookie 下载（可能失败）")
    
    if cookie:
        logger.info(f"[OK] Cookie 已获取（长度: {len(cookie)} 字符）")
        parsed = parse_cookie_string(cookie)
        if 'cf_clearance' not in parsed:
            logger.warning("[WARN] Cookie 中未检测到 cf_clearance，Cloudflare 绕过可能仍然失败")
        else:
            logger.info("[OK] cf_clearance 检测到，已包含 Cloudflare 清除 token")
    
    # ========================================================================
    # 第二步：生成文件候选
    # ========================================================================
    
    try:
        if args.date:
            ref_date = datetime.strptime(args.date, "%Y-%m-%d")
        else:
            ref_date = None
    except ValueError:
        logger.error(f"[FAIL] 日期格式错误: {args.date}（应为 YYYY-MM-DD）")
        sys.exit(1)
    
    candidates = generate_candidate_files(ref_date, num_slots=args.count)
    logger.info(f"[OK] 生成了 {len(candidates)} 个文件候选")
    
    # ========================================================================
    # 第三步：准备下载列表
    # ========================================================================
    
    if args.base_url:
        base_urls = [args.base_url]
    else:
        base_urls = [url for url in ARCHIVE_BASE_URLS if url]
    
    logger.info(f"[OK] 将尝试 {len(base_urls)} 个存档 URL 来源")

    proxies = load_proxy_pool(args.proxy, args.proxy_file)
    proxy_pool = ProxyPool(proxies, mode=args.proxy_mode) if proxies else None
    if proxy_pool:
        logger.info(f"[OK] 已加载 {len(proxies)} 个代理（模式: {args.proxy_mode}）")
        logger.debug("代理池预览: " + ", ".join(redact_proxy(p) for p in proxies[:5]))
    else:
        logger.info("[INFO] 未配置代理池，将使用本机出口 IP")

    # 预检，尝试在下载文件前建立会话，确保 cf_clearance 等 Cookie 与主站关联
    await preflight_session_establish(base_urls, cookie=cookie, proxy_pool=proxy_pool)
    
    # ========================================================================
    # 第四步：开始下载
    # ========================================================================
    
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    results = await download_multiple_files(
        candidates,
        base_urls,
        cookie=cookie,
        proxy_pool=proxy_pool,
        max_concurrent=3,
        output_dir=output_dir
    )
    
    # ========================================================================
    # 第五步：总结报告
    # ========================================================================
    
    success_count = sum(1 for success, _ in results.values() if success)
    total_count = len(results)
    
    logger.info("=" * 70)
    logger.info(f"下载完成: {success_count}/{total_count} 成功")
    logger.info("=" * 70)
    
    if success_count > 0:
        logger.info("[OK] 成功下载的文件:")
        for fname, (success, path) in results.items():
            if success:
                logger.info(f"  • {path}")
    else:
        logger.warning("[FAIL] 未成功下载任何文件")
    
    sys.exit(0 if success_count > 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())
