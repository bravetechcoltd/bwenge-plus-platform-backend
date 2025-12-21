import { Router } from "express";
import { ScheduleController } from "../controllers/ScheduleController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

// ==================== SCHEDULE ROUTES ====================

// Get instructor's teaching schedule
router.get(
  "/",
  authenticate,
  ScheduleController.getInstructorSchedule
);

// Create new schedule event
router.post(
  "/events",
  authenticate,
  ScheduleController.createEvent
);

// Update event
router.put(
  "/events/:id",
  authenticate,
  ScheduleController.updateEvent
);

// Delete event
router.delete(
  "/events/:id",
  authenticate,
  ScheduleController.deleteEvent
);

export default router;