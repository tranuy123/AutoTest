import { describe, expect, it } from "vitest";

import { describeRunner } from "./index.js";

describe("runner (khung S1.1)", () => {
  it("mo ta dung trang thai cho viec va engine playwright", () => {
    expect(describeRunner()).toEqual({
      name: "@autotest/runner",
      state: "idle",
      engine: "playwright",
    });
  });
});
