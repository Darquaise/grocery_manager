"""Response schemas shared by several routers."""

from pydantic import BaseModel


class UserOut(BaseModel):
    id: int
    name: str
    color: str
    language: str | None = None
