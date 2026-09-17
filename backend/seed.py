"""
Database seeding - creates initial data for development.
"""

import os
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .database import async_session
from .models import Parsons, TaskSet, TaskSetItem, Teacher, RegistrationToken
from .migrate_tasks import migrate_tasks
from backend.utils import hash_token
from backend.utils.task_types import ensure_default_task_types


async def seed_db():
    """
    Create initial test teacher user and migrate tasks if they don't exist.
    Called on application startup.
    """
    async with async_session() as session:
        # Check if test teacher already exists
        result = await session.execute(
            select(Teacher).where(Teacher.username == "mattiruotsalainen")
        )
        existing_teacher = result.scalar_one_or_none()
        teacher_to_use = None

        if existing_teacher is None:
            # Create default test teacher
            test = Teacher(
                username="mattiruotsalainen",
                email="matti.ruotsalainen@example.com",
                is_admin_teacher=True
            )
            test.set_password("test1234")  # Change in production!

            session.add(test)
            try:
                await session.commit()
                await session.refresh(test)
                teacher_to_use = test
                print("Created default test teacher (username: mattiruotsalainen, password: test1234)")
            except IntegrityError:
                # User was created by another instance in a race condition
                await session.rollback()
                print("Test teacher already exists (created by another instance), skipping seed")
        else:
            teacher_to_use = existing_teacher
            print("Test teacher already exists, skipping seed")

        # Create a registration token for testing if TEACHER_REGISTRATION_TOKEN is set
        registration_token = os.getenv("TEACHER_REGISTRATION_TOKEN")
        if registration_token and teacher_to_use:
            token_hash = hash_token(registration_token)
            reg_token = RegistrationToken(
                token_hash=token_hash,
                created_by_admin_id=teacher_to_use.id,
                expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            )
            session.add(reg_token)
            try:
                await session.commit()
                print("Created registration token from TEACHER_REGISTRATION_TOKEN environment variable")
            except IntegrityError:
                await session.rollback()
                print("Registration token already exists, skipping seed")

    # Migrate tasks from parsons_probs/ directory
    print("\nMigrating tasks from parsons_probs/...")
    await migrate_tasks()

    async with async_session() as session:
        await ensure_default_task_types(session)
        await session.commit()

    # Create a default task set for the test teacher
    async with async_session() as session:
        teacher_result = await session.execute(
            select(Teacher).where(Teacher.username == "mattiruotsalainen")
        )
        test_teacher = teacher_result.scalar_one_or_none()

        if test_teacher is None:
            print("Test teacher not found, skipping task set seed")
            return

        list_result = await session.execute(
            select(TaskSet).where(TaskSet.unique_link_code == "starter-list")
        )
        existing_list = list_result.scalar_one_or_none()

        if existing_list is None:
            default_list = TaskSet(
                teacher_id=test_teacher.id,
                title="Starter List",
                unique_link_code="starter-list",
                teacher_description="Template starter list containing 2 foundational exercises for beginners. Use this as a reference for creating your own exercise collections. Students can attempt each exercise multiple times with instant feedback. View student progress and statistics through the dashboard. Part of Helsinki University's Parsons Code Lab project.",
                student_description="A beginner-friendly collection of foundational programming exercises designed to help you learn core concepts. This starter set includes two carefully selected tasks that progressively build your understanding. Each exercise includes clear instructions and starter code to help you get started. You can run and test your code as many times as needed until you're ready to submit.",
            )
            session.add(default_list)
            try:
                await session.commit()
                print("Created default task set (unique_link_code: starter-list)")
            except IntegrityError:
                await session.rollback()
                print("Default task set already exists (race condition), skipping seed")
        else:
            print("Default task set already exists, skipping seed")

        # Ensure starter list has two exercises
        starter_list_result = await session.execute(
            select(TaskSet).where(TaskSet.unique_link_code == "starter-list")
        )
        starter_list = starter_list_result.scalar_one_or_none()

        if starter_list is None:
            print("Starter task set not found, skipping exercise assignment")
            return

        tasks_result = await session.execute(
            select(Parsons).order_by(Parsons.id).limit(2)
        )
        starter_tasks = tasks_result.scalars().all()

        if len(starter_tasks) < 2:
            print("Not enough tasks available to seed two exercises")
            return

        existing_items_result = await session.execute(
            select(TaskSetItem).where(TaskSetItem.task_set_id == starter_list.id)
        )
        existing_items = existing_items_result.scalars().all()
        existing_task_ids = {item.task_id for item in existing_items}

        new_items = []
        for task in starter_tasks:
            if task.id not in existing_task_ids:
                new_items.append(
                    TaskSetItem(task_set_id=starter_list.id, task_id=task.id)
                )

        if new_items:
            session.add_all(new_items)
            try:
                await session.commit()
                print(f"Added {len(new_items)} exercises to starter task set")
            except IntegrityError:
                await session.rollback()
                print("Could not add starter exercises (race condition), skipping")
        else:
            print("Starter task set already has the seeded exercises")
