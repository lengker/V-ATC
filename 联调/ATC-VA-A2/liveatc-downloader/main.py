#!/usr/bin/env python3

from pathlib import Path
from cli import get_args
from liveatc import get_stations, download_archive, list_historical_archives, download_date_range
from datetime import datetime, timedelta
import sys
import os
from proxy_utils import load_proxy_pool, ProxyPool, redact_proxy

# Gets the last Zulu period of 30 minutes
# E.g. if time is 10:35:00, it will return 10:00:00
def get_last_zulu_period(date, minutes=30):
  return date - timedelta(minutes=minutes) - (date - datetime.min) % timedelta(minutes=minutes)


def resolve_cookie(args):
  if args.cookie:
    return args.cookie
  env_cookie = os.getenv("LIVEATC_COOKIE", "").strip()
  if env_cookie:
    return env_cookie
  if getattr(args, "cookie_file", None):
    content = Path(args.cookie_file).read_text(encoding="utf-8").strip()
    return content or None
  return None


def resolve_archive_base_url(args):
  value = getattr(args, "archive_base_url", None)
  if value:
    return value
  env_value = os.getenv("LIVEATC_ARCHIVE_BASE_URL", "").strip()
  return env_value or None


def resolve_proxy_pool(args):
  proxies = load_proxy_pool(getattr(args, "proxy", None), getattr(args, "proxy_file", None))
  mode = getattr(args, "proxy_mode", "round_robin")
  if proxies:
    pool = ProxyPool(proxies, mode=mode)
    print(f"已加载 {len(proxies)} 个代理，模式: {mode}")
    preview = ', '.join(redact_proxy(p) for p in proxies[:5])
    if preview:
      print(f"代理池预览: {preview}")
    return pool
  return None


def export_cookie(args):
  """Export LiveATC Cookie via a real browser session."""
  try:
    from browser_cookie_fetcher import export_liveatc_cookie
  except Exception as exc:
    print(f"错误: 未安装 playwright 或依赖缺失: {exc}", file=sys.stderr)
    print("请先执行: pip install -r requirements.txt && playwright install", file=sys.stderr)
    sys.exit(2)

  cookie = export_liveatc_cookie(
    output_path=args.output,
    headless=args.headless,
    timeout_seconds=args.timeout,
  )
  print(f"已保存 Cookie 到: {args.output}")
  print(f"Cookie 预览(截断): {cookie[:80]}{'...' if len(cookie) > 80 else ''}")


def stations(args):
  cookie = resolve_cookie(args)
  proxy_pool = resolve_proxy_pool(args)
  stations = get_stations(args.icao, user_agent=args.user_agent, cookie=cookie, proxy_pool=proxy_pool)
  for station in stations:
    print(f"[{station['identifier']}] - {station['title']}")

    for freq in station['frequencies']:
      print(f"\t{freq['title']} - {freq['frequency']}")

    print()


def download(args):
  """下载单个音频档案。"""
  cookie = resolve_cookie(args)
  archive_base_url = resolve_archive_base_url(args)
  proxy_pool = resolve_proxy_pool(args)
  date_now = datetime.utcnow()

  last_period = get_last_zulu_period(date_now)

  if not args.date and not args.time:
    date = last_period.strftime('%b-%d-%Y')
    time = last_period.strftime('%H%MZ')
  else:
    date = args.date if args.date else date_now.strftime('%b-%d-%Y')
    time = args.time if args.time else last_period.strftime('%H%MZ')

  result = download_archive(
    args.station,
    date,
    time,
    output_dir=args.output_dir,
    user_agent=args.user_agent,
    cookie=cookie,
    archive_base_url=archive_base_url,
    proxy_pool=proxy_pool,
  )
  
  if not result.get('success'):
    print(f"错误: {result.get('error', '未知错误')}", file=sys.stderr)
    sys.exit(1)
  else:
    print(f"成功下载: {result.get('filepath')}")


def list_archives(args):
  """列出特定电台的历史音频档案。"""
  cookie = resolve_cookie(args)
  archive_base_url = resolve_archive_base_url(args)
  proxy_pool = resolve_proxy_pool(args)
  print(f"获取 {args.station} 的历史档案列表...")
  
  archives = list_historical_archives(
    args.station,
    user_agent=args.user_agent,
    cookie=cookie,
    archive_base_url=archive_base_url,
    proxy_pool=proxy_pool,
  )
  
  if not archives:
    print("未找到档案")
    return
  
  print(f"\n找到 {len(archives)} 个档案:\n")
  for i, archive in enumerate(archives, 1):
    date_str = f"{archive.get('month', '')}-{archive.get('day', '')}-{archive.get('year', '')}"
    time_str = archive.get('time', '')
    filename = archive.get('filename', '')
    print(f"{i}. {filename} ({date_str} {time_str})")


def download_range(args):
  """下载指定日期范围内的音频。"""
  cookie = resolve_cookie(args)
  archive_base_url = resolve_archive_base_url(args)
  proxy_pool = resolve_proxy_pool(args)
  
  try:
    start_date = datetime.strptime(args.start_date, '%Y-%m-%d')
    end_date = datetime.strptime(args.end_date, '%Y-%m-%d')
  except ValueError as e:
    print(f"错误: 日期格式不正确: {e}", file=sys.stderr)
    print("请使用 YYYY-MM-DD 格式，例如: 2021-10-01", file=sys.stderr)
    sys.exit(1)
  
  if start_date > end_date:
    print("错误: 开始日期不能晚于结束日期", file=sys.stderr)
    sys.exit(1)
  
  times = None
  if args.times:
    times = args.times.split(',')
  
  print(f"将下载 {args.station} 从 {start_date.date()} 到 {end_date.date()} 的音频")
  if times:
    print(f"指定时间: {', '.join(times)}")
  
  results = download_date_range(
    args.station,
    start_date,
    end_date,
    output_dir=args.output_dir,
    user_agent=args.user_agent,
    cookie=cookie,
    archive_base_url=archive_base_url,
    times=times,
    proxy_pool=proxy_pool,
  )
  
  # 统计结果
  successful = sum(1 for r in results if r.get('success'))
  print(f"\n结果: {successful}/{len(results)} 成功下载")


if __name__ == '__main__':
  args = get_args()
  print(args)

  if args.command == 'stations':
    stations(args)
  elif args.command == 'download':
    download(args)
  elif args.command == 'list':
    list_archives(args)
  elif args.command == 'download-range':
    download_range(args)
  elif args.command == 'cookie':
    export_cookie(args)
