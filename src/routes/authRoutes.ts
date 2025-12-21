import { Router } from "express";
import { BwengePlusAuthController } from "../controllers/AuthController";
import { authenticate } from "../middlewares/authMiddleware";
import { body } from "express-validator";
import { uploadSingle } from "../services/multer"; 
import { extractSystemContext } from "../middlewares/systemAwareMiddleware";

const router = Router();

router.use(extractSystemContext);


router.post(
  "/google-one-tap",
  [
    body("credential")
      .notEmpty()
      .withMessage("Google credential is required")
      .isString()
      .withMessage("Credential must be a string"),
  ],
  BwengePlusAuthController.googleOneTapLogin
);

router.post(
  "/google",
  [
    body("token").notEmpty().withMessage("Google token is required"),
  ],
  BwengePlusAuthController.googleLogin
);

router.post(
  "/login",
  [
    body("email").isEmail(),
    body("password").notEmpty()
  ],
  BwengePlusAuthController.login
);
router.post("/check-user-exists", BwengePlusAuthController.checkUserExists);

router.get("/sso/consume", BwengePlusAuthController.ssoConsume);

// Logout
router.post("/logout", authenticate, BwengePlusAuthController.logout);

// Cross-system logout (called by Ongera)
router.post("/cross-system-logout", BwengePlusAuthController.crossSystemLogout);

// Check Ongera session
router.get("/check-ongera-session", authenticate, BwengePlusAuthController.checkOngeraSession);

// Get profile
router.get("/profile", authenticate, BwengePlusAuthController.getProfile);

// Update profile
router.put(
  "/profile",
  authenticate,
  BwengePlusAuthController.updateProfile
);

// Upload profile picture
router.post(
  "/profile/picture",
  authenticate,
  uploadSingle,
  BwengePlusAuthController.uploadProfilePicture
);

// Upload CV
router.post(
  "/profile/cv",
  authenticate,
  uploadSingle,
  BwengePlusAuthController.uploadCV
);

// Get profile completion status
router.get(
  "/profile/completion",
  authenticate,
  BwengePlusAuthController.getProfileCompletionStatus
);

// Update account type
router.patch(
  "/profile/account-type",
  authenticate,
  BwengePlusAuthController.updateAccountType
);

router.get(
  "/settings",
  authenticate,
  BwengePlusAuthController.getUserSettings
);

// Update appearance settings
router.put(
  "/settings/appearance",
  authenticate,
  BwengePlusAuthController.updateAppearanceSettings
);

// Toggle two-factor authentication
router.post(
  "/settings/two-factor",
  authenticate,
  BwengePlusAuthController.toggleTwoFactor
);

// Change password
router.post(
  "/settings/change-password",
  authenticate,
  BwengePlusAuthController.changePassword
);

export default router;