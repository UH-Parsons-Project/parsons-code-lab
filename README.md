[![CI](https://github.com/UH-Parsons-Project/faded-parsons-static/actions/workflows/main.yml/badge.svg)](https://github.com/UH-Parsons-Project/faded-parsons-static/actions/workflows/main.yml)

# Python Faded Parsons Problems

This website allows you to run Faded Parsons Problems in the browser.
It uses Pyodide for executing Python doctests and localStorage for storing user progress.

Check it out here:

https://pamelafox.github.io/faded-parsons-static/index.html

## Running the website

### To run locally:

Build a docker image
```
docker build -t faded-parsons:local .
```
Run the image in the desired port
```
docker run -p 3000:8000 faded-parsons:local
```

## Deploying the website

This website can be deployed anywhere since it's entirely static, and is currently deployed on Github Pages. You can enable Pages on your own fork of the repo to host on Github.

## Adding a new problem

Add two files to the `parson_probs` folder:

* problem_name.py: This should be a Python function that _only_ has the function header, docstring, and doctests. It shouldn't contain the solution.
* problem_name.yaml: This is a YAML file that includes the problem description (HTML) and code lines with blanks.

Then you can access the new problem at problem.html?name=problem_name

## Definition of Done

"Code is validated and tests are passing, docstrings are written, code is reviewed by a peer developer before merging to main branch"

## Sprint Backlogs
- [Sprint 1](https://github.com/orgs/UH-Parsons-Project/projects/5)

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
- on-campus work
