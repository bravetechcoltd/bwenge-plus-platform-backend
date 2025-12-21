import { Router } from "express";
import { ProgressController } from "../controllers/ProgressController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

// ==================== ALL ROUTES REQUIRE AUTHENTICATION ====================

// ✅ FIX: Add the missing endpoint for getting course progress (without userId in URL)
// This matches: GET /api/progress/course/:courseId
router.get(
  "/course/:courseId",
  authenticate,
  ProgressController.getCourseProgressForCurrentUser
);

// GET user progress for a specific course (with userId in URL)
// Matches: GET /api/progress/course/:courseId/user/:userId
router.get(
  "/course/:courseId/user/:userId",
  authenticate,
  ProgressController.getUserProgress
);

// POST complete a step (lesson or assessment)
// Matches: POST /api/progress/complete-step
router.post(
  "/complete-step",
  authenticate,
  ProgressController.completeStep
);

// POST mark a step as pending (in progress but not complete)
// Matches: POST /api/progress/pending-step
router.post(
  "/pending-step",
  authenticate,
  ProgressController.markStepPending
);

// PUT update current step (bookmark/last accessed)
// Matches: PUT /api/progress/update-current-step
router.put(
  "/update-current-step",
  authenticate,
  ProgressController.updateCurrentStep
);

// PUT reset assessment for retake
// Matches: PUT /api/progress/retake-assessment
router.put(
  "/retake-assessment",
  authenticate,
  ProgressController.retakeAssessment
);

export default router;