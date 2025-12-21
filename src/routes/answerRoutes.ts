import { Router } from "express";
import { AnswerController } from "../controllers/AnswerController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();


router.post(
  "/submit",
  authenticate,
  AnswerController.submitAnswers
);


router.get(
  "/:assessment_id/user",
  authenticate,
  AnswerController.getUserAnswers
);


router.get(
  "/user/:userId",
  authenticate,
  AnswerController.getUserAllAnswers
);

router.get(
  "/pending-submissions",
  authenticate,
  AnswerController.getPendingSubmissions
);

router.post(
  "/grade-manually",
  authenticate,
  AnswerController.gradeAssessmentManually
);

export default router;