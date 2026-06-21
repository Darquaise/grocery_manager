import json
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import (
    ExpiryMode,
    Product,
    ShoppingListItem,
    ShoppingSource,
    ShoppingState,
    ShoppingTrip,
    StockItem,
    User,
)
from ..shopping_logic import STATUS_FULL, is_status, reconcile_auto_items
from .deps import current_user

router = APIRouter(prefix="/shopping", tags=["shopping"], dependencies=[Depends(current_user)])


# ── Active list ───────────────────────────────────────────────────────────────


class PlanEntry(BaseModel):
    """One package to add to stock when the trip completes."""

    size: int | None = None
    expiry_date: date | None = None


class ShoppingItemIn(BaseModel):
    display_name: str
    amount_text: str | None = None
    product_id: int | None = None


class ShoppingItemUpdate(BaseModel):
    state: ShoppingState | None = None
    amount_text: str | None = None
    # The packages to add to stock on completion (set when checking off).
    purchase_plan: list[PlanEntry] | None = None


@router.get("/items", response_model=list[ShoppingListItem])
def list_items(session: Session = Depends(get_session)):
    """The active list: open + in-cart entries, minus snoozed auto entries."""
    return session.exec(
        select(ShoppingListItem)
        .where(
            ShoppingListItem.state.in_([ShoppingState.open, ShoppingState.in_cart]),
            ShoppingListItem.ignored_until_restock == False,  # noqa: E712
        )
        .order_by(ShoppingListItem.display_name)
    ).all()


@router.post("/items", response_model=ShoppingListItem, status_code=status.HTTP_201_CREATED)
def add_item(
    data: ShoppingItemIn,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Add a manual item (with optional amount) or a free one-off (no product)."""
    item = ShoppingListItem(
        display_name=data.display_name,
        amount_text=data.amount_text,
        product_id=data.product_id,
        source=ShoppingSource.manual,
        added_by=user.id,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.patch("/items/{item_id}", response_model=ShoppingListItem)
def update_item(
    item_id: int,
    data: ShoppingItemUpdate,
    session: Session = Depends(get_session),
):
    """Check off / un-check (open <-> inCart), edit the amount text, or record the
    purchase plan (quantity + expiry dates) used when the trip is completed."""
    item = session.get(ShoppingListItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
    fields = data.model_dump(exclude_unset=True)
    if "amount_text" in fields:
        item.amount_text = fields["amount_text"]
    if "purchase_plan" in fields:
        plan = fields["purchase_plan"]
        item.purchase_plan = json.dumps(plan, default=str) if plan is not None else None
    if fields.get("state") is not None:
        item.state = fields["state"]
        if item.state == ShoppingState.in_cart:
            _get_or_create_active_trip(session)  # first check-off starts the trip
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    session: Session = Depends(get_session),
):
    """Remove an entry. Auto entries are *snoozed* (kept hidden until the product
    is refilled and drops below its threshold again); manual entries are deleted."""
    item = session.get(ShoppingListItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
    if item.source == ShoppingSource.auto:
        item.ignored_until_restock = True
        session.add(item)
    else:
        session.delete(item)
    session.commit()


# ── Trips / archive ───────────────────────────────────────────────────────────


class CompleteTripIn(BaseModel):
    total_price: float | None = None


class TripItemOut(BaseModel):
    display_name: str
    amount_text: str | None = None
    source: str
    product_id: int | None = None
    added_by: int | None = None


class TripOut(BaseModel):
    id: int
    started_at: datetime
    completed_at: datetime | None
    completed_by: int | None
    total_price: float | None
    items: list[TripItemOut]


def _trip_out(trip: ShoppingTrip) -> TripOut:
    items = [TripItemOut(**i) for i in json.loads(trip.items_json or "[]")]
    return TripOut(
        id=trip.id,
        started_at=trip.started_at,
        completed_at=trip.completed_at,
        completed_by=trip.completed_by,
        total_price=trip.total_price,
        items=items,
    )


def _get_or_create_active_trip(session: Session) -> ShoppingTrip:
    trip = session.exec(
        select(ShoppingTrip).where(ShoppingTrip.completed_at.is_(None))
    ).first()
    if trip is None:
        trip = ShoppingTrip(started_at=datetime.now(UTC))
        session.add(trip)
        session.flush()
    return trip


def _materialize_stock(
    session: Session, product: Product, plan_json: str | None, user: User
) -> None:
    """Turn an item's purchase plan into StockItems. Missing plan = one package."""
    try:
        plan = json.loads(plan_json) if plan_json else []
    except (ValueError, TypeError):
        plan = []
    if not plan:
        plan = [{}]  # checked off without the dialog -> one default package

    today = date.today()
    for entry in plan:
        if product.can_expire == ExpiryMode.expiry:
            raw = entry.get("expiry_date")
            expiry = date.fromisoformat(raw) if raw else None
            purchase = None
        elif product.can_expire == ExpiryMode.purchase_date:
            expiry, purchase = None, today
        else:
            expiry, purchase = None, None

        if is_status(product):
            session.add(
                StockItem(
                    product_id=product.id,
                    status_level=STATUS_FULL,
                    expiry_date=expiry,
                    purchase_date=purchase,
                    updated_by=user.id,
                )
            )
        else:
            size = entry.get("size") or product.package_size
            session.add(
                StockItem(
                    product_id=product.id,
                    size=size,
                    remaining=size,
                    expiry_date=expiry,
                    purchase_date=purchase,
                    updated_by=user.id,
                )
            )


@router.post("/complete", response_model=TripOut)
def complete_trip(
    data: CompleteTripIn,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Finish the active trip: archive the bought (in-cart) entries, materialise
    their planned packages into stock, and clear them off the active list.
    Unchecked entries stay on the list for next time."""
    bought = session.exec(
        select(ShoppingListItem).where(ShoppingListItem.state == ShoppingState.in_cart)
    ).all()
    if not bought:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "nothing in the cart")

    snapshot: list[dict] = []
    for item in bought:
        snapshot.append(
            {
                "display_name": item.display_name,
                "amount_text": item.amount_text,
                "source": item.source.value,
                "product_id": item.product_id,
                "added_by": item.added_by,
            }
        )
        if item.product_id is not None:
            product = session.get(Product, item.product_id)
            if product and product.deleted_at is None:
                _materialize_stock(session, product, item.purchase_plan, user)
        session.delete(item)

    trip = _get_or_create_active_trip(session)
    trip.items_json = json.dumps(snapshot, ensure_ascii=False)
    trip.completed_at = datetime.now(UTC)
    trip.completed_by = user.id
    trip.total_price = data.total_price
    session.add(trip)

    session.flush()
    reconcile_auto_items(session)  # refilled products drop off the auto list
    session.commit()
    session.refresh(trip)
    return _trip_out(trip)


@router.get("/trips", response_model=list[TripOut])
def list_trips(session: Session = Depends(get_session)):
    trips = session.exec(
        select(ShoppingTrip)
        .where(ShoppingTrip.completed_at.is_not(None))
        .order_by(ShoppingTrip.completed_at.desc())
    ).all()
    return [_trip_out(t) for t in trips]


@router.get("/trips/{trip_id}", response_model=TripOut)
def get_trip(
    trip_id: int,
    session: Session = Depends(get_session),
):
    trip = session.get(ShoppingTrip, trip_id)
    if not trip or trip.completed_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    return _trip_out(trip)
