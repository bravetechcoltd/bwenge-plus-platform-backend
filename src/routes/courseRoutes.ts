import { Router } from "express";
import { EnhancedCourseController } from "../controllers/CourseController";
import { EnhancedEnrollmentController } from "../controllers/EnrollmentController";
import { authenticate } from "../middlewares/authMiddleware";
import { AccessControlMiddleware } from "../middlewares/accessControlMiddleware";
import { uploadFields, handleMulterError } from "../services/multer";
import { SystemAdminCourseController } from "../controllers/SystemAdminCourseController";

const router = Router();

// ==================== PUBLIC ROUTES ====================

// Get all public MOOC courses
router.get("/mooc", EnhancedCourseController.getPublicMOOCs);

// Validate access code for SPOC course
router.post("/:id/validate-code", EnhancedCourseController.validateAccessCode);

// Course search with filters
router.get("/search", EnhancedCourseController.searchCourses);

// Get all course categories (public)
router.get("/categories", EnhancedCourseController.getCourseCategories);

// ==================== AUTHENTICATED ROUTES ====================

// Create unified course with file uploads
router.post(
  "/create",
  uploadFields,
  authenticate, 
  handleMulterError,
  EnhancedCourseController.createCourse
);

// ==================== CRITICAL FIX: SPECIFIC ROUTES BEFORE DYNAMIC /:id ====================

// ✅ FIX: Get all courses with full information - MUST come BEFORE /:id route
router.get(
  "/all",
  // authenticate,
  EnhancedCourseController.getAllCoursesWithFullInfo
);

// ==================== INSTRUCTOR MANAGEMENT ====================

// Get instructor's courses
router.get(
  "/instructor/my-courses",
  authenticate,
  EnhancedCourseController.getInstructorCourses
);

// Get courses by instructor ID
router.get(
  "/instructor/:instructorId",
  EnhancedCourseController.getInstructorCoursesById
);


router.post(
  "/check-scenario",
  authenticate,
  EnhancedEnrollmentController.checkEnrollmentScenario
);
// ==================== INSTITUTION-SPECIFIC ROUTES ====================

// Get institution's owned courses (SPOC only)
router.get(
  "/institution/:institutionId/owned",
  authenticate,
  EnhancedCourseController.getInstitutionOwnedCourses
);

// Get institution-specific SPOC courses
router.get(
  "/spoc/:institutionId",
  AccessControlMiddleware.checkInstitutionMember,
  EnhancedCourseController.getInstitutionSPOCs
);

// ==================== COURSE DISCOVERY ====================

// Get courses by category
router.get(
  "/category/:categoryId",
  authenticate,
  EnhancedCourseController.getCoursesByCategory
);

// ==================== COURSE CONTENT MANAGEMENT ====================

// Delete module
router.delete(
  "/module/:id",
  authenticate,
  EnhancedCourseController.deleteModule
);

// Delete lesson
router.delete(
  "/lesson/:id",
  authenticate,
  EnhancedCourseController.deleteLesson
);

// Delete assessment
router.delete(
  "/assessment/:id",
  authenticate,
  EnhancedCourseController.deleteAssessment
);

// ==================== STUDENT MANAGEMENT ====================

// Get course students
router.get(
  "/get/:id/students",
  authenticate,
  EnhancedCourseController.getCourseStudents
);

// Export course students
router.get(
  "/get/:id/students/export",
  EnhancedCourseController.exportCourseStudents
);

// ==================== COURSE MANAGEMENT (DYNAMIC :id ROUTES) ====================

// ✅ IMPORTANT: All specific string-based routes MUST be defined BEFORE this section
// The /:id route will match ANY string, so it must come last

// Get single course with full details
router.get(
  "/:id",
  authenticate,
  EnhancedCourseController.getCourseDetails
);

// Update course with file uploads
router.put(
  "/:id",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  uploadFields,
  handleMulterError,
  EnhancedCourseController.updateCourse
);

// Update course modules
router.put(
  "/:id/modules",
  authenticate,
  EnhancedCourseController.updateCourseModules
);

