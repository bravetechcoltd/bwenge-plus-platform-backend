

import { Router } from "express";
import { QuizController } from "../controllers/QuizController";
import { authenticate } from "../middlewares/authMiddleware";
import { AccessControlMiddleware } from "../middlewares/accessControlMiddleware";

const router = Router();

// Student routes
router.get("/lesson/:lessonId", authenticate, QuizController.getQuizzesByLesson);
router.get("/:id", authenticate, QuizController.getQuizById);

// Instructor routes
router.post(
  "/",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  QuizController.createQuiz
);

router.put(
  "/:id",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  QuizController.updateQuiz
);

router.delete(
  "/:id",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  QuizController.deleteQuiz
);

router.post(
  "/:id/questions",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  QuizController.addQuestion
);

router.put(
  "/:id/questions/:questionId",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  QuizController.updateQuestion
);

router.delete(
  "/:id/questions/:questionId",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  QuizController.deleteQuestion
);

export default router;
