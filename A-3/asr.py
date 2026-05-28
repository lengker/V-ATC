import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.common.response import success_response
from app.db.session import get_db
from app.services.asr_service import AsrService

router = APIRouter()

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


@router.post("/recognize")
def asr_recognize(
    file: UploadFile = File(...),
    unique_id: str | None = Form(None),
    recording_start_time: str | None = Form(None),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not file:
        return success_response(code=400, message="未上传文件")

    if unique_id is None:
        unique_id = str(uuid.uuid4())

    save_path = UPLOAD_DIR / f"{unique_id}.wav"
    content = file.file.read()
    with open(save_path, "wb") as f:
        f.write(content)

    try:
        result = AsrService(db).recognize_audio(str(save_path), unique_id, recording_start_time)
        return success_response(data=result)
    except FileNotFoundError as e:
        return success_response(code=500, message=f"模型文件缺失：{str(e)}")
    except Exception as e:
        return success_response(code=500, message=f"识别异常：{str(e)}")