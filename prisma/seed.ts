import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

const defaultPositions = [
  {
    name: "Software Engineer",
    description: "Builds, tests, and maintains software systems across frontend, backend, and infrastructure.",
    skills: [
      { name: "FrontEnd", keywords: ["ui", "layout", "component", "responsive", "react", "nextjs"] },
      { name: "BackEnd", keywords: ["api", "database", "auth", "server", "architecture", "nestjs"] },
      { name: "DevOps", keywords: ["docker", "deploy", "ci/cd", "pipeline", "server", "cloud"] },
      { name: "Testing", keywords: ["test", "validation", "bug", "jest", "qa"] },
      { name: "System Analysis", keywords: ["requirement", "workflow", "use case", "analysis"] },
      { name: "Database", keywords: ["sql", "postgresql", "schema", "prisma", "query"] },
    ],
  },
  {
    name: "UX/UI Designer",
    description: "Designs user-centered product experiences, flows, interfaces, and design systems.",
    skills: [
      { name: "User Research", keywords: ["research", "interview", "persona", "user need"] },
      { name: "Wireframing", keywords: ["wireframe", "flow", "layout", "structure"] },
      { name: "Visual Design", keywords: ["color", "typography", "visual", "spacing"] },
      { name: "Prototyping", keywords: ["prototype", "figma", "interaction", "mockup"] },
      { name: "Usability Testing", keywords: ["usability", "test", "feedback", "heuristic"] },
      { name: "Design Systems", keywords: ["component", "token", "style guide", "design system"] },
    ],
  },
  {
    name: "Investor",
    description: "Analyzes markets, risk, valuation, and portfolio decisions.",
    skills: [
      { name: "Financial Analysis", keywords: ["financial", "statement", "ratio", "cash flow"] },
      { name: "Risk Management", keywords: ["risk", "drawdown", "volatility", "loss"] },
      { name: "Market Research", keywords: ["market", "industry", "trend", "competitor"] },
      { name: "Portfolio Strategy", keywords: ["portfolio", "diversification", "allocation"] },
      { name: "Valuation", keywords: ["valuation", "dcf", "multiple", "intrinsic"] },
      { name: "Decision Making", keywords: ["decision", "bias", "thesis", "strategy"] },
    ],
  },
  {
    name: "Financial Accounting",
    description: "Handles bookkeeping, reporting, tax, audit, budgeting, and compliance.",
    skills: [
      { name: "Bookkeeping", keywords: ["journal", "ledger", "transaction", "bookkeeping"] },
      { name: "Financial Reporting", keywords: ["report", "statement", "balance sheet", "income"] },
      { name: "Tax", keywords: ["tax", "vat", "withholding", "filing"] },
      { name: "Audit", keywords: ["audit", "evidence", "control", "sampling"] },
      { name: "Budgeting", keywords: ["budget", "forecast", "variance", "planning"] },
      { name: "Compliance", keywords: ["compliance", "standard", "policy", "regulation"] },
    ],
  },
  {
    name: "Project Manager",
    description: "Plans, coordinates, and monitors projects, risks, teams, and stakeholders.",
    skills: [
      { name: "Planning", keywords: ["plan", "timeline", "milestone", "scope"] },
      { name: "Communication", keywords: ["communication", "meeting", "status", "report"] },
      { name: "Risk Management", keywords: ["risk", "issue", "mitigation", "dependency"] },
      { name: "Resource Management", keywords: ["resource", "capacity", "team", "allocation"] },
      { name: "Agile/Scrum", keywords: ["agile", "scrum", "sprint", "backlog"] },
      { name: "Stakeholder Management", keywords: ["stakeholder", "expectation", "alignment"] },
    ],
  },
  {
    name: "Sales Manager",
    description: "Manages sales pipelines, customer relationships, strategy, and team performance.",
    skills: [
      { name: "Lead Management", keywords: ["lead", "pipeline", "prospect", "qualification"] },
      { name: "Negotiation", keywords: ["negotiation", "deal", "objection", "closing"] },
      { name: "CRM", keywords: ["crm", "salesforce", "hubspot", "customer data"] },
      { name: "Sales Strategy", keywords: ["strategy", "target", "segment", "pricing"] },
      { name: "Customer Relationship", keywords: ["customer", "relationship", "retention"] },
      { name: "Performance Analysis", keywords: ["kpi", "conversion", "forecast", "performance"] },
    ],
  },
  {
    name: "IT Support",
    description: "Troubleshoots technical problems and supports users, devices, networks, and systems.",
    skills: [
      { name: "Troubleshooting", keywords: ["troubleshoot", "error", "diagnose", "fix"] },
      { name: "Networking", keywords: ["network", "ip", "dns", "wifi", "router"] },
      { name: "Hardware", keywords: ["hardware", "device", "printer", "pc", "laptop"] },
      { name: "Operating Systems", keywords: ["windows", "macos", "linux", "os"] },
      { name: "Security Basics", keywords: ["security", "malware", "password", "permission"] },
      { name: "Customer Support", keywords: ["support", "ticket", "user", "service"] },
    ],
  },
];

async function main() {
  for (const positionData of defaultPositions) {
    const position = await prisma.position.upsert({
      where: { name: positionData.name },
      update: {
        description: positionData.description,
        isActive: true,
      },
      create: {
        name: positionData.name,
        description: positionData.description,
      },
    });

    for (const skill of positionData.skills) {
      await prisma.positionSkill.upsert({
        where: { positionId_name: { positionId: position.id, name: skill.name } },
        update: {
          keywords: skill.keywords,
          isActive: true,
        },
        create: {
          positionId: position.id,
          name: skill.name,
          keywords: skill.keywords,
        },
      });
    }
  }

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
          createdByUserId: admin.id,
          content: lessonContents[i],
          order: i + 1,
          quizzes: { create: { title: `แบบทดสอบ: ${lessonTitles[i]}`, createdByUserId: admin.id } },
        },
        include: { quizzes: true },
      });
      lessons.push(lesson);
    }

    // Demo progress for the regular user account: first two lessons completed,
    // but quiz history starts empty so the dashboard reflects real attempts.
    const completedLessons = lessons.slice(0, 2);
    for (const lesson of completedLessons) {
      await prisma.lessonProgress.create({
        data: { userId: user.id, lessonId: lesson.id, completed: true, completedAt: new Date() },
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
