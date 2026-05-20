import os
import requests
import time

# 1. 配置路径和接口
folder_path = r"C:\Users\86136\Desktop\软件项目综合实践\a3_speech_processing_2\test_wavs"
api_url = "http://127.0.0.1:8000/api/v1/process"

# 2. 获取文件夹下所有的 wav 文件
wav_files = [f for f in os.listdir(folder_path) if f.endswith('.wav')]
total_files = len(wav_files)

if total_files == 0:
    print("❌ 文件夹里没有找到 .wav 文件！")
    exit()

print(f"🎯 找到 {total_files} 个音频文件，准备循环发送 10 次，共计 {total_files * 10} 个请求。")
print("⚠️ 请现在打开【任务管理器】，盯住 Python 进程的内存！\n")
time.sleep(3)  # 给你 3 秒钟时间打开任务管理器

# 3. 开始 10 次循环轰炸
success_count = 0
for loop in range(1, 11):
    print(f"========== 🔄 开始第 {loop}/10 轮循环 ==========")

    for wav_file in wav_files:
        file_path = os.path.join(folder_path, wav_file)
        print(f"📤 正在发送: {wav_file} ... ", end="")

        try:
            # 模拟前端上传文件
            with open(file_path, "rb") as f:
                files = {"file": (wav_file, f, "audio/wav")}
                # 发送 POST 请求到你的引擎
                response = requests.post(api_url, files=files)

            if response.status_code == 200:
                print("✅ 成功!")
                success_count += 1
            else:
                print(f"❌ 失败! 状态码: {response.status_code}")

        except Exception as e:
            print(f"❌ 请求异常: {e}")

        # 稍微停顿 0.5 秒，模拟真实并发间隔
        time.sleep(0.5)

print(f"\n🎉 压测结束！共成功处理 {success_count} 个音频文件。")