# PixelRunner Local AI

This companion service runs `realesrgan-x4plus` through the official NCNN Vulkan executable. It deliberately listens only on `127.0.0.1` and automatically selects the first available port in `17836-17845`; the Photoshop plugin will not send images to a remote server.

The plugin preserves the original Photoshop canvas. It exports the complete visible composite without downsampling, runs the model at its native 4x scale, and places the result back as one smart-object layer fitted once to the original canvas. The service intentionally never passes `-s 2` to `realesrgan-x4plus`. Each job invokes the native CLI once with the selected `-t` value, so no external PNG tile decode, crop, stitch, or re-encode step runs after inference. The default 128 px tile is conservative for integrated GPUs; 256 px and 512 px are available for more VRAM.

## Setup

The Windows package contains the official `realesrgan-ncnn-vulkan.exe`, the `realesrgan-x4plus` model files, and a pinned CPython embeddable runtime under `local-ai/runtime/`. Opening the Local Upscale panel starts the bundled hidden launcher automatically; a separately installed Python is not required. The launcher first checks whether a healthy local service already exists, so reopening the panel does not start duplicate engines. UXP may request permission the first time it opens the bundled launcher; no manual command window needs to remain open.

Closing the Local Upscale panel sends `POST /v1/shutdown` to the loopback service. The service cancels queued/running jobs, terminates the Real-ESRGAN child process, and then stops Python. Plugin/WebView unload uses the same endpoint as a best-effort fallback, so the service no longer remains in Task Manager after the feature is closed.

For troubleshooting, the launcher writes interpreter startup output to `%LOCALAPPDATA%\PixelRunner\local-ai\launcher.log`, and the service writes lifecycle events to `%LOCALAPPDATA%\PixelRunner\local-ai\service.log`. Enable **保留诊断文件** before starting a job to retain `input.png`, `command.txt`, `stdout.txt`, `stderr.txt`, `engine-output.png`, and `metadata.json` in `%LOCALAPPDATA%\PixelRunner\local-ai\debug\<jobId>\`. The legacy `start-local-ai.cmd` can also be started manually, or run directly with the bundled runtime:

```powershell
.\local-ai\runtime\python.exe .\local-ai\server.py
```

For a source checkout or a different Windows engine, place the matching NCNN executable and its `models` folder in `local-ai/engine/`. A custom location can also be used:

```powershell
python .\local-ai\server.py --engine 'D:\AI\realesrgan-ncnn-vulkan.exe' --models 'D:\AI\models'
```

## macOS and Apple Silicon

The current package is **Windows-only** for automatic local inference: it contains a Windows `.exe` and `.vbs` launcher, not a macOS native engine. The Python loopback service and its shutdown protocol are portable, but an M-series MacBook cannot run the files currently shipped in `local-ai/engine/`.

To support macOS, ship a separately tested, signed, and notarized `local-ai/macos/PixelRunner Local AI.app`. The app must contain an arm64 or universal `realesrgan-ncnn-vulkan` build, matching `models`, its bundled Python runtime, and all required dynamic libraries (including the Vulkan-to-Metal layer when used). The plugin selects that `.app` on macOS and will show a clear missing-companion error until it is present. A manual development setup can run `python3 ./local-ai/server.py --engine /absolute/path/to/realesrgan-ncnn-vulkan --models /absolute/path/to/models`; verify it on physical Apple Silicon before release.

## Interface

- `GET /v1/health` checks the NCNN executable and model directory and returns the service/protocol/build identity.
- `POST /v1/jobs` queues one local GPU job at a time.
- `GET /v1/jobs/{jobId}` returns its state.
- `POST /v1/jobs/{jobId}/cancel` stops a queued or running job.
- `POST /v1/shutdown` cancels all jobs, terminates the native child process, and stops the loopback service.
- `POST /v1/jobs/{jobId}/placement` records the actual Photoshop placement dimensions for a debug job.
- `GET /v1/jobs/{jobId}/result` streams the PNG result back to Photoshop.

The plugin passes its temporary exported PNG paths to this loopback-only service. It removes the source PNG after successful inference; result files remain in Photoshop's temporary directory until the host cleans them up.
