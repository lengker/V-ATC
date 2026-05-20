# scripts/audit_storage.py
import os
import sys
import shutil
from datetime import datetime

# 将项目根目录加入环境变量
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.db.models import LngAudioRecords


def run_consistency_audit_and_repair():
    db = SessionLocal()
    print("🛡️ [数据一致性] 开始执行双向审计与自动修补...")

    records = db.query(LngAudioRecords).all()
    db_file_paths = {os.path.abspath(r.file_path): r for r in records if r.file_path}

    # 1. 排查幻影记录 (数据库有，但物理文件丢了)
    print("\n🔍 阶段 1: 扫描数据库幻影记录...")
    phantom_count = 0
    for path, record in db_file_paths.items():
        if not os.path.exists(path):
            phantom_count += 1
            print(f"  ❌ 发现幻影记录: ID={record.audio_id}, 文件丢失={path}")
            # [自动修补] 将状态置为 3 (失败/异常)，防止后续引擎去读取它报错
            record.status = 3
            record.asr_content = "[系统拦截] 物理音频文件丢失"

    # 2. 排查孤儿文件 (硬盘上有，但数据库没记录)
    print("\n🔍 阶段 2: 扫描存储区孤儿文件...")
    target_dirs = ["test_wavs", "storage"]
    orphan_count = 0
    base_dir = os.path.dirname(os.path.dirname(__file__))
    quarantine_dir = os.path.join(base_dir, "quarantine_orphans")  # 隔离区

    for directory in target_dirs:
        dir_path = os.path.join(base_dir, directory)
        if not os.path.exists(dir_path): continue

        for root, _, files in os.walk(dir_path):
            for file in files:
                if file.endswith('.wav') or file.endswith('.zip'):
                    full_path = os.path.abspath(os.path.join(root, file))
                    if full_path not in db_file_paths:
                        orphan_count += 1
                        print(f"  ⚠️ 发现孤儿文件: {full_path}")
                        # [自动修补] 移入隔离区，防止占用业务目录空间
                        os.makedirs(quarantine_dir, exist_ok=True)
                        shutil.move(full_path, os.path.join(quarantine_dir, file))
                        print(f"     -> 已移至隔离区: quarantine_orphans/{file}")

    db.commit()
    print(f"\n✅ 审计与修补完毕！共处理 {phantom_count} 条幻影记录，隔离 {orphan_count} 个孤儿文件。")
    db.close()


if __name__ == "__main__":
    run_consistency_audit_and_repair()