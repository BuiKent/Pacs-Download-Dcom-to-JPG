import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Export Options Modal", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("modal markup includes options for Web Viewer, DICOM and Both", () => {
    const html = `
      <div class="export-modal-overlay">
        <div class="export-modal-dialog">
          <header class="export-modal-header">
            <h3 class="export-modal-title">Tùy chọn xuất hồ sơ</h3>
            <button class="file-info-close-btn" data-action="close-export-modal">✕</button>
          </header>
          <div class="export-modal-body">
            <div class="export-options-grid">
              <div class="export-option-card" data-action="confirm-export-choice" data-mode="viewer" data-folder="/path/patient">
                <span class="title">Web PACS Viewer (Ảnh JPG)</span>
              </div>
              <div class="export-option-card" data-action="confirm-export-choice" data-mode="dicom" data-folder="/path/patient">
                <span class="title">File gốc DICOM</span>
              </div>
              <div class="export-option-card" data-action="confirm-export-choice" data-mode="both" data-folder="/path/patient">
                <span class="title">Xuất đầy đủ (Cả Web Viewer + DICOM)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.getElementById("app").innerHTML = html;

    const cards = document.querySelectorAll(".export-option-card");
    expect(cards.length).toBe(3);
    expect(cards[0].getAttribute("data-mode")).toBe("viewer");
    expect(cards[1].getAttribute("data-mode")).toBe("dicom");
    expect(cards[2].getAttribute("data-mode")).toBe("both");
  });
});
