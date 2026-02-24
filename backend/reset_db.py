"""
Reset database - drops all tables and recreates them.
Used before running tests to ensure a clean state.

Usage:
    python -m backend.reset_db
"""

import asyncio
from .database import engine, Base


async def reset_db():
    """
    Drop all tables and recreate them from models.
    """
    print("Resetting database...")
    
    async with engine.begin() as conn:
        print("Dropping all tables...")
        await conn.run_sync(Base.metadata.drop_all, checkfirst=True)
        
        print("Creating all tables...")
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)
    
    print("Database reset")


async def main():
    """Main entry point for the script."""
    await reset_db()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
