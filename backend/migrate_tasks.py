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


def parse_problem_description(html_description: str) -> Dict[str, str]:
    """
    Parse HTML problem description into structured parts.

    Extracts:
    - function_name: The function name from first <code> tag
    - description: Text description without code tags and without function name
    - examples: The <pre><code> block with examples

    Args:
        html_description: HTML formatted problem description

    Returns:
        Dictionary with 'function_name', 'description', 'examples' keys
    """
    result = {"function_name": "", "description": "", "examples": ""}

    # Extract function name from first <code> tag (inline code only, not in <pre>)
    code_match = re.search(r"<code>(\w+)</code>", html_description)
    if code_match:
        result["function_name"] = code_match.group(1)

    # Extract examples from <pre><code>...</code></pre>
    pre_match = re.search(r"<pre><code>(.*?)</code></pre>", html_description, re.DOTALL)
    if pre_match:
        result["examples"] = pre_match.group(1).strip()

    # Extract description text (everything except function name and examples)
    # Remove <pre><code>...</code></pre> (examples) block entirely
    description = re.sub(
        r"<pre><code>.*?</code></pre>", "", html_description, flags=re.DOTALL
    )
    # Remove inline <code>...</code> tags entirely (including the function name inside)
    description = re.sub(r"<code>.*?</code>", "", description)
    # Remove HTML tags: <p>, <br>, </p>, </div>, <div>, etc.
    description = re.sub(r"</?[^>]+>", " ", description)
    # Clean up whitespace
    description = " ".join(description.split())
    result["description"] = description.strip()

    return result


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

        # Check if line is marked as "given" (pre-filled, non-draggable)
        is_given = bool(re.search(r"#[0-9]+given", line))

        # Remove special markers
        clean_code = line.strip()
        clean_code = re.sub(r"#[0-9]+given", "", clean_code).strip()
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
            "given": is_given,
        }
        blocks.append(block)
        block_id += 1

    return blocks, has_faded


def extract_function_signature(function_file: str) -> str:
    """
    Extract only the function signature from a Python file, excluding the docstring.

    Handles both single-line and multi-line function definitions, and strips the docstring.

    Args:
        function_file: The complete Python file content

    Returns:
        Function signature (def line only, without docstring)
    """
    lines = function_file.split("\n")
    signature_lines = []
    in_signature = False
    found_colon = False

    for line in lines:
        # Start collecting when we find the def keyword
        if not in_signature and "def " in line:
            in_signature = True

        if in_signature:
            signature_lines.append(line)
            # Check if this line ends the signature (has the closing colon)
            if ":" in line:
                found_colon = True
                break

    # Join the signature lines and return
    signature = "\n".join(signature_lines).strip()
    return signature


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

        # Load Python file and extract only the function signature (without docstring)
        with open(py_path, "r") as f:
            function_file_content = f.read()
        function_header = extract_function_signature(function_file_content)

        # Parse problem description into structured parts
        html_description = yaml_data.get("problem_description", "")
        parsed_description = parse_problem_description(html_description)

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
            "description": json.dumps(parsed_description),
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
