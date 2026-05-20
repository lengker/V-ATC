#!/usr/bin/env python
"""
VHHH 下载工具诊断和测试脚本

检查：
1. Python 环境和依赖
2. Cookie 可用性
3. 网络连接
4. 下载工具功能
"""

import os
import sys
from pathlib import Path
from typing import Tuple
import subprocess

try:
    import httpx
    import cloudscraper
    from bs4 import BeautifulSoup
except ImportError as e:
    print(f"[WARN] 依赖缺失: {e}")
    print("请运行: pip install -r requirements.txt")


class Tester:
    """诊断和测试工具"""
    
    def __init__(self):
        self.script_dir = Path(__file__).parent
        self.cookie_file = self.script_dir / ".local" / "liveatc_cookie.txt"
        self.results = []
    
    def test(self, name: str, func) -> bool:
        """运行单个测试"""
        try:
            print(f"\n[测试] {name}...", end=" ", flush=True)
            result = func()
            if result:
                print("[OK] 通过")
                self.results.append((name, True, None))
                return True
            else:
                print("[FAIL] 失败")
                self.results.append((name, False, "返回 False"))
                return False
        except Exception as e:
            print(f"[FAIL] 异常: {e}")
            self.results.append((name, False, str(e)))
            return False
    
    def print_summary(self):
        """打印总结报告"""
        print("\n" + "=" * 70)
        print("诊断报告")
        print("=" * 70)
        
        passed = sum(1 for _, success, _ in self.results if success)
        total = len(self.results)
        
        for name, success, error in self.results:
            status = "[OK]" if success else "[FAIL]"
            print(f"{status} {name}", end="")
            if error:
                print(f" ({error})")
            else:
                print()
        
        print("=" * 70)
        print(f"结果: {passed}/{total} 通过")
        
        if passed == total:
            print("[OK] 所有测试通过！工具已就绪。")
            return 0
        else:
            print("[FAIL] 部分测试失败，请查看上述错误。")
            return 1
    
    # ========================================================================
    # 环境检查
    # ========================================================================
    
    def check_python_version(self) -> bool:
        """检查 Python 版本"""
        version = f"{sys.version_info.major}.{sys.version_info.minor}"
        print(f"(Python {version})", end=" ")
        return sys.version_info >= (3, 7)
    
    def check_httpx(self) -> bool:
        """检查 httpx 安装"""
        try:
            import httpx
            return True
        except ImportError:
            return False
    
    def check_cloudscraper(self) -> bool:
        """检查 cloudscraper 安装"""
        try:
            import cloudscraper
            return True
        except ImportError:
            return False
    
    def check_beautifulsoup(self) -> bool:
        """检查 beautifulsoup4 安装"""
        try:
            from bs4 import BeautifulSoup
            return True
        except ImportError:
            return False
    
    def check_playwright(self) -> bool:
        """检查 playwright 安装（可选）"""
        try:
            from playwright.sync_api import sync_playwright
            return True
        except ImportError:
            print("(可选)", end=" ")
            return False
    
    # ========================================================================
    # Cookie 检查
    # ========================================================================
    
    def check_cookie_env_var(self) -> bool:
        """检查环境变量 LIVEATC_COOKIE"""
        cookie = os.environ.get("LIVEATC_COOKIE", "").strip()
        if cookie:
            print(f"({len(cookie)} 字符)", end=" ")
            return True
        print("(未设置)", end=" ")
        return False
    
    def check_cookie_file(self) -> bool:
        """检查 Cookie 文件"""
        if self.cookie_file.exists():
            size = self.cookie_file.stat().st_size
            print(f"({size} 字节)", end=" ")
            return size > 10
        print("(不存在)", end=" ")
        return False
    
    def check_cookie_file_env_var(self) -> bool:
        """检查环境变量 LIVEATC_COOKIE_FILE"""
        cookie_file = os.environ.get("LIVEATC_COOKIE_FILE", "").strip()
        if cookie_file and Path(cookie_file).exists():
            print(f"({cookie_file})", end=" ")
            return True
        print("(未设置或不存在)", end=" ")
        return False
    
    # ========================================================================
    # 网络检查
    # ========================================================================
    
    def check_internet_connectivity(self) -> bool:
        """检查互联网连接"""
        try:
            response = httpx.get("https://www.google.com", timeout=5)
            print(f"(状态码 {response.status_code})", end=" ")
            return response.status_code == 200
        except Exception as e:
            print(f"({e})", end=" ")
            return False
    
    def check_liveatc_main_page(self) -> bool:
        """检查 LiveATC 主页可达性"""
        try:
            response = httpx.get("https://www.liveatc.net/", timeout=10)
            print(f"(状态码 {response.status_code})", end=" ")
            return 200 <= response.status_code < 400
        except Exception as e:
            print(f"({e})", end=" ")
            return False
    
    def check_archive_url(self) -> bool:
        """检查存档 URL 可达性"""
        try:
            response = httpx.head(
                "https://archive.liveatc.net/",
                timeout=10,
                follow_redirects=True
            )
            print(f"(状态码 {response.status_code})", end=" ")
            return 200 <= response.status_code < 400
        except Exception as e:
            print(f"({e})", end=" ")
            return False
    
    # ========================================================================
    # 工具检查
    # ========================================================================
    
    def check_vhhh_script_exists(self) -> bool:
        """检查 vhhh_multimethod_download.py 存在"""
        script = self.script_dir / "vhhh_multimethod_download.py"
        exists = script.exists()
        print(f"({script})", end=" ")
        return exists
    
    def check_quick_start_script(self) -> bool:
        """检查快速启动脚本存在"""
        if sys.platform == "win32":
            script = self.script_dir / "vhhh_quick_start.ps1"
        else:
            script = self.script_dir / "vhhh_quick_start.sh"
        exists = script.exists()
        print(f"({script.name})", end=" ")
        return exists
    
    def check_requirements_txt(self) -> bool:
        """检查 requirements.txt 存在"""
        req_file = self.script_dir / "requirements.txt"
        exists = req_file.exists()
        print(f"({req_file})", end=" ")
        return exists
    
    # ========================================================================
    # 功能测试
    # ========================================================================
    
    def check_file_generation(self) -> bool:
        """检查能否生成候选文件名"""
        from datetime import datetime, timedelta
        
        now = datetime.utcnow()
        minute_slot = (now.minute // 30) * 30
        start = now.replace(minute=minute_slot, second=0, microsecond=0)
        
        identifiers = ["VHHH5-App-Dep-Dir-Zone", "VHHH5-Ground"]
        count = 0
        
        for identifier in identifiers:
            for slot_offset in range(4):
                slot_time = start - timedelta(minutes=30 * slot_offset)
                filename = f"{identifier}-{slot_time.strftime('%b-%d-%Y-%H%MZ')}.mp3"
                count += 1
        
        print(f"(生成了 {count} 个文件名)", end=" ")
        return count > 0
    
    def check_downloader_help(self) -> bool:
        """检查下载脚本的 --help 输出"""
        try:
            venv_path = Path(__file__).parent.parent / ".venv"
            if sys.platform == "win32":
                python_exe = venv_path / "Scripts" / "python.exe"
            else:
                python_exe = venv_path / "bin" / "python"
            
            if not python_exe.exists():
                print(f"(虚拟环境不存在)", end=" ")
                return False
            
            result = subprocess.run(
                [str(python_exe), str(self.script_dir / "vhhh_multimethod_download.py"), "--help"],
                capture_output=True,
                timeout=5
            )
            print(f"(返回码 {result.returncode})", end=" ")
            return result.returncode == 0
        except Exception as e:
            print(f"({e})", end=" ")
            return False
    
    # ========================================================================
    # 运行所有测试
    # ========================================================================
    
    def run_all(self) -> int:
        """运行所有诊断测试"""
        
        print("=" * 70)
        print("VHHH 下载工具诊断和测试")
        print("=" * 70)
        
        # ====================================================================
        print("\n► 环境检查")
        # ====================================================================
        self.test("Python 版本", self.check_python_version)
        self.test("httpx 库", self.check_httpx)
        self.test("cloudscraper 库", self.check_cloudscraper)
        self.test("beautifulsoup4 库", self.check_beautifulsoup)
        self.test("playwright 库（可选）", self.check_playwright)
        
        # ====================================================================
        print("\n► Cookie 检查")
        # ====================================================================
        self.test("环境变量 LIVEATC_COOKIE", self.check_cookie_env_var)
        self.test("Cookie 文件 (.local/liveatc_cookie.txt)", self.check_cookie_file)
        self.test("环境变量 LIVEATC_COOKIE_FILE", self.check_cookie_file_env_var)
        
        # ====================================================================
        print("\n► 网络连接检查")
        # ====================================================================
        self.test("互联网连接 (Google)", self.check_internet_connectivity)
        self.test("LiveATC 主页", self.check_liveatc_main_page)
        self.test("存档 URL", self.check_archive_url)
        
        # ====================================================================
        print("\n► 工具和脚本检查")
        # ====================================================================
        self.test("vhhh_multimethod_download.py", self.check_vhhh_script_exists)
        self.test("快速启动脚本", self.check_quick_start_script)
        self.test("requirements.txt", self.check_requirements_txt)
        
        # ====================================================================
        print("\n► 功能测试")
        # ====================================================================
        self.test("文件名生成", self.check_file_generation)
        self.test("下载脚本可执行性", self.check_downloader_help)
        
        # ====================================================================
        # 打印总结
        # ====================================================================
        return self.print_summary()


def main():
    """主程序"""
    tester = Tester()
    exit_code = tester.run_all()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
