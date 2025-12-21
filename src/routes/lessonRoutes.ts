
import { Router } from "express";
import { LessonController } from "../controllers/LessonController";
import { authenticate } from "../middlewares/authMiddleware";
import { AccessControlMiddleware } from "../middlewares/accessControlMiddleware";
import { uploadFields } from "../services/multer";

const router = Router();

// Public/Student routes
router.get("/course/:courseId", authenticate, LessonController.getLessonsByCourse);
router.get("/module/:moduleId", authenticate, LessonController.getLessonsByModule);
router.get("/:id", authenticate, LessonController.getLessonById);

// Instructor routes
router.post(
  "/",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  uploadFields,
  LessonController.createLesson
);

router.put(
  "/:id",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  uploadFields,
  LessonController.updateLesson
);

router.delete(
  "/:id",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  LessonController.deleteLesson
);

router.post(
  "/reorder",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  LessonController.reorderLessons
);

router.post(
  "/:id/publish",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  LessonController.publishLesson
);

router.delete(
  "/:id/resource",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  LessonController.deleteResource
);

export default router;
