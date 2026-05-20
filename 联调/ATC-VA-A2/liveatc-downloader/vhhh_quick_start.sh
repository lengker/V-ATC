#!/usr/bin/env bash
# VHHH 多方式下载快速参考卡片
# 
# 将此文件另存为 vhhh_quick_start.sh 并运行：
#   bash vhhh_quick_start.sh
#   或
#   chmod +x vhhh_quick_start.sh && ./vhhh_quick_start.sh

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DOWNLOADS_DIR="${SCRIPT_DIR}/downloads"
COOKIE_FILE="${SCRIPT_DIR}/.local/liveatc_cookie.txt"
LOCAL_MIRROR="${LIVEATC_LOCAL_MIRROR:-}"

echo "+================================================================+"
echo "|      VHHH 香港机场 LiveATC 历史音频多方式下载                  |"
echo "|          Multi-Method VHHH Historical Audio Downloader        |"
echo "+================================================================+"
echo ""

# 显示菜单
show_menu() {
    echo ""
    echo "请选择下载方式 (Choose download method):"
    echo ""
    echo "  [1] 快速下载 - 使用现有 Cookie（Fast - Use existing Cookie）"
    echo "  [2] 浏览器导出 - 启动浏览器完成验证（Browser - Export Cookie with verification）"
    echo "  [3] 自定义 Cookie - 直接提供 Cookie 字符串（Custom - Provide Cookie string）"
    echo "  [4] 指定日期 - 下载特定日期的音频（Date - Download specific date）"
    echo "  [5] 查看日志 - 查看最后的下载日志（Logs - View download logs）"
    echo "  [0] 退出（Exit）"
    echo ""
    read -p "输入选择 (Enter choice): " choice
}

# 方法 1: 快速下载
quick_download() {
    echo ""
    echo "► 快速下载最近 5 个 30 分钟时段..."
    python3 vhhh_multimethod_download.py --count 5 --cookie-file "$COOKIE_FILE"
}

# 方法 2: 浏览器导出
browser_export() {
    echo ""
    echo "► 启动浏览器导出 Cookie..."
    echo "  1. 浏览器打开 https://www.liveatc.net/"
    echo "  2. 如出现 Cloudflare 验证，请手动完成"
    echo "  3. 返回此终端按 Enter 键"
    echo ""
    python3 vhhh_multimethod_download.py --export-cookie --count 5
}

# 方法 3: 自定义 Cookie
custom_cookie() {
    echo ""
    read -p "请输入 Cookie 字符串 (Paste Cookie): " cookie_str
    if [ -z "$cookie_str" ]; then
        echo "[FAIL] Cookie 不能为空"
        return 1
    fi
    echo ""
    echo "► 使用提供的 Cookie 下载..."
    python3 vhhh_multimethod_download.py --cookie "$cookie_str" --count 5
}

# 方法 4: 指定日期
date_download() {
    echo ""
    read -p "输入日期 (Date, YYYY-MM-DD): " date_str
    if [ -z "$date_str" ]; then
        echo "[FAIL] 日期不能为空"
        return 1
    fi
    read -p "输入时段数（默认 8）(Time slots, default 8): " slot_count
    slot_count="${slot_count:-8}"
    
    echo ""
    echo "► 下载 $date_str 的 $slot_count 个 30 分钟时段..."
    python3 vhhh_multimethod_download.py \
        --date "$date_str" \
        --count "$slot_count" \
        --cookie-file "$COOKIE_FILE"
}

# 方法 5: 查看日志
view_logs() {
    echo ""
    if [ -f "$DOWNLOADS_DIR/vhhh_download.log" ]; then
        echo "► 最后 30 行日志:"
        echo ""
        tail -30 "$DOWNLOADS_DIR/vhhh_download.log"
    else
        echo "[FAIL] 日志文件不存在: $DOWNLOADS_DIR/vhhh_download.log"
    fi
}

# 环境检查
check_env() {
    echo "► 环境检查..."
    
    # 检查 Python
    if ! command -v python3 &> /dev/null; then
        echo "[FAIL] 缺少 Python 3"
        exit 1
    fi
    echo "  [OK] Python 3 $(python3 --version)"
    
    # 检查脚本
    if [ ! -f "$SCRIPT_DIR/vhhh_multimethod_download.py" ]; then
        echo "[FAIL] 缺少脚本: vhhh_multimethod_download.py"
        exit 1
    fi
    echo "  [OK] vhhh_multimethod_download.py 存在"
    
    # 检查依赖
    if ! python3 -c "import httpx" 2>/dev/null; then
        echo ""
        echo "► 缺少依赖，尝试安装..."
        pip3 install -r requirements.txt --quiet
    fi
    echo "  [OK] 依赖已安装"
    
    # 检查 Cookie
    if [ -f "$COOKIE_FILE" ]; then
        cookie_size=$(wc -c < "$COOKIE_FILE")
        echo "  [OK] Cookie 文件存在（$cookie_size 字节）"
    else
        echo "  [WARN] Cookie 文件不存在: $COOKIE_FILE"
    fi
    
    echo ""
}

# 主循环
main() {
    cd "$SCRIPT_DIR"
    check_env
    
    while true; do
        show_menu
        case $choice in
            1) quick_download ;;
            2) browser_export ;;
            3) custom_cookie ;;
            4) date_download ;;
            5) view_logs ;;
            0) echo "再见 (Goodbye)"; exit 0 ;;
            *) echo "[FAIL] 无效选择 (Invalid choice)" ;;
        esac
    done
}

# 运行主程序
main
