import { Router } from "express";
import { InstitutionAdminController } from "../controllers/InstitutionAdminController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

router.get(
  "/:institutionId/dashboard",
  authenticate,
  InstitutionAdminController.getAdminDashboard
);

router.get(
  "/:institutionId/info",
  authenticate,
  InstitutionAdminController.getInstitutionBasicInfo
);

export default router;