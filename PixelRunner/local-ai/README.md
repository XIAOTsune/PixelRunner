# PixelRunner Local AI

This companion service runs `realesrgan-x4plus` through the official NCNN Vulkan executable. It deliberately listens only on `127.0.0.1:17836`; the Photoshop plugin will not send images to a remote server.

The plugin preserves the original Photoshop canvas. It exports the complete visible composite without downsampling, runs the model at its native 4x scale, and places the result back as one smart-object layer fitted once to the original canvas. The service intentionally never passes `-s 2` to `realesrgan-x4plus`. Each job invokes the native CLI once with the selected `-t` value, so no external PNG tile decode, crop, stitch, or re-encode step runs after inference. The default 128 px tile is conservative for integrated GPUs; 256 px and 512 px are available for more VRAM.

## Setup

The Windows test package already contains the official `realesrgan-ncnn-vulkan` executable and the `realesrgan-x4plus` model files. Opening the Local Upscale panel starts the bundled hidden launcher automatically. It first checks whether a healthy local service already exists, so reopening the panel does not start duplicate engines. UXP may request permission the first time it opens the bundled launcher; no manual command window needs to remain open.

For troubleshooting, the service writes startup failures to `%LOCALAPPDATA%\PixelRunner\local-ai\service.log`. Enable **保留诊断文件** before starting a job to retain `input.png`, `command.txt`, `stdout.txt`, `stderr.txt`, `engine-output.png`, and `metadata.json` in `%LOCALAPPDATA%\PixelRunner\local-ai\debug\<jobId>\`. The legacy `start-local-ai.cmd` can also be started manually, or run directly with:

```powershell
python .\local-ai\server.py
```

For a source checkout, a different Windows engine, or a macOS engine, place the matching NCNN executable and its `models` folder in `local-ai/engine/`. A custom location can also be used:

```powershell
python .\local-ai\server.py --engine 'D:\AI\realesrgan-ncnn-vulkan.exe' --models 'D:\AI\models'
```

On macOS, use the universal `realesrgan-ncnn-vulkan` executable and run the same command with `python3`. The released macOS binary uses MoltenVK to access Metal. For distribution, package this script and the platform-specific engine as a signed/notarized companion application.

## Interface

- `GET /v1/health` checks the NCNN executable and model directory and returns the service/protocol/build identity.
- `POST /v1/jobs` queues one local GPU job at a time.
- `GET /v1/jobs/{jobId}` returns its state.
- `POST /v1/jobs/{jobId}/cancel` stops a queued or running job.
- `POST /v1/jobs/{jobId}/placement` records the actual Photoshop placement dimensions for a debug job.
- `GET /v1/jobs/{jobId}/result` streams the PNG result back to Photoshop.

The plugin passes its temporary exported PNG paths to this loopback-only service. It removes the source PNG after successful inference; result files remain in Photoshop's temporary directory until the host cleans them up.
