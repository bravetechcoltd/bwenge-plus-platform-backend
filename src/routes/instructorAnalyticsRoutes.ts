import { Router } from "express";
import { InstructorAnalyticsController } from "../controllers/InstructorAnalyticsController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

// ==================== INSTRUCTOR ANALYTICS ROUTES ====================

// Get comprehensive analytics for instructor
router.get(
  "/",
  authenticate,
  InstructorAnalyticsController.getAnalyticsOverview
);

// Export analytics data
router.get(
  "/export",
  authenticate,
  InstructorAnalyticsController.exportAnalytics
);

export default router;