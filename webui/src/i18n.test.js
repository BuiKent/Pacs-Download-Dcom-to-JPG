import { afterEach, describe, expect, it } from "vitest";
import { getLanguage, setLanguage, t, tf, translateLog } from "./i18n.js";

afterEach(() => setLanguage("en"));

describe("language selection", () => {
  it("defaults to English and only accepts a known language", () => {
    expect(getLanguage()).toBe("en");
    expect(setLanguage("vi")).toBe("vi");
    expect(setLanguage("fr")).toBe("en");
  });

  it("returns the source text unchanged in Vietnamese", () => {
    setLanguage("vi");
    expect(t("Tải ca đã chọn")).toBe("Tải ca đã chọn");
  });

  it("translates known interface text in English", () => {
    setLanguage("en");
    expect(t("Tải ca đã chọn")).toBe("Download selected");
    expect(t("Tải tất cả file")).toBe("Download all files");
    expect(t("Quét danh sách series")).toBe("Scan series list");
    expect(t("Đo chiều dài (mm)")).toBe("Measure length (mm)");
    expect(t("Tải ca theo mã bệnh nhân")).toBe("Download by patient ID");
    expect(t("Đã thêm thư mục nguồn thành công.")).toBe("Source folder added successfully.");
    expect(t("Lỗi:")).toBe("Error:");
  });

  it("falls back to the Vietnamese text when a string is not translated", () => {
    setLanguage("en");
    // An untranslated string must stay readable rather than render empty.
    expect(t("Chuỗi chưa dịch")).toBe("Chuỗi chưa dịch");
  });
});

describe("placeholder substitution", () => {
  it("fills each {} in order", () => {
    setLanguage("vi");
    expect(tf("Đã xóa {} phép đo/ROI.", 3)).toBe("Đã xóa 3 phép đo/ROI.");
  });

  it("fills placeholders in the translated string too", () => {
    setLanguage("en");
    expect(tf("Đang dựng MPR từ {} lát…", 121)).toBe("Building MPR from 121 slices…");
  });

  it("keeps an unfilled placeholder visible instead of printing undefined", () => {
    setLanguage("vi");
    expect(tf("Đã có trong kho · {} ca đã tải · {} ca mới · {} ca chưa hoàn tất", 1)).toContain("{}");
  });
});

describe("pipeline log translation", () => {
  it("leaves logs untouched in Vietnamese", () => {
    setLanguage("vi");
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

  it("translates selective-series inventory and download logs", () => {
    setLanguage("en");
    expect(translateLog("Công cụ nền: Microsoft Edge (dòng này chỉ báo trình duyệt tự động, không báo đăng nhập)."))
      .toBe("Background tool: Microsoft Edge (this line reports browser automation, not a new sign-in).");
    expect(translateLog("[2/3] Đang đọc series ngày 2026-07-06 - MR BRAIN..."))
      .toBe("[2/3] Reading series for 2026-07-06 - MR BRAIN...");
    expect(translateLog("      Bước 1/2: Tạo vé viewer tạm thời cho StudyUID đã chọn (không tìm lại mã bệnh nhân)..."))
      .toBe("      Step 1/2: Creating a temporary viewer ticket for the selected StudyUID (the patient is not searched again)...");
    expect(translateLog("      ✓ Đã dùng lại phiên RIS; không đăng nhập lại."))
      .toBe("      ✓ Reused the existing RIS session; no new sign-in.");
    expect(translateLog("Đường nội bộ http://192.168.50.105 không khả dụng; tự chuyển sang cổng PACS công cộng."))
      .toBe("The internal endpoint http://192.168.50.105 is unavailable; continuing through the public PACS gateway.");
    expect(translateLog("Đã quét 8 series; chưa tải file ảnh nào."))
      .toBe("Scanned 8 series; no image files were saved.");
    expect(translateLog("Manifest: 2 series đã chọn/8 series, ~204 ảnh. Đang tải trực tiếp 204 ảnh (6 luồng song song)..."))
      .toBe("Manifest: 2 of 8 selected series, ~204 images. Downloading 204 images directly (6 parallel threads)...");
  });

  it("keeps the plain download banner free of a dangling capture group", () => {
    setLanguage("en");
    expect(translateLog("BƯỚC 1/2: Tải ảnh từ viewer"))
      .toBe("STEP 1/2: Download images from the viewer");
  });

  it("translates folder scan and resume-metadata failures", () => {
    setLanguage("en");
    expect(translateLog("Đang quét thư mục phim: 100 thư mục…"))
      .toBe("Scanning imaging folders: 100 folders...");
    expect(translateLog("Không thể đổi tên thư mục: access denied"))
      .toBe("Could not rename directory: access denied");
    expect(translateLog("Không thể ghi metadata tải tiếp: disk full"))
      .toBe("Could not write resume metadata: disk full");
    expect(translateLog("❌ CHẶN GỘP CA 2 DO MÂU THUẪN ĐỊNH DANH: Ngày sinh DICOM '2000-01-01' không khớp hồ sơ '2001-01-01'."))
      .toBe("❌ BLOCKED MERGING STUDY 2 DUE TO AN IDENTITY CONFLICT: DICOM birth date '2000-01-01' does not match the patient record '2001-01-01'.");
    expect(translateLog("DICOMweb chưa liệt kê đủ instance của mọi series ảnh; không đánh dấu ca là hoàn tất. 2 - PLAIN: tìm thấy 4/115 instance"))
      .toBe("DICOMweb did not list every image instance; the study was not marked complete. 2 - PLAIN: found 4/115 instances");
  });

  it("passes through a line it does not recognise", () => {
    setLanguage("en");
    expect(translateLog("Dòng log lạ")).toBe("Dòng log lạ");
  });

  it("survives a null message", () => {
    expect(translateLog(null)).toBe("");
  });
});
