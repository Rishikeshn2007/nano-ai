# Nano AI - Colab server cells
Open https://colab.research.google.com > New notebook > Runtime > Change runtime type > **T4 GPU**.
Paste each block below into its own cell and run them top to bottom.

## Cell 1 - Check the GPU

```python
# Runtime > Change runtime type > T4 GPU  (do this BEFORE running)
!nvidia-smi --query-gpu=name,memory.total --format=csv
```

## Cell 2 - Install Ollama + ngrok client

```python
%%capture
!apt-get -qq install -y zstd pciutils lshw
!curl -fsSL https://ollama.com/install.sh | sh
!pip -q install pyngrok
print("installed")
```

## Cell 3 - Your settings (edit this one)

```python
# ---- EDIT THESE ----------------------------------------------------------
MODEL = "gpt-oss:20b"      # alternatives for a 15 GB T4: "qwen3:14b", "gemma3:12b", "qwen3:8b"
KEEP_ALIVE = "2h"          # how long the model stays loaded in GPU memory when idle
# ngrok token: free at https://dashboard.ngrok.com/get-started/your-authtoken
# Best: Colab left sidebar > key icon (Secrets) > add secret named NGROK_TOKEN > enable notebook access.
# ---------------------------------------------------------------------------
import os, getpass
try:
    from google.colab import userdata
    NGROK_TOKEN = userdata.get("NGROK_TOKEN")
except Exception:
    NGROK_TOKEN = None
if not NGROK_TOKEN:
    NGROK_TOKEN = getpass.getpass("Paste your ngrok authtoken: ").strip()
print("model:", MODEL, "| token loaded:", bool(NGROK_TOKEN))
```

## Cell 4 - Start the Ollama server

```python
import os, subprocess, time, urllib.request

env = dict(os.environ,
           OLLAMA_HOST="0.0.0.0:11434",
           OLLAMA_ORIGINS="*",
           OLLAMA_KEEP_ALIVE=KEEP_ALIVE,
           OLLAMA_FLASH_ATTENTION="1",
           OLLAMA_NUM_PARALLEL="1")
server = subprocess.Popen(["ollama", "serve"], env=env,
                          stdout=open("/content/ollama.log", "w"), stderr=subprocess.STDOUT)

for _ in range(60):
    try:
        urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=2)
        print("Ollama is up")
        break
    except Exception:
        time.sleep(1)
else:
    print(open("/content/ollama.log").read()[-2000:])
    raise RuntimeError("Ollama did not start - see log above")
```

## Cell 5 - Download the model (first time takes a few minutes)

```python
!ollama pull {MODEL}
!ollama list
```

## Cell 6 - Warm up the model on the GPU

```python
import json, urllib.request, time
t = time.time()
req = urllib.request.Request(
    "http://127.0.0.1:11434/api/generate",
    data=json.dumps({"model": MODEL, "prompt": "Say OK.", "stream": False,
                     "options": {"num_predict": 8}, "keep_alive": KEEP_ALIVE}).encode(),
    headers={"Content-Type": "application/json"})
print(json.loads(urllib.request.urlopen(req, timeout=600).read())["response"].strip() or "(loaded)")
print(f"model ready in {time.time()-t:.0f}s")
!ollama ps
```

## Cell 7 - Open the ngrok tunnel and get your link

```python
from pyngrok import ngrok, conf

ngrok.set_auth_token(NGROK_TOKEN)
for t in ngrok.get_tunnels():          # clean up old tunnels if you re-run this cell
    ngrok.disconnect(t.public_url)

# host_header makes Ollama accept requests that arrive through the tunnel
tunnel = ngrok.connect(addr="11434", proto="http", host_header="localhost:11434")
PUBLIC_URL = tunnel.public_url.replace("http://", "https://")

print("=" * 64)
print("  Your Nano AI server link:\n")
print("  ", PUBLIC_URL)
print("\n  On your computer, in the nano-ai terminal, run:")
print("  /url", PUBLIC_URL)
print("=" * 64)
```

## Cell 8 - Keep it alive (leave this cell running while you chat)

```python
# Colab disconnects idle sessions. This cell pings the server so the tab keeps working.
# Stop it with the square button when you are done (or just close the tab).
import time, urllib.request
print("Server running. Link:", PUBLIC_URL)
try:
    while True:
        try:
            urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=5)
            status = "ok"
        except Exception as e:
            status = f"PROBLEM: {e}"
        print(time.strftime("%H:%M:%S"), status, end="\r")
        time.sleep(60)
except KeyboardInterrupt:
    print("\nstopped")
```

## When Colab disconnects

Re-run cells 2 to 8 (cell 2 only if the runtime was reset), then run `/url <new-link>` in Nano AI.
