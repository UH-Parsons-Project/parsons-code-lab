"""
Database seeding - creates initial data for development.
"""

from sqlalchemy import select
from .database import async_session
from .models import Teacher


async def seed_db():
    """
    Create initial teacher user if it doesn't exist.
    Called on application startup.
    """
    async with async_session() as session:
        # Check if admin teacher already exists
        result = await session.execute(
            select(Teacher).where(Teacher.username == "admin")
        )
        existing_teacher = result.scalar_one_or_none()
        
        if existing_teacher is None:
            # Create default admin teacher
            admin = Teacher(
                username="test",
                email="test@example.com"
            )
            admin.set_password("test")  # Change in production!
            
            session.add(admin)
            await session.commit()
            print("Created default admin teacher (username: test, password: test)")
        else:
            print("Admin teacher already exists, skipping seed")
