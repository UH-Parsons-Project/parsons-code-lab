# Testing in the project

## Creating new tests

- Add Python unit tests under `tests/unit/`.
- Follow naming from `pytest.ini`:
	- Files: `test_*.py`
	- Classes: `Test*`
	- Functions: `test_*`
- Keep tests close to the backend behavior they verify (auth, database, API routes, etc.).
- Reuse fixtures from `tests/unit/conftest.py` when possible.

## Running tests

### 1) Set up environment

From repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2) Run Python unit tests (pytest)

```bash
pytest
```

Pytest configuration comes from `pytest.ini` and defaults to `tests/unit`.

### 3) Run tests with coverage

```bash
python -m coverage erase
python -m coverage run -m pytest tests/unit
python -m coverage report -m
```

### 4) Run Playwright tests

Playwright tests are in `tests/*.spec.js` and use global setup from `tests/global-setup.js`.

Run through Docker profile:

```bash
docker compose --profile test up --build --abort-on-container-exit --exit-code-from test
```
