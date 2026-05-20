#!/usr/bin/env python3
"""
VHHH 多方式下载启动器 - 自动使用虚拟环境

这个脚本会：
1. 检查是否运行在虚拟环境中
2. 如未运行，则尝试重新在虚拟环境中执行
3. 加载主下载脚本
"""

import sys
import os
from pathlib import Path
import subprocess
import venv

def get_venv_path():
    """获取虚拟环境路径"""
    project_root = Path(__file__).parent.parent
    venv_path = project_root / ".venv"
    return venv_path

def is_in_venv():
    """检查是否运行在虚拟环境中"""
    return hasattr(sys, 'real_prefix') or (
        hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix
    )

def get_python_executable():
    """获取虚拟环境中的 Python 可执行文件"""
    venv_path = get_venv_path()
    if sys.platform == "win32":
        python_exe = venv_path / "Scripts" / "python.exe"
    else:
        python_exe = venv_path / "bin" / "python"
    return python_exe

def activate_venv():
    """在虚拟环境中重新执行此脚本"""
    venv_path = get_venv_path()
    python_exe = get_python_executable()
    
    if not venv_path.exists():
        print(f"[错误] 虚拟环境不存在: {venv_path}")
        print(f"请在项目根目录运行: python -m venv .venv")
        sys.exit(1)
    
    if not python_exe.exists():
        print(f"[错误] Python 可执行文件不存在: {python_exe}")
        print(f"虚拟环境可能未正确初始化")
        sys.exit(1)
    
    print(f"[信息] 在虚拟环境中重新执行...")
    print(f"       Python: {python_exe}")
    
    # 重新执行此脚本
    result = subprocess.run(
        [str(python_exe)] + sys.argv,
        cwd=Path(__file__).parent
    )
    sys.exit(result.returncode)

def main():
    """主程序"""
    
    # 检查是否在虚拟环境中运行
    if not is_in_venv():
        print("[警告] 未在虚拟环境中运行")
        activate_venv()
        return
    
    print(f"[成功] 在虚拟环境中运行")
    print(f"       Python: {sys.executable}")
    print(f"       版本: {sys.version.split()[0]}")
    
    # 加载并执行主下载脚本
    print()
    
    download_script = Path(__file__).parent / "vhhh_multimethod_download.py"
    
    if not download_script.exists():
        print(f"[错误] 下载脚本不存在: {download_script}")
        sys.exit(1)
    
    # 执行主脚本，传递所有参数
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "vhhh_multimethod_download",
        download_script
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

if __name__ == "__main__":
    main()
