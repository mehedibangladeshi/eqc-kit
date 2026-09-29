# Example Engineering Quality Standard

Version: 1.0
Date: 2026-01-15

## How to read this

Rules are grouped into three tiers. A project reaches a tier when every rule in that tier and in all lower tiers passes. Tags in brackets say where a rule applies: [all], [web], [backend], [mobile].

## Bronze

The basics every project should have from day one.

1. **CI runs on every pull request** [all] A pipeline builds and tests each pull request automatically. Merging is blocked when the pipeline fails.
2. **Linter enforced** [all] A linter is configured and runs in CI with zero errors. Warnings do not hide real problems.
3. **Code formatter configured** [all] A formatter is configured and applied consistently, either by CI check or pre-commit hook.
4. **README has setup instructions** [all] A new developer can install, run, and test the project by following the README alone.
5. **No committed secrets** [all] Source control contains no API keys, passwords, or private tokens. Secrets come from the environment or a secret manager.
6. **Dependency vulnerability audit** [all] Dependencies are audited for known vulnerabilities in CI, and high-severity findings block the build.

## Silver

Habits that keep a growing codebase healthy.

1. **Unit tests exist** [all] Core logic has automated unit tests that run in CI and pass reliably.
2. **Coverage threshold enforced** [all] CI enforces a minimum test coverage percentage, and the build fails when it drops below it.
3. **Structured logging, no stray debug prints** [all] Code uses a logging wrapper with levels. Raw print or console debugging statements do not ship.
4. **Error tracking enabled** [web][backend] Unhandled errors are reported to an error tracking service with enough context to act on.
5. **Configuration comes from the environment** [all] URLs, keys, and feature flags are read from environment or config files, never hardcoded in source.
6. **Database migrations are versioned** [backend] Schema changes are applied through versioned migration files kept in source control.

## Gold

Practices of mature, well-operated projects.

1. **Release automation** [all] Versioning, changelog, and publishing happen through an automated pipeline, not manual steps.
2. **Observability dashboards** [backend] Key service metrics such as latency, errors, and saturation are visible on shared dashboards with alerts.
3. **Architecture decisions recorded** [all] Significant design decisions are documented as short ADRs or architecture docs kept next to the code.
4. **Performance budget defined** [web][mobile] A measurable budget for load time, bundle size, or startup time exists and is checked in CI.
5. **Accessibility and crash reporting** [web][mobile] Interactive elements have accessible labels and contrast, and mobile builds report crashes to a crash reporting service.
