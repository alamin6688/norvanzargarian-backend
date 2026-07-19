import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { DriverUploadService } from "./driverUpload.service";
import ApiError from "../../../errors/apiError";
import prisma from "../../../lib/prisma";

const uploadDriverExcel = catchAsync(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No file uploaded.");
  }

  // Get the logged in user to find their associated companyId
  const dbUser = await prisma.user.findUnique({
    where: { id: req.user.id },
  });

  if (!dbUser) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "User not found.");
  }

  // If the user is an ADMIN, they may upload for a specific company passed in query or body
  let companyId = dbUser.companyId;
  if (dbUser.role === "ADMIN") {
    companyId = (req.body.companyId as string) || (req.query.companyId as string);
  }

  if (!companyId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Upload requires a company context. Please specify a companyId."
    );
  }

  const fileSizeKb = Math.round(file.size / 1024);

  const result = await DriverUploadService.processDriverExcel(
    file.path,
    file.originalname,
    fileSizeKb,
    companyId,
    dbUser.id
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Driver list Excel file processed successfully.",
    data: result,
  });
});

export const DriverUploadController = {
  uploadDriverExcel,
};
