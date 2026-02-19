[![CI](https://github.com/UH-Parsons-Project/faded-parsons-static/actions/workflows/main.yml/badge.svg)](https://github.com/UH-Parsons-Project/faded-parsons-static/actions/workflows/main.yml)

# Python Faded Parsons Problems

Check it out here:

https://faded-parsons-production-timed-parsons.ext.ocp-prod-0.k8s.it.helsinki.fi/

## Running the website

### To run locally:

```
docker compose up --build
```

### Populate the database:

```
docker compose exec -T web python -m backend.migrate_tasks
```

### Running tests:

Tests use Playwright's global setup to reset the database before running each test.

```
docker compose --profile test up --build --abort-on-container-exit --exit-code-from test
```

The website can be accessed at http://localhost:8000/.

## Adding a new problem

Add two files to the `parson_probs` folder:

* problem_name.py: This should be a Python function that _only_ has the function header, docstring, and doctests. It shouldn't contain the solution.
* problem_name.yaml: This is a YAML file that includes the problem description (HTML) and code lines with blanks.

Then you can access the new problem at problem.html?name=problem_name

## Definition of Done

"Code is validated and tests are passing, docstrings are written, code is reviewed by a peer developer before merging to main branch"

## Product and Sprint Backlogs
[Product Backlog](https://github.com/orgs/UH-Parsons-Project/projects/12)

## Original codebase

This codebase is based on the Faded Parsons Problems project found here: https://github.com/pamelafox/faded-parsons-static, which is licensed under the MIT License.
The original project, a static website, allows the user to run Faded Parsons Problems in the browser. It used Pyodide for executing Python doctests and localStorage for storing user progress. The original project contained the functionality for solving and submitting faded parsons problems which were then automatically tested according to task definitions.

The repository was forked in Jan 2026, and this fork was renamed and detached in Feb 2026.

## Team
Students:
- Julia Roukala
- Sebastian Olander
- Mira Tihveräinen
- Boris Versonnen
- Vili Mähönen
- Victoria Khoreva
- Santeri Silvennoinen

Instructor:
- Sasu Paukku

## Internal team communication 
- Telegram
- Discord
- Meeting up on campus
