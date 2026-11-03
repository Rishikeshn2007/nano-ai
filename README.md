# Nano AI

A terminal chat for your own LLM running on Google Colab. Manual transmission: you control sampling, context, memory and sessions.

## Setup (once)

```bash
cd nano-ai
./install.sh          # links the `nanoai` command (needs Node 18+)
sudo apt install xclip   # optional: lets /copy reach your clipboard
```

## Every session

1. Open `colab/nano_ai_server.ipynb` in Colab (or paste `colab/colab_cells.md` cell by cell), pick a T4 GPU, run cells top to bottom.
2. Copy the printed link.
3. In your terminal: `nanoai`, then `/url https://xxxx.ngrok-free.app`  (saved for next time).
4. Chat. If Colab disconnects: re-run the cells, then `/url <new link>`.

## Key commands (`/help` shows all)

| Command | What it does |
|---|---|
| `/set temp 0.3` `/set topk 20` `/set top_p 0.9` `/set max 2048` `/set ctx 8192` | sampling for this chat (`--global` for all chats) |
| `/preset precise\|balanced\|creative` | quick sampling presets |
| `/new` `/sessions` `/switch 2` `/rename` `/delete` | multiple saved chats |
| `/ctx` | context usage bar |
| `/summarize` `/summary` `/memory on\|off` | summary-based memory controls |
| `/copy` `/copy 2` `/copy all` `/save 1 app.py` | grab code from the last reply |
| `/system <text>` | custom system prompt |
| `/retry` `/undo` `/file path` `/export` | extras |
| `"""` | start/end a multi-line message |

## How memory works

Each chat is stored in `~/.nano-ai/sessions/`. The newest messages are always sent as they are. When the prompt passes 75% of the context budget, older messages are folded by the model into a short rolling summary, which is added to the system prompt. Tune with `/memory at 60`, `/memory keep 8`, `/memory words 300`.

## Notes

- Default server type is Ollama. For vLLM/llama.cpp use `/api openai`.
- Everything is stored locally in `~/.nano-ai/` (config, chats, history).
- Test without a GPU: `npm test`.
