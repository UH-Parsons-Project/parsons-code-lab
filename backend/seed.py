"""
Database seeding - creates initial data for development.
"""

import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .database import async_session
from .models import Parsons, TaskList, TaskListItem, Teacher, StudentSession, TaskAttempt
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

        # Create sample student sessions and task attempts for statistics
        await seed_student_data(session, starter_list, starter_tasks)


async def seed_student_data(session, task_list, tasks):
    """Create sample student sessions and task attempts for testing statistics."""
    
    if not tasks or len(tasks) < 2:
        print("Not enough tasks available for seeding student data")
        return
    
    # Check if we already have student data
    existing_sessions_result = await session.execute(
        select(StudentSession).where(StudentSession.task_list_id == task_list.id).limit(1)
    )
    if existing_sessions_result.scalar_one_or_none():
        print("Student session data already exists, skipping student data seed")
        return
    
    print("Creating sample student sessions and task attempts...")
    
    base_time = datetime.now(timezone.utc) - timedelta(days=7)
    task1_id = tasks[0].id  # add_in_range
    task2_id = tasks[1].id  # assign_grade
    
    # ===== TASK 1: add_in_range =====
    
    # Student 1: Made off-by-one error with increment
    session1 = StudentSession(
        session_id=uuid.uuid4(),
        task_list_id=task_list.id,
        username="alice_student",
        started_at=base_time,
        last_activity_at=base_time + timedelta(minutes=18)
    )
    session.add(session1)
    await session.flush()
    
    # Failed: used start += 1000 instead of start += 1
    attempt1_1 = TaskAttempt(
        student_session_id=session1.id,
        task_id=task1_id,
        task_started_at=base_time + timedelta(minutes=2),
        completed_at=base_time + timedelta(minutes=4, seconds=30),
        success=False,
        submitted_inputs={"code": "def add_in_range(start, stop):\n    total = 0\n    while start <= stop:\n        total += start\n        start += 1000\n    return total"}
    )
    
    # Failed: forgot to increment start (infinite loop caught by timeout)
    attempt1_2 = TaskAttempt(
        student_session_id=session1.id,
        task_id=task1_id,
        task_started_at=base_time + timedelta(minutes=8),
        completed_at=base_time + timedelta(minutes=9, seconds=15),
        success=False,
        submitted_inputs={"code": "def add_in_range(start, stop):\n    total = 0\n    while start <= stop:\n        total += start\n    return total"}
    )
    
    # Success
    attempt1_3 = TaskAttempt(
        student_session_id=session1.id,
        task_id=task1_id,
        task_started_at=base_time + timedelta(minutes=14),
        completed_at=base_time + timedelta(minutes=17),
        success=True,
        submitted_inputs={"code": "def add_in_range(start, stop):\n    total = 0\n    while start <= stop:\n        total += start\n        start += 1\n    return total"}
    )
    session.add_all([attempt1_1, attempt1_2, attempt1_3])
    
    # Student 2: Quick learner - got it on second try
    session2 = StudentSession(
        session_id=uuid.uuid4(),
        task_list_id=task_list.id,
        username="bob_student",
        started_at=base_time + timedelta(hours=3),
        last_activity_at=base_time + timedelta(hours=3, minutes=12)
    )
    session.add(session2)
    await session.flush()
    
    # Failed: used start += 1000
    attempt2_1 = TaskAttempt(
        student_session_id=session2.id,
        task_id=task1_id,
        task_started_at=base_time + timedelta(hours=3, minutes=2),
        completed_at=base_time + timedelta(hours=3, minutes=4, seconds=20),
        success=False,
        submitted_inputs={"code": "def add_in_range(start, stop):\n    total = 0\n    while start <= stop:\n        total += start\n        start += 1000\n    return total"}
    )
    
    # Success
    attempt2_2 = TaskAttempt(
        student_session_id=session2.id,
        task_id=task1_id,
        task_started_at=base_time + timedelta(hours=3, minutes=8),
        completed_at=base_time + timedelta(hours=3, minutes=11),
        success=True,
        submitted_inputs={"code": "def add_in_range(start, stop):\n    total = 0\n    while start <= stop:\n        total += start\n        start += 1\n    return total"}
    )
    session.add_all([attempt2_1, attempt2_2])
    
    # Student 3: Perfect on first try
    session3 = StudentSession(
        session_id=uuid.uuid4(),
        task_list_id=task_list.id,
        username="charlie_student",
        started_at=base_time + timedelta(hours=6),
        last_activity_at=base_time + timedelta(hours=6, minutes=8)
    )
    session.add(session3)
    await session.flush()
    
    attempt3_1 = TaskAttempt(
        student_session_id=session3.id,
        task_id=task1_id,
        task_started_at=base_time + timedelta(hours=6, minutes=2),
        completed_at=base_time + timedelta(hours=6, minutes=7),
        success=True,
        submitted_inputs={"code": "def add_in_range(start, stop):\n    total = 0\n    while start <= stop:\n        total += start\n        start += 1\n    return total"}
    )
    session.add(attempt3_1)
    
    # Student 4: Made the infinite loop mistake
    session4 = StudentSession(
        session_id=uuid.uuid4(),
        task_list_id=task_list.id,
        username="diana_student",
        started_at=base_time + timedelta(days=1),
        last_activity_at=base_time + timedelta(days=1, minutes=15)
    )
    session.add(session4)
    await session.flush()
    
    # Failed: infinite loop (no increment)
    attempt4_1 = TaskAttempt(
        student_session_id=session4.id,
        task_id=task1_id,
        task_started_at=base_time + timedelta(days=1, minutes=3),
        completed_at=base_time + timedelta(days=1, minutes=4),
        success=False,
        submitted_inputs={"code": "def add_in_range(start, stop):\n    total = 0\n    while start <= stop:\n        total += start\n    return total"}
    )
    
    # Success
    attempt4_2 = TaskAttempt(
        student_session_id=session4.id,
        task_id=task1_id,
        task_started_at=base_time + timedelta(days=1, minutes=10),
        completed_at=base_time + timedelta(days=1, minutes=14),
        success=True,
        submitted_inputs={"code": "def add_in_range(start, stop):\n    total = 0\n    while start <= stop:\n        total += start\n        start += 1\n    return total"}
    )
    session.add_all([attempt4_1, attempt4_2])
    
    # ===== TASK 2: assign_grade =====
    
    # Student 5: Struggled with elif conditions
    session5 = StudentSession(
        session_id=uuid.uuid4(),
        task_list_id=task_list.id,
        username="eve_student",
        started_at=base_time + timedelta(days=2),
        last_activity_at=base_time + timedelta(days=2, minutes=25)
    )
    session.add(session5)
    await session.flush()
    
    # Failed: wrong condition order
    attempt5_1 = TaskAttempt(
        student_session_id=session5.id,
        task_id=task2_id,
        task_started_at=base_time + timedelta(days=2, minutes=3),
        completed_at=base_time + timedelta(days=2, minutes=5, seconds=30),
        success=False,
        submitted_inputs={"code": "def assign_grade(score):\n    if score >= 65:\n        return 'D'\n    elif score >= 70:\n        return 'C'\n    elif score >= 80:\n        return 'B'\n    elif score >= 90:\n        return 'A'\n    else:\n        return 'F'"}
    )
    
    # Failed: missing conditions
    attempt5_2 = TaskAttempt(
        student_session_id=session5.id,
        task_id=task2_id,
        task_started_at=base_time + timedelta(days=2, minutes=12),
        completed_at=base_time + timedelta(days=2, minutes=14),
        success=False,
        submitted_inputs={"code": "def assign_grade(score):\n    if score >= 90:\n        return 'A'\n    elif score >= 80:\n        return 'B'\n    else:\n        return 'F'"}
    )
    
    # Success
    attempt5_3 = TaskAttempt(
        student_session_id=session5.id,
        task_id=task2_id,
        task_started_at=base_time + timedelta(days=2, minutes=18),
        completed_at=base_time + timedelta(days=2, minutes=23),
        success=True,
        submitted_inputs={"code": "def assign_grade(score):\n    if score >= 90:\n        return 'A'\n    elif score >= 80:\n        return 'B'\n    elif score >= 70:\n        return 'C'\n    elif score >= 65:\n        return 'D'\n    else:\n        return 'F'"}
    )
    session.add_all([attempt5_1, attempt5_2, attempt5_3])
    
    # Student 6: Got grade logic right quickly
    session6 = StudentSession(
        session_id=uuid.uuid4(),
        task_list_id=task_list.id,
        username="frank_student",
        started_at=base_time + timedelta(days=3),
        last_activity_at=base_time + timedelta(days=3, minutes=14)
    )
    session.add(session6)
    await session.flush()
    
    # Failed: wrong boundary (>= 65 first catches everything)
    attempt6_1 = TaskAttempt(
        student_session_id=session6.id,
        task_id=task2_id,
        task_started_at=base_time + timedelta(days=3, minutes=2),
        completed_at=base_time + timedelta(days=3, minutes=5),
        success=False,
        submitted_inputs={"code": "def assign_grade(score):\n    if score >= 65:\n        return 'D'\n    elif score >= 70:\n        return 'C'\n    elif score >= 80:\n        return 'B'\n    elif score >= 90:\n        return 'A'\n    else:\n        return 'F'"}
    )
    
    # Success
    attempt6_2 = TaskAttempt(
        student_session_id=session6.id,
        task_id=task2_id,
        task_started_at=base_time + timedelta(days=3, minutes=9),
        completed_at=base_time + timedelta(days=3, minutes=13),
        success=True,
        submitted_inputs={"code": "def assign_grade(score):\n    if score >= 90:\n        return 'A'\n    elif score >= 80:\n        return 'B'\n    elif score >= 70:\n        return 'C'\n    elif score >= 65:\n        return 'D'\n    else:\n        return 'F'"}
    )
    session.add_all([attempt6_1, attempt6_2])
    
    # Student 7: Perfect first attempt on assign_grade
    session7 = StudentSession(
        session_id=uuid.uuid4(),
        task_list_id=task_list.id,
        username="grace_student",
        started_at=base_time + timedelta(days=4),
        last_activity_at=base_time + timedelta(days=4, minutes=9)
    )
    session.add(session7)
    await session.flush()
    
    attempt7_1 = TaskAttempt(
        student_session_id=session7.id,
        task_id=task2_id,
        task_started_at=base_time + timedelta(days=4, minutes=2),
        completed_at=base_time + timedelta(days=4, minutes=8),
        success=True,
        submitted_inputs={"code": "def assign_grade(score):\n    if score >= 90:\n        return 'A'\n    elif score >= 80:\n        return 'B'\n    elif score >= 70:\n        return 'C'\n    elif score >= 65:\n        return 'D'\n    else:\n        return 'F'"}
    )
    session.add(attempt7_1)
    
    try:
        await session.commit()
        print("Created 7 student sessions with 15 task attempts")
        print(f"  - Task {task1_id} (add_in_range): 8 attempts")
        print(f"  - Task {task2_id} (assign_grade): 7 attempts")
    except IntegrityError as e:
        await session.rollback()
        print(f"Error creating student data: {e}")
