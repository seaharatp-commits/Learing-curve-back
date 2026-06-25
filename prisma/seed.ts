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

  await prisma.user.upsert({
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
