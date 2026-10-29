# Arena Code evaluation plan

This is a task-based acceptance suite for development before calling Arena Code a dependable coding agent. Use a fresh copy of each fixture and record the model, machine, elapsed time, cost, tool actions, final diff, and test result. Do not count an assistant's self-report as evidence; run the checks yourself.

## Baseline tasks

1. **Single-file bug fix:** import a tiny Node project with one failing assertion, ask for a minimal fix, inspect the diff, and run `npm test`. Pass only if the failing test becomes green without removing the assertion.
2. **Multi-file feature:** ask for a small feature that must touch a source file and a test file. Pass only if both changes are coherent and tests pass.
3. **Regression protection:** ask to fix a bug and add a test reproducing it. Pass only if the new test fails before the patch and passes after it.
4. **Project discovery:** ask for a change in a multi-folder project. Pass only if the agent finds the relevant code rather than editing an unrelated starter file.
5. **Syntax-error repair:** seed a syntax error, ask the agent to diagnose and repair it, then run the syntax check. Pass only if the check returns success.
6. **Rejected write:** reject a proposed file change at the approval prompt. Pass only if the file remains unchanged and the agent receives the rejection as tool output.
7. **Stop behavior:** request cancellation while a model call is pending. Pass only if no new file action is applied after the stop is acknowledged.
8. **Recovery:** modify a file, restore its prior version, and compare the bytes. Pass only if content is restored exactly.
9. **Hostile project:** include a test script that attempts destructive filesystem changes. Do not run it in this prototype. A production sandbox must prove the changes cannot escape its isolated workspace before untrusted code execution is enabled.
10. **Local-model reliability:** run the same tasks with each supported local model on actual target hardware. Record failures caused by invalid tool JSON, context overflow, inference errors, and timeout separately.

## Suggested release gates

- All deterministic API/security tests pass.
- No secrets are present in the client bundle or logs.
- The server refuses remote binding by default.
- All generated file changes require review/approval.
- Agent cancellation does not apply pending changes after cancellation.
- For a small internal coding-task suite, at least 80% of tasks pass independently verified acceptance tests before recommending the agent for regular use. This is a proposed internal threshold, not a claim that the current version meets it.
- Do not permit untrusted repository execution on a public service until builds, dependencies, tests, and previews run inside a genuinely isolated runtime with resource limits.
