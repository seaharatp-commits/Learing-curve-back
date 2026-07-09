import { calculateCareerReadiness, type CareerReadinessSkillInput } from "./career-readiness-calculator";

function skill(name: string, score: number, evidenceCount: number): CareerReadinessSkillInput {
  return { name, score, evidenceCount };
}

describe("calculateCareerReadiness", () => {
  it("returns Getting Started with no strengths when nothing has evidence", () => {
    const result = calculateCareerReadiness([
      skill("FrontEnd", 0, 0),
      skill("BackEnd", 0, 0),
    ]);

    expect(result.level).toBe("Getting Started");
    expect(result.readinessScore).toBe(0);
    expect(result.strengths).toEqual([]);
  });

  it("ignores skills with score>0 but no evidence, and evidence but score 0", () => {
    const result = calculateCareerReadiness([
      skill("FrontEnd", 40, 0), // score but no evidence -> ignored
      skill("BackEnd", 0, 5), // evidence but no score -> ignored
    ]);

    expect(result.level).toBe("Getting Started");
    expect(result.strengths).toEqual([]);
  });

  it("returns the strongest evidenced skills first, capped at 3", () => {
    const result = calculateCareerReadiness([
      skill("FrontEnd", 70, 4),
      skill("BackEnd", 90, 6),
      skill("DevOps", 50, 2),
      skill("Testing", 80, 5),
    ]);

    expect(result.strengths).toEqual(["BackEnd", "Testing", "FrontEnd"]);
  });

  it("does not let a single strong skill reach a top tier (breadth matters)", () => {
    // One 100% skill out of 6 total: avg 100, breadth 1/6 -> 100*(0.6+0.4*0.167)=66.7
    const result = calculateCareerReadiness(
      [
        skill("FrontEnd", 100, 10),
        skill("BackEnd", 0, 0),
        skill("DevOps", 0, 0),
        skill("Testing", 0, 0),
        skill("System Analysis", 0, 0),
        skill("Database", 0, 0),
      ],
      6,
    );

    expect(result.readinessScore).toBeCloseTo(66.67, 1);
    expect(result.level).toBe("Junior Strong");
  });

  it("reaches Advanced when the learner is strong across the whole position", () => {
    const result = calculateCareerReadiness(
      [
        skill("FrontEnd", 90, 10),
        skill("BackEnd", 88, 9),
        skill("DevOps", 85, 8),
        skill("Testing", 92, 11),
      ],
      4,
    );

    // avg ~88.75, breadth 1.0 -> 88.75 * 1.0 = 88.75
    expect(result.readinessScore).toBeGreaterThanOrEqual(82);
    expect(result.level).toBe("Advanced");
  });

  it("maps a moderate, broad profile to Junior", () => {
    const result = calculateCareerReadiness(
      [
        skill("FrontEnd", 45, 3),
        skill("BackEnd", 40, 2),
        skill("DevOps", 35, 2),
      ],
      3,
    );

    // avg 40, breadth 1.0 -> 40 * 1.0 = 40 -> Junior
    expect(result.readinessScore).toBe(40);
    expect(result.level).toBe("Junior");
  });

  it("never returns a readinessScore above 100", () => {
    const result = calculateCareerReadiness([skill("FrontEnd", 100, 50)], 1);

    expect(result.readinessScore).toBeLessThanOrEqual(100);
  });

  it("clamps out-of-range skill scores before averaging", () => {
    const result = calculateCareerReadiness([skill("FrontEnd", 150, 5)], 1);

    // 150 clamped to 100, breadth 1 -> 100
    expect(result.readinessScore).toBe(100);
  });
});
