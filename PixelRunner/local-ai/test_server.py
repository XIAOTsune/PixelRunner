"""Focused tests for the local service's version contract and diagnostic coordinates."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SERVER_PATH = Path(__file__).with_name("server.py")
SPEC = importlib.util.spec_from_file_location("pixelrunner_local_ai_server", SERVER_PATH)
assert SPEC and SPEC.loader
server = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = server
SPEC.loader.exec_module(server)


class LocalAiServerTests(unittest.TestCase):
    def test_native_tile_coordinates_use_engine_scale_once(self) -> None:
        tiles = server.build_native_tile_coordinates(300, 200, 128, 4)
        self.assertEqual(len(tiles), 6)
        self.assertEqual(
            tiles[1],
            {
                "inputLeft": 128,
                "inputTop": 0,
                "inputRight": 256,
                "inputBottom": 128,
                "engineLeft": 512,
                "engineTop": 0,
                "engineRight": 1024,
                "engineBottom": 512,
            },
        )
        self.assertEqual(tiles[-1]["engineRight"], 1200)
        self.assertEqual(tiles[-1]["engineBottom"], 800)

    def test_external_tile_plan_uses_overlap_without_scaled_coordinates(self) -> None:
        tiles = server.build_external_tile_plan(300, 200, 128, 64)
        self.assertEqual(len(tiles), 6)
        self.assertEqual(tiles[1].core_left, 128)
        self.assertEqual(tiles[1].source_left, 64)
        self.assertEqual(tiles[1].source_right, 300)
        self.assertEqual(tiles[-1].core_right, 300)
        self.assertEqual(tiles[-1].source_bottom, 200)
        described = server.describe_external_tile_coordinates(300, 200, 128)
        self.assertEqual(described[1]["engineLeft"], 512)
        self.assertEqual(described[1]["sourceLeft"], 64)

    def test_png_codec_preserves_rgb_pixels(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            path = Path(temporary_dir) / "sample.png"
            pixels = bytearray((
                1, 2, 3,
                4, 5, 6,
                7, 8, 9,
                10, 11, 12,
            ))
            server.write_png_rgb(path, 2, 2, pixels)
            width, height, decoded = server.read_png_rgb(path)
            self.assertEqual((width, height), (2, 2))
            self.assertEqual(decoded, pixels)

    def test_debug_metadata_records_all_pipeline_sizes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            job = server.Job(
                job_id="debug-job-001",
                input_path=root / "source.png",
                output_path=root / "result.png",
                scale=1,
                tile=128,
                tta=False,
                target_width=6000,
                target_height=4000,
                debug=True,
                debug_dir=root / "debug" / "debug-job-001",
                input_dimensions=(6000, 4000),
                engine_output_dimensions=(24000, 16000),
                placement={"width": 6000, "height": 4000, "layerId": 12, "documentId": 6},
            )
            service = object.__new__(server.LocalUpscaleService)
            service.model = "realesrgan-x4plus"
            metadata = service._debug_metadata(job)
            self.assertEqual(metadata["input"]["width"], 6000)
            self.assertEqual(metadata["engineOutput"]["width"], 24000)
            self.assertEqual(metadata["placement"]["height"], 4000)
            self.assertEqual(metadata["nativeTileCoordinates"][1]["engineLeft"], 512)
            self.assertEqual(metadata["engineTilePolicy"], "external-overlap")
            self.assertEqual(metadata["externalTileCoordinates"][1]["sourceLeft"], 64)
            self.assertEqual(json.loads(json.dumps(metadata))["engineScale"], 4)

    def test_debug_artifacts_survive_before_and_after_engine_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            input_path = root / "source.png"
            output_path = root / "result.png"
            input_path.write_bytes(b"source")
            job = server.Job(
                job_id="debug-job-002",
                input_path=input_path,
                output_path=output_path,
                scale=1,
                tile=128,
                tta=False,
                target_width=6,
                target_height=4,
                debug=True,
                debug_dir=root / "debug" / "debug-job-002",
            )
            service = object.__new__(server.LocalUpscaleService)
            self.assertTrue(service._prepare_debug_artifacts(job))
            self.assertTrue((job.debug_dir / "input.png").is_file())
            self.assertTrue((job.debug_dir / "stdout.txt").is_file())
            self.assertTrue((job.debug_dir / "stderr.txt").is_file())
            output_path.write_bytes(b"partial-engine-output")
            self.assertTrue(service._preserve_debug_engine_output(job, required=False))
            self.assertEqual((job.debug_dir / "engine-output.png").read_bytes(), b"partial-engine-output")

    def test_visible_input_tile_cannot_become_successful_black_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            work_dir = root / "work"
            output_dir = work_dir / "output"
            output_dir.mkdir(parents=True)
            plan = server.build_external_tile_plan(4, 4, 4, 0)
            tile = plan[0]
            server.write_png_rgb(output_dir / tile.filename, 16, 16, bytearray(16 * 16 * 3))
            job = server.Job(
                job_id="black-tile-job",
                input_path=root / "source.png",
                output_path=root / "result.png",
                scale=1,
                tile=4,
                tta=False,
                input_dimensions=(4, 4),
                input_has_visible_pixels=True,
                visible_input_tiles={tile.filename},
            )
            service = object.__new__(server.LocalUpscaleService)
            with self.assertRaisesRegex(ValueError, "全黑分块"):
                service._stitch_external_tile_outputs(job, work_dir, plan)

    def test_version_handshake_rejects_old_protocol(self) -> None:
        with self.assertRaisesRegex(ValueError, "协议版本"):
            server.LocalUpscaleService._require_matching_protocol({
                "protocolVersion": "1",
                "buildId": server.BUILD_ID,
            })
        with self.assertRaisesRegex(ValueError, "构建版本"):
            server.LocalUpscaleService._require_matching_protocol({
                "protocolVersion": server.PROTOCOL_VERSION,
                "buildId": "old-build",
            })


if __name__ == "__main__":
    unittest.main()
