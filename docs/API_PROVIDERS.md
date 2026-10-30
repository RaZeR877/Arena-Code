# Vynqode — AI provider setup (v0.14)

Vynqode offers a **single assistant** with multiple interchangeable inference providers. This is an API connector for the coding assistant and reviewed project edits, **not** an embedded ChatGPT account or subscription. ChatGPT Plus/Pro subscriptions do not automatically provide OpenAI API usage; API calls may incur separate charges.

## Safe design

The **GitHub Pages edition cannot securely accept OpenAI/Claude/Gemini secret API keys**. Never paste paid API keys into the page, JavaScript, GitHub repository, Actions variables exposed to builds, or browser local storage. Its API picker displays available integrations and points to secure setup, but API execution remains unavailable until you run the Node backend at the **same origin**. The free browser-local WebLLM path still works without credentials.

The local Node server is **localhost-only by default**. Requests to `/api/ide/providers` report provider availability and allowed model IDs without exposing credentials. The browser sends coding context to `/api/ide/complete` at that same origin; the server attaches credentials and forwards requests to the chosen provider. `/api/ide/complete` has request/response size limits, a timeout, per-minute rate limits, origin validation, and a provider/model allowlist. Neither endpoint works in publicly bound or hosted mode. **Do not expose the default Node service or this proxy to the Internet.** Public deployment needs its own authenticated backend, request budgets and CSRF safeguards.

## New: paste a key inside local Vynqode

When you run the Node application at **http://127.0.0.1:3000**, click **Connect AI → API providers**, choose OpenAI/Claude/Gemini or another API provider, and use **API KEY → Connect key for this session**. Then choose an allowed model and **Use selected API**.

- The key is submitted directly to **your own localhost server**, held in **process memory only**, and removed when the server stops. Use **Remove session key** to clear it earlier. If a key was also set as an environment variable, that environment key remains available.
- Keys are not persisted to localStorage, written to disk, returned by provider discovery, or included in the Pages build. The input clears after submitting.
- The route requires a matching localhost browser Origin and is disabled in remote and hosted modes. This is a convenient *local-development* workflow, not a hardened public credential vault.
- On GitHub Pages, the key field is hidden and a setup guide is displayed instead.

**Alternative:** Set `OPENAI_API_KEY` or the applicable provider environment variable in your shell before running Vynqode. You do not need to paste a key into the UI when the environment is configured.

## Quick start

Requirements: Node 20 or newer, git clone of the **main** source branch, and a provider key obtained directly from that provider. Examples below set an environment variable only for the current terminal session; never commit real values.

### Windows PowerShell

```powershell
$env:OPENAI_API_KEY = "your-provider-key-here"
$env:VYNQODE_OPENAI_MODELS = "gpt-4.1-mini,gpt-4.1"
npm install
npm start
```

### macOS / Linux

```sh
OPENAI_API_KEY="your-provider-key-here" VYNQODE_OPENAI_MODELS="gpt-4.1-mini,gpt-4.1" npm start
```

Visit `http://127.0.0.1:3000` on the **same computer**. Click **Connect AI → API providers → OpenAI (ChatGPT API) → Use selected API**. You can now **Ask** or **Suggest edits** using the server-proxied model. No real API call occurs until you request one. Change the provider in the same dialog at any time. To avoid putting secrets in shell history, prefer operating-system secret storage or a private, ignored environment file managed by your shell/launcher. Do not send keys in chat.

## Available provider variables

| Provider | Required environment | Optional model allowlist | Suggested default models |
| --- | --- | --- | --- |
| OpenAI API | `OPENAI_API_KEY` | `VYNQODE_OPENAI_MODELS` | `gpt-4.1-mini`, `gpt-4.1` |
| Anthropic Claude | `ANTHROPIC_API_KEY` | `VYNQODE_ANTHROPIC_MODELS` | `claude-sonnet-4-5`, `claude-haiku-4-5` |
| Google Gemini | `GEMINI_API_KEY` | `VYNQODE_GEMINI_MODELS` | `gemini-2.5-flash`, `gemini-2.5-pro` |
| OpenRouter | `OPENROUTER_API_KEY` | `VYNQODE_OPENROUTER_MODELS` | `openai/gpt-4.1-mini`, `anthropic/claude-sonnet-4` |
| Groq | `GROQ_API_KEY` | `VYNQODE_GROQ_MODELS` | `llama-3.3-70b-versatile`, `openai/gpt-oss-20b` |
| DeepSeek | `DEEPSEEK_API_KEY` | `VYNQODE_DEEPSEEK_MODELS` | `deepseek-chat`, `deepseek-reasoner` |
| Ollama (local) | `VYNQODE_ENABLE_OLLAMA=1` | `VYNQODE_OLLAMA_MODELS` | `qwen2.5-coder:7b`, `codellama:7b` |
| Compatible server | `VYNQODE_CUSTOM_API_KEY` and `VYNQODE_CUSTOM_API_BASE_URL` | `VYNQODE_CUSTOM_MODELS` | `custom-model` (replace) |

Example for free local Ollama after installing and loading a compatible model:

```sh
VYNQODE_ENABLE_OLLAMA=1 VYNQODE_OLLAMA_MODELS=qwen2.5-coder:7b npm start
```

The compatible endpoint must be an HTTPS URL (or localhost HTTP URL) **ending in `/`**, such as `https://your-inference-service.example/v1/`. The backend appends `chat/completions`. Provider/model access and prices change; check the current provider docs and configure models you have access to.

## What gets sent?

When you use **Ask** or **Suggest edits**, the selected project context (file names and relevant source snippets) is transmitted to your selected API provider through your local server. Vynqode does not automatically send everything in the project, but relevant source content may contain personal information. Never place secrets in project files. Paid API output must be reviewed; an AI-generated patch is not automatically executed. A structured/syntax test is not proof of runtime correctness.

## Supported request formats

OpenAI, OpenRouter, Groq, DeepSeek, Ollama and compatible endpoints use `POST /chat/completions`; Anthropic uses `POST /v1/messages`; Gemini uses `POST /v1beta/models/{model}:generateContent`. The model allowlist is set on the server. Other API features (streaming, tool calling, multimodal inputs, reasoning-specific settings) are not implemented yet.

Official provider references: [OpenAI](https://developers.openai.com/api/reference/chat-completions/overview), [Anthropic](https://platform.claude.com/docs/en/api/overview), [Gemini](https://ai.google.dev/api/generate-content), [Groq](https://console.groq.com/docs/openai), [OpenRouter](https://openrouter.ai/developers).
