"""One router implementation for both managed name lists (categories and
storage locations) — they are structurally identical: kitchen-scoped named
entries with a sort order, referenced by an optional FK on `Product` that is
nulled when an entry is deleted."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, SQLModel, select

from ..db import get_session
from ..models import Category, Location, Product
from .deps import KitchenContext, member_of, writer_of


class NamedItemIn(BaseModel):
    name: str
    sort_order: int = 0


class NamedItemUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class NamedItemOut(BaseModel):
    id: int
    name: str
    sort_order: int
    is_default: bool


def build_named_list_router(
    *, model: type[SQLModel], prefix: str, tag: str, product_field: str
) -> APIRouter:
    router = APIRouter(prefix="/kitchens/{kitchen_id}" + prefix, tags=[tag])
    not_found = f"{tag[:-1] if tag.endswith('s') else tag} not found"

    def get_scoped(session: Session, ctx: KitchenContext, item_id: int):
        item = session.get(model, item_id)
        if not item or item.kitchen_id != ctx.kitchen.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, not_found)
        return item

    @router.get("", response_model=list[NamedItemOut])
    def list_items(
        ctx: KitchenContext = Depends(member_of),
        session: Session = Depends(get_session),
    ):
        return session.exec(
            select(model)
            .where(model.kitchen_id == ctx.kitchen.id)
            .order_by(model.sort_order, model.name)
        ).all()

    @router.post("", response_model=NamedItemOut, status_code=status.HTTP_201_CREATED)
    def create_item(
        data: NamedItemIn,
        ctx: KitchenContext = Depends(writer_of),
        session: Session = Depends(get_session),
    ):
        item = model(kitchen_id=ctx.kitchen.id, name=data.name, sort_order=data.sort_order)
        session.add(item)
        session.commit()
        session.refresh(item)
        return item

    @router.patch("/{item_id}", response_model=NamedItemOut)
    def update_item(
        item_id: int,
        data: NamedItemUpdate,
        ctx: KitchenContext = Depends(writer_of),
        session: Session = Depends(get_session),
    ):
        item = get_scoped(session, ctx, item_id)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(item, field, value)
        session.add(item)
        session.commit()
        session.refresh(item)
        return item

    @router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_item(
        item_id: int,
        ctx: KitchenContext = Depends(writer_of),
        session: Session = Depends(get_session),
    ):
        """Delete an entry; products referencing it fall back to null."""
        item = get_scoped(session, ctx, item_id)
        column = getattr(Product, product_field)
        for product in session.exec(select(Product).where(column == item_id)).all():
            setattr(product, product_field, None)
            session.add(product)
        session.delete(item)
        session.commit()

    return router


categories_router = build_named_list_router(
    model=Category, prefix="/categories", tag="categories", product_field="category_id"
)
locations_router = build_named_list_router(
    model=Location, prefix="/locations", tag="locations", product_field="location_id"
)
