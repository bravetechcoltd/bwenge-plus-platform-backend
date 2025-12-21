import { Router } from "express";
import { CourseInstructorController } from "../controllers/CourseInstructorController";
import { authenticate } from "../middlewares/authMiddleware";
import { checkCourseAccess } from "../middlewares/courseAccessMiddleware";

const router = Router();

// Public/Protected routes
router.get(
  "/institutions/:institutionId/available-instructors",
  authenticate,
  CourseInstructorController.getAvailableInstructors
);

router.get(
  "/courses/:courseId/instructors",
  authenticate,
  CourseInstructorController.getCourseInstructors
);

// Protected routes (require auth + course access)
router.post(
  "/courses/:courseId/instructors",
  authenticate,
  checkCourseAccess,
  CourseInstructorController.assignInstructor
);

router.post(
  "/courses/:courseId/instructors/bulk",
  authenticate,
  checkCourseAccess,
  CourseInstructorController.bulkAssignInstructors
);

router.patch(
  "/courses/:courseId/instructors/:instructorId/permissions",
  authenticate,
  checkCourseAccess,
  CourseInstructorController.updateInstructorPermissions
);

router.put(
  "/courses/:courseId/instructors/primary",
  authenticate,
  checkCourseAccess,
  CourseInstructorController.replacePrimaryInstructor
);

router.delete(
  "/courses/:courseId/instructors/:instructorId",
  authenticate,
  checkCourseAccess,
  CourseInstructorController.removeInstructor
);

export default router;