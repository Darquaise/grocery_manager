from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session

from ..db import get_session
from ..models import User


def current_user(
    request: Request,
    session: Session = Depends(get_session),
) -> User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    user = session.get(User, user_id)
    if not user:
        request.session.clear()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid session")
    return user
