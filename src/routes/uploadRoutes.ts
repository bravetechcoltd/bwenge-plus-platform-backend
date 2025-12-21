// routes/uploadRoutes.ts
import { Router } from "express";
import { AssessmentUploadController } from "../controllers/AssessmentUploadController";
import { authenticate } from "../middlewares/authMiddleware";
import { uploadAssessmentFileFrontend, handleMulterError } from "../services/multer";

const router = Router();

// ==================== ASSESSMENT FILE UPLOAD ====================
// This is the EXACT endpoint your frontend is calling: POST /api/upload/assessment-file
router.post(
  "/assessment-file",
  authenticate,
  uploadAssessmentFileFrontend,
  handleMulterError,
  AssessmentUploadController.uploadAssessmentFile
);

// Get assessment file details
router.get(
  "/assessment-file/:submissionId",
  authenticate,
  AssessmentUploadController.getAssessmentFile
);

export default router;