"""Create a de-identified geometric phantom for local viewer smoke tests."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def create_phantom(output: Path, slices: int = 121, size: int = 192) -> Path:
    series = output / "Series_1_T1_POST_SYNTHETIC"
    series.mkdir(parents=True, exist_ok=True)
    ordered = []
    yy, xx = np.mgrid[:size, :size]
    center = (size - 1) / 2
    for index in range(slices):
        z = (index - (slices - 1) / 2) / ((slices - 1) / 2)
        brain_radius_x = size * 0.34 * math.sqrt(max(0.05, 1 - z * z))
        brain_radius_y = size * 0.41 * math.sqrt(max(0.05, 1 - z * z))
        ellipse = ((xx - center) / brain_radius_x) ** 2 + ((yy - center) / brain_radius_y) ** 2
        image = np.zeros((size, size), dtype=np.float32)
        image[ellipse <= 1] = 82 + 24 * (1 - ellipse[ellipse <= 1])
        image[(ellipse > 0.80) & (ellipse <= 1)] = 180
        ventricle_left = ((xx - (center - 17)) / 10) ** 2 + ((yy - center) / 24) ** 2 <= 1
        ventricle_right = ((xx - (center + 17)) / 10) ** 2 + ((yy - center) / 24) ** 2 <= 1
        image[ventricle_left | ventricle_right] = 25
        if -0.22 < z < 0.38:
            tumor = ((xx - (center + 34)) / 17) ** 2 + ((yy - (center - 16)) / 21) ** 2 <= 1
            rim = ((xx - (center + 34)) / 19) ** 2 + ((yy - (center - 16)) / 23) ** 2 <= 1
            image[rim] = 215
            image[tumor] = 128
        image += np.clip((xx / size) * 12, 0, 12)
        pixels = np.clip(image, 0, 255).astype(np.uint8)
        filename = f"MPR_{index + 1:04d}.jpg"
        Image.fromarray(pixels, mode="L").save(
            series / filename,
            "JPEG",
            quality=100,
            subsampling=0,
        )
        ordered.append({
            "file": filename,
            "position": [0.0, 0.0, float(index)],
            "distance": float(index),
            "sop_instance_uid": f"1.2.826.0.1.3680043.10.999.{index + 1}",
        })
    manifest = {
        "format": "dcom-mpr-jpg",
        "version": 1,
        "series_type": "T1_POST_CONTRAST",
        "series_description": "SYNTHETIC T1 POST - NO PATIENT DATA",
        "series_number": "1",
        "study_instance_uid": "1.2.826.0.1.3680043.10.998",
        "series_instance_uid": "1.2.826.0.1.3680043.10.999",
        "frame_of_reference_uid": "1.2.826.0.1.3680043.10.997",
        "rows": size,
        "columns": size,
        "slice_count": slices,
        "pixel_spacing": [0.8, 0.8],
        "slice_spacing": 1.0,
        "image_orientation_patient": [1, 0, 0, 0, 1, 0],
        "affine": [[0.8, 0, 0, 0], [0, 0.8, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
        "intensity": {"method": "synthetic", "low": 0, "high": 255, "bits": 8},
        "jpeg_quality": 100,
        "ordered_slices": ordered,
    }
    (series / "mpr-volume.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return series


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(create_phantom(args.output))

