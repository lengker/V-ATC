import pytest
import numpy as np


# ==========================================
# 隔离真实模型：Mock 底层 C++ 引擎
# ==========================================

@pytest.fixture
def mock_sherpa(mocker):
    """
    终极拦截：把整个 sherpa_onnx 模块替换成 Mock 对象
    这样就不会去真实加载几百兆的 ONNX 模型文件了
    """
    return mocker.patch('app.engine.sense_voice.sherpa_onnx')


@pytest.fixture
def mock_os_chdir(mocker):
    """
    拦截路径切换：防止代码里的 os.chdir() 把测试运行器所在的目录给搞乱了
    """
    mocker.patch('os.chdir')
    mocker.patch('os.getcwd', return_value="/mock/cwd")


# ==========================================
# 测试用例 (Test Cases)
# ==========================================

def test_asr_init_with_hotwords(mocker, mock_sherpa, mock_os_chdir):
    """
    测试：引擎初始化时，确保不会因为模型路径校验失败而崩溃，且底层加载器被调用
    """
    # 终极拦截：无论去检查什么文件（模型、词表、热词），都假装它存在！
    mocker.patch('os.path.exists', return_value=True)

    from app.engine.sense_voice import ASREngine
    engine = ASREngine()

    # 因为你的代码实际上使用的是 from_sense_voice，所以我们要断言这个方法被调用了
    mock_sherpa.OfflineRecognizer.from_sense_voice.assert_called_once()


def test_recognize_single_stream(mocker, mock_sherpa, mock_os_chdir):
    """
    测试：单句识别逻辑，确保 C++ Stream 被正确创建、喂数据和解析
    """
    # 【必须加这行】骗过模型路径存在性校验
    mocker.patch('os.path.exists', return_value=True)

    from app.engine.sense_voice import ASREngine
    engine = ASREngine()

    # 1. 伪造一个底层的推理流 (Stream)
    fake_stream = mocker.MagicMock()
    fake_stream.result.text = "Roger that, Cathay 123"

    # 强制让引擎创建 Stream 时，返回我们伪造的 fake_stream
    engine.recognizer.create_stream.return_value = fake_stream

    # 2. 传入假音频数据
    import numpy as np
    fake_audio = np.zeros(16000, dtype=np.float32)
    result = engine.recognize(fake_audio)

    # 3. 断言验证
    assert result == "Roger that, Cathay 123"
    fake_stream.accept_waveform.assert_called_once()
    engine.recognizer.decode_stream.assert_called_once_with(fake_stream)


def test_recognize_batch_streams(mocker, mock_sherpa, mock_os_chdir):
    """
    测试：我们重构的“多流批处理(Batch)”能力是否正确分发了数据
    """
    # 【必须加这行】骗过模型路径存在性校验
    mocker.patch('os.path.exists', return_value=True)

    from app.engine.sense_voice import ASREngine
    engine = ASREngine()

    # 1. 伪造两个独立的流
    fake_stream_1 = mocker.MagicMock()
    fake_stream_1.result.text = "Alpha"
    fake_stream_2 = mocker.MagicMock()
    fake_stream_2.result.text = "Bravo"

    engine.recognizer.create_stream.side_effect = [fake_stream_1, fake_stream_2]

    # 2. 模拟 VAD 切出了两段并发音频
    import numpy as np
    fake_batch_audio = [np.zeros(100), np.zeros(200)]

    # 3. 执行批处理
    results = engine.recognize_batch(fake_batch_audio)

    # 4. 断言验证
    assert results == ["Alpha", "Bravo"]
    assert engine.recognizer.create_stream.call_count == 2
    engine.recognizer.decode_streams.assert_called_once()