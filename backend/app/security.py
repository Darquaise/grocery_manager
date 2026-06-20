from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError

_ph = PasswordHasher()


def hash_password(plain: str) -> str:
    return _ph.hash(plain)


def verify_password(password_hash: str, plain: str) -> bool:
    try:
        return _ph.verify(password_hash, plain)
    except (VerifyMismatchError, VerificationError):
        return False
