"""
Database seeding - creates initial data for development.
"""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .database import async_session
from .models import Parsons, TaskList, TaskListItem, Teacher
from .migrate_tasks import migrate_tasks


async def seed_db():
    """
    Create initial test teacher user and migrate tasks if they don't exist.
    Called on application startup.
    """
    async with async_session() as session:
        # Check if test teacher already exists
        result = await session.execute(
            select(Teacher).where(Teacher.username == "Matti Ruotsalainen")
        )
        existing_teacher = result.scalar_one_or_none()
        
        if existing_teacher is None:
            # Create default test teacher
            test = Teacher(
                username="mattiruotsalainen",
                email="matti.ruotsalainen@example.com"
            )
            test.set_password("test1234")  # Change in production!
            
            session.add(test)
            try:
                await session.commit()
                print("Created default test teacher (username: mattiruotsalainen, password: test1234)")
            except IntegrityError:
                # User was created by another instance in a race condition
                await session.rollback()
                print("Test teacher already exists (created by another instance), skipping seed")
        else:
            print("Test teacher already exists, skipping seed")
    
    # Migrate tasks from parsons_probs/ directory
    print("\nMigrating tasks from parsons_probs/...")
    await migrate_tasks()

    # Create a default task list for the test teacher
    async with async_session() as session:
        teacher_result = await session.execute(
            select(Teacher).where(Teacher.username == "mattiruotsalainen")
        )
        test_teacher = teacher_result.scalar_one_or_none()

        if test_teacher is None:
            print("Test teacher not found, skipping task list seed")
            return

        list_result = await session.execute(
            select(TaskList).where(TaskList.unique_link_code == "starter-list")
        )
        existing_list = list_result.scalar_one_or_none()

        if existing_list is None:
            default_list = TaskList(
                teacher_id=test_teacher.id,
                title="Starter Task List",
                unique_link_code="starter-list",
            )
            session.add(default_list)
            try:
                await session.commit()
                print("Created default task list (unique_link_code: starter-list)")
            except IntegrityError:
                await session.rollback()
                print("Default task list already exists (race condition), skipping seed")
        else:
            print("Default task list already exists, skipping seed")

        # Ensure starter list has two exercises
        starter_list_result = await session.execute(
            select(TaskList).where(TaskList.unique_link_code == "starter-list")
        )
        starter_list = starter_list_result.scalar_one_or_none()

        if starter_list is None:
            print("Starter task list not found, skipping exercise assignment")
            return

        tasks_result = await session.execute(
            select(Parsons).order_by(Parsons.id).limit(2)
        )
        starter_tasks = tasks_result.scalars().all()

        if len(starter_tasks) < 2:
            print("Not enough tasks available to seed two exercises")
            return

        existing_items_result = await session.execute(
            select(TaskListItem).where(TaskListItem.task_list_id == starter_list.id)
        )
        existing_items = existing_items_result.scalars().all()
        existing_task_ids = {item.task_id for item in existing_items}

        new_items = []
        for task in starter_tasks:
            if task.id not in existing_task_ids:
                new_items.append(
                    TaskListItem(task_list_id=starter_list.id, task_id=task.id)
                )

        if new_items:
            session.add_all(new_items)
            try:
                await session.commit()
                print(f"Added {len(new_items)} exercises to starter task list")
            except IntegrityError:
                await session.rollback()
                print("Could not add starter exercises (race condition), skipping")
        else:
            print("Starter task list already has the seeded exercises")
