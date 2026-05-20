# scripts/test_query_performance.py
import sys
import os
import time
from datetime import datetime, timedelta

# 将项目根目录加入环境变量，方便导入 app 模块
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.db.crud import get_audio_records_by_strategy


def test_performance():
    db = SessionLocal()
    print("🚀 开始进行复杂查询压测...")

    # 构造一个宽泛的时间范围，以触发潜在的全表扫描
    end_time = datetime.now()
    start_time = end_time - timedelta(days=365)

    iterations = 100  # 模拟高并发，连续执行 100 次复杂检索
    print(f"🔁 正在连续执行 {iterations} 次策略检索...")

    # 开始计时
    start_tick = time.perf_counter()

    for _ in range(iterations):
        records = get_audio_records_by_strategy(
            db=db,
            start_time=start_time,
            end_time=end_time,
            channel="APP",  # 测试刚刚加过索引的 channel 字段
            keyword="CPA",  # 模糊匹配测试
            limit=500
        )

    end_tick = time.perf_counter()
    db.close()

    total_time = end_tick - start_tick
    avg_time = (total_time / iterations) * 1000  # 转换为毫秒

    print(f"\n✅ 压测完成！")
    print(f"📊 总执行次数: {iterations} 次")
    print(f"⏱️ 总体耗时: {total_time:.4f} 秒")
    print(f"⚡ 单次查询平均耗时: {avg_time:.2f} ms")

    if avg_time < 50:
        print("💡 结论: 性能极佳！B-Tree 索引已生效，耗时低于 50ms。")
    else:
        print("💡 结论: 如果这是加索引前的测试，请运行 build_indexes.py 后再测一次进行对比！")


if __name__ == "__main__":
    test_performance()