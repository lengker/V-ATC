# homework/scripts/test_db_pool_pressure.py
import sys
import os
import time
import concurrent.futures

# 将项目根目录加入 sys.path，以便能找到 app 模块
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import engine, get_db
from app.db.base import Base
from app.db.crud import create_audio_record

# 压测参数配置
CONCURRENCY = 50  # 并发线程数（也就是同时有多少个请求去抢连接）
TOTAL_REQUESTS = 200  # 总共发起的请求数


def setup_database():
    """压测前：如果表不存在，先创建表"""
    print("🛠️ 正在初始化数据库表结构...")
    Base.metadata.create_all(bind=engine)


def simulate_api_request(task_id: int):
    """模拟一次真实的 API 请求，走完整的连接池借出与归还流程"""
    db_generator = get_db()
    db = next(db_generator)  # 从连接池获取连接

    try:
        # 1. 模拟业务逻辑：插入一条测试数据
        mock_data = {
            "file_name": f"stress_test_{task_id}.mp3",
            "file_path": f"/data/test/stress_test_{task_id}.mp3",
            "duration": 5.5,
            "channel": "APP_TEST"
        }
        create_audio_record(db=db, record_data=mock_data)

        # 模拟真实的接口处理耗时 (比如调用模型花了 0.1 秒)
        time.sleep(0.1)

        return True, ""
    except Exception as e:
        return False, str(e)
    finally:
        # 无论成功失败，必须安全释放连接！触发 generator 的 finally 逻辑
        db_generator.close()


def run_stress_test():
    print(f"🚀 开始数据库连接池压力测试...")
    print(f"⚙️ 参数：总请求数={TOTAL_REQUESTS}, 并发线程={CONCURRENCY}")
    print(f"⏳ 数据库池配置：Pool Size={engine.pool.size()}, Max Overflow={engine.pool._max_overflow}\n")

    start_time = time.time()
    success_count = 0
    fail_count = 0
    errors = []

    # 使用线程池并发执行请求
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        # 提交所有任务
        futures = {executor.submit(simulate_api_request, i): i for i in range(TOTAL_REQUESTS)}

        # 收集结果
        for future in concurrent.futures.as_completed(futures):
            success, err_msg = future.result()
            if success:
                success_count += 1
            else:
                fail_count += 1
                errors.append(err_msg)

    end_time = time.time()
    total_time = end_time - start_time
    qps = TOTAL_REQUESTS / total_time

    # 打印测试报告
    print("==========================================")
    print("📊 连接池压测结果报告")
    print("==========================================")
    print(f"⏱️ 总耗时:     {total_time:.2f} 秒")
    print(f"⚡ QPS (吞吐量): {qps:.2f} 请求/秒")
    print(f"✅ 成功请求数: {success_count}")
    print(f"❌ 失败请求数: {fail_count}")

    if fail_count > 0:
        print(f"⚠️ 常见错误示例: {errors[0]}")
    elif success_count == TOTAL_REQUESTS:
        print("\n🎉 测试完美通过！未发生连接泄露 (Connection Leak) 和阻塞超时。")
    print("==========================================")


if __name__ == "__main__":
    setup_database()
    run_stress_test()