import { Router } from "express";
import { SubscribeController } from "../controllers/SubscribeController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();


router.post("/", SubscribeController.subscribe);

router.post("/unsubscribe", SubscribeController.unsubscribe);

router.patch("/preferences", SubscribeController.updatePreferences);


router.get("/all", authenticate, SubscribeController.getAllSubscribers);

export default router;