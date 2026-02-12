"""
Database seeding - creates initial data for development.
"""

from sqlalchemy import select
from .database import async_session
from .models import Teacher


async def seed_db():
    """
    Create initial test teacher user if it doesn't exist.
    Called on application startup.
    """
    async with async_session() as session:
        # Check if test teacher already exists
        result = await session.execute(
            select(Teacher).where(Teacher.username == "test")
        )
        existing_teacher = result.scalar_one_or_none()
        
        if existing_teacher is None:
            # Create default test teacher
            test = Teacher(
                username="test",
                email="test@example.com"
            )
            test.set_password("test")  # Change in production!
            
            session.add(test)
            await session.commit()
            print("Created default test teacher (username: test, password: test)")
        else:
            print("Test teacher already exists, skipping seed")
