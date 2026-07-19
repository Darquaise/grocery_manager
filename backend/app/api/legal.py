from fastapi import APIRouter
from pydantic import BaseModel

from ..config import settings

router = APIRouter(prefix="/legal", tags=["legal"])


class LegalOut(BaseModel):
    """Provider details for the imprint and privacy pages.

    `configured` tells the frontend whether the operator filled in the imprint
    details at all. A privately run instance is not subject to the imprint duty
    (§ 5 DDG applies to commercial services), so the link stays hidden until
    name, street and city are set — better than serving a page full of blanks.
    """

    configured: bool
    name: str
    care_of: str
    street: str
    city: str
    country: str
    email: str
    vat_id: str
    hosting_provider: str


# Public on purpose: an imprint has to be reachable without signing in.
@router.get("", response_model=LegalOut)
def read_legal():
    return LegalOut(
        configured=bool(settings.legal_name and settings.legal_street and settings.legal_city),
        name=settings.legal_name,
        care_of=settings.legal_care_of,
        street=settings.legal_street,
        city=settings.legal_city,
        country=settings.legal_country,
        email=settings.legal_email,
        vat_id=settings.legal_vat_id,
        hosting_provider=settings.legal_hosting_provider,
    )
