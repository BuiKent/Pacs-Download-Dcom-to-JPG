import { describe, expect, it } from "vitest";

describe("viewer shell", () => {
  it("keeps the test environment available", () => {
    expect(typeof URLSearchParams).toBe("function");
  });
});
