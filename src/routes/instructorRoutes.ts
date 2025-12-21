import { Router } from "express";
import { InstructorController } from "../controllers/InstructorController";
import { authenticate } from "../middlewares/authMiddleware";
import { checkInstructorRole, checkCourseInstructorAccess } from "../middlewares/instructorMiddleware";
import { InstructorAnalyticsController } from "../controllers/InstructorAnalyticsController";

const router = Router();

// Apply authentication to all routes
router.use(authenticate);
router.use(checkInstructorRole);

// Instructor courses management
router.get("/courses", InstructorController.getInstructorCourses);
router.get("/dashboard/summary", InstructorController.getDashboardSummary);
router.get("/courses/:courseId/students", checkCourseInstructorAccess, InstructorController.getCourseStudents);

// NEW ENDPOINT: Get all students across all courses for an instructor
router.get("/:instructorId/students", InstructorController.getAllInstructorStudents);
// ✅ NEW: Get all students for the current instructor (simpler endpoint)
router.get("/students", InstructorController.getMyStudents);

// ✅ NEW: Get assessment statistics for instructor
router.get("/assessments/stats", InstructorAnalyticsController.getAssessmentStats);

// ✅ NEW: Get reviews for instructor's courses
router.get("/reviews", InstructorAnalyticsController.getInstructorReviews);
// Additional endpoints (to be implemented)
router.get("/courses/:courseId/analytics", checkCourseInstructorAccess, (req, res) => {
  res.json({ message: "Course analytics endpoint - to be implemented" });
});

router.get("/assignments/pending", (req, res) => {
  res.json({ message: "Pending assignments endpoint - to be implemented" });
});

router.get("/enrollments/pending", (req, res) => {
  res.json({ message: "Pending enrollments endpoint - to be implemented" });
});

export default router;