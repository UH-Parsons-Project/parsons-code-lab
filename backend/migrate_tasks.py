"""
Migration script to convert task files (YAML + Python) to database records.
Run this script to populate the parsons table from existing task files.

Usage:
    python -m backend.migrate_tasks

    Or from Docker (ensure web service is running with --profile web):
    docker compose exec web python -m backend.migrate_tasks
"""

import asyncio
import json
import re
from pathlib import Path
from typing import Any, Dict, List

import yaml
from sqlalchemy import select

from backend.database import async_session
from backend.models import ModelAnswer, Parsons, Teacher

# Path to the parsons_probs folder
PARSONS_PROBS_DIR = Path(__file__).parent.parent / "parsons_probs"


def parse_problem_instructions(html_instructions: str) -> Dict[str, str]:
    """
    Parse HTML problem instructions into structured parts.

    Extracts:
    - function_name: The function name from first <code> tag
    - task_instructions: Text instructions without code tags and without function name
    - examples: The <pre><code> block with examples

    Args:
        html_instructions: HTML formatted problem instructions

    Returns:
        Dictionary with 'function_name', 'task_instructions', 'examples' keys
    """
    result = {"function_name": "", "task_instructions": "", "examples": ""}

    # Extract function name from first <code> tag (inline code only, not in <pre>)
    code_match = re.search(r"<code>(\w+)</code>", html_instructions)
    if code_match:
        result["function_name"] = code_match.group(1)

    # Extract examples from <pre><code>...</code></pre>
    pre_match = re.search(r"<pre><code>(.*?)</code></pre>", html_instructions, re.DOTALL)
    if pre_match:
        result["examples"] = pre_match.group(1).strip()

    # Extract instruction text (everything except function name and examples)
    # Remove <pre><code>...</code></pre> (examples) block entirely
    task_instructions = re.sub(
        r"<pre><code>.*?</code></pre>", "", html_instructions, flags=re.DOTALL
    )
    # Remove inline <code>...</code> tags entirely (including the function name inside)
    task_instructions = re.sub(r"<code>.*?</code>", "", task_instructions)
    # Remove HTML tags: <p>, <br>, </p>, </div>, <div>, etc.
    task_instructions = re.sub(r"</?[^>]+>", " ", task_instructions)
    # Clean up whitespace
    task_instructions = " ".join(task_instructions.split())
    result["task_instructions"] = task_instructions.strip()

    return result


def parse_code_lines(code_lines: str) -> tuple[List[Dict[str, Any]], bool]:
    """
    Convert code_lines string into structured blocks.

    Args:
        code_lines: Multi-line string with code

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
    Extract the function definition including the docstring from a Python file.

    Handles both single-line and multi-line function definitions, and includes the docstring.

    Args:
        function_file: The complete Python file content

    Returns:
        Function definition with docstring (everything up to and including the docstring)
    """
    lines = function_file.split("\n")
    result_lines = []
    in_function = False
    in_docstring = False
    docstring_quote = None

    for line in lines:
        # Start collecting when we find the def keyword
        if not in_function and line.strip().startswith("def "):
            in_function = True

        if in_function:
            result_lines.append(line)

            # Check for docstring start
            stripped = line.strip()
            if not in_docstring:
                # Check for docstring opening (""" or ''')
                if '"""' in stripped or "'''" in stripped:
                    docstring_quote = '"""' if '"""' in stripped else "'''"
                    in_docstring = True
                    # Check if it's a one-line docstring
                    if stripped.count(docstring_quote) >= 2:
                        # One-line docstring, we're done
                        break
            else:
                # We're in a docstring, check for closing
                if docstring_quote and docstring_quote in stripped:
                    # Docstring ended, we're done
                    break

    return "\n".join(result_lines)


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
        with open(yaml_path, "r", encoding="utf-8") as f:
            yaml_data = yaml.safe_load(f)

        # Load Python file and extract the function definition (including docstring)
        with open(py_path, "r", encoding="utf-8") as f:
            function_file_content = f.read()
        function_header = extract_function_signature(function_file_content)

        # Parse task instructions into structured parts
        html_instructions = yaml_data.get("task_instructions", "")
        parsed_instructions = parse_problem_instructions(html_instructions)

        # Store the original YAML problem_description text as task description.
        # Keep a fallback to legacy "description" for older files.
        description = yaml_data.get("problem_description", yaml_data.get("description", ""))
        if description is None:
            description = ""

        # Parse code lines into blocks
        code_lines = yaml_data.get("code_lines", "")
        blocks, has_faded = parse_code_lines(code_lines)

        # Load model answer code to reconstruct solution_code and set block indentations
        model_answer_code = load_model_answer_file(task_name)
        if model_answer_code:
            md_lines = [line for line in model_answer_code.split("\n") if line.strip()]
            if len(blocks) == len(md_lines):
                for block, md_line in zip(blocks, md_lines):
                    indent_count = len(md_line) - len(md_line.lstrip())
                    block["indent"] = indent_count // 4

        # Generate correct order based on block IDs
        correct_order = [block["id"] for block in blocks]

        # Determine task type
        task_type = yaml_data.get("task_type") or yaml_data.get("tag")
        if not task_type:
            desc_lower = description.lower()
            if "loop" in desc_lower:
                task_type = "loops"
            elif "if-" in desc_lower or "conditional" in desc_lower:
                task_type = "conditionals"
            elif "math" in desc_lower or "arithmetic" in desc_lower:
                task_type = "arithmetic"
            elif "list" in desc_lower:
                task_type = "lists"
            elif "comparison" in desc_lower or "boolean" in desc_lower:
                task_type = "booleans"
            elif "string" in desc_lower:
                task_type = "strings"
            elif "function" in desc_lower:
                task_type = "functions"
            elif "dictionar" in desc_lower:
                task_type = "dictionaries"
            else: task_type = "other"

        # Get test function name
        test_fn = yaml_data.get("test_fn", get_function_name(function_header))

        solution_code = None
        if model_answer_code:
            # Reconstruct solution_code with !BLANK markers and proper indentation
            yaml_lines = []
            for line in code_lines.split("\n"):
                if not line.strip():
                    continue
                clean = line.strip()
                clean = re.sub(r"#[0-9]+given", "", clean).strip()
                if clean:
                    yaml_lines.append(clean)

            md_lines = [line for line in model_answer_code.split("\n") if line.strip()]

            if len(yaml_lines) == len(md_lines):
                result_lines = []
                for yaml_line, md_line in zip(yaml_lines, md_lines):
                    indent_count = len(md_line) - len(md_line.lstrip())
                    indent_spaces = " " * indent_count
                    result_lines.append(indent_spaces + yaml_line)
                solution_code = "\n".join(result_lines)
            else:
                solution_code = model_answer_code

        def _strip_comment(text: str) -> str:
            if " #" in text:
                return text.split(" #", 1)[0].rstrip()
            if "#" in text:
                return text.split("#", 1)[0].rstrip()
            return text.rstrip()

        # Generate teacher tests assertions from examples
        examples = parsed_instructions.get("examples", "")
        teacher_tests = ""
        if examples:
            assertions = []
            lines = examples.split("\n")
            i = 0
            while i < len(lines):
                line = lines[i].strip()
                if line.startswith(">>>"):
                    code_expr = _strip_comment(line[3:].strip())

                    if i + 1 < len(lines):
                        next_line = _strip_comment(lines[i+1].strip())

                        if not next_line.startswith(">>>") and next_line:
                            assertions.append(f"assert {code_expr} == {next_line}")
                            i += 2
                            continue
                    assertions.append(code_expr)
                    i += 1
                else:
                    i += 1
            teacher_tests = "\n".join(assertions)

        return {
            "title": task_name,
            "task_instructions": json.dumps(parsed_instructions),
            "description": description,
            "task_type": task_type,
            "faded": has_faded,
            "code_blocks": {"blocks": blocks, "function_header": function_header},
            "correct_solution": {
                "correct_order": correct_order,
                "test_function": test_fn,
                "solution_code": solution_code or "",
                "teacher_tests": teacher_tests,
            },
        }

    except Exception as e:
        print(f"Error loading task {task_name}: {e}")
        return None


