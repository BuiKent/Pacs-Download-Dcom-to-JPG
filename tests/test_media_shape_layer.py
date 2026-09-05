"""
pytest for the vector shape layer in photo_engine.py.

The studio draws on a canvas and posts the whole layer once; these check that
what arrives is parsed the way the client actually spells it, that the marks
land where they were drawn, and — the part that matters clinically — that a
redaction really removes the pixels rather than covering them.
"""

from pathlib import Path

import pytest
from PIL import Image, ImageDraw

import photo_engine as pe


@pytest.fixture()
def sample_photo(tmp_path: Path) -> Path:
    """An intra-operative photo with an identity strip burned into the corner."""
    path = tmp_path / "trong_mo.jpg"
    img = Image.new("RGB", (900, 600), (60, 110, 160))
    draw = ImageDraw.Draw(img)
    # A bright, unmistakable block to redact: an average that stays bright
    # afterwards proves the redaction did nothing.
    draw.rectangle((40, 40, 340, 100), fill=(255, 255, 255))
    img.save(path, quality=95)
    return path


class TestPayloadParsing:
    def test_accepts_the_camel_case_the_client_actually_sends(self):
        # `TextAnnotation(**{"fontSize": 24})` raised TypeError on every single
        # use of the old text tool, and no test caught it because the tests all
        # built the dataclass directly.
        shape = pe.Shape.from_dict({
            "kind": "text", "x": 10, "y": 20, "fontSize": 30, "strokeWidth": 6,
        })
        assert shape.font_size == 30
        assert shape.stroke_width == 6

    def test_accepts_a_colour_as_a_triple_or_as_a_hex_string(self):
        assert pe.Shape.from_dict({"kind": "rect", "color": [10, 132, 255]}).color == (10, 132, 255)
        assert pe.Shape.from_dict({"kind": "rect", "color": "#0a84ff"}).color == (10, 132, 255)
        assert pe.Shape.from_dict({"kind": "rect", "color": "#fff"}).color == (255, 255, 255)

    def test_ignores_keys_the_engine_has_no_field_for(self):
        # The client carries an id and a selection flag it has no reason to
        # strip; an unknown key must not take the whole request down.
        shape = pe.Shape.from_dict({"kind": "arrow", "id": "sh_7", "editing": False, "x1": 5})
        assert shape.kind == "arrow"
        assert shape.x1 == 5

    def test_rejects_a_kind_it_cannot_draw(self):
        with pytest.raises(pe.PhotoEngineError):
            pe.Shape.from_dict({"kind": "blur3d"})
        with pytest.raises(pe.PhotoEngineError):
            pe.Shape.from_dict({"x": 1, "y": 2})

    def test_clamps_opacity_into_range(self):
        assert pe.Shape.from_dict({"kind": "rect", "opacity": 4.5}).opacity == 1.0
        assert pe.Shape.from_dict({"kind": "rect", "opacity": -2}).opacity == 0.0

    def test_rounds_geometry_arriving_as_floats(self):
        shape = pe.Shape.from_dict({"kind": "rect", "x": 10.6, "y": 20.4, "width": 99.5})
        assert (shape.x, shape.y, shape.width) == (11, 20, 100)


