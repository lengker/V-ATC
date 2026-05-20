from fastapi import Header, HTTPException, status

from app.core.config import settings


async def verify_a3_callback_token(x_a3_token: str = Header(default="")) -> None:
    if not settings.a3_callback_token:
        return
    if x_a3_token != settings.a3_callback_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid callback token")


async def verify_api_token(x_api_token: str = Header(default="")) -> None:
    """Verify API token for integration endpoints."""
    if not settings.api_token:
        return
    if x_api_token != settings.api_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API token")
