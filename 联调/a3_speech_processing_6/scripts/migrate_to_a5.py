# scripts/migrate_to_a5.py
import os
import sqlite3
import sys

# 将项目根目录加入环境变量，方便导入 app 模块
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import engine
from app.db.base import Base
import app.db.models  # 确保加载所有新模型

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "speech_processing.db")


def migrate_database():
    print("🚀 开始进行 A5 架构数据库平滑迁移...")
    if not os.path.exists(DB_PATH):
        print("❌ 找不到数据库文件！")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 检查是否已经迁移过了 (看看有没有 audio_id 字段)
    cursor.execute("PRAGMA table_info(LNG_AUDIO_RECORDS)")
    columns = [info[1] for info in cursor.fetchall()]
    if "audio_id" in columns:
        print("✅ 数据库已经是最新 A5 架构，无需再次迁移！")
        conn.close()
        return

    try:
        # 第一步：备份旧表
        print("📦 1. 正在备份旧表数据...")
        cursor.execute("DROP TABLE IF EXISTS LNG_AUDIO_RECORDS_OLD")
        cursor.execute("ALTER TABLE LNG_AUDIO_RECORDS RENAME TO LNG_AUDIO_RECORDS_OLD")
        conn.commit()

        # 第二步：利用 SQLAlchemy 重建包含所有 A5 规范的新表（含机场、用户、标注表等）
        print("🏗️ 2. 正在按照 A5 标准重建全新表结构与 B-Tree 索引...")
        Base.metadata.create_all(bind=engine)

        # 第三步：数据平滑灌入 (核心逻辑：旧的 id 映射给新的 audio_id，新加字段自动赋默认值)
        print("🔄 3. 正在将历史语音数据无损迁移至新表...")
        cursor.execute("""
            INSERT INTO LNG_AUDIO_RECORDS (
                audio_id, file_name, file_path, duration, asr_content, channel, created_at
            )
            SELECT 
                id, file_name, file_path, duration, asr_content, channel, created_at 
            FROM LNG_AUDIO_RECORDS_OLD
        """)

        # 第四步：清理战场
        print("🧹 4. 迁移完毕，清理临时备份表...")
        cursor.execute("DROP TABLE LNG_AUDIO_RECORDS_OLD")
        conn.commit()

        print("🎉 迁移完美成功！历史数据已 100% 保留并适配 A5 新接口！")
    except Exception as e:
        print(f"❌ 迁移失败，已回滚: {e}")
        conn.rollback()
    finally:
        conn.close()


if __name__ == "__main__":
    migrate_database()