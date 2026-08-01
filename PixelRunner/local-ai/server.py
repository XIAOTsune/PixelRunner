#!/usr/bin/env python3
"""PixelRunner Local AI companion service for Real-ESRGAN NCNN Vulkan."""

from __future__ import annotations

import argparse
import errno
import json
import mimetypes
import os
import platform
import queue
import re
import shutil
import subprocess
import struct
import sys
import tempfile
import threading
import time
import zlib
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


JOB_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{6,128}$")
SUPPORTED_SCALES = {1}
NATIVE_MODEL_SCALE = 4
DEFAULT_TILE_SIZE = 128
SERVICE_VERSION = "2.8.1"
PROTOCOL_VERSION = "2"
BUILD_ID = "PixelRunnerV2.8.1-local-ai-bundled-runtime"
DEFAULT_PORT = 17836
DEFAULT_PORT_END = 17845
MAX_PORT_CANDIDATES = 32
ENGINE_SCALE_POLICY = "native-cli-tile-x4-only"
DEBUG_ENVIRONMENT_VARIABLE = "PIXELRUNNER_LOCAL_AI_DEBUG"
EXTERNAL_TILE_OVERLAP = 64
EXTERNAL_ENGINE_TILE_SIZE = 0
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
VULKAN_FAILURE_PATTERN = re.compile(
    r"(?:vk[A-Za-z0-9_]*\s+failed|out of memory|failed to (?:allocate|create|load))",
    re.IGNORECASE,
)
NATIVE_PROGRESS_PATTERN = re.compile(r"^\s*(\d{1,3}(?:\.\d+)?)%\s*$")


def write_service_log(message: str) -> None:
    try:
        log_dir = get_local_ai_root()
        log_dir.mkdir(parents=True, exist_ok=True)
        with (log_dir / "service.log").open("a", encoding="utf-8") as output:
            output.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
    except OSError:
        pass


def get_local_ai_root() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("TEMP") or Path.home())
        return base / "PixelRunner" / "local-ai"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "PixelRunner" / "local-ai"
    base = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state")
    return base / "PixelRunner" / "local-ai"


