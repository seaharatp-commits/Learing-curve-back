import { buildFingerprint, sharedTokens, jaccardScore } from "./text-similarity.util";

describe("buildFingerprint", () => {
  it("lowercases and tokenizes into individual words", () => {
    const fp = buildFingerprint(["Windows 11", "error 0x80070005"]);
    expect(fp).toEqual(new Set(["windows", "0x80070005", "error"]));
  });

  it("drops tokens shorter than 3 characters", () => {
    const fp = buildFingerprint(["a ab abc"]);
    expect(fp).toEqual(new Set(["abc"]));
  });

  it("merges multiple input parts into one fingerprint", () => {
    const fp = buildFingerprint(["VPN", "WiFi หลุดบ่อย", "LAN"]);
    expect(fp.has("vpn")).toBe(true);
    expect(fp.has("wifi")).toBe(true);
    expect(fp.has("lan")).toBe(true);
  });

  it("returns an empty set for empty/whitespace-only input", () => {
    expect(buildFingerprint([""]).size).toBe(0);
    expect(buildFingerprint([]).size).toBe(0);
  });

  // This is the actual bug found while testing the dedup/merge feature:
  // comparing whole keyword phrases ("Windows 11" vs "Windows") never
  // overlaps, but tokenizing into words does.
  it("makes differently-phrased mentions of the same thing overlap", () => {
    const a = buildFingerprint(["Windows 11", "0x80070005"]);
    const b = buildFingerprint(["error 0x80070005", "Windows"]);
    expect(sharedTokens(a, b).sort()).toEqual(["0x80070005", "windows"]);
  });
});

describe("sharedTokens", () => {
  it("returns tokens present in both sets", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d"]);
    expect(sharedTokens(a, b).sort()).toEqual(["b", "c"]);
  });

  it("returns an empty array when nothing overlaps", () => {
    expect(sharedTokens(new Set(["a"]), new Set(["b"]))).toEqual([]);
  });
});

describe("jaccardScore", () => {
  it("is 1 for identical sets", () => {
    const a = new Set(["a", "b"]);
    expect(jaccardScore(a, new Set(a))).toBe(1);
  });

  it("is 0 for disjoint sets", () => {
    expect(jaccardScore(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("is 0 when either set is empty", () => {
    expect(jaccardScore(new Set(), new Set(["a"]))).toBe(0);
    expect(jaccardScore(new Set(["a"]), new Set())).toBe(0);
  });

  it("computes intersection over union for partial overlap", () => {
    // intersection={b,c} (2), union={a,b,c,d} (4) -> 0.5
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d"]);
    expect(jaccardScore(a, b)).toBe(0.5);
  });
});
