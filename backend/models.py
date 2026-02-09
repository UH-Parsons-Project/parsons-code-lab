"""
Database models for the application.
"""

from datetime import datetime
from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from passlib.hash import bcrypt

from .database import Base


class Teacher(Base):
    """Teacher user model."""
    
    __tablename__ = "teachers"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    def set_password(self, password: str) -> None:
        """Hash and set the password."""
        self.password_hash = bcrypt.hash(password)

    def verify_password(self, password: str) -> bool:
        """Verify a password against the stored hash."""
        return bcrypt.verify(password, self.password_hash)
