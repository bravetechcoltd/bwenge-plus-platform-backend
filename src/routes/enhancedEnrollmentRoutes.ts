import { Router } from "express";
import { EnhancedEnrollmentController } from "../controllers/EnrollmentController";
import { authenticate } from "../middlewares/authMiddleware";
import { AccessControlMiddleware } from "../middlewares/accessControlMiddleware";

const router = Router();

// ==================== USER-SPECIFIC ENROLLMENTS ====================
// Get enrollments for a specific user by ID
router.get(
  "/user/:userId",
  authenticate,
  EnhancedEnrollmentController.getUserEnrollmentsByUserId
);

// Get current user's enrollments (POST for complex queries)
router.post(
  "/user-enrollments",
  authenticate,
  EnhancedEnrollmentController.getUserEnrollments
);

// ==================== PENDING ENROLLMENTS ====================
// Get count of pending enrollments for the current user's context
router.get(
  "/pending-count",
  authenticate,
  EnhancedEnrollmentController.getPendingEnrollmentsCount
);

// Get all pending enrollments with pagination and filtering
router.get(
  "/pending",
  authenticate,
  EnhancedEnrollmentController.getAllPendingEnrollments
);

// ==================== ENROLLMENT ELIGIBILITY & SCENARIOS ====================
// Check if user is eligible to enroll in a course
router.post(
  "/check-eligibility",
  authenticate,
  EnhancedEnrollmentController.checkEnrollmentEligibility
);

// Check enrollment scenario (comprehensive eligibility check with UI guidance)
router.post(
  "/check-scenario",
  authenticate,
  EnhancedEnrollmentController.checkEnrollmentScenario
);

// ==================== DIRECT ENROLLMENT ====================
// Direct enrollment (for MOOC courses)
router.post(
  "/enroll-direct",
  authenticate,
  EnhancedEnrollmentController.enrollDirect
);

// ==================== ACCESS CODE MANAGEMENT ====================
// Request an access code for a SPOC course
router.post(
  "/request-access-code",
  authenticate,
  EnhancedEnrollmentController.requestAccessCode
);

// Redeem an access code and auto-enroll
router.post(
  "/redeem-access-code",
  authenticate,
  EnhancedEnrollmentController.redeemAccessCode
);

// Get access code requests (for admins/instructors)
router.get(
  "/access-code-requests",
  authenticate,
  EnhancedEnrollmentController.getAccessCodeRequests
);

// Send/generate access code for a specific learner
router.post(
  "/send-access-code",
  authenticate,
  EnhancedEnrollmentController.sendAccessCode
);

// ==================== APPROVAL REQUESTS ====================
// Request enrollment approval (for courses requiring approval)
router.post(
  "/request-approval",
  authenticate,
  EnhancedEnrollmentController.requestEnrollmentApproval
);

// Approve an enrollment request
router.patch(
  "/:id/approve",
  authenticate,
  EnhancedEnrollmentController.approveEnrollment
);

// Reject an enrollment request
router.patch(
  "/:id/reject",
  authenticate,
  EnhancedEnrollmentController.rejectEnrollment
);

// ==================== BULK OPERATIONS ====================
// Bulk enroll students (for admins/instructors)
router.post(
  "/bulk",
  authenticate,
  EnhancedEnrollmentController.bulkEnrollStudents
);

// ==================== ANALYTICS & REPORTING ====================
// Get enrollment analytics for an institution
router.get(
  "/analytics/institution/:institutionId",
  authenticate,
  EnhancedEnrollmentController.getInstitutionEnrollmentAnalytics
);

// Export enrollment data
router.get(
  "/analytics/export",
  authenticate,
  EnhancedEnrollmentController.exportEnrollments
);

// Export enrollment analytics (alternative format)
router.get(
  "/analytics/export-analytics",
  authenticate,
  EnhancedEnrollmentController.exportEnrollmentAnalytics
);

// Get preview of enrollment data for export
router.get(
  "/export-preview",
  authenticate,
  EnhancedEnrollmentController.getExportPreview
);

// Get export history
router.get(
  "/export-history",
  authenticate,
  EnhancedEnrollmentController.getExportHistory
);

// Get enrollment count with filters
router.get(
  "/count",
  authenticate,
  EnhancedEnrollmentController.getEnrollmentCount
);
// Add this route to your enhancedEnrollmentRoutes.ts
router.get(
  "/analytics/instructor",
  authenticate,
  EnhancedEnrollmentController.getInstructorEnrollmentAnalytics
);
export default router;