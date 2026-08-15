// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { setLanguage } from "./i18n.js";
import { getSeriesMediaType } from "./main.js";

describe("Media Studio Detection & Layouts", () => {
  beforeEach(() => {
    setLanguage("vi");
  });

  it("identifies video series correctly", () => {
    expect(getSeriesMediaType({ mediaType: "video" })).toBe("video");
    expect(getSeriesMediaType({ name: "phau_thuat.mp4", description: "Video mo" })).toBe("video");
    expect(getSeriesMediaType({ description: "Video phẫu thuật nội soi" })).toBe("video");
  });

  it("identifies photo and doc series correctly", () => {
    expect(getSeriesMediaType({ mediaType: "photo" })).toBe("photo");
    expect(getSeriesMediaType({ name: "gpb.jpg", description: "Anh giai phau benh" })).toBe("photo");
    expect(getSeriesMediaType({ description: "Tài liệu bệnh án scan", name: "doc.png" })).toBe("doc");
  });

  it("defaults to dicom for regular imaging series", () => {
    expect(getSeriesMediaType({ description: "T1 SAG 5mm", sliceCount: 24 })).toBe("dicom");
    expect(getSeriesMediaType(null)).toBe("dicom");
  });
});