// Update course thumbnail (with file upload)
router.post(
  "/:id/thumbnail",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  handleMulterError,
  EnhancedCourseController.updateCourseThumbnail
);

// Publish course
router.patch(
  "/:id/publish",
  authenticate,
  EnhancedCourseController.publishCourse
);

// Unpublish course
router.patch(
  "/:id/unpublish",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  EnhancedCourseController.unpublishCourse
);

// Delete course (soft delete)
router.delete(
  "/:id",
  authenticate,
  AccessControlMiddleware.checkInstitutionAdmin,
  EnhancedCourseController.deleteCourse
);

// Clone course
router.post(
  "/:id/clone",
  authenticate,
  AccessControlMiddleware.checkCourseInstructor,
  EnhancedCourseController.cloneCourse
);

// Assign instructor to course
router.post(
  "/:id/instructors",
  authenticate,
  AccessControlMiddleware.checkInstitutionAdmin,
  EnhancedCourseController.assignInstructorToCourse
);

// Remove instructor from course
router.delete(
  "/:id/instructors/:instructorId",
  authenticate,
  AccessControlMiddleware.checkInstitutionAdmin,
  EnhancedCourseController.removeInstructorFromCourse
);

// Get course curriculum
router.get(
  "/:id/curriculum",
  AccessControlMiddleware.checkEnrollmentAccess,
  EnhancedCourseController.getCourseCurriculum
);

// ==================== ACCESS CODE MANAGEMENT (SPOC ONLY) ====================

// Generate access codes for SPOC courses
// Now supports both SYSTEM_ADMIN and INSTITUTION_ADMIN
router.post(
  "/:id/access-codes",
  authenticate,
  EnhancedCourseController.generateAccessCodes
);

// ==================== ENROLLMENT MANAGEMENT ====================

// Check enrollment eligibility
router.post(
  "/check-eligibility",
  authenticate,
  EnhancedEnrollmentController.checkEnrollmentEligibility
);

// Bulk enroll students (ENHANCED - supports Institution Admins)
router.post(
  "/bulk-enroll",
  authenticate,
  EnhancedEnrollmentController.bulkEnrollStudents
);

// Approve enrollment
router.patch(
  "/enrollments/:id/approve",
  authenticate,
  EnhancedEnrollmentController.approveEnrollment
);

// Reject enrollment
router.patch(
  "/enrollments/:id/reject",
  authenticate,
  EnhancedEnrollmentController.rejectEnrollment
);

// In courseRoutes.ts - Add analytics routes
router.get(
  "/:id/analytics",
  authenticate,
  EnhancedCourseController.getCourseAnalytics
);

router.get(
  "/:id/analytics/export",
  authenticate,
  EnhancedCourseController.exportCourseAnalytics
);

// In enrollmentRoutes.ts - Add analytics and export routes
router.get(
  "/analytics/institution/:institutionId",
  authenticate,
  EnhancedEnrollmentController.getInstitutionEnrollmentAnalytics
);

router.get(
  "/analytics/export",
  authenticate,
  EnhancedEnrollmentController.exportEnrollments
);

router.get(
  "/export-preview",
  authenticate,
  EnhancedEnrollmentController.getExportPreview
);

router.get(
  "/export-history",
  authenticate,
  EnhancedEnrollmentController.getExportHistory
);

router.get(
  "/count",
  authenticate,
  EnhancedEnrollmentController.getEnrollmentCount
);
router.get("/admin/mooc-overview", authenticate, SystemAdminCourseController.getMOOCOverview);
router.get("/admin/spoc-overview", authenticate, SystemAdminCourseController.getSPOCOverview);
router.get("/admin/reports", authenticate, SystemAdminCourseController.getCourseReports);
router.get("/admin/moderation", authenticate, SystemAdminCourseController.getContentModeration);
router.patch("/admin/moderation/:id/approve", authenticate, SystemAdminCourseController.approveCourse);
router.patch("/admin/moderation/:id/reject", authenticate, SystemAdminCourseController.rejectCourse);
router.patch("/admin/moderation/:id/flag", authenticate, SystemAdminCourseController.flagCourse);
export default router;