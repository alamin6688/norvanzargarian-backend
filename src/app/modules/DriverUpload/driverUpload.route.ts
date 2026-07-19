import express from "express";
import auth from "../../middlewares/auth";
import { upload } from "../../../helpers/file_uploader/fileUploadToLocal";
import { DriverUploadController } from "./driverUpload.controller";

const router = express.Router();

router.post(
  "/driver-excel",
  auth("COMPANY", "ADMIN"),
  upload.single("file"),
  DriverUploadController.uploadDriverExcel
);

export const DriverUploadRoutes = router;
