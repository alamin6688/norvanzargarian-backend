import { Role } from "@prisma/client";
import config from "../../config";
import prisma from "../../lib/prisma";
import { hashItem } from "../../utils/hashAndCompareItem";
import logger from "../../utils/logger/logger";

export const seedDefaultAdmin = async (): Promise<void> => {
  try {
    const adminEmail = config.admin.email;
    if (!adminEmail) {
      logger.warn("⚠️ No DEFAULT_ADMIN_EMAIL specified in config/env. Skipping admin seed.");
      return;
    }

    // Check if default admin user already exists
    const existingAdmin = await prisma.user.findFirst({
      where: {
        email: adminEmail,
      },
    });

    if (existingAdmin) {
      logger.info(`ℹ️ Default Admin already exists with email: ${adminEmail}`);
      return;
    }

    // Hash default password
    const hashedPassword = await hashItem(config.admin.password);

    // Create the default admin user
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: config.admin.name || "System Admin",
        password: hashedPassword,
        role: Role.ADMIN,
        isEmailVerified: true,
        isActive: true,
      },
    });

    logger.info(`✅ Default Admin user successfully seeded: ${adminEmail}`);
  } catch (error) {
    logger.error("❌ Failed to seed default admin:", error);
  }
};
