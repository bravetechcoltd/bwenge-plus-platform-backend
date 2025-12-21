import { Router } from "express";
import { SystemAdminUserController } from "../controllers/SystemAdminUserController";
import { authenticate } from "../middlewares/authMiddleware";
import { checkSystemAdmin } from "../middlewares/Systemadminmiddleware";

const router = Router();


router.get(
  "/users",
  authenticate,
  checkSystemAdmin,
  SystemAdminUserController.getAllUsers
);



router.get(
  "/users/statistics",
  authenticate,
  checkSystemAdmin,
  SystemAdminUserController.getUserStatistics
);


router.get(
  "/users/:userId",
  authenticate,
  checkSystemAdmin,
  SystemAdminUserController.getUserDetails
);


router.post(
  "/users",
  authenticate,
  checkSystemAdmin,
  SystemAdminUserController.createUser
);


router.put(
  "/users/:userId",
  authenticate,
  checkSystemAdmin,
  SystemAdminUserController.updateUser
);


router.delete(
  "/users/:userId",
  authenticate,
  checkSystemAdmin,
  SystemAdminUserController.deleteUser
);


router.patch(
  "/users/batch",
  authenticate,
  checkSystemAdmin,
  SystemAdminUserController.batchUpdateUsers
);

export default router;