# No postinstall hook — setup runs only via `npx eqc-kit init`

Setup is an explicit, interactive `npx eqc-kit init` (non-interactive: `init --yes --config file.json`), never an npm `postinstall` script. npm 7+ hides lifecycle output and gives scripts no TTY, so prompts hang or are skipped; pnpm and Yarn Berry block dependency install scripts by default; install-time prompts break CI; many repos we target (Go, Python, Swift, Kotlin) have no `package.json`; and security teams flag packages that run code on install.
