from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.common.enums import UserRole, UserStatus
from app.common.response import success_response
from app.db.session import get_db
from app.schemas.auth import LoginRequest, LogoutRequest, RefreshRequest, SignupRequest
from app.schemas.user import UserCreate, UserOut
from app.services.auth_service import AuthService
from app.services.user_service import UserService

router = APIRouter()


@router.post("/login")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    service = AuthService(db)
    data = service.login(
        username=payload.username,
        password=payload.password,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return success_response(data=data)


@router.post("/signup")
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    user = UserService(db).create_user(
        UserCreate(
            username=payload.username.strip(),
            password=payload.password,
            display_name=(payload.display_name or payload.username).strip(),
            role=UserRole.ANNOTATOR,
            status=UserStatus.ACTIVE,
        )
    )
    return success_response(data=UserOut.model_validate(user).model_dump())


@router.post("/refresh")
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    return success_response(data=AuthService(db).refresh(payload.refresh_token))


@router.post("/logout")
def logout(payload: LogoutRequest, db: Session = Depends(get_db)):
    return success_response(data=AuthService(db).logout(payload.refresh_token))