def load_model_answer_file(task_name: str) -> str | None:
    """Load model answer code from a task markdown file if present."""
    md_path = PARSONS_PROBS_DIR / f"{task_name}.md"

    if not md_path.exists():
        return None

    try:
        content = md_path.read_text(encoding="utf-8").strip()
        if not content:
            return None

        # Local model answer files store newlines as escaped literals.
        return content.replace("\\n", "\n").replace("\\t", "\t")
    except Exception as e:
        print(f"Error loading model answer for {task_name}: {e}")
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
    model_answers_added = 0
    skipped = 0
    failed = 0

    async with async_session() as session:
        for task_name in task_names:
            print(f"\n  Processing: {task_name}...", end=" ")

            model_answer_code = load_model_answer_file(task_name)

            # Check if already exists
            if await task_exists(task_name):
                if model_answer_code:
                    task_result = await session.execute(
                        select(Parsons).where(Parsons.title == task_name).limit(1)
                    )
                    existing_task = task_result.scalar_one_or_none()

                    if existing_task:
                        existing_model_result = await session.execute(
                            select(ModelAnswer)
                            .where(ModelAnswer.parsons_id == existing_task.id)
                            .limit(1)
                        )
                        existing_model = existing_model_result.scalar_one_or_none()

                        if not existing_model:
                            model_answer = ModelAnswer(
                                parsons_id=existing_task.id,
                                created_by_teacher_id=teacher.id,
                                answer_code=model_answer_code,
                            )
                            session.add(model_answer)
                            await session.flush()
                            print("SKIPPED (already exists), ADDED model answer")
                            model_answers_added += 1
                            skipped += 1
                            continue

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
                task_instructions=task_data["task_instructions"],
                description=task_data["description"],
                task_type=task_data["task_type"],
                faded=task_data["faded"],
                code_blocks=task_data["code_blocks"],
                correct_solution=task_data["correct_solution"],
                is_public=True,
            )

            try:
                session.add(task)
                await session.flush()  # Get the ID

                if model_answer_code:
                    model_answer = ModelAnswer(
                        parsons_id=task.id,
                        created_by_teacher_id=teacher.id,
                        answer_code=model_answer_code,
                    )
                    session.add(model_answer)

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
    print(f"  Model answers added: {model_answers_added}")
    print(f"  Skipped:  {skipped}")
    print(f"  Failed:   {failed}")
    print(f"  Total:    {len(task_names)}")
    print(f"{'=' * 50}")


async def main():
    """Entry point for the migration script."""
    await migrate_tasks()


if __name__ == "__main__":
    asyncio.run(main())
