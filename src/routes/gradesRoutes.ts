import { Router } from "express";
import { GradesController } from "../controllers/GradesController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

// Get user grades summary
router.get(
  "/user/:userId",
  authenticate,
  GradesController.getUserGrades
);

// Get graded assignments for user
router.get(
  "/graded/:userId",
  authenticate,
  GradesController.getGradedAssignments
);

// Export grades
router.get(
  "/export",
  authenticate,
  GradesController.exportGrades
);

export default router;
