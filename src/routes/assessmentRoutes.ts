import { Router } from "express";
import { AssessmentController } from "../controllers/AssessmentController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

router.get(
  "/:id",
  authenticate,
  AssessmentController.getAssessmentById
);

export default router;
