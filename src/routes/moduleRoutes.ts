import { Router } from "express";
import { ModuleController } from "../controllers/ModuleController";
import { authenticate } from "../middlewares/authMiddleware";
import { AccessControlMiddleware } from "../middlewares/accessControlMiddleware";

const router = Router();

// All module routes require authentication
router.post(
  "/",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  ModuleController.createModule
);

router.get(
  "/course/:courseId",
  authenticate,
  ModuleController.getModulesByCourse
);

router.get(
  "/:id",
  authenticate,
  ModuleController.getModuleDetails
);

router.put(
  "/:id",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  ModuleController.updateModule
);

router.delete(
  "/:id",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  ModuleController.deleteModule
);

router.post(
  "/reorder",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  ModuleController.reorderModules
);

router.post(
  "/:id/publish",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  ModuleController.publishModule
);

router.post(
  "/:id/final-assessment",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  ModuleController.createModuleFinalAssessment
);

export default router;