class TestDrawing:
    def test_draws_the_whole_layer_in_one_output_file(self, sample_photo, tmp_path):
        out = tmp_path / "drawn.jpg"
        result = pe.draw_shapes(sample_photo, out, [
            {"kind": "arrow", "x1": 100, "y1": 500, "x2": 400, "y2": 200, "color": [255, 59, 48]},
            {"kind": "ellipse", "x": 420, "y": 160, "width": 220, "height": 150},
            {"kind": "text", "x": 80, "y": 240, "text": "Tổn thương gan phải", "font_size": 30},
            {"kind": "marker", "x": 640, "y": 470, "label": "3", "font_size": 30},
            {"kind": "pen", "points": [[700, 100], [730, 160], [700, 220]]},
        ])
        assert result.exists()
        assert Image.open(result).size == (900, 600)

    def test_leaves_the_original_untouched(self, sample_photo, tmp_path):
        before = sample_photo.read_bytes()
        pe.draw_shapes(sample_photo, tmp_path / "drawn.jpg",
                       [{"kind": "rect", "x": 0, "y": 0, "width": 100, "height": 100}])
        assert sample_photo.read_bytes() == before

    def test_refuses_an_empty_layer(self, sample_photo, tmp_path):
        with pytest.raises(pe.PhotoEngineError):
            pe.draw_shapes(sample_photo, tmp_path / "drawn.jpg", [])

    def test_renders_vietnamese_text(self, sample_photo, tmp_path):
        # The notes a surgeon writes are Vietnamese; a font that cannot carry
        # the diacritics turns them into boxes.
        out = pe.draw_shapes(sample_photo, tmp_path / "vn.jpg", [
            {"kind": "text", "x": 60, "y": 300, "text": "Ổ loét bờ cong nhỏ",
             "font_size": 40, "color": [255, 255, 255], "background": False},
        ])
        region = Image.open(out).convert("RGB").crop((50, 290, 700, 360))
        # White glyphs on the blue ground: the brightest pixel must be near white.
        assert max(region.convert("L").getdata()) > 230

    def test_a_shape_lands_where_it_was_drawn(self, sample_photo, tmp_path):
        out = pe.draw_shapes(sample_photo, tmp_path / "placed.jpg", [
            {"kind": "rect", "x": 600, "y": 400, "width": 200, "height": 120,
             "color": [255, 0, 0], "filled": True},
        ])
        drawn = Image.open(out).convert("RGB")
        assert drawn.getpixel((700, 460))[0] > 200      # inside the red block
        assert drawn.getpixel((200, 200))[0] < 120      # far away, untouched

    def test_a_highlight_lets_the_tissue_show_through(self, sample_photo, tmp_path):
        out = pe.draw_shapes(sample_photo, tmp_path / "hl.jpg", [
            {"kind": "highlight", "x": 100, "y": 300, "width": 300, "height": 100,
             "color": [255, 204, 0]},
        ])
        under = Image.open(out).convert("RGB").getpixel((250, 350))
        # Tinted, but not painted over: the blue channel of the photo survives.
        assert under != (255, 204, 0)
        assert under[2] > 60


class TestDestructiveShapes:
    def test_redaction_removes_the_pixels_it_covers(self, sample_photo, tmp_path):
        out = pe.draw_shapes(sample_photo, tmp_path / "red.jpg", [
            {"kind": "redact", "x": 40, "y": 40, "width": 300, "height": 60},
        ])
        strip = Image.open(out).convert("L").crop((45, 45, 335, 95))
        # The white identity block is gone, not merely hidden behind an overlay.
        assert max(strip.getdata()) < 40

    def test_pixelation_destroys_detail_without_blacking_the_region_out(self, tmp_path):
        src = tmp_path / "detail.png"
        img = Image.new("RGB", (400, 200), (0, 0, 0))
        draw = ImageDraw.Draw(img)
        for x in range(0, 400, 4):
            draw.line((x, 0, x, 200), fill=(255, 255, 255), width=2)
        img.save(src)

        out = pe.draw_shapes(src, tmp_path / "px.png", [
            {"kind": "pixelate", "x": 0, "y": 0, "width": 400, "height": 200, "stroke_width": 10},
        ])
        result = Image.open(out).convert("L")
        row = list(result.crop((0, 100, 400, 101)).getdata())
        # The fine stripes are gone: no neighbouring pair swings the full range.
        assert max(abs(a - b) for a, b in zip(row, row[1:])) < 200
        # But the region still carries the average brightness — it is a mosaic,
        # not a black box, so the reader can still see what kind of thing it was.
        assert 40 < sum(row) / len(row) < 220

    def test_a_region_dragged_past_the_edge_is_clipped_not_rejected(self, sample_photo, tmp_path):
        # The pointer is clamped to the image, but rounding at the border used to
        # push a rectangle one pixel over and Pillow refuses that box outright.
        out = pe.draw_shapes(sample_photo, tmp_path / "edge.jpg", [
            {"kind": "redact", "x": 800, "y": 550, "width": 400, "height": 300},
        ])
        assert out.exists()

    def test_splits_what_must_filter_from_what_can_be_composited(self):
        drawn, destructive = pe.split_destructive([
            {"kind": "arrow", "x1": 0, "y1": 0, "x2": 10, "y2": 10},
            {"kind": "pixelate", "x": 0, "y": 0, "width": 10, "height": 10},
            {"kind": "redact", "x": 0, "y": 0, "width": 10, "height": 10},
        ])
        assert [s.kind for s in drawn] == ["arrow"]
        assert [s.kind for s in destructive] == ["pixelate", "redact"]


