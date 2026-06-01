import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.common.response import success_response
from app.db.session import get_db
from app.services.asr_service import AsrService

router = APIRouter()

UPLOAD_DIR = Path("uploads") / "asr"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/recognize")
async def recognize_audio(
    file: UploadFile = File(...),
    unique_id: str | None = Form(None),
    recording_start_time: str | None = Form(None),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    audio_id = unique_id or str(uuid.uuid4())
    safe_audio_id = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in audio_id)
    suffix = Path(file.filename or "upload.wav").suffix or ".wav"
    save_path = UPLOAD_DIR / f"{safe_audio_id}{suffix}"
    save_path.write_bytes(await file.read())

    try:
        result = AsrService(db).recognize_audio(str(save_path), audio_id, recording_start_time)
        return success_response(data=result)
    except FileNotFoundError as exc:
        return success_response(code=500, message=f"ASR model file missing: {exc}")
    except Exception as exc:
        return success_response(code=500, message=f"ASR recognition failed: {exc}")
    finally:
        save_path.unlink(missing_ok=True)
