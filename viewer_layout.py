"""Pure image composition helpers for 2D compare and montage layouts."""

from __future__ import annotations

from typing import Optional, Sequence

from PIL import Image, ImageDraw


BACKGROUND = (11, 11, 11)
EMPTY_BORDER = (75, 75, 75)
ACTIVE_BORDER = (0, 190, 230)
TEXT_COLOR = (255, 218, 70)


def _fit_image(image: Image.Image, width: int, height: int) -> Image.Image:
    """Return a proportional copy contained in the requested tile."""
    if image.width <= 0 or image.height <= 0:
        raise ValueError("Image dimensions must be positive")
    scale = min(width / image.width, height / image.height)
    target = (
        max(1, round(image.width * scale)),
        max(1, round(image.height * scale)),
    )
    return image.resize(target, Image.Resampling.LANCZOS)


def compose_grid(
    images: Sequence[Optional[Image.Image]],
    *,
    columns: int,
    rows: int,
    labels: Optional[Sequence[str]] = None,
    active_index: Optional[int] = None,
    gap: int = 6,
) -> Optional[Image.Image]:
    """Compose equal, non-distorted tiles; empty slots remain black."""
    if columns <= 0 or rows <= 0:
        raise ValueError("Grid dimensions must be positive")
    slot_count = columns * rows
    values = list(images[:slot_count])
    values.extend([None] * (slot_count - len(values)))
    valid = [image for image in values if image is not None]
    if not valid:
        return None

    tile_width = max(image.width for image in valid)
    tile_height = max(image.height for image in valid)
    output_width = columns * tile_width + (columns - 1) * gap
    output_height = rows * tile_height + (rows - 1) * gap
    output = Image.new("RGB", (output_width, output_height), BACKGROUND)
    draw = ImageDraw.Draw(output)
    label_values = list(labels or [])

    for slot, image in enumerate(values):
        row, column = divmod(slot, columns)
        left = column * (tile_width + gap)
        top = row * (tile_height + gap)
        right = left + tile_width - 1
        bottom = top + tile_height - 1
        if image is not None:
            fitted = _fit_image(image.convert("RGB"), tile_width, tile_height)
            x = left + (tile_width - fitted.width) // 2
            y = top + (tile_height - fitted.height) // 2
            output.paste(fitted, (x, y))
        color = ACTIVE_BORDER if slot == active_index else EMPTY_BORDER
        draw.rectangle((left, top, right, bottom), outline=color, width=3 if slot == active_index else 1)
        if slot < len(label_values) and label_values[slot]:
            draw.text((left + 7, top + 6), label_values[slot], fill=TEXT_COLOR)
    return output


def compose_compare(
    left: Optional[Image.Image],
    right: Optional[Image.Image],
    *,
    left_label: str,
    right_label: str,
    active: str = "left",
) -> Optional[Image.Image]:
    return compose_grid(
        [left, right],
        columns=2,
        rows=1,
        labels=[left_label, right_label],
        active_index=0 if active == "left" else 1,
    )


def compose_montage(
    images: Sequence[Optional[Image.Image]],
    *,
    count: int,
    labels: Optional[Sequence[str]] = None,
) -> Optional[Image.Image]:
    if count not in (6, 8):
        raise ValueError("Montage count must be 6 or 8")
    return compose_grid(
        images,
        columns=3 if count == 6 else 4,
        rows=2,
        labels=labels,
    )
