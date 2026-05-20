# scripts/build_indexes.py
import sqlite3
import os

# 确保路径指向根目录下的数据库文件
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "speech_processing.db")

def upgrade_database():
    print(f"🚀 开始热更新数据库索引: {DB_PATH}")
    if not os.path.exists(DB_PATH):
        print("❌ 未找到数据库文件，请先运行服务生成数据库！")
        return

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        # 🎯 为 channel 字段建立 B-Tree 索引
        print("⏳ 正在为 channel 字段构建索引...")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_LNG_AUDIO_RECORDS_channel ON LNG_AUDIO_RECORDS (channel);")

        # 🎯 为 created_at 字段建立 B-Tree 索引
        print("⏳ 正在为 created_at 字段构建索引...")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_LNG_AUDIO_RECORDS_created_at ON LNG_AUDIO_RECORDS (created_at);")

        conn.commit()
        print("✅ 历史数据平滑迁移与索引构建成功完成！无任何数据丢失。")
    except Exception as e:
        print(f"❌ 索引构建失败: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    upgrade_database()