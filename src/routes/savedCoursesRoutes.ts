import { Router } from "express";
import { SavedCourseController } from "../controllers/SavedCourseController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

router.get(
  "/user/:userId",
  authenticate,
  SavedCourseController.getUserSavedCourses
);

router.post(
  "/",
  authenticate,
  SavedCourseController.saveCourse
);

router.delete(
  "/:id",
  authenticate,
  SavedCourseController.unsaveCourse
);

router.patch(
  "/:id/notes",
  authenticate,
  SavedCourseController.updateNotes
);

// Check if a course is saved by the current user
router.get(
  "/check/:courseId",
  authenticate,
  SavedCourseController.checkSaved
);

export default router;