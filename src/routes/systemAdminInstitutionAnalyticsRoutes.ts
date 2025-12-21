import { Router } from "express";
import { SystemAdminInstitutionAnalyticsController } from "../controllers/SystemAdminInstitutionAnalyticsController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

// All routes require authentication and system admin role
router.use(authenticate);

// ==================== INSTITUTION ANALYTICS ROUTES ====================

// Get comprehensive institution analytics
router.get(
  "/",
  SystemAdminInstitutionAnalyticsController.getInstitutionAnalytics
);

// Export institution analytics data
router.get(
  "/export",
  SystemAdminInstitutionAnalyticsController.exportInstitutionAnalytics
);

export default router;