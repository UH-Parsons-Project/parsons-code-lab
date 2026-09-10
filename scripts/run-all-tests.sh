#!/usr/bin/env bash
set -euo pipefail

# Run both unittest and playwright services concurrently in the test profile.
# Then check each service exit code explicitly.
compose_cmd=(docker compose --profile test)

SKIP_BUILD=false
for arg in "$@"; do
  if [[ "$arg" == "--no-build" || "$arg" == "--fast" ]]; then
    SKIP_BUILD=true
  fi
done

if [[ "${SKIP_BUILD}" == "false" ]]; then
  echo "Building test profile services..."
  "${compose_cmd[@]}" build
else
  echo "Skipping container build step..."
fi

# Start only infrastructure in background.
"${compose_cmd[@]}" up -d db-test web-test

# Run both test services concurrently and wait for both to finish.
set +e
"${compose_cmd[@]}" run --rm unittest &
unit_pid=$!

"${compose_cmd[@]}" run --rm test &
playwright_pid=$!

wait "${unit_pid}"
unit_exit=$?

wait "${playwright_pid}"
playwright_exit=$?
set -e

# Clean up background infrastructure.
"${compose_cmd[@]}" down --remove-orphans

if [[ "${unit_exit}" == "0" && "${playwright_exit}" == "0" ]]; then
  echo "All tests passed!"
  exit 0
fi

echo "Tests failed (unittest=${unit_exit}, playwright=${playwright_exit})"
exit 1

