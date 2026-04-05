import { Router } from "express";
import { SystemAdminDashboardController } from "../controllers/SystemAdminDashboardController";
import { authenticate } from "../middlewares/authMiddleware";
import { checkSystemAdmin } from "../middlewares/Systemadminmiddleware";

const router = Router();

router.get(
  "/dashboard-summary",
  authenticate,
  checkSystemAdmin,
  SystemAdminDashboardController.getDashboardSummary
);

export default router;