def is_debug_enabled(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def build_port_candidates(port: int, port_end: int) -> list[int]:
    start = int(port)
    end = int(port_end)
    if start < 1 or end > 65535 or end < start:
        raise ValueError("本地超分端口范围无效")
    if end - start + 1 > MAX_PORT_CANDIDATES:
        raise ValueError(f"本地超分端口范围最多允许 {MAX_PORT_CANDIDATES} 个端口")
    return list(range(start, end + 1))


def build_native_tile_coordinates(width: int, height: int, tile: int, engine_scale: int) -> list[dict[str, int]]:
    """Describe the NCNN tile grid without changing the engine's tile implementation."""
    safe_width = max(1, int(width))
    safe_height = max(1, int(height))
    safe_tile = max(1, int(tile))
    safe_scale = max(1, int(engine_scale))
    coordinates: list[dict[str, int]] = []
    for top in range(0, safe_height, safe_tile):
        for left in range(0, safe_width, safe_tile):
            right = min(safe_width, left + safe_tile)
            bottom = min(safe_height, top + safe_tile)
            coordinates.append({
                "inputLeft": left,
                "inputTop": top,
                "inputRight": right,
                "inputBottom": bottom,
                "engineLeft": left * safe_scale,
                "engineTop": top * safe_scale,
                "engineRight": right * safe_scale,
                "engineBottom": bottom * safe_scale,
            })
    return coordinates


def parse_native_inference_progress(line: str, tile_total: int) -> tuple[float, int] | None:
    match = NATIVE_PROGRESS_PATTERN.fullmatch(str(line or "").strip())
    if not match:
        return None
    percent = max(0.0, min(100.0, float(match.group(1))))
    total = max(0, int(tile_total))
    completed = max(0, min(total, int(round(total * percent / 100.0)))) if total else 0
    return percent, completed


@dataclass(frozen=True)
class ExternalTile:
    row: int
    col: int
    core_left: int
    core_top: int
    core_right: int
    core_bottom: int
    source_left: int
    source_top: int
    source_right: int
    source_bottom: int
    filename: str


def build_external_tile_plan(width: int, height: int, tile: int, overlap: int = EXTERNAL_TILE_OVERLAP) -> list[ExternalTile]:
    """Split an input image into overlapped cores with integer source/output coordinates."""
    safe_width = max(1, int(width))
    safe_height = max(1, int(height))
    safe_tile = max(1, int(tile))
    safe_overlap = max(0, int(overlap))
    plan: list[ExternalTile] = []
    row = 0
    for core_top in range(0, safe_height, safe_tile):
        col = 0
        core_bottom = min(safe_height, core_top + safe_tile)
        for core_left in range(0, safe_width, safe_tile):
            core_right = min(safe_width, core_left + safe_tile)
            plan.append(ExternalTile(
                row=row,
                col=col,
                core_left=core_left,
                core_top=core_top,
                core_right=core_right,
                core_bottom=core_bottom,
                source_left=max(0, core_left - safe_overlap),
                source_top=max(0, core_top - safe_overlap),
                source_right=min(safe_width, core_right + safe_overlap),
                source_bottom=min(safe_height, core_bottom + safe_overlap),
                filename=f"tile-r{row:04d}-c{col:04d}.png",
            ))
            col += 1
        row += 1
    return plan


def describe_external_tile_coordinates(width: int, height: int, tile: int) -> list[dict[str, int]]:
    return [{
        "row": item.row,
        "col": item.col,
        "coreLeft": item.core_left,
        "coreTop": item.core_top,
        "coreRight": item.core_right,
        "coreBottom": item.core_bottom,
        "sourceLeft": item.source_left,
        "sourceTop": item.source_top,
        "sourceRight": item.source_right,
        "sourceBottom": item.source_bottom,
        "engineLeft": item.core_left * NATIVE_MODEL_SCALE,
        "engineTop": item.core_top * NATIVE_MODEL_SCALE,
        "engineRight": item.core_right * NATIVE_MODEL_SCALE,
        "engineBottom": item.core_bottom * NATIVE_MODEL_SCALE,
    } for item in build_external_tile_plan(width, height, tile)]


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def read_png_rgb(path: Path) -> tuple[int, int, bytearray]:
    """Decode non-interlaced 8-bit PNG RGB/RGBA data without an external dependency."""
    try:
        with path.open("rb") as source:
            if source.read(8) != PNG_SIGNATURE:
                raise ValueError("不是 PNG 文件")
            width = height = bit_depth = color_type = interlace = 0
            idat_parts: list[bytes] = []
            saw_iend = False
            while True:
                raw_length = source.read(4)
                if not raw_length:
                    break
                if len(raw_length) != 4:
                    raise ValueError("PNG 数据不完整")
                length = struct.unpack(">I", raw_length)[0]
                kind = source.read(4)
                payload = source.read(length)
                raw_crc = source.read(4)
                if len(kind) != 4 or len(payload) != length or len(raw_crc) != 4:
                    raise ValueError("PNG 数据不完整")
                if struct.unpack(">I", raw_crc)[0] != (zlib.crc32(kind + payload) & 0xFFFFFFFF):
                    raise ValueError("PNG 校验失败")
                if kind == b"IHDR":
                    if len(payload) != 13:
                        raise ValueError("PNG IHDR 无效")
                    width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(">IIBBBBB", payload)
                    if compression != 0 or filter_method != 0:
                        raise ValueError("PNG 压缩格式不受支持")
                elif kind == b"IDAT":
                    idat_parts.append(payload)
                elif kind == b"IEND":
                    saw_iend = True
                    break
            if not saw_iend or width <= 0 or height <= 0 or not idat_parts:
                raise ValueError("PNG 缺少必要数据")
    except (OSError, struct.error, zlib.error) as error:
        raise ValueError(f"无法读取 PNG：{error}") from error

    if bit_depth != 8 or interlace != 0 or color_type not in {0, 2, 6}:
        raise ValueError("外部分块仅支持非交错 8 位灰度、RGB 或 RGBA PNG")
    components = {0: 1, 2: 3, 6: 4}[color_type]
    bytes_per_pixel = components
    row_bytes = width * components
    try:
        decoded = zlib.decompress(b"".join(idat_parts))
    except zlib.error as error:
        raise ValueError(f"PNG 解压失败：{error}") from error
    expected_length = (row_bytes + 1) * height
    if len(decoded) != expected_length:
        raise ValueError("PNG 像素数据尺寸异常")

    rgb = bytearray(width * height * 3)
    previous = bytearray(row_bytes)
    offset = 0
    for row in range(height):
        filter_type = decoded[offset]
        offset += 1
        scanline = decoded[offset:offset + row_bytes]
        offset += row_bytes
        reconstructed = bytearray(row_bytes)
        if filter_type == 0:
            reconstructed[:] = scanline
        elif filter_type == 1:
            for index, value in enumerate(scanline):
                reconstructed[index] = (value + (reconstructed[index - bytes_per_pixel] if index >= bytes_per_pixel else 0)) & 0xFF
        elif filter_type == 2:
            for index, value in enumerate(scanline):
                reconstructed[index] = (value + previous[index]) & 0xFF
        elif filter_type == 3:
            for index, value in enumerate(scanline):
                left = reconstructed[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
                reconstructed[index] = (value + ((left + previous[index]) >> 1)) & 0xFF
        elif filter_type == 4:
            for index, value in enumerate(scanline):
                left = reconstructed[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
                up = previous[index]
                up_left = previous[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
                estimate = left + up - up_left
                left_distance = abs(estimate - left)
                up_distance = abs(estimate - up)
                up_left_distance = abs(estimate - up_left)
                predictor = left if left_distance <= up_distance and left_distance <= up_left_distance else up if up_distance <= up_left_distance else up_left
                reconstructed[index] = (value + predictor) & 0xFF
        else:
            raise ValueError("PNG 过滤器不受支持")

        destination = row * width * 3
        if color_type == 2:
            rgb[destination:destination + width * 3] = reconstructed
        elif color_type == 0:
            for column, value in enumerate(reconstructed):
                pixel = destination + column * 3
                rgb[pixel:pixel + 3] = bytes((value, value, value))
        else:
            for column in range(width):
                source_pixel = column * 4
                destination_pixel = destination + column * 3
                rgb[destination_pixel:destination_pixel + 3] = reconstructed[source_pixel:source_pixel + 3]
        previous = reconstructed
    return width, height, rgb


def write_png_rgb(path: Path, width: int, height: int, pixels: bytearray) -> None:
    safe_width = max(1, int(width))
    safe_height = max(1, int(height))
    row_bytes = safe_width * 3
    if len(pixels) != row_bytes * safe_height:
        raise ValueError("PNG 写入像素尺寸异常")
    compressor = zlib.compressobj(level=6)
    compressed_parts: list[bytes] = []
    for row in range(safe_height):
        start = row * row_bytes
        compressed_parts.append(compressor.compress(b"\x00" + pixels[start:start + row_bytes]))
    compressed_parts.append(compressor.flush())
    payload = b"".join(compressed_parts)
    with path.open("wb") as output:
        output.write(PNG_SIGNATURE)
        output.write(_png_chunk(b"IHDR", struct.pack(">IIBBBBB", safe_width, safe_height, 8, 2, 0, 0, 0)))
        output.write(_png_chunk(b"IDAT", payload))
        output.write(_png_chunk(b"IEND", b""))


def crop_rgb(source: bytearray, source_width: int, tile: ExternalTile) -> tuple[int, int, bytearray]:
    width = tile.source_right - tile.source_left
    height = tile.source_bottom - tile.source_top
    output = bytearray(width * height * 3)
    for row in range(height):
        source_start = ((tile.source_top + row) * source_width + tile.source_left) * 3
        destination_start = row * width * 3
        output[destination_start:destination_start + width * 3] = source[source_start:source_start + width * 3]
    return width, height, output


@dataclass
class Job:
    job_id: str
    input_path: Path
    output_path: Path
    scale: int
    tile: int
    tta: bool
    target_width: int = 0
    target_height: int = 0
    debug: bool = False
    debug_dir: Path | None = None
    status: str = "queued"
    progress: int = 12
    message: str = "等待 GPU 队列"
    error: str = ""
    created_at: float = field(default_factory=time.time)
    started_at: float = 0.0
    completed_at: float = 0.0
    cancelled: bool = False
    process: subprocess.Popen[str] | None = None
    command: list[str] = field(default_factory=list)
    input_dimensions: tuple[int, int] | None = None
    engine_output_dimensions: tuple[int, int] | None = None
    native_tile_total: int = 0
    native_tile_completed: int = 0
    native_inference_percent: float = 0.0
    input_has_visible_pixels: bool = False
    visible_input_tiles: set[str] = field(default_factory=set)
    placement: dict[str, Any] = field(default_factory=dict)

    def public(self) -> dict[str, Any]:
        return {
            "ok": True,
            "serviceVersion": SERVICE_VERSION,
            "protocolVersion": PROTOCOL_VERSION,
            "buildId": BUILD_ID,
            "jobId": self.job_id,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "error": self.error,
            "sourceScale": self.scale,
            "engineScale": NATIVE_MODEL_SCALE,
            "tile": self.tile,
            "tileTotal": self.native_tile_total,
            "tileCompleted": self.native_tile_completed,
            "inferencePercent": round(self.native_inference_percent, 2),
            "model": "realesrgan-x4plus",
            "debug": self.debug,
            "debugPath": str(self.debug_dir) if self.debug_dir else "",
            "createdAt": int(self.created_at * 1000),
            "startedAt": int(self.started_at * 1000) if self.started_at else 0,
            "completedAt": int(self.completed_at * 1000) if self.completed_at else 0,
            "resultPath": str(self.output_path) if self.status == "succeeded" else "",
        }


class LocalUpscaleService:
    def __init__(self, engine_path: Path, models_path: Path, model: str) -> None:
        self.engine_path = engine_path.expanduser().resolve()
        self.models_path = models_path.expanduser().resolve()
        self.model = model
        self.server_path = Path(__file__).resolve()
        self.jobs: dict[str, Job] = {}
        self.jobs_lock = threading.Lock()
        self.work_queue: queue.Queue[str] = queue.Queue()
        self.shutdown_event = threading.Event()
        self.shutdown_lock = threading.Lock()
        self.http_server: LocalAiHttpServer | None = None
        self.worker = threading.Thread(target=self._work, name="pixelrunner-realesrgan", daemon=True)
        self.worker.start()

    def health(self) -> dict[str, Any]:
        engine_ready = self.engine_path.is_file()
        models_ready = self.models_path.is_dir()
        ready = engine_ready and models_ready
        message = "本地引擎已就绪" if ready else "请检查 NCNN 可执行文件和 models 目录"
        return {
            "ok": True,
            "ready": ready,
            "message": message,
            "model": self.model,
            "backend": "Vulkan",
            "platform": platform.platform(),
            "enginePath": str(self.engine_path),
            "modelsPath": str(self.models_path),
            "serviceVersion": SERVICE_VERSION,
            "protocolVersion": PROTOCOL_VERSION,
            "buildId": BUILD_ID,
            "pid": os.getpid(),
            "port": int(self.http_server.server_address[1]) if self.http_server else 0,
            "serverPath": str(self.server_path),
            "engineScalePolicy": ENGINE_SCALE_POLICY,
        }

    @staticmethod
    def _require_matching_protocol(payload: dict[str, Any]) -> None:
        protocol_version = str(payload.get("protocolVersion", "")).strip()
        build_id = str(payload.get("buildId", "")).strip()
        if protocol_version != PROTOCOL_VERSION:
            raise ValueError("本地超分协议版本不匹配，请重新启动 PixelRunner Local AI")
        if build_id != BUILD_ID:
            raise ValueError("本地超分服务构建版本不匹配，请重新启动 PixelRunner Local AI")

    @staticmethod
    def _positive_int(value: Any) -> int:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0

    def _debug_metadata(self, job: Job) -> dict[str, Any]:
        return {
            "jobId": job.job_id,
            "serviceVersion": SERVICE_VERSION,
            "protocolVersion": PROTOCOL_VERSION,
            "buildId": BUILD_ID,
            "status": job.status,
            "input": {
                "sourcePath": str(job.input_path),
                "debugPath": str(job.debug_dir / "input.png") if job.debug_dir else "",
                "width": job.input_dimensions[0] if job.input_dimensions else 0,
                "height": job.input_dimensions[1] if job.input_dimensions else 0,
            },
            "engineOutput": {
                "sourcePath": str(job.output_path),
                "debugPath": str(job.debug_dir / "engine-output.png") if job.debug_dir else "",
                "width": job.engine_output_dimensions[0] if job.engine_output_dimensions else 0,
                "height": job.engine_output_dimensions[1] if job.engine_output_dimensions else 0,
            },
            "placement": job.placement,
            "target": {"width": job.target_width, "height": job.target_height},
            "scale": job.scale,
            "engineScale": NATIVE_MODEL_SCALE,
            "tile": job.tile,
            "engineTilePolicy": "native-cli",
            "nativeTileCoordinates": build_native_tile_coordinates(
                job.input_dimensions[0], job.input_dimensions[1], job.tile, NATIVE_MODEL_SCALE
            ) if job.input_dimensions else [],
            "model": self.model,
            "tta": job.tta,
            "command": job.command,
            "commandLine": subprocess.list2cmdline(job.command) if job.command else "",
            "error": job.error,
            "createdAt": int(job.created_at * 1000),
            "startedAt": int(job.started_at * 1000) if job.started_at else 0,
            "completedAt": int(job.completed_at * 1000) if job.completed_at else 0,
        }

    def _write_debug_metadata(self, job: Job) -> None:
        if not job.debug or not job.debug_dir:
            return
        try:
            job.debug_dir.mkdir(parents=True, exist_ok=True)
            (job.debug_dir / "metadata.json").write_text(
                json.dumps(self._debug_metadata(job), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError as error:
            write_service_log(f"Unable to write debug metadata for {job.job_id}: {error}")

    def _prepare_debug_artifacts(self, job: Job) -> bool:
        if not job.debug or not job.debug_dir:
            return True
        try:
            job.debug_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(job.input_path, job.debug_dir / "input.png")
            (job.debug_dir / "command.txt").write_text(
                subprocess.list2cmdline(job.command), encoding="utf-8"
            )
            # Preserve the required files even when preparation fails before the engine starts.
            (job.debug_dir / "stdout.txt").touch(exist_ok=True)
            (job.debug_dir / "stderr.txt").touch(exist_ok=True)
            return True
        except OSError as error:
            job.status = "failed"
            job.progress = 100
            job.error = f"无法保留本地超分调试输入：{error}"
            job.message = job.error
            job.completed_at = time.time()
            self._write_debug_metadata(job)
            return False

    def _write_debug_process_output(self, job: Job, stdout: str, stderr: str) -> None:
        if not job.debug or not job.debug_dir:
            return
        try:
            (job.debug_dir / "stdout.txt").write_text(stdout or "", encoding="utf-8")
            (job.debug_dir / "stderr.txt").write_text(stderr or "", encoding="utf-8")
        except OSError as error:
            write_service_log(f"Unable to write debug process output for {job.job_id}: {error}")

    def _preserve_debug_engine_output(self, job: Job, *, required: bool = True) -> bool:
        if not job.debug or not job.debug_dir:
            return True
        if not job.output_path.is_file():
            return not required
        try:
            shutil.copy2(job.output_path, job.debug_dir / "engine-output.png")
            return True
        except OSError as error:
            if not required:
                write_service_log(f"Unable to preserve debug engine output for {job.job_id}: {error}")
                return False
            job.status = "failed"
            job.progress = 100
            job.error = f"无法保留本地超分引擎输出：{error}"
            job.message = job.error
            return False

    def create_job(self, payload: dict[str, Any]) -> Job:
        self._require_matching_protocol(payload)
        job_id = str(payload.get("jobId", "")).strip()
        if not JOB_ID_PATTERN.fullmatch(job_id):
            raise ValueError("本地超分任务编号无效")
        input_path = Path(str(payload.get("inputPath", "")).strip()).expanduser()
        output_path = Path(str(payload.get("outputPath", "")).strip()).expanduser()
        scale = int(payload.get("scale", 0))
        tile = int(payload.get("tile", 0))
        if scale not in SUPPORTED_SCALES:
            raise ValueError("本地超分必须使用完整画布输入")
        if tile == 0:
            tile = DEFAULT_TILE_SIZE
        if tile < 32 or tile > 1024:
            raise ValueError("分块尺寸无效")
        if not input_path.is_file():
            raise ValueError("未找到 Photoshop 导出的源图像")
        if input_path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            raise ValueError("本地超分仅接受 PNG、JPEG 或 WebP 图像")
        if output_path.suffix.lower() != ".png":
            raise ValueError("本地超分结果必须使用 PNG 格式")
        if input_path.resolve() == output_path.resolve():
            raise ValueError("本地超分输出路径不能覆盖输入图像")
        if output_path.exists():
            raise ValueError("本地超分输出路径已存在，已停止以避免复用旧结果")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        target_width = self._positive_int(payload.get("targetWidth"))
        target_height = self._positive_int(payload.get("targetHeight"))
        debug = is_debug_enabled(payload.get("debug")) or is_debug_enabled(os.environ.get(DEBUG_ENVIRONMENT_VARIABLE))

        with self.jobs_lock:
            if job_id in self.jobs:
                raise ValueError("本地超分任务编号已存在")
            job = Job(
                job_id=job_id,
                input_path=input_path.resolve(),
                output_path=output_path.resolve(),
                scale=scale,
                tile=tile,
                tta=bool(payload.get("tta", False)),
                target_width=target_width,
                target_height=target_height,
                debug=debug,
                debug_dir=(get_local_ai_root() / "debug" / job_id) if debug else None,
            )
            self.jobs[job_id] = job
        job.input_dimensions = read_png_dimensions(job.input_path)
        if job.input_dimensions:
            job.native_tile_total = len(build_native_tile_coordinates(
                job.input_dimensions[0], job.input_dimensions[1], job.tile, NATIVE_MODEL_SCALE
            ))
        self._write_debug_metadata(job)
        self.work_queue.put(job_id)
        return job

    def record_placement(self, job_id: str, payload: dict[str, Any]) -> Job | None:
        self._require_matching_protocol(payload)
        with self.jobs_lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            job.placement = {
                "width": self._positive_int(payload.get("width")),
                "height": self._positive_int(payload.get("height")),
                "layerId": self._positive_int(payload.get("layerId")),
                "documentId": self._positive_int(payload.get("documentId")),
                "completedAt": int(time.time() * 1000),
            }
        self._write_debug_metadata(job)
        return job

    def get_job(self, job_id: str) -> Job | None:
        with self.jobs_lock:
            return self.jobs.get(job_id)

    def cancel_job(self, job_id: str) -> Job | None:
        with self.jobs_lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            job.cancelled = True
            if job.status == "queued":
                job.status = "cancelled"
                job.progress = 0
                job.message = "任务已取消"
                job.completed_at = time.time()
            process = job.process
        if process and process.poll() is None:
            process.terminate()
        self._write_debug_metadata(job)
        return job

    def attach_http_server(self, server: "LocalAiHttpServer") -> None:
        self.http_server = server

    def request_shutdown(self) -> dict[str, Any]:
        """Stop queued work, terminate the native child, then release the loopback port."""
        with self.shutdown_lock:
            already_requested = self.shutdown_event.is_set()
            self.shutdown_event.set()

        with self.jobs_lock:
            job_ids = list(self.jobs)
        for job_id in job_ids:
            self.cancel_job(job_id)

        server = self.http_server
        if server and not already_requested:
            threading.Thread(
                target=self._shutdown_http_server,
                name="pixelrunner-local-ai-shutdown",
                daemon=True,
            ).start()

        return {
            "ok": True,
            "shuttingDown": True,
            "protocolVersion": PROTOCOL_VERSION,
            "buildId": BUILD_ID,
        }

    def _shutdown_http_server(self) -> None:
        # Finish the HTTP response before ThreadingHTTPServer stops accepting requests.
        time.sleep(0.05)
        server = self.http_server
        if server:
            server.shutdown()

    def _work(self) -> None:
        while not self.shutdown_event.is_set():
            try:
                job_id = self.work_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            try:
                job = self.get_job(job_id)
                if not job or job.cancelled or self.shutdown_event.is_set():
                    continue
                self._run_job(job)
            finally:
                self.work_queue.task_done()

    def _prepare_external_tiles(self, job: Job) -> tuple[Path, list[ExternalTile], list[str]]:
        width, height, pixels = read_png_rgb(job.input_path)
        if job.cancelled:
            raise InterruptedError("任务已取消")
        job.input_dimensions = (width, height)
        job.input_has_visible_pixels = max(pixels) > 6
        plan = build_external_tile_plan(width, height, job.tile)
        work_dir = Path(tempfile.mkdtemp(prefix=f"pixelrunner-external-{job.job_id}-", dir=job.output_path.parent))
        input_dir = work_dir / "input"
        output_dir = work_dir / "output"
        input_dir.mkdir()
        output_dir.mkdir()
        try:
            for tile in plan:
                if job.cancelled:
                    raise InterruptedError("任务已取消")
                tile_width, tile_height, tile_pixels = crop_rgb(pixels, width, tile)
                if max(tile_pixels) > 6:
                    job.visible_input_tiles.add(tile.filename)
                write_png_rgb(input_dir / tile.filename, tile_width, tile_height, tile_pixels)
            command = [
                str(self.engine_path),
                "-i", str(input_dir),
                "-o", str(output_dir),
                "-n", self.model,
                "-s", str(NATIVE_MODEL_SCALE),
                # Each external crop already fits memory, so disable the CLI's internal tile stitcher.
                "-t", str(EXTERNAL_ENGINE_TILE_SIZE),
                "-m", str(self.models_path),
                "-f", "png",
            ]
            if job.tta:
                command.append("-x")
            return work_dir, plan, command
        except Exception:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise

    @staticmethod
    def _write_streamed_png_row(output: Any, compressor: zlib.compressobj, row: bytearray) -> None:
        compressed = compressor.compress(b"\x00" + row)
        if compressed:
            output.write(_png_chunk(b"IDAT", compressed))

    def _stitch_external_tile_outputs(self, job: Job, work_dir: Path, plan: list[ExternalTile]) -> tuple[int, int]:
        if not job.input_dimensions:
            raise ValueError("缺少本地超分输入尺寸")
        source_width, source_height = job.input_dimensions
        output_width = source_width * NATIVE_MODEL_SCALE
        output_height = source_height * NATIVE_MODEL_SCALE
        output_dir = work_dir / "output"
        rows: dict[int, list[ExternalTile]] = {}
        has_visible_engine_pixels = False
        for tile in plan:
            rows.setdefault(tile.row, []).append(tile)

        with job.output_path.open("wb") as output:
            output.write(PNG_SIGNATURE)
            output.write(_png_chunk(b"IHDR", struct.pack(">IIBBBBB", output_width, output_height, 8, 2, 0, 0, 0)))
            compressor = zlib.compressobj(level=6)
            ordered_row_indices = sorted(rows)
            total_rows = max(1, len(ordered_row_indices))
            for completed_rows, row_index in enumerate(ordered_row_indices, start=1):
                row_tiles = sorted(rows[row_index], key=lambda tile: tile.col)
                decoded_tiles: list[tuple[ExternalTile, int, int, bytearray]] = []
                core_output_height = 0
                for tile in row_tiles:
                    tile_width, tile_height, tile_pixels = read_png_rgb(output_dir / tile.filename)
                    expected_width = (tile.source_right - tile.source_left) * NATIVE_MODEL_SCALE
                    expected_height = (tile.source_bottom - tile.source_top) * NATIVE_MODEL_SCALE
                    if (tile_width, tile_height) != (expected_width, expected_height):
                        raise ValueError(
                            f"外部分块输出尺寸异常 {tile.filename}：预期 {expected_width} x {expected_height}，实际 {tile_width} x {tile_height}"
                        )
                    current_core_height = (tile.core_bottom - tile.core_top) * NATIVE_MODEL_SCALE
                    if core_output_height and core_output_height != current_core_height:
                        raise ValueError("外部分块行高度不一致")
                    core_output_height = current_core_height
                    if tile.filename in job.visible_input_tiles and max(tile_pixels) <= 6:
                        raise ValueError(
                            f"Real-ESRGAN 返回全黑分块 {tile.filename}，已停止回贴"
                        )
                    decoded_tiles.append((tile, tile_width, tile_height, tile_pixels))

                has_visible_engine_pixels = has_visible_engine_pixels or any(
                    max(tile_pixels) > 6 for _, _, _, tile_pixels in decoded_tiles
                )

                for core_row in range(core_output_height):
                    final_row = bytearray(output_width * 3)
                    cursor = 0
                    for tile, tile_width, _, tile_pixels in decoded_tiles:
                        source_x = (tile.core_left - tile.source_left) * NATIVE_MODEL_SCALE
                        source_y = (tile.core_top - tile.source_top) * NATIVE_MODEL_SCALE + core_row
                        core_width = (tile.core_right - tile.core_left) * NATIVE_MODEL_SCALE
                        start = (source_y * tile_width + source_x) * 3
                        end = start + core_width * 3
                        final_row[cursor:cursor + core_width * 3] = tile_pixels[start:end]
                        cursor += core_width * 3
                    if cursor != len(final_row):
                        raise ValueError("外部分块拼接行宽异常")
                    self._write_streamed_png_row(output, compressor, final_row)
                job.progress = 84 + min(12, int(completed_rows * 12 / total_rows))
                job.message = f"正在按整数坐标拼接外部分块 ({completed_rows}/{total_rows})"
            tail = compressor.flush()
            if tail:
                output.write(_png_chunk(b"IDAT", tail))
            output.write(_png_chunk(b"IEND", b""))
        if job.input_has_visible_pixels and not has_visible_engine_pixels:
            raise ValueError("Real-ESRGAN 返回全黑图像，已停止回贴")
        return output_width, output_height

    def _run_job(self, job: Job) -> None:
        if not self.engine_path.is_file() or not self.models_path.is_dir():
            job.status = "failed"
            job.progress = 100
            job.error = "本地引擎未就绪，请检查 NCNN 可执行文件和 models 目录"
            job.message = job.error
            job.completed_at = time.time()
            self._write_debug_metadata(job)
            return
        try:
            if job.cancelled or self.shutdown_event.is_set():
                raise InterruptedError("任务已取消")
            input_dimensions = read_png_dimensions(job.input_path)
            if not input_dimensions:
                raise ValueError("无法读取本地超分输入 PNG 尺寸")
            job.input_dimensions = input_dimensions
            engine_input_path = job.debug_dir / "input.png" if job.debug and job.debug_dir else job.input_path
            job.command = [
                str(self.engine_path),
                "-i", str(engine_input_path),
                "-o", str(job.output_path),
                "-n", self.model,
                "-s", str(NATIVE_MODEL_SCALE),
                "-t", str(job.tile),
                "-m", str(self.models_path),
                "-f", "png",
            ]
            if job.tta:
                job.command.append("-x")
            if not self._prepare_debug_artifacts(job):
                return
            job.progress = 0
            job.native_inference_percent = 0.0
            job.message = "正在使用 Vulkan 原生 4x 分块推理"
            job.status = "running"
            job.started_at = time.time()
            self._write_debug_metadata(job)
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
            process = subprocess.Popen(
                job.command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=creationflags,
            )
            with self.jobs_lock:
                job.process = process
                should_terminate = job.cancelled or self.shutdown_event.is_set()
            if should_terminate and process.poll() is None:
                process.terminate()
            output_lines: list[str] = []
            if process.stdout:
                for line in process.stdout:
                    output_lines.append(line)
                    native_progress = parse_native_inference_progress(line, job.native_tile_total)
                    if native_progress:
                        percent, completed = native_progress
                        with self.jobs_lock:
                            job.native_inference_percent = max(job.native_inference_percent, percent)
                            job.native_tile_completed = max(job.native_tile_completed, completed)
                            job.progress = int(round(job.native_inference_percent))
                            job.message = f"Vulkan 原生 4x 推理 {job.native_inference_percent:.2f}%"
                process.stdout.close()
            process.wait()
            output = "".join(output_lines)
            stderr = ""
            # NCNN writes both diagnostics and progress to stderr. The streams are
            # merged only so progress cannot deadlock behind an unread pipe.
            self._write_debug_process_output(job, "", output)
            with self.jobs_lock:
                job.process = None
            if job.cancelled:
                job.status = "cancelled"
                job.progress = 0
                job.message = "任务已取消"
            elif process.returncode != 0:
                detail = ((output or "") + "\n" + (stderr or "")).strip()[-1200:]
                job.status = "failed"
                job.progress = 100
                job.error = detail or f"Real-ESRGAN 进程退出，代码 {process.returncode}"
                job.message = job.error
            elif VULKAN_FAILURE_PATTERN.search((output or "") + "\n" + (stderr or "")):
                detail = "\n".join(
                    line for line in ((output or "") + "\n" + (stderr or "")).splitlines()
                    if VULKAN_FAILURE_PATTERN.search(line)
                )[-1200:]
                job.status = "failed"
                job.progress = 100
                job.error = f"Vulkan 推理失败：{detail or '显存或驱动错误'}"
                job.message = job.error
            else:
                # Keep the tile counters for diagnostics, while the public UI follows
                # the native percentage that was streamed by NCNN.
                job.native_tile_completed = job.native_tile_total
                job.native_inference_percent = 100.0
                job.progress = 100
                job.message = "正在验证原生引擎输出"
                self._write_debug_metadata(job)
                actual_size = read_png_dimensions(job.output_path)
                expected_size = job.input_dimensions
                job.engine_output_dimensions = actual_size
                if not actual_size:
                    job.status = "failed"
                    job.progress = 100
                    job.error = "Real-ESRGAN 未生成可识别的 PNG 输出"
                    job.message = job.error
                elif expected_size:
                    expected_width = expected_size[0] * NATIVE_MODEL_SCALE
                    expected_height = expected_size[1] * NATIVE_MODEL_SCALE
                    if actual_size != (expected_width, expected_height):
                        job.status = "failed"
                        job.progress = 100
                        job.error = (
                            "Real-ESRGAN 输出尺寸异常："
                            f"预期 {expected_width} x {expected_height}，"
                            f"实际 {actual_size[0]} x {actual_size[1]}"
                        )
                        job.message = job.error
                if job.status != "failed" and png_contains_visible_pixels(job.input_path) and not png_contains_visible_pixels(job.output_path):
                    job.status = "failed"
                    job.progress = 100
                    job.error = "Real-ESRGAN 返回全黑图像，已停止回贴"
                    job.message = job.error
                if job.status != "failed" and not self._preserve_debug_engine_output(job):
                    return
                if job.status != "failed":
                    job.status = "succeeded"
                    job.progress = 100
                    job.message = "推理完成"
                    try:
                        job.input_path.unlink(missing_ok=True)
                    except OSError:
                        pass
        except InterruptedError:
            job.status = "cancelled"
            job.progress = 0
            job.message = "任务已取消"
        except (OSError, ValueError) as error:
            job.status = "failed"
            job.progress = 100
            job.error = f"本地超分失败：{error}"
            job.message = job.error
        finally:
            # A failed black-image or validation result is still useful diagnostic evidence.
            self._preserve_debug_engine_output(job, required=False)
            job.completed_at = time.time()
            self._write_debug_metadata(job)


def read_png_dimensions(path: Path) -> tuple[int, int] | None:
    """Read PNG dimensions without a third-party image decoder."""
    try:
        with path.open("rb") as source:
            header = source.read(24)
        if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
            return None
        width, height = struct.unpack(">II", header[16:24])
        return (width, height) if width > 0 and height > 0 else None
    except OSError:
        return None


def png_contains_visible_pixels(path: Path) -> bool:
    """Detect an all-black PNG without reconstructing or retaining its pixel buffer."""
    try:
        with path.open("rb") as source:
            if source.read(8) != PNG_SIGNATURE:
                raise ValueError("不是 PNG 文件")
            width = height = bit_depth = color_type = compression = filter_method = interlace = 0
            components = row_size = 0
            decoded_buffer = bytearray()
            decoder = zlib.decompressobj()
            rows_seen = 0
            saw_iend = False

            def consume(decoded: bytes) -> bool:
                nonlocal rows_seen
                decoded_buffer.extend(decoded)
                while row_size and len(decoded_buffer) >= row_size:
                    # Filter bytes may be non-zero even when every reconstructed pixel is black.
                    if any(decoded_buffer[1:row_size]):
                        return True
                    del decoded_buffer[:row_size]
                    rows_seen += 1
                return False

            while True:
                raw_length = source.read(4)
                if not raw_length:
                    break
                if len(raw_length) != 4:
                    raise ValueError("PNG 数据不完整")
                length = struct.unpack(">I", raw_length)[0]
                kind = source.read(4)
                payload = source.read(length)
                raw_crc = source.read(4)
                if len(kind) != 4 or len(payload) != length or len(raw_crc) != 4:
                    raise ValueError("PNG 数据不完整")
                if struct.unpack(">I", raw_crc)[0] != (zlib.crc32(kind + payload) & 0xFFFFFFFF):
                    raise ValueError("PNG 校验失败")
                if kind == b"IHDR":
                    if len(payload) != 13:
                        raise ValueError("PNG IHDR 无效")
                    width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(">IIBBBBB", payload)
                    if bit_depth != 8 or color_type not in {0, 2, 6} or compression != 0 or filter_method != 0 or interlace != 0:
                        raise ValueError("PNG 像素格式不受支持")
                    components = {0: 1, 2: 3, 6: 4}[color_type]
                    row_size = width * components + 1
                elif kind == b"IDAT":
                    if not row_size:
                        raise ValueError("PNG 缺少 IHDR")
                    if consume(decoder.decompress(payload)):
                        return True
                elif kind == b"IEND":
                    saw_iend = True
                    break
            if consume(decoder.flush()):
                return True
            if not saw_iend or rows_seen != height or decoded_buffer:
                raise ValueError("PNG 像素数据不完整")
            return False
    except (OSError, struct.error, zlib.error) as error:
        raise ValueError(f"无法验证 PNG 输出：{error}") from error


class RequestHandler(BaseHTTPRequestHandler):
    service: LocalUpscaleService

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 128 * 1024:
            raise ValueError("请求体无效")
        data = self.rfile.read(length)
        payload = json.loads(data.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("请求必须是 JSON 对象")
        return payload

    @staticmethod
    def _job_id_from_path(path: str) -> str:
        parts = [item for item in path.split("/") if item]
        return parts[2] if len(parts) >= 3 and parts[0] == "v1" and parts[1] == "jobs" else ""

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/v1/health":
            self._send_json(HTTPStatus.OK, self.service.health())
            return
        job_id = self._job_id_from_path(path)
        if job_id and path == f"/v1/jobs/{job_id}":
            job = self.service.get_job(job_id)
            if not job:
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "未找到本地超分任务"})
                return
            self._send_json(HTTPStatus.OK, job.public())
            return
        if job_id and path == f"/v1/jobs/{job_id}/result":
            self._send_result(job_id)
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "接口不存在"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            if path == "/v1/shutdown":
                payload = self._read_json()
                self.service._require_matching_protocol(payload)
                self._send_json(HTTPStatus.OK, self.service.request_shutdown())
                return
            if path == "/v1/jobs":
                job = self.service.create_job(self._read_json())
                self._send_json(HTTPStatus.ACCEPTED, job.public())
                return
            job_id = self._job_id_from_path(path)
            if job_id and path == f"/v1/jobs/{job_id}/placement":
                job = self.service.record_placement(job_id, self._read_json())
                if not job:
                    self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "未找到本地超分任务"})
                    return
                self._send_json(HTTPStatus.OK, job.public())
                return
            if job_id and path == f"/v1/jobs/{job_id}/cancel":
                job = self.service.cancel_job(job_id)
                if not job:
                    self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "未找到本地超分任务"})
                    return
                self._send_json(HTTPStatus.OK, job.public())
                return
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "接口不存在"})
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})

    def _send_result(self, job_id: str) -> None:
        job = self.service.get_job(job_id)
        if not job or job.status != "succeeded" or not job.output_path.is_file():
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "本地超分结果尚不可用"})
            return
        content_type = mimetypes.guess_type(str(job.output_path))[0] or "image/png"
        size = job.output_path.stat().st_size
        self.send_response(HTTPStatus.OK)
        self._send_cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with job.output_path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                self.wfile.write(chunk)


class LocalAiHttpServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def bind_first_available_http_server(
    host: str,
    port_candidates: list[int],
    handler: type[BaseHTTPRequestHandler],
    server_factory: Any = LocalAiHttpServer,
) -> ThreadingHTTPServer | None:
    for candidate_port in port_candidates:
        try:
            return server_factory((host, candidate_port), handler)
        except OSError as error:
            address_in_use = (
                getattr(error, "winerror", 0) == 10048
                or getattr(error, "errno", 0) in {errno.EADDRINUSE, 98}
            )
            write_service_log(f"Port {candidate_port} is unavailable: {error}")
            if not address_in_use:
                raise
    return None


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parent
    executable = "realesrgan-ncnn-vulkan.exe" if os.name == "nt" else "realesrgan-ncnn-vulkan"
    parser = argparse.ArgumentParser(description="PixelRunner Local AI - Real-ESRGAN service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--port-end", type=int, default=DEFAULT_PORT_END)
    parser.add_argument("--engine", type=Path, default=root / "engine" / executable)
    parser.add_argument("--models", type=Path, default=root / "engine" / "models")
    parser.add_argument("--model", default="realesrgan-x4plus")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.host not in {"127.0.0.1", "localhost"}:
        print("For safety, PixelRunner Local AI only accepts 127.0.0.1 or localhost.", file=sys.stderr)
        return 2
    try:
        port_candidates = build_port_candidates(args.port, args.port_end)
    except ValueError as error:
        write_service_log(str(error))
        print(str(error), file=sys.stderr)
        return 2
    service = LocalUpscaleService(args.engine, args.models, args.model)
    RequestHandler.service = service
    try:
        server = bind_first_available_http_server(args.host, port_candidates, RequestHandler)
    except OSError:
        return 1
    if server is None:
        write_service_log(f"No local port is available in range {port_candidates[0]}-{port_candidates[-1]}")
        return 1
    service.attach_http_server(server)
    selected_port = int(server.server_address[1])
    print(f"PixelRunner Local AI listening on http://{args.host}:{selected_port}")
    print(json.dumps(service.health(), ensure_ascii=False))
    write_service_log(f"Listening on http://{args.host}:{selected_port}; engine={service.engine_path}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        service.request_shutdown()
        server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