class TestOverlayForVideo:
    def test_renders_a_transparent_layer_at_the_frame_size(self, tmp_path):
        out = pe.render_overlay_png([
            {"kind": "arrow", "x1": 80, "y1": 300, "x2": 300, "y2": 140},
            {"kind": "text", "x": 60, "y": 40, "text": "Kẹp ống mật", "font_size": 26},
        ], (1280, 720), tmp_path / "ov.png")
        img = Image.open(out)
        assert img.size == (1280, 720)
        assert img.mode == "RGBA"
        low, high = img.getchannel("A").getextrema()
        assert low == 0 and high == 255  # drawn marks over genuine transparency

    def test_leaves_destructive_shapes_out_of_the_overlay(self, tmp_path):
        # Compositing a picture of a blur over a video leaves the face in the
        # frames underneath; those regions are ffmpeg's job, not this one.
        out = pe.render_overlay_png([
            {"kind": "redact", "x": 0, "y": 0, "width": 1280, "height": 720},
        ], (1280, 720), tmp_path / "empty.png")
        assert Image.open(out).getchannel("A").getextrema() == (0, 0)

    def test_refuses_an_impossible_frame_size(self, tmp_path):
        with pytest.raises(pe.PhotoEngineError):
            pe.render_overlay_png([], (0, 720), tmp_path / "bad.png")
        with pytest.raises(pe.PhotoEngineError):
            pe.render_overlay_png([], (99999, 720), tmp_path / "bad.png")


class TestLegibility:
    def test_marker_digits_take_the_ink_that_survives_the_fill(self):
        # A yellow marker with white digits is unreadable, and the number is the
        # whole point of a marker.
        assert pe._readable_ink((255, 204, 0)) == (17, 17, 17)
        assert pe._readable_ink((10, 132, 255)) == (255, 255, 255)

    def test_client_and_engine_agree_on_the_mosaic_block_size(self):
        # `pixelateBlock` in photo-annotator.js computes max(4, round(w * 2.5)).
        # If the two drift, the reader approves one coarseness and gets another.
        for width, expected in ((4, 10), (1, 4), (12, 30)):
            assert pe._pixelate_block(pe.Shape(kind="pixelate", stroke_width=width)) == expected


class TestTimedMarks:
    """A mark on a clip carries when it is on screen; one on a photo does not."""

    def test_parses_a_span_from_the_client(self):
        shape = pe.Shape.from_dict({"kind": "arrow", "start_s": 4, "end_s": 13})
        assert (shape.start_s, shape.end_s) == (4.0, 13.0)

    def test_a_mark_with_no_span_belongs_to_the_whole_clip(self):
        # Absent, not null-and-zero: an identity stamp that quietly became a
        # 0.0-second overlay would vanish from the recording it identifies.
        shape = pe.Shape.from_dict({"kind": "text", "text": "BN 02"})
        assert shape.start_s is None and shape.end_s is None

    def test_the_span_does_not_change_what_is_drawn(self, tmp_path):
        # Timing is the video layer's business; the rasteriser must ignore it,
        # or a timed mark would come out different from an untimed one.
        base = {"kind": "rect", "x": 10, "y": 10, "width": 80, "height": 60,
                "color": [255, 0, 0], "filled": True}
        plain = pe.render_overlay_png([base], (200, 150), tmp_path / "a.png")
        timed = pe.render_overlay_png([{**base, "start_s": 2, "end_s": 5}],
                                      (200, 150), tmp_path / "b.png")
        assert Image.open(plain).tobytes() == Image.open(timed).tobytes()
