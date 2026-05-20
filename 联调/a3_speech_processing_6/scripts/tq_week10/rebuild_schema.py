# scripts/tq_week10/rebuild_schema.py
import os
import sys
import sqlite3

# 往上跳三层回到项目根目录
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(PROJECT_ROOT)

from app.db.session import engine
from app.db.base import Base
import app.db.models  # 加载最新带有 CASCADE 的模型

DB_PATH = os.path.join(PROJECT_ROOT, "speech_processing.db")


def rebuild_schema_for_cascade():
    print("🔧 开始重建数据库 Schema 以应用外键级联规则...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # 必须先关闭外键约束才能动表结构
        cursor.execute("PRAGMA foreign_keys=OFF")

        # 1. 备份现有数据表
        print("📦 1. 正在备份现有音频与标注表...")

        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='LNG_AUDIO_RECORDS'")
        if cursor.fetchone():
            cursor.execute("DROP TABLE IF EXISTS _backup_audio")
            cursor.execute("ALTER TABLE LNG_AUDIO_RECORDS RENAME TO _backup_audio")

        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='LNG_ANNOTATIONS'")
        if cursor.fetchone():
            cursor.execute("DROP TABLE IF EXISTS _backup_anno")
            cursor.execute("ALTER TABLE LNG_ANNOTATIONS RENAME TO _backup_anno")

        conn.commit()

        # 手动清理关联在旧表上的索引
        cursor.execute("DROP INDEX IF EXISTS ix_LNG_AUDIO_RECORDS_file_name")
        cursor.execute("DROP INDEX IF EXISTS ix_LNG_AUDIO_RECORDS_channel")
        cursor.execute("DROP INDEX IF EXISTS ix_LNG_AUDIO_RECORDS_created_at")

        # 2. 重新生成原生支持 CASCADE 约束的物理表结构
        print("🏗️ 2. 重新生成原生支持 CASCADE 约束的物理表结构...")
        Base.metadata.create_all(bind=engine)

        # 3. 将数据无缝导回 (⭐️ 终极容错：只在备份表确实存在时才导回数据)
        print("🔄 3. 正在将数据无损导回新表...")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='_backup_audio'")
        if cursor.fetchone():
            cursor.execute("INSERT INTO LNG_AUDIO_RECORDS SELECT * FROM _backup_audio")

        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='_backup_anno'")
        if cursor.fetchone():
            cursor.execute("INSERT INTO LNG_ANNOTATIONS SELECT * FROM _backup_anno")

        # 4. 删除备份 (⭐️ 使用 IF EXISTS 防止报错)
        print("🧹 4. 清理备份表...")
        cursor.execute("DROP TABLE IF EXISTS _backup_audio")
        cursor.execute("DROP TABLE IF EXISTS _backup_anno")

        conn.commit()
        print("🎉 Schema 重建成功！数据库物理层已原生支持外键级联！")
    except Exception as e:
        print(f"❌ 重建失败，已回滚: {e}")
        conn.rollback()
    finally:
        cursor.execute("PRAGMA foreign_keys=ON")
        conn.close()


if __name__ == "__main__":
    rebuild_schema_for_cascade()