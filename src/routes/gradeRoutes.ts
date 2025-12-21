import { Router } from "express";
import { GradeController } from "../controllers/GradeController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

router.get(
  "/user/:userId",
  authenticate,
  GradeController.getUserGrades
);

router.get(
  "/export",
  authenticate,
  GradeController.exportGrades
);

router.get(
  "/stats/:userId",
  authenticate,
  GradeController.getGradeStats
);

export default router;