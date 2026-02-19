"""
Database seeding - creates initial data for development.
"""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .database import async_session
from .models import Teacher
from .migrate_tasks import migrate_tasks


async def seed_db():
    """
    Create initial test teacher user and migrate tasks if they don't exist.
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
            try:
                await session.commit()
                print("Created default test teacher (username: test, password: test)")
            except IntegrityError:
                # User was created by another instance in a race condition
                await session.rollback()
                print("Test teacher already exists (created by another instance), skipping seed")
        else:
            print("Test teacher already exists, skipping seed")
    
    # Migrate tasks from parsons_probs/ directory
    print("\nMigrating tasks from parsons_probs/...")
    await migrate_tasks()
