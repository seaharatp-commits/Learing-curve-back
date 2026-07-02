import { sanitizeReply } from "./sanitize-reply.util";

describe("sanitizeReply", () => {
  it("removes a short dangling bullet that looks truncated", () => {
    const result = sanitizeReply("ข้อควรระวัง\n- ตรวจสอบข้อมูลก่อนทำงาน\n- สำ");

    expect(result).toBe("ข้อควรระวัง\n• ตรวจสอบข้อมูลก่อนทำงาน");
  });

  it("keeps complete bullet points", () => {
    const result = sanitizeReply("ข้อควรระวัง\n- สำรองข้อมูลก่อนเริ่มงานเสมอค่ะ");

    expect(result).toContain("สำรองข้อมูลก่อนเริ่มงานเสมอค่ะ");
  });
});
