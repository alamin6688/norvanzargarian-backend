import express from "express";
import { AuthRoutes } from "../modules/Auth/auth.route";
import { DriverUploadRoutes } from "../modules/DriverUpload/driverUpload.route";

const router = express.Router();

const moduleRoutes = [
  {
    path: "/auth",
    route: AuthRoutes,
  },
  {
    path: "/uploads",
    route: DriverUploadRoutes,
  },
];

moduleRoutes.forEach((r) => router.use(r.path, r.route));

export default router;
