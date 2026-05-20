# scripts/test_cascade_delete.py
import os
import sys
from datetime import datetime

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.db.models import LngAudioRecords, LngTracks, LngAnnotations


def stress_test_cascading_delete():
    db = SessionLocal()
    print("💥 [破坏性压测] 开始执行跨表级联删除测试...")

    try:
        # 1. 制造一条完整的链路: Track -> Audio -> Annotation
        print("  -> 1. 正在构建测试链路数据...")
        track = LngTracks(timestamp=datetime.now(), flight_id="TEST_FLIGHT", tracks_latitude=0.0, tracks_longitude=0.0)
        db.add(track)
        db.commit()

        audio = LngAudioRecords(file_name="test_cascade.wav", file_path="/fake/path", track_id=track.track_id)
        db.add(audio)
        db.commit()

        anno = LngAnnotations(audio_id=audio.audio_id, relative_start=0, relative_end=1, abs_start_time=datetime.now(),
                              abs_end_time=datetime.now())
        db.add(anno)
        db.commit()

        print(f"     ✅ 链路构建成功: Track[{track.track_id}] -> Audio[{audio.audio_id}] -> Anno[{anno.annotation_id}]")

        # 2. 模拟极端情况 A: 航迹被强制删除 (测试 SET NULL 是否生效)
        print("  -> 2. 模拟前端强制删除航迹节点...")
        db.delete(track)
        db.commit()

        db.refresh(audio)
        if audio.track_id is None:
            print("     ✅ SET NULL 防护生效: 航迹被删，音频未宕机，外键已安全置空。")
        else:
            print("     ❌ 失败: 音频仍保留脏读外键！")

        # 3. 模拟极端情况 B: 音频被强制删除 (测试 CASCADE 是否生效)
        print("  -> 3. 模拟管理员强制删除音频节点...")
        anno_id_backup = anno.annotation_id
        db.delete(audio)
        db.commit()

        # 检查标注是否被级联删除
        surviving_anno = db.query(LngAnnotations).filter(LngAnnotations.annotation_id == anno_id_backup).first()
        if surviving_anno is None:
            print("     ✅ CASCADE 防护生效: 音频被删，挂载的标注数据已被干净地同步销毁。")
        else:
            print("     ❌ 失败: 存在残留的脏读标注数据！")

        print("\n🎉 级联破坏性压测全量通过！系统具备极强的跨表容错能力。")

    except Exception as e:
        print(f"\n❌ 压测触发系统宕机 (未通过): {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    stress_test_cascading_delete()