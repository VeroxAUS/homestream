# ci-metrics

Timing records of the CI runs on main, one JSON file per run in `runs/`. Written by the "CI timing" job of
.github/workflows/ci.yml (scripts/ci-timing.mjs); nothing else is stored here and nothing is ever deleted.
See docs/ci.md in the main branch for the format and how the comparison works.
