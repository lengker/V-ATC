# scripts/recover_zombies.py
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.db.models import LngAudioRecords


def rollback_zombie_tasks():
    db = SessionLocal()
    print("🧟 [容错恢复] 开始扫描并回滚僵尸任务...")

    # 查找所有卡在 status=1 (处理中) 的记录
    zombies = db.query(LngAudioRecords).filter(LngAudioRecords.status == 1).all()

    if not zombies:
        print("  ✅ 状态健康，未发现僵尸任务。")
    else:
        for z in zombies:
            print(f"  ⚠️ 发现僵尸任务: ID={z.audio_id}, 文件名={z.file_name}")
            # [安全降级] 将状态回滚为 3 (失败)，并追加恢复日志
            z.status = 3
            z.asr_content = (z.asr_content or "") + " | [异常] 节点崩溃，任务已强制阻断"

        db.commit()
        print(f"  ✅ 成功回滚 {len(zombies)} 条僵尸记录。系统状态已降级安全。")

    db.close()


if __name__ == "__main__":
    rollback_zombie_tasks()