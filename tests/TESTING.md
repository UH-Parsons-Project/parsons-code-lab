# Running Tests

This project includes a comprehensive unit test suite for the backend.

## Prerequisites

Install the test dependencies:

```bash
pip install -r requirements.txt
```

## Running Tests

### Run all tests
```bash
pytest tests/unit/
```

### Run tests with verbose output
```bash
pytest tests/unit/ -v
```

### Run tests with coverage report
```bash
pytest tests/unit/ --cov=backend --cov-report=html --cov-report=term
```

### Run specific test file
```bash
pytest tests/unit/test_models.py
pytest tests/unit/test_auth.py
pytest tests/unit/test_main.py
```

### Run specific test class
```bash
pytest tests/unit/test_models.py::TestTeacherModel
pytest tests/unit/test_auth.py::TestAuthenticateUser
```

### Run specific test
```bash
pytest tests/unit/test_auth.py::TestAuthenticateUser::test_authenticate_valid_user
```

## Test Coverage

After running tests with coverage, open the HTML report:

```bash
# Linux
xdg-open htmlcov/index.html

# macOS
open htmlcov/index.html
```

## Test Structure

- `tests/unit/conftest.py` - Pytest fixtures and configuration
- `tests/unit/test_models.py` - Tests for database models (10 tests)
- `tests/unit/test_auth.py` - Tests for authentication module (15 tests)
- `tests/unit/test_main.py` - Tests for API endpoints (18 tests)

## CI/CD Integration

Tests run automatically in GitHub Actions:
- **On every push/PR**: Unit tests + Playwright tests
- **Before staging deployment**: Unit tests must pass
- **Before production deployment**: Unit tests must pass

To run tests locally as CI does:

```bash
pytest tests/unit/ -v --cov=backend --cov-report=xml --cov-report=term
```