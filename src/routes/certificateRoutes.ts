import { Router } from "express";
import { CertificateController } from "../controllers/CertificateController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

// ==================== PUBLIC ROUTES ====================

// Verify certificate by verification code (public)
router.get(
  "/verify/:code",
  CertificateController.verifyCertificate
);

// ==================== AUTHENTICATED USER ROUTES ====================

// Issue certificate for completed course
router.post(
  "/issue",
  authenticate,
  CertificateController.issueCertificate
);

// Check if certificate exists for user and course
router.get(
  "/check/user/:userId/course/:courseId",
  authenticate,
  CertificateController.checkCertificate
);

// Get all certificates for authenticated user
router.get(
  "/user/my-certificates",
  authenticate,
  CertificateController.getUserCertificates
);

// Get specific certificate by ID
router.get(
  "/:id",
  authenticate,
  CertificateController.getCertificateById
);

// Generate certificate PDF
router.get(
  "/:id/pdf",
  authenticate,
  CertificateController.generateCertificatePDF
);

router.get(
  "/:id/pdf/download",
  CertificateController.downloadCertificatePDF
);

router.post(
  "/:id/revoke",
  authenticate,
  CertificateController.revokeCertificate
);

router.get(
  "/course/:courseId/certificates",
  authenticate,
  async (req, res, next) => {
    // Check if user is instructor or admin for this course
    const user = req.user;
    const { courseId } = req.params;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Check permissions - this would be implemented in a middleware
    // For now, we'll pass to controller and handle permission there
    next();
  },
  CertificateController.getUserCertificates // This would need a new method for course certificates
);

export default router;