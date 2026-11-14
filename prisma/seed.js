import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();

const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!email || !password) {
  console.log("Bootstrap admin not created. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.");
} else {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {},
    create: { fullName: process.env.BOOTSTRAP_ADMIN_NAME || "Registry Administrator", email: email.toLowerCase(), passwordHash, role: "ADMIN", institution: process.env.DEFAULT_INSTITUTION || "Demo University" }
  });
  console.log("Bootstrap administrator is ready.");
}
await prisma.$disconnect();
