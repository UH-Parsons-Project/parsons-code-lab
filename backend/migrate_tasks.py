"""
Migration script to convert task files (YAML + Python) to database records.
Run this script to populate the parsons table from existing task files.

Usage:
    python -m backend.migrate_tasks

    Or from Docker:
    docker compose exec web python -m backend.migrate_tasks
"""

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List

import yaml
from sqlalchemy import select

from backend.database import async_session, init_db
from backend.models import Parsons, Teacher

# Path to the parsons_probs folder
PARSONS_PROBS_DIR = Path(__file__).parent.parent / "parsons_probs"


def parse_code_lines(
    code_lines: str, faded_markers: bool = False
) -> tuple[List[Dict[str, Any]], bool]:
    """
    Convert code_lines string into structured blocks.

    Args:
        code_lines: Multi-line string with code
        faded_markers: Whether the code contains !BLANK markers (indicating Faded type)

    Returns:
        tuple of (blocks list, has_faded boolean)
    """
    blocks = []
    has_faded = False
    block_id = 1

    for line in code_lines.split("\n"):
        if not line.strip():  # Skip empty lines
            continue

        # Calculate indentation
        indent_count = len(line) - len(line.lstrip())
        indent_level = indent_count // 4  # Assume 4 spaces per indent level

        # Check if line has !BLANK marker (faded)
        is_faded = "!BLANK" in line
        if is_faded:
            has_faded = True

        # Remove special markers
        clean_code = line.strip()
        clean_code = re.sub(r"#0given", "", clean_code).strip()
        clean_code = re.sub(
            r"!BLANK", "___", clean_code
        ).strip()  # Replace !BLANK with underscore placeholder

        if not clean_code:
            continue

        block = {
            "id": f"block_{block_id}",
            "code": clean_code,
            "indent": indent_level,
            "faded": is_faded,
        }
        blocks.append(block)
        block_id += 1

    return blocks, has_faded


def get_function_name(function_header: str) -> str:
    """
    Extract function name from Python function header.

    Args:
        function_header: The Python function definition

    Returns:
        Function name
    """
    match = re.search(r"def\s+(\w+)\s*\(", function_header)
    if match:
        return match.group(1)
    return "unknown"


def load_task_file(task_name: str) -> Dict[str, Any] | None:
    """
    Load YAML and Python files for a task and return parsed data.

    Args:
        task_name: Name of the task (without extension)

    Returns:
        Dictionary with parsed task data or None if files not found
    """
    yaml_path = PARSONS_PROBS_DIR / f"{task_name}.yaml"
    py_path = PARSONS_PROBS_DIR / f"{task_name}.py"

    if not yaml_path.exists() or not py_path.exists():
        return None

    try:
        # Load YAML
        with open(yaml_path, "r") as f:
            yaml_data = yaml.safe_load(f)

        # Load Python file
        with open(py_path, "r") as f:
            function_header = f.read().strip()

        # Parse code lines into blocks
        code_lines = yaml_data.get("code_lines", "")
        blocks, has_faded = parse_code_lines(code_lines)

        # Generate correct order based on block IDs
        correct_order = [block["id"] for block in blocks]

        # Determine task type
        task_type = "Faded" if has_faded else "normal"

        # Get test function name
        test_fn = yaml_data.get("test_fn", get_function_name(function_header))

        return {
            "title": task_name,
            "description": yaml_data.get("problem_description", ""),
            "task_type": task_type,
            "code_blocks": {"blocks": blocks, "function_header": function_header},
            "correct_solution": {
                "correct_order": correct_order,
                "test_function": test_fn,
            },
        }

    except Exception as e:
        print(f"Error loading task {task_name}: {e}")
        return None


def get_task_files() -> List[str]:
    """
    Get list of all task names (without extensions).

    Returns:
        List of task names
    """
    if not PARSONS_PROBS_DIR.exists():
        print(f"Directory not found: {PARSONS_PROBS_DIR}")
        return []

    yaml_files = set()
    for file in PARSONS_PROBS_DIR.glob("*.yaml"):
        yaml_files.add(file.stem)

    return sorted(list(yaml_files))


async def get_or_create_default_teacher() -> Parsons | None:
    """
    Get the first teacher, or return None if none exist.
    Tasks need to be created by someone.

    Returns:
        Teacher object or None
    """
    async with async_session() as session:
        stmt = select(Teacher).limit(1)
        result = await session.execute(stmt)
        teacher = result.scalar_one_or_none()
        return teacher


async def task_exists(task_title: str) -> bool:
    """
    Check if a task with this title already exists.

    Args:
        task_title: The task title

    Returns:
        True if task exists
    """
    async with async_session() as session:
        stmt = select(Parsons).where(Parsons.title == task_title).limit(1)
        result = await session.execute(stmt)
        return result.scalar_one_or_none() is not None


async def migrate_tasks():
    """
    Main migration function. Loads all task files and inserts into database.
    """
    print("Starting task migration...")

    # Initialize database
    await init_db()
    print("✓ Database initialized")

    # Get default teacher
    teacher = await get_or_create_default_teacher()
    if not teacher:
        print("✗ No teacher found in database. Please create a teacher first.")
        return

    print(f"✓ Using teacher: {teacher.username} (id={teacher.id})")

    # Get all task files
    task_names = get_task_files()
    if not task_names:
        print("✗ No task files found in parsons_probs/")
        return

    print(f"✓ Found {len(task_names)} task files")

    # Migrate each task
    migrated = 0
    skipped = 0
    failed = 0

    async with async_session() as session:
        for task_name in task_names:
            print(f"\n  Processing: {task_name}...", end=" ")

            # Check if already exists
            if await task_exists(task_name):
                print("SKIPPED (already exists)")
                skipped += 1
                continue

            # Load task data
            task_data = load_task_file(task_name)
            if not task_data:
                print("FAILED (couldn't parse files)")
                failed += 1
                continue

            # Create task record
            task = Parsons(
                created_by_teacher_id=teacher.id,
                title=task_data["title"],
                description=task_data["description"],
                task_type=task_data["task_type"],
                code_blocks=task_data["code_blocks"],
                correct_solution=task_data["correct_solution"],
                is_public=True,
            )

            try:
                session.add(task)
                await session.flush()  # Get the ID
                print(f"✓ MIGRATED (id={task.id}, type={task.task_type})")
                migrated += 1
            except Exception as e:
                print(f"FAILED ({e})")
                failed += 1
                await session.rollback()
                continue

        # Commit all at once
        try:
            await session.commit()
        except Exception as e:
            print(f"\n✗ Failed to commit: {e}")
            return

    # Print summary
    print(f"\n{'=' * 50}")
    print(f"Migration Summary:")
    print(f"  Migrated: {migrated}")
    print(f"  Skipped:  {skipped}")
    print(f"  Failed:   {failed}")
    print(f"  Total:    {len(task_names)}")
    print(f"{'=' * 50}")


async def main():
    """Entry point for the migration script."""
    try:
        await migrate_tasks()
    except Exception as e:
        print(f"Fatal error: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
