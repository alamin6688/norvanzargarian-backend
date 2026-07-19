import * as xlsx from "xlsx";
import httpStatus from "http-status";
import { Role, DriverStatus } from "@prisma/client";
import ApiError from "../../../errors/apiError";
import prisma from "../../../lib/prisma";
import { hashItem } from "../../../utils/hashAndCompareItem";
import { IDriverUploadResult } from "./driverUpload.interface";
import logger from "../../../utils/logger/logger";
import * as fs from "fs";

const processDriverExcel = async (
  filePath: string,
  fileName: string,
  fileSizeKb: number,
  companyId: string,
  uploadedById: string
): Promise<IDriverUploadResult> => {
  // Create an initial DataUpload log with status PROCESSING
  const dataUploadLog = await prisma.dataUpload.create({
    data: {
      companyId,
      uploadedById,
      fileName,
      fileSizeKb,
      format: "Excel",
      status: "PROCESSING",
    },
  });

  const errors: string[] = [];
  let successCount = 0;
  let failedCount = 0;
  let totalRows = 0;

  try {
    if (!fs.existsSync(filePath)) {
      throw new ApiError(httpStatus.NOT_FOUND, "Uploaded file not found on disk.");
    }

    // Read the workbook
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Excel workbook contains no sheets.");
    }

    const worksheet = workbook.Sheets[sheetName];
    const rawData = xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet);
    totalRows = rawData.length;

    if (totalRows === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Excel sheet is empty.");
    }

    // Get default hashed password for new drivers
    const defaultPasswordHash = await hashItem("Driver@123");

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNumber = i + 2; // 1-indexed header + 1-indexed index

      // Case-insensitive key extraction
      let name = "";
      let email = "";
      let associateId = "";

      for (const key of Object.keys(row)) {
        const lowerKey = key.trim().toLowerCase();
        const value = String(row[key] ?? "").trim();

        if (lowerKey === "name" || lowerKey === "driver name" || lowerKey === "drivername") {
          name = value;
        } else if (lowerKey === "email" || lowerKey === "driver email" || lowerKey === "driveremail") {
          email = value;
        } else if (
          lowerKey === "associate id" ||
          lowerKey === "associateid" ||
          lowerKey === "driver id" ||
          lowerKey === "driverid" ||
          lowerKey === "id"
        ) {
          associateId = value;
        }
      }

      if (!email || !name) {
        errors.push(`Row ${rowNumber}: Missing required name or email field.`);
        failedCount++;
        continue;
      }

      // Simple email validation regex
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        errors.push(`Row ${rowNumber}: Invalid email format (${email}).`);
        failedCount++;
        continue;
      }

      try {
        const existingDriver = await prisma.user.findUnique({
          where: { email },
        });

        if (existingDriver) {
          // If the user exists, update their driver-related info and link to this company
          await prisma.user.update({
            where: { id: existingDriver.id },
            data: {
              name,
              associateId: associateId || existingDriver.associateId,
              companyId,
              role: Role.DRIVER, // Ensure their role is DRIVER
            },
          });
        } else {
          // If the user doesn't exist, create a new DRIVER user
          await prisma.user.create({
            data: {
              email,
              name,
              password: defaultPasswordHash,
              role: Role.DRIVER,
              associateId: associateId || null,
              companyId,
              isEmailVerified: true, // auto-verified since company admin created them
              isActive: true,
              status: DriverStatus.ACTIVE,
            },
          });
        }
        successCount++;
      } catch (rowErr) {
        const errorMsg = rowErr instanceof Error ? rowErr.message : "Unknown error";
        logger.error(`Error saving driver at row ${rowNumber}:`, rowErr);
        errors.push(`Row ${rowNumber}: Database error (${errorMsg}).`);
        failedCount++;
      }
    }

    // Update log status to SUCCESS or FAILED based on records processed
    const finalStatus = successCount > 0 ? "SUCCESS" : "FAILED";
    const errorMessage = errors.length > 0 ? errors.slice(0, 5).join(" | ") : undefined;

    await prisma.dataUpload.update({
      where: { id: dataUploadLog.id },
      data: {
        status: finalStatus,
        recordsProcessed: successCount,
        errorMessage,
      },
    });

    // Attempt to delete temp file
    try {
      fs.unlinkSync(filePath);
    } catch (fsErr) {
      logger.error("Failed to delete temporary uploaded file:", fsErr);
    }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Excel processing failed.";
    logger.error("Excel processing failed completely:", err);

    await prisma.dataUpload.update({
      where: { id: dataUploadLog.id },
      data: {
        status: "FAILED",
        errorMessage: errorMsg,
      },
    });

    // Attempt to delete temp file
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (fsErr) {
      logger.error("Failed to delete temporary uploaded file after error:", fsErr);
    }

    throw new ApiError(httpStatus.BAD_REQUEST, errorMsg);
  }

  return {
    totalRows,
    successCount,
    failedCount,
    errors,
  };
};

export const DriverUploadService = {
  processDriverExcel,
};
