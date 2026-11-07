import { describe, expect, it } from "vitest";

import { ROLE_IDS, listRoleIds, type Scenario } from "./index.js";

describe("scenario-schema (khung S1.1)", () => {
  it("co du 5 vai dung thu tu hien thi", () => {
    expect(listRoleIds()).toEqual([
      "benh-nhan",
      "le-tan",
      "bac-si",
      "thu-ngan",
      "quan-ly",
    ]);
    expect(ROLE_IDS).toHaveLength(5);
  });

  it("khai bao duoc mot kich ban mau bang kieu cua goi", () => {
    const mau: Scenario = {
      id: "dat-lich-den-bao-cao",
      name: "Dat lich -> check-in -> thanh toan -> bao cao doanh thu",
      roles: ["benh-nhan", "le-tan", "thu-ngan", "quan-ly"],
      steps: [
        { id: "dat-lich", role: "benh-nhan", action: "dat-lich" },
        {
          id: "xac-nhan",
          role: "le-tan",
          action: "xac-nhan-lich",
          syncEvent: "appointment.created",
        },
      ],
    };
    expect(mau.steps).toHaveLength(2);
    expect(mau.steps[1]?.syncEvent).toBe("appointment.created");
  });
});
