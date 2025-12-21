import { Router } from "express";
import { SSOController } from "../controllers/SSOController";
import { authenticate } from "../middlewares/authMiddleware";
import { validateSession } from "../middlewares/sessionMiddleware";
import { body } from "express-validator";

const router = Router();

// ==================== PUBLIC SSO ENDPOINTS ====================

/**
 * @route   POST /api/auth/sso/consume-token
 * @desc    Consume SSO token (called by BwengePlus or other systems)
 * @access  Public
 * @body    { sso_token: string }
 */
router.post(
  "/sso/consume-token",
  [
    body("sso_token")
      .notEmpty()
      .withMessage("SSO token is required")
      .isString()
      .withMessage("SSO token must be a string")
      .isLength({ min: 32, max: 128 })
      .withMessage("Invalid token format"),
  ],
  SSOController.consumeToken
);

/**
 * @route   POST /api/auth/sso/validate-token
 * @desc    Validate SSO token without consuming it
 * @access  Public (for BwengePlus backend)
 * @body    { sso_token: string }
 */
router.post(
  "/sso/validate-token",
  [
    body("sso_token")
      .notEmpty()
      .withMessage("SSO token is required"),
  ],
  SSOController.validateToken
);

// ==================== PROTECTED SSO ENDPOINTS ====================

/**
 * @route   POST /api/auth/sso/generate-token
 * @desc    Generate SSO token for cross-system authentication
 * @access  Private (requires authentication)
 * @body    { target_system: "BWENGE_PLUS" }
 */
router.post(
  "/sso/generate-token",
  authenticate,
  validateSession,
  [
    body("target_system")
      .notEmpty()
      .withMessage("Target system is required")
      .isIn(["BWENGE_PLUS"])
      .withMessage("Invalid target system. Must be 'BWENGE_PLUS'"),
  ],
  SSOController.generateToken
);

/**
 * @route   GET /api/auth/sso/validate-session
 * @desc    Check if user has active sessions in both systems
 * @access  Private (requires authentication)
 */
router.get(
  "/sso/validate-session",
  authenticate,
  validateSession,
  SSOController.validateSession
);

/**
 * @route   GET /api/auth/sso/sessions
 * @desc    Get all active sessions for authenticated user
 * @access  Private (requires authentication)
 */
router.get(
  "/sso/sessions",
  authenticate,
  validateSession,
  SSOController.getUserSessions
);

/**
 * @route   POST /api/auth/sso/terminate-session
 * @desc    Terminate session for specific system
 * @access  Private (requires authentication)
 * @body    { user_id: string, system: "ONGERA" | "BWENGE_PLUS" }
 */
router.post(
  "/sso/terminate-session",
  authenticate,
  [
    body("user_id")
      .notEmpty()
      .withMessage("User ID is required")
      .isUUID()
      .withMessage("Invalid user ID format"),
    body("system")
      .notEmpty()
      .withMessage("System is required")
      .isIn(["ONGERA", "BWENGE_PLUS"])
      .withMessage("Invalid system"),
  ],
  SSOController.terminateCrossSystemSession
);

/**
 * @route   POST /api/auth/sso/cleanup-tokens
 * @desc    Cleanup expired SSO tokens (admin only or cron job)
 * @access  Private (requires authentication)
 */
router.post(
  "/sso/cleanup-tokens",
  authenticate,
  SSOController.cleanupExpiredTokens
);

export default router;