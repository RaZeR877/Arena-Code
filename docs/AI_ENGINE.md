# Arena Code 0.11 — Local AI model and reliability upgrade

Arena Code's intelligence comes from the *chosen model*, not from the size of the Arena application. This release adds model discovery, context selection, bounded syntax repair, and two disposable structural evaluation tasks. It does **not** train a new model or make a small model equivalent to frontier coding models.

## Browser edition (free, no keys)

1. Open Arena Code's GitHub Pages site on a WebGPU-compatible browser. Prefer desktop Chrome or Edge with sufficient GPU memory.
2. Open **Free AI engine → Find supported models**. This queries the WebLLM runtime's actual supported-model list without downloading weights.
3. Select a coding-oriented model. A 0.5–1.5B model is lighter; a 3B or 7B model is substantially more demanding. The presence of a model in the list **does not** prove the GPU can run it. Weight downloads and device memory requirements can be several GB.
4. Click **Load selected model** to deliberately download and initialize the weights. Choose **Use in Direct chat** for chat, or open **Browser coding workspace** for reviewed multi-file edits.
5. In the project workspace, enter a task and click **Suggest edits**. Arena selects task-relevant files, sends a bounded prompt, parses the returned JSON patch, and rejects syntactically invalid JS/JSON proposals. It can request one correction. It shows a before/after review before applying any changes. If a model cannot see all the needed code, it must not overwrite omitted/truncated existing files.
6. Click **Test my AI (2 tasks)** to run two **disposable structural tasks**, using the loaded model. This cannot modify your project. It measures JSON edit structure, requested files/identifiers, and parseable source; it **does not execute tests or measure functional correctness**. Downloaded evaluation JSON has the model ID, attempts, outcomes, and elapsed time.

No cloud model inference runs on GitHub Pages, and no API key should ever be entered into the public site. The default starter/demo response is labeled as a template, not AI inference.

## Full local Node app (optional, no paid provider necessary)

Run an OpenAI-compatible local provider such as Ollama behind Arena's localhost server. For example, after installing Ollama and a locally available coding model:

```
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_API_KEY=ollama
AI_MODELS=<exact installed model ID>
```

Configure those variables **in the server environment**, not in source files or browser local storage. This allows using any model compatible with the configured local inference service, limited by your machine.

For meaningful coding quality evidence, run the existing five-task **behavioral** test suite with a real model and an isolated Docker backend (see `EVALUATION.md`):

```
ARENA_EXECUTION_BACKEND=docker npm start
npm run eval -- --model <model-id-from-AI_MODELS>
```

This executes contract tests and evaluates actual code behavior. It needs Docker, an accessible provider and enough compute; it is not equivalent to the browser-only structural test. Do not expose the localhost developer server or Docker socket to the public Internet.

## What remains unverified

- No real WebGPU local model was loaded or benchmarked by this release process. The available browser checks use a **mock** model to verify that the workflow operates correctly.
- Real models can fail JSON formatting, omit required files, or produce logically wrong but syntactically valid code; stronger models and behavioral tests remain important.
- Syntax parsing is deliberately narrow. JS/JSON are checked without executing; TypeScript, modules, HTML/CSS behavior and other languages are marked unverified where a supported parser is unavailable.
- Large repositories require additional indexing, retrieval and multi-step planning beyond the current bounded source selection.
