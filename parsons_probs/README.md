# Adding a new Parsons problem

This folder contains one problem as a pair of files:

- `<problem_name>.py` (function signature + doctests)
- `<problem_name>.yaml` (task metadata + code blocks shown in UI)

Both files must have the same name.

## 1) Create the two files

Example for a new task `my_new_task`:

- `parsons_probs/my_new_task.py`
- `parsons_probs/my_new_task.yaml`

## 2) Add the Python file (`.py`)

The Python file is used for function header and doctest-based validation.

Template:

```python
def my_new_task(arg1, arg2):
    """
    >>> my_new_task(1, 2)
    3
    >>> my_new_task(5, 7)
    12
    """
```

Notes:

- Keep doctests inside the docstring.
- Use the same function name here and in YAML (`test_fn`).
- The frontend grader runs doctests from this definition.

## 3) Add the YAML file (`.yaml`)

Template:

```yaml
problem_name: my_new_task

task_instructions: |
  Short instruction for the student.

problem_description: |
  <code>my_new_task</code> does something useful.<br>
  <pre><code>
  >>> my_new_task(1, 2)
  3
  >>> my_new_task(5, 7)
  12
  </code></pre>

code_lines: |
  def my_new_task(arg1, arg2): #0given
  result = !BLANK
  return result

test_fn: my_new_task
```

Required/important fields:

- `problem_name`: task name
- `problem_description`: shown in UI (HTML format used in existing tasks)
- `code_lines`: one code line per row
- `test_fn`: function name to test

Optional field:

- `task_instructions`

### `code_lines` markers

- `!BLANK` creates a faded placeholder (`___`) in the task.
- `#0given` (or `#1given`, etc.) marks a line as pre-filled/non-draggable.

If `code_lines` has at least one `!BLANK`, task type becomes `Faded`; otherwise it is `normal`.

## 4) Load the task into database

Tasks are migrated from this folder into DB.

### Local (venv)

```bash
source .venv/bin/activate
python -m backend.migrate_tasks
```

### Docker (web profile running)

```bash
docker compose exec web python -m backend.migrate_tasks
```

If you are running the app with auto-reload, the new task should appear after migration.

## 5) Quick checklist

- File names match: `<name>.py` and `<name>.yaml`
- Function name matches `test_fn`
- Doctests exist and are correct
- `code_lines` indentation is intentional (4-space levels)
- Migration command runs without errors
