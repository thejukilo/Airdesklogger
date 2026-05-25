import { describe, it, expect } from "vitest";
import {
  functionMinutes,
  countersignRequirement,
  functionRemark,
} from "../src/domain/functionTime.js";

describe("pilot function time", () => {
  it("credits PIC time for PIC, PICUS and SPIC", () => {
    for (const primary of ["PIC", "PICUS", "SPIC"] as const) {
      const fm = functionMinutes({ primary, instructor: 0 }, 120);
      expect(fm.pic).toBe(120);
      expect(fm.coPilot).toBe(0);
      expect(fm.dual).toBe(0);
    }
  });

  it("credits co-pilot and dual to their own columns", () => {
    expect(functionMinutes({ primary: "CO_PILOT", instructor: 0 }, 90).coPilot).toBe(90);
    expect(functionMinutes({ primary: "DUAL", instructor: 0 }, 90).dual).toBe(90);
  });

  it("treats instructor time as an independent annotation", () => {
    const fm = functionMinutes({ primary: "PIC", instructor: 120 }, 120);
    expect(fm.pic).toBe(120);
    expect(fm.instructor).toBe(120);
  });

  it("requires supervising-PIC countersignature for PICUS", () => {
    const r = countersignRequirement({ primary: "PICUS", instructor: 0 });
    expect(r.required).toBe(true);
    expect(r.role).toBe("SUPERVISING_PIC");
  });

  it("requires instructor countersignature for SPIC", () => {
    const r = countersignRequirement({ primary: "SPIC", instructor: 0 });
    expect(r.required).toBe(true);
    expect(r.role).toBe("INSTRUCTOR");
  });

  it("requires no countersignature for plain PIC", () => {
    expect(countersignRequirement({ primary: "PIC", instructor: 0 }).required).toBe(false);
  });

  it("annotates the remarks column for PICUS/SPIC", () => {
    expect(functionRemark({ primary: "PICUS", instructor: 0 })).toBe("PICUS");
    expect(functionRemark({ primary: "SPIC", instructor: 0 })).toBe("SPIC");
    expect(functionRemark({ primary: "PIC", instructor: 0 })).toBeNull();
  });
});
