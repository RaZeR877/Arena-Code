# Arena Code model-in-the-loop evaluation

`npm run eval:dry` lists the reproducible benchmark suite without network/model calls.

To run the real suite, start Arena with a real provider and Docker runner enabled:

```bash
AI_API_KEY=... AI_BASE_URL=https://openrouter.ai/api/v1 AI_MODELS=provider/model ARENA_EXECUTION_BACKEND=docker npm start
# Configure and pre-pull ARENA_DOCKER_IMAGE as described in README.md, then:
npm run eval -- --model provider/model
```

On Windows, configure these variables in the shell before launching the server. The evaluation runner creates temporary projects through Arena's API, first confirms that each contract suite fails, asks the selected model to fix it using the same JSON tool protocol, and then runs tests in the Docker backend. It hashes contract tests before and after; changing a contract test invalidates the result. Temporary project folders are deleted after each task. Results are saved locally to `evaluation/results/latest.json` and are not added to source control.

The suite currently covers four deterministic tasks: arithmetic edge-case repair, multi-file slug generation, typed configuration loading, and quoted CSV parsing. Run it on multiple models and machine setups for comparative results. A score is only meaningful for the exact model, prompt suite, runtime configuration, and version of Arena that produced it.

**Safety:** use a disposable development machine and inspect all agent changes. The runner sends project text to the configured AI provider. Docker is a useful hardening layer, not a guarantee against malicious code. Do not point this evaluator at personal or production data.
