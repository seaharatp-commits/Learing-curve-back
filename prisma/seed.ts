import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const [accountCategory, loginCategory] = await Promise.all([
    prisma.category.upsert({
      where: { name: "บัญชีผู้ใช้" },
      update: {},
      create: { name: "บัญชีผู้ใช้" },
    }),
    prisma.category.upsert({
      where: { name: "การเข้าสู่ระบบ" },
      update: {},
      create: { name: "การเข้าสู่ระบบ" },
    }),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: "admin@learningcurve.dev" },
    update: {},
    create: {
      email: "admin@learningcurve.dev",
      passwordHash: await bcrypt.hash("admin1234", 10),
      name: "ผู้ดูแลระบบ",
      role: Role.ADMIN,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "user@learningcurve.dev" },
    update: {},
    create: {
      email: "user@learningcurve.dev",
      passwordHash: await bcrypt.hash("user1234", 10),
      name: "ผู้ใช้งานทั่วไป",
      role: Role.USER,
    },
  });

  await prisma.knowledgeBaseArticle.createMany({
    data: [
      {
        title: "วิธีรีเซ็ตรหัสผ่าน",
        content: "ไปที่หน้า Login แล้วเลือก 'ลืมรหัสผ่าน' จากนั้นกรอกอีเมลเพื่อรับลิงก์รีเซ็ตรหัสผ่าน",
        categoryId: accountCategory.id,
        authorId: admin.id,
      },
      {
        title: "ไม่สามารถเข้าสู่ระบบได้",
        content: "ตรวจสอบว่าอีเมลและรหัสผ่านถูกต้อง และลองล้างแคชเบราว์เซอร์หากยังเข้าไม่ได้",
        categoryId: loginCategory.id,
        authorId: admin.id,
      },
    ],
  });

  // Lessons/quizzes are seeded once (no natural unique key to upsert on).
  const existingLessonCount = await prisma.lesson.count();
  if (existingLessonCount === 0) {
    const lessonTitles = [
      "พื้นฐานการใช้งานระบบ",
      "การจัดการบัญชีผู้ใช้",
      "การแก้ไขปัญหาเบื้องต้น",
      "การใช้งานฐานความรู้",
      "เทคนิคขั้นสูง",
    ];
    const lessonContents = [
      "เริ่มจากสำรวจเมนูหลักของระบบ: แดชบอร์ดใช้ดูภาพรวม, แชทกับ AI ใช้ถามปัญหา, แบบทดสอบใช้ทบทวนความเข้าใจ และประวัติใช้กลับไปดูสิ่งที่เคยเรียนรู้\n\nเป้าหมายของบทนี้คือให้คุณรู้ว่าควรเริ่มจากหน้าจอไหนเมื่อต้องการเรียนต่อหรือค้นหาความรู้เดิม",
      "บัญชีผู้ใช้เป็นศูนย์กลางของประสบการณ์การเรียนรู้ ระบบจะผูกความคืบหน้า คะแนนแบบทดสอบ และประวัติการใช้งานไว้กับบัญชีของคุณ\n\nควรออกจากระบบเมื่อใช้เครื่องร่วมกับผู้อื่น และติดต่อผู้ดูแลหากพบข้อมูลบัญชีผิดปกติ",
      "เมื่อเจอปัญหา ให้เริ่มจากอ่านอาการที่พบ แยกสิ่งที่คาดหวังกับสิ่งที่เกิดขึ้นจริง แล้วค้นหาแนวทางแก้ในฐานความรู้หรือถาม AI ด้วยบริบทที่ครบถ้วน\n\nการอธิบายปัญหาอย่างเป็นขั้นตอนช่วยให้ระบบแนะนำคำตอบที่ตรงขึ้น",
      "ฐานความรู้รวบรวมบทความที่ผ่านการจัดหมวดหมู่แล้ว คุณสามารถใช้เป็นแหล่งอ้างอิงก่อนทำแบบทดสอบ หรือให้ผู้ดูแลสร้างแบบทดสอบจากบทความที่สำคัญได้\n\nบทความที่ดีควรมีสรุป อาการ สาเหตุ วิธีแก้ และวิธีตรวจสอบผลลัพธ์",
      "เมื่อคุ้นกับระบบแล้ว ลองใช้แบบทดสอบเพื่อตรวจช่องว่างความเข้าใจ และใช้ช่องสร้างหัวข้อใหม่ในหน้าแบบทดสอบเพื่อขยายเรื่องที่อยากเรียนรู้ต่อ\n\nการเรียนแบบวนซ้ำระหว่างอ่านเนื้อหา ทำแบบทดสอบ และกลับมาทบทวน จะช่วยให้จำได้ดีขึ้น",
    ];

    const lessons = [];
    for (let i = 0; i < lessonTitles.length; i++) {
      const lesson = await prisma.lesson.create({
        data: {
          title: lessonTitles[i],
          content: lessonContents[i],
          order: i + 1,
          quizzes: { create: { title: `แบบทดสอบ: ${lessonTitles[i]}` } },
        },
        include: { quizzes: true },
      });
      lessons.push(lesson);
    }

    // Demo progress/quiz history for the regular user account: first two
    // lessons completed with passing quiz scores, third lesson not yet
    // attempted -> shows up as "Continue Learning".
    const completedLessons = lessons.slice(0, 2);
    for (const lesson of completedLessons) {
      await prisma.lessonProgress.create({
        data: { userId: user.id, lessonId: lesson.id, completed: true, completedAt: new Date() },
      });
    }

    const scores = [78, 85, 92, 88];
    const daysAgo = [10, 7, 3, 1];
    for (let i = 0; i < scores.length; i++) {
      const lesson = lessons[i % completedLessons.length];
      await prisma.quizAttempt.create({
        data: {
          userId: user.id,
          quizId: lesson.quizzes[0].id,
          score: scores[i],
          completedAt: new Date(Date.now() - daysAgo[i] * 24 * 60 * 60 * 1000),
        },
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
