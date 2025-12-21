// @ts-nocheck
import { Router } from "express";
import { BwengePlusAuthController } from "../controllers/AuthController";
import { authenticate } from "../middlewares/authMiddleware";
import { body } from "express-validator";
import { uploadSingle } from "../services/multer"; 
import { extractSystemContext } from "../middlewares/systemAwareMiddleware";
import jwt from "jsonwebtoken";

const router = Router();

router.use(extractSystemContext);

// ============================================================================
// DEBUG ENDPOINT - Validate JWT Token (for socket debugging)
// ============================================================================
/**
 * @route GET /api/auth/debug/jwt-check
 * @description Validates a JWT token and returns its decoded payload
 * @header Authorization: Bearer <token>
 */
router.get("/debug/jwt-check", async (req, res) => {
  console.log("\n🔍 ========== JWT DEBUG CHECK ==========");
  
  try {
    // Extract token from Authorization header
    let token = req.headers.authorization?.replace('Bearer ', '');
    
    // Also check cookie
    if (!token && req.cookies?.bwenge_token) {
      token = req.cookies.bwenge_token;
      console.log("📋 Token from cookie");
    }
    
    if (!token) {
      console.log("❌ No token provided");
      return res.status(401).json({ 
        valid: false, 
        error: "No token provided",
        headers_present: {
          authorization: !!req.headers.authorization,
          cookie: !!req.cookies?.bwenge_token
        }
      });
    }
    
    console.log("📋 Token preview:", token.substring(0, 50) + "...");
    console.log("📋 Token length:", token.length);
    
    const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
    console.log("📋 Using JWT_SECRET:", JWT_SECRET.substring(0, 10) + "...");
    
    // Try to decode without verification first
    let decodedWithoutVerify = null;
    try {
      decodedWithoutVerify = jwt.decode(token);
      console.log("✅ Token decoded without verification");
      console.log("📦 Decoded payload:", JSON.stringify(decodedWithoutVerify, null, 2));
    } catch (decodeError: any) {
      console.log("❌ Cannot decode token at all:", decodeError.message);
    }
    
    // Try to verify the token
    let decoded = null;
    let verificationError = null;
    
    try {
      decoded = jwt.verify(token, JWT_SECRET);
      console.log("✅ Token verified successfully");
      console.log("📦 Verified payload:", JSON.stringify(decoded, null, 2));
    } catch (error: any) {
      verificationError = error;
      console.error("❌ JWT verification failed:", error.message);
      
      // Try with different secret patterns (for debugging)
      if (error.message === "invalid signature") {
        console.log("🔍 Testing alternative secrets...");
        
        // Try with no secret (just decode)
        try {
          const altDecoded = jwt.decode(token);
          console.log("📦 Decoded without secret:", JSON.stringify(altDecoded, null, 2));
        } catch (e) {}
      }
    }
    
    // Extract user info from either verified or unverified decode
    const payload = decoded || decodedWithoutVerify;
    const userId = payload?.userId || payload?.id || payload?.user_id;
    const email = payload?.email;
    const exp = payload?.exp;
    
    const isExpired = exp ? (exp * 1000 < Date.now()) : null;
    
    res.json({
      valid: !!decoded,
      token_preview: token.substring(0, 30) + "...",
      token_length: token.length,
      verification_error: verificationError ? {
        name: verificationError.name,
        message: verificationError.message
      } : null,
      decoded_payload: payload,
      extracted_info: {
        user_id: userId,
        email: email,
        is_expired: isExpired,
        expires_at: exp ? new Date(exp * 1000).toISOString() : null,
        issued_at: payload?.iat ? new Date(payload.iat * 1000).toISOString() : null
      },
      secret_info: {
        secret_length: JWT_SECRET.length,
        secret_preview: JWT_SECRET.substring(0, 10) + "..."
      },
      environment: process.env.NODE_ENV
    });
    
  } catch (error: any) {
    console.error("❌ Debug endpoint error:", error.message);
    res.status(500).json({ 
      valid: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

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

router.post(
  "/register",
  [
    body("first_name").notEmpty().trim().withMessage("First name is required"),
    body("last_name").notEmpty().trim().withMessage("Last name is required"),
    body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
    body("confirm_password").notEmpty().withMessage("Confirm password is required"),
  ],
  BwengePlusAuthController.register
);

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

router.post(
  "/request-password-change",
  [
    body("email").isEmail().withMessage("Valid email is required"),
  ],
  BwengePlusAuthController.requestPasswordChange
);

router.post(
  "/verify-email",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("otp").isLength({ min: 6, max: 6 }).withMessage("OTP must be 6 digits"),
  ],
  BwengePlusAuthController.verifyEmail
);

router.post(
  "/resend-verification",
  [
    body("email").isEmail().withMessage("Valid email is required"),
  ],
  BwengePlusAuthController.resendVerificationOTP
);

router.post(
  "/change-password-otp",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("otp").isLength({ min: 6, max: 6 }).withMessage("OTP must be 6 digits"),
    body("new_password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
  ],
  BwengePlusAuthController.changePasswordWithOTP
);

// ============================================================================
// ADMIN — APPLICATION MANAGEMENT
// ============================================================================
router.get("/admin/applications", authenticate, BwengePlusAuthController.getApplications);
router.post("/admin/approve-user", authenticate, BwengePlusAuthController.approveUser);
router.post("/admin/reject-user", authenticate, BwengePlusAuthController.rejectUser);

export default router;