import argparse
import sys

parser = argparse.ArgumentParser(description='LiveATC 历史音频下载工具')

commands = parser.add_subparsers(title='command', dest='command', help='可用命令')

# stations 命令 - 列出机场的电台
parser_stations = commands.add_parser('stations', help='列出指定机场的所有电台')
parser_stations.add_argument('icao', help='机场 ICAO 代码，例如 KPDX 或 VHHH')
parser_stations.add_argument('--user-agent', help='自定义 User-Agent 头')
parser_stations.add_argument('--cookie', help='自定义 Cookie 头')
parser_stations.add_argument('--cookie-file', help='包含 Cookie 头值的文件路径')
parser_stations.add_argument('--proxy', help='代理池字符串（逗号或换行分隔）')
parser_stations.add_argument('--proxy-file', help='代理池文件路径（每行一个代理）')
parser_stations.add_argument('--proxy-mode', choices=['round_robin', 'random'], default='round_robin', help='代理轮换模式')

# download 命令 - 下载单个音频
parser_download = commands.add_parser('download', help='下载指定电台和时间的音频档案')
parser_download.add_argument('station', help='电台标识符，例如 kpdx_app')
parser_download.add_argument('-d', '--date', help='档案日期，格式 Oct-01-2021，默认为当前日期')
parser_download.add_argument('-t', '--time', help='档案 Zulu 时间，格式 0000Z，默认为当前时间')
parser_download.add_argument(
  '-o',
  '--output-dir',
  default='./downloads',
  help='下载目录，默认为 ./downloads'
)
parser_download.add_argument('--user-agent', help='自定义 User-Agent 头')
parser_download.add_argument('--cookie', help='自定义 Cookie 头')
parser_download.add_argument('--cookie-file', help='包含 Cookie 头值的文件路径')
parser_download.add_argument('--archive-base-url', help='覆盖历史归档域名（镜像）')
parser_download.add_argument('--proxy', help='代理池字符串（逗号或换行分隔）')
parser_download.add_argument('--proxy-file', help='代理池文件路径（每行一个代理）')
parser_download.add_argument('--proxy-mode', choices=['round_robin', 'random'], default='round_robin', help='代理轮换模式')

# list 命令 - 列出历史音频
parser_list = commands.add_parser('list', help='列出电台的历史音频档案')
parser_list.add_argument('station', help='电台标识符，例如 kpdx_app')
parser_list.add_argument('--user-agent', help='自定义 User-Agent 头')
parser_list.add_argument('--cookie', help='自定义 Cookie 头')
parser_list.add_argument('--cookie-file', help='包含 Cookie 头值的文件路径')
parser_list.add_argument('--archive-base-url', help='覆盖历史归档域名（镜像）')
parser_list.add_argument('--proxy', help='代理池字符串（逗号或换行分隔）')
parser_list.add_argument('--proxy-file', help='代理池文件路径（每行一个代理）')
parser_list.add_argument('--proxy-mode', choices=['round_robin', 'random'], default='round_robin', help='代理轮换模式')

# download-range 命令 - 下载日期范围内的音频
parser_download_range = commands.add_parser(
  'download-range',
  help='下载指定日期范围内的音频档案（注意：LiveATC 仅保存最近 30 天的档案）'
)
parser_download_range.add_argument('station', help='电台标识符，例如 kpdx_app')
parser_download_range.add_argument(
  '--start-date',
  required=True,
  help='开始日期，格式 YYYY-MM-DD，例如 2021-10-01'
)
parser_download_range.add_argument(
  '--end-date',
  required=True,
  help='结束日期，格式 YYYY-MM-DD，例如 2021-10-05'
)
parser_download_range.add_argument(
  '--times',
  help='要下载的 Zulu 时间列表，用逗号分隔，例如 0000Z,0030Z,0100Z。默认下载所有 30 分钟时段'
)
parser_download_range.add_argument(
  '-o',
  '--output-dir',
  default='./downloads',
  help='下载目录，默认为 ./downloads'
)
parser_download_range.add_argument('--user-agent', help='自定义 User-Agent 头')
parser_download_range.add_argument('--cookie', help='自定义 Cookie 头')
parser_download_range.add_argument('--cookie-file', help='包含 Cookie 头值的文件路径')
parser_download_range.add_argument('--archive-base-url', help='覆盖历史归档域名（镜像）')
parser_download_range.add_argument('--proxy', help='代理池字符串（逗号或换行分隔）')
parser_download_range.add_argument('--proxy-file', help='代理池文件路径（每行一个代理）')
parser_download_range.add_argument('--proxy-mode', choices=['round_robin', 'random'], default='round_robin', help='代理轮换模式')

# cookie 命令 - 使用浏览器导出 Cookie
parser_cookie = commands.add_parser('cookie', help='使用浏览器导出 LiveATC Cookie')
parser_cookie.add_argument(
  '--output',
  default='./.local/liveatc_cookie.txt',
  help='输出 Cookie 文件路径，默认为 ./.local/liveatc_cookie.txt'
)
parser_cookie.add_argument(
  '--headless',
  action='store_true',
  help='启用无头模式（默认关闭，便于手动完成验证）'
)
parser_cookie.add_argument(
  '--timeout',
  type=int,
  default=120,
  help='页面加载超时时间（秒），默认 120'
)


def get_args():
  return parser.parse_args(sys.argv[1:])
