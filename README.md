
[![CI](https://github.com/UH-Parsons-Project/faded-parsons-static/actions/workflows/main.yml/badge.svg)](https://github.com/UH-Parsons-Project/faded-parsons-static/actions/workflows/main.yml)
[![Codecov](https://codecov.io/gh/UH-Parsons-Project/parsons-code-lab/branch/main/graph/badge.svg)](https://codecov.io/gh/UH-Parsons-Project/parsons-code-lab)

# <img src="ohtuproj_logo.png" alt="drawing" width="170"/> PARSONS CODE LAB 
## Educational software for programming practise and learning analytics

**What?**

Parsons Code Lab offers educators a simple way to observe and understand student progress at one glance. By providing a diverse set of statistics on learning outcomes and the challenges students most commonly encounter, the tool helps educators form a clearer picture of individual and class development. Its aim is to support reflective teaching practices by making meaningful patterns in student learning easier to recognize and interpret.

**How?**

Parsons Code Lab lets students practice programming basics by solving Parsons Problems, a type of programming exercise where you rearrange blocks of code and fill in blanks to create a working program. Parsons Code Lab supports two-dimensional, faded, and distractor blocks. It also allows for purely conceptual ordering tasks! You can learn more about Parsons Problems e.g. in this [2022 review by Ericson, et al](https://dl.acm.org/doi/10.1145/3571785.3574127).

The coding problems hosted in Parsons Code Lab are currently written in Python 3, and student submissions are checked for correctness using doctests. The software is straightforward to use; educators can build task sets from a library of ready-made exercises or include their own custom tasks. Each task set can be shared with students through a unique URL, making the whole process easy and smooth. 


### Check it out here:
https://parsonscodelab.web.helsinki.fi


</br>

## Development
Parsons Code Lab is being hosted and developed by the University of Helsinki, Finland. It is in beta phase.

Parsons Code Lab is developed by Julia Roukala, Sebastian Olander, Mira Tihveräinen, Boris Versonnen, Vili Mähönen, Victoria Khoreva, and Santeri Silvennoinen.

Project PI: Laura Sinikallio

#### Original codebase

This codebase is based on the Faded Parsons Problems project found here: https://github.com/pamelafox/faded-parsons-static, which is licensed under the MIT License.
The original project, a static website, allows the user to run Faded Parsons Problems in the browser. It used Pyodide for executing Python doctests and localStorage for storing user progress. The original project contained the functionality and UI for solving faded parsons problems (read from a file) and running predefines tests for feedback on correctness.

The repository was forked in Jan 2026, and this fork was renamed and detached in Feb 2026.

</br>


## Developer guide

**[Project Wiki](https://github.com/UH-Parsons-Project/parsons-code-lab/wiki)**

### Run the software locally:

```
docker compose --profile web up --build
```

The website can be accessed at http://localhost:8000/.

### Run all tests at once:

Run Pytest unittests and Playwright E2E-tests simultaneously.

```
./scripts/run-all-tests.sh
```

## Database migrations

This project uses Alembic for schema migrations.

### Developer workflow

1. Update SQLAlchemy models in `backend/models.py`.
2. Generate a migration:

```bash
docker compose exec -w /usr/src/app web alembic revision --autogenerate -m "describe change"
```

3. Review the generated file under `alembic/versions/`.
4. Apply migrations locally:

```bash
docker compose exec -w /usr/src/app web alembic upgrade head
```

5. Commit both model changes and migration file.

### OpenShift-native automatic migrations

In staging and production, each new pod runs Alembic migrations before the app starts.

- `manifest/staging/deployment.yaml`
- `manifest/production/deployment.yaml`

Container startup command:

```bash
alembic upgrade head && uvicorn backend.main:app --host 0.0.0.0 --port 8000
```


## Misc


[Tuntikirjanpito](https://github.com/UH-Parsons-Project/parsons-code-lab/wiki/Ty%C3%B6aikakirjanpito) (For course work documentation)


**Parsons Code Lab logo by [Victoria Khoreva](https://www.instagram.com/victheliar/)**

<p align="center">
	<img src="ohtuproj_logo.png" alt="drawing" width="600"/>
</p>


