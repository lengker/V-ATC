import pytest
import numpy as np
from app.engine.vad_processor import VADEngine


# ==========================================
# 测试配置与假数据生成 (Test Fixtures)
# ==========================================

@pytest.fixture
def fake_audio_data():
    """
    生成一段长达 5 秒的假音频流 (16000Hz)
    用于欺骗 VAD 引擎，避免读取真实物理硬盘
    """
    sample_rate = 16000
    duration_sec = 5
    # 生成全 0 数组模拟音频流
    return np.zeros(sample_rate * duration_sec, dtype=np.float32)


# ==========================================
# 测试用例 (Test Cases)
# ==========================================

def test_vad_engine_init():
    """测试 VAD 引擎的参数是否正确挂载"""
    engine = VADEngine(top_db=30, min_duration=0.5, padding_sec=0.1)
    assert engine.top_db == 30
    assert engine.min_duration == 0.5
    assert engine.padding_sec == 0.1


def test_process_generator_padding_and_slice(mocker, fake_audio_data):
    """
    核心白盒测试：验证零 I/O 内存切片与边缘留白 (Padding) 计算是否精准
    """
    engine = VADEngine(top_db=20, min_duration=0.3, padding_sec=0.2)
    fake_sr = 16000

    # 【拦截系统调用】假装文件存在
    mocker.patch('os.path.exists', return_value=True)
    # 【新增拦截】假装文件大小是 100MB (102400000 字节)，满足大于0且小于500MB的条件
    mocker.patch('os.path.getsize', return_value=102400000)

    mocker.patch('soundfile.read', return_value=(fake_audio_data, fake_sr))
    mock_intervals = np.array([[32000, 48000]])
    mocker.patch('librosa.effects.split', return_value=mock_intervals)

    segments = list(engine.process_generator(audio_path="fake_path.wav"))

    assert len(segments) == 1
    segment = segments[0]

    assert "start_time" in segment
    assert "end_time" in segment
    assert "audio_data" in segment
    assert isinstance(segment["audio_data"], np.ndarray)

    expected_samples = int(1.4 * fake_sr)
    actual_samples = len(segment["audio_data"])
    assert actual_samples == expected_samples, f"Padding 计算错误！期望 {expected_samples} 点，实际拿到 {actual_samples} 点"

    assert segment["start_time"] == 1.8
    assert segment["end_time"] == 3.2


def test_process_generator_resample_trigger(mocker, fake_audio_data):
    """
    测试：当遇到非 16000Hz 时，是否正确触发全局重采样
    """
    engine = VADEngine()
    bad_sr = 8000

    # 【拦截系统调用】
    mocker.patch('os.path.exists', return_value=True)
    # 【新增拦截】
    mocker.patch('os.path.getsize', return_value=102400000)

    mocker.patch('soundfile.read', return_value=(fake_audio_data, bad_sr))

    mock_resample = mocker.patch('librosa.resample', return_value=fake_audio_data)
    mocker.patch('librosa.effects.split', return_value=np.array([]))

    list(engine.process_generator("fake_8k_audio.wav"))

    mock_resample.assert_called_once()
    _, kwargs = mock_resample.call_args
    assert kwargs.get('orig_sr') == 8000
    assert kwargs.get('target_sr') == 16000