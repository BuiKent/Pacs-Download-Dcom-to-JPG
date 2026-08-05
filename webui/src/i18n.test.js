import { afterEach, describe, expect, it } from "vitest";
import { getLanguage, setLanguage, t, tf, translateLog } from "./i18n.js";

afterEach(() => setLanguage("vi"));

describe("language selection", () => {
  it("defaults to Vietnamese and only accepts a known language", () => {
    expect(getLanguage()).toBe("vi");
    expect(setLanguage("en")).toBe("en");
    expect(setLanguage("fr")).toBe("vi");
  });

  it("returns the source text unchanged in Vietnamese", () => {
    expect(t("Tải ca đã chọn")).toBe("Tải ca đã chọn");
  });

  it("translates known interface text in English", () => {
    setLanguage("en");
    expect(t("Tải ca đã chọn")).toBe("Download selected");
    expect(t("Đo chiều dài (mm)")).toBe("Measure length (mm)");
  });

  it("falls back to the Vietnamese text when a string is not translated", () => {
    setLanguage("en");
    // An untranslated string must stay readable rather than render empty.
    expect(t("Chuỗi chưa dịch")).toBe("Chuỗi chưa dịch");
  });
});

describe("placeholder substitution", () => {
  it("fills each {} in order", () => {
    expect(tf("Đã xóa {} phép đo/ROI.", 3)).toBe("Đã xóa 3 phép đo/ROI.");
  });

  it("fills placeholders in the translated string too", () => {
    setLanguage("en");
    expect(tf("Đang dựng MPR từ {} lát…", 121)).toBe("Building MPR from 121 slices…");
  });

  it("keeps an unfilled placeholder visible instead of printing undefined", () => {
    expect(tf("Đã có trong kho · {} ca đã tải · {} ca mới · {} ca chưa hoàn tất", 1)).toContain("{}");
  });
});

describe("pipeline log translation", () => {
  it("leaves logs untouched in Vietnamese", () => {
    const line = "  ...đã tải 42 ảnh (DICOM: 40)";
    expect(translateLog(line)).toBe(line);
  });

  it("rewrites a log line and keeps its captured numbers", () => {
    setLanguage("en");
    expect(translateLog("  ...đã tải 42 ảnh (DICOM: 40)"))
      .toBe("  ...downloaded 42 images (DICOM: 40)");
  });

  it("translates the retry banner the resume flow emits", () => {
    setLanguage("en");
    expect(translateLog("BƯỚC 1/2: Tải ảnh từ viewer (THỬ LẠI — gộp vào folder cũ)"))
      .toBe("STEP 1/2: Download images from the viewer (RETRY — merging into the existing folder)");
  });

  it("keeps the plain download banner free of a dangling capture group", () => {
    setLanguage("en");
    expect(translateLog("BƯỚC 1/2: Tải ảnh từ viewer"))
      .toBe("STEP 1/2: Download images from the viewer");
  });

  it("passes through a line it does not recognise", () => {
    setLanguage("en");
    expect(translateLog("Dòng log lạ")).toBe("Dòng log lạ");
  });

  it("survives a null message", () => {
    expect(translateLog(null)).toBe("");
  });
});
