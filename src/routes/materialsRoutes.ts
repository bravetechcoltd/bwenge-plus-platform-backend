import { Router } from "express";
import { MaterialsController } from "../controllers/MaterialsController";
import { authenticate } from "../middlewares/authMiddleware";
import { uploadFields, handleMulterError } from "../services/multer";

const router = Router();


router.get(
  "/course/:course_id",
  authenticate,
  MaterialsController.getCourseMaterials
);

router.post(
  "/upload",
  authenticate,
  uploadFields,
  handleMulterError,
  MaterialsController.uploadMaterials
);

router.delete(
  "/:id",
  authenticate,
  MaterialsController.deleteMaterial
);

router.get(
  "/stats",
  authenticate,
  MaterialsController.getMaterialsStats
);

export default router;