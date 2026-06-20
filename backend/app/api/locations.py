from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Location, Product, User
from .deps import current_user

router = APIRouter(prefix="/locations", tags=["locations"])


class LocationIn(BaseModel):
    name: str
    sort_order: int = 0


class LocationUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None


@router.get("", response_model=list[Location])
def list_locations(session: Session = Depends(get_session), user: User = Depends(current_user)):
    return session.exec(select(Location).order_by(Location.sort_order, Location.name)).all()


@router.post("", response_model=Location, status_code=status.HTTP_201_CREATED)
def create_location(
    data: LocationIn,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    location = Location(name=data.name, sort_order=data.sort_order, is_default=False)
    session.add(location)
    session.commit()
    session.refresh(location)
    return location


@router.patch("/{location_id}", response_model=Location)
def update_location(
    location_id: int,
    data: LocationUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    location = session.get(Location, location_id)
    if not location:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "location not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(location, field, value)
    session.add(location)
    session.commit()
    session.refresh(location)
    return location


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(
    location_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Delete a location; products there fall back to "no location" (null)."""
    location = session.get(Location, location_id)
    if not location:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "location not found")
    for product in session.exec(
        select(Product).where(Product.location_id == location_id)
    ).all():
        product.location_id = None
        session.add(product)
    session.delete(location)
    session.commit()
