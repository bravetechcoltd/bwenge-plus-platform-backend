import { Router } from "express";
import { InstructorController } from "../controllers/InstructorController";
import { authenticate } from "../middlewares/authMiddleware";
import { checkInstructorRole, checkCourseInstructorAccess } from "../middlewares/instructorMiddleware";
import { InstructorAnalyticsController } from "../controllers/InstructorAnalyticsController";
import { StudentProgressController } from "../controllers/StudentProgressController";

const router = Router();

router.use(authenticate);
router.use(checkInstructorRole);


router.get(
  "/student-progress/:studentId",
  StudentProgressController.getStudentProgress
);
router.get("/my-courses", InstructorController.getInstructorCourses);
router.get("/dashboard/summary", InstructorController.getDashboardSummary);
router.get("/courses/:courseId/students", checkCourseInstructorAccess, InstructorController.getCourseStudents);
router.get("/students", InstructorController.getMyStudents);
router.get("/:instructorId/students", InstructorController.getAllInstructorStudents);

// Analytics
router.get("/assessments/stats", InstructorAnalyticsController.getAssessmentStats);
router.get("/reviews", InstructorAnalyticsController.getInstructorReviews);

// Additional endpoints
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