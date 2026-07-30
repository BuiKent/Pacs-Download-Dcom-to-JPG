import { describe, expect, it } from "vitest";
import { STACK_PREFETCH_CONFIG } from "./viewer.js";

describe("viewer shell", () => {
  it("keeps the test environment available", () => {
    expect(typeof URLSearchParams).toBe("function");
  });

  it("prefetches only a bounded neighborhood around the current slice", () => {
    expect(STACK_PREFETCH_CONFIG.minBefore).toBe(2);
    expect(STACK_PREFETCH_CONFIG.maxAfter).toBe(6);
    expect(STACK_PREFETCH_CONFIG.directionExtraImages).toBe(0);
    expect(
      STACK_PREFETCH_CONFIG.minBefore + STACK_PREFETCH_CONFIG.maxAfter,
    ).toBeLessThanOrEqual(STACK_PREFETCH_CONFIG.maxImagesToPrefetch);
  });
});
