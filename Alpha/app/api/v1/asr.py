from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.common.response import error_response, success_response
from app.db.session import get_db
from app.services.asr_service import AsrService, AsrServiceError

router = APIRouter()


@router.post("/recognize")
def recognize(
    file: UploadFile | None = File(None),
    unique_id: str | None = Form(None),
    recording_start_time: str | None = Form(None),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    if file is None:
        return error_response(message="No uploaded audio file", code=400)
    try:
        result = AsrService(db).recognize_upload(
            file.file,
            file.filename,
            unique_id,
            recording_start_time,
        )
    except AsrServiceError as exc:
        return error_response(message=str(exc), code=500)
    finally:
        file.file.close()
    return success_response(data=result.to_response())
