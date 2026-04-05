
import { Router } from "express";
import { EnhancedCourseController } from "../controllers/CourseController";
import { EnhancedEnrollmentController } from "../controllers/EnrollmentController";
import { authenticate } from "../middlewares/authMiddleware";
import { AccessControlMiddleware } from "../middlewares/accessControlMiddleware";
import { uploadFields, handleMulterError } from "../services/multer";
import { SystemAdminCourseController } from "../controllers/SystemAdminCourseController";

const router = Router();

// ==================== PUBLIC ROUTES ====================
router.get("/mooc", EnhancedCourseController.getPublicMOOCs);
router.post("/:id/validate-code", EnhancedCourseController.validateAccessCode);
router.get("/search", EnhancedCourseController.searchCourses);
router.get("/categories", EnhancedCourseController.getCourseCategories);

// ==================== AUTHENTICATED ROUTES ====================
router.post("/create", uploadFields, authenticate, handleMulterError, EnhancedCourseController.createCourse);

// ==================== ⚠️ CRITICAL: SPECIFIC STRING-BASED ROUTES (MUST BE BEFORE /:id) ====================
router.get("/all", EnhancedCourseController.getAllCoursesWithFullInfo);

router.get(
  "/admin/public-courses/requests",
  authenticate,
  EnhancedEnrollmentController.getPublicCourseEnrollmentRequests
);


router.post(
  "/admin/public-courses/:id/access-codes",
  authenticate,
  EnhancedEnrollmentController.generatePublicCourseAccessCodes
);

router.post(
  "/admin/public-courses/send-access-code",
  authenticate,
  EnhancedEnrollmentController.sendPublicCourseAccessCode
);

router.get(
  "/admin/public-courses/:id/access-codes",
  authenticate,
  EnhancedEnrollmentController.getPublicCourseAccessCodes
);

router.patch(
  "/admin/public-courses/:id/approve",
  authenticate,
  EnhancedEnrollmentController.approvePublicCourseEnrollment
);

router.patch(
  "/admin/public-courses/:id/reject",
  authenticate,
  EnhancedEnrollmentController.rejectPublicCourseEnrollment
);
router.get("/instructor/my-courses", authenticate, EnhancedCourseController.getInstructorCourses);
router.get("/instructor/:instructorId", EnhancedCourseController.getInstructorCoursesById);
router.get("/public/available", authenticate, EnhancedCourseController.getPublicCoursesForAssignment);
router.post("/:courseId/assign-to-institution/:institutionId", authenticate, EnhancedCourseController.assignCourseToInstitution);
router.post("/check-scenario", authenticate, EnhancedEnrollmentController.checkEnrollmentScenario);

// ==================== INSTITUTION-SPECIFIC ROUTES ====================
router.get("/institution/:institutionId/owned", authenticate, EnhancedCourseController.getInstitutionOwnedCourses);
router.get("/spoc/:institutionId", AccessControlMiddleware.checkInstitutionMember, EnhancedCourseController.getInstitutionSPOCs);
router.get("/category/:categoryId", authenticate, EnhancedCourseController.getCoursesByCategory);

// ==================== COURSE CONTENT MANAGEMENT (DELETE) ====================
router.delete("/module/:id", authenticate, EnhancedCourseController.deleteModule);
router.delete("/lesson/:id", authenticate, EnhancedCourseController.deleteLesson);
router.delete("/assessment/:id", authenticate, EnhancedCourseController.deleteAssessment);

// ==================== STUDENT MANAGEMENT ====================
router.get("/get/:id/students", authenticate, EnhancedCourseController.getCourseStudents);
router.get("/get/:id/students/export", EnhancedCourseController.exportCourseStudents);

// ==================== ENROLLMENT MANAGEMENT ====================
router.post("/check-eligibility", authenticate, EnhancedEnrollmentController.checkEnrollmentEligibility);
router.post("/bulk-enroll", authenticate, EnhancedEnrollmentController.bulkEnrollStudents);
router.patch("/enrollments/:id/approve", authenticate, EnhancedEnrollmentController.approveEnrollment);
router.patch("/enrollments/:id/reject", authenticate, EnhancedEnrollmentController.rejectEnrollment);

// ==================== ANALYTICS ROUTES ====================
router.get("/analytics/institution/:institutionId", authenticate, EnhancedEnrollmentController.getInstitutionEnrollmentAnalytics);
router.get("/analytics/export", authenticate, EnhancedEnrollmentController.exportEnrollments);
router.get("/export-preview", authenticate, EnhancedEnrollmentController.getExportPreview);
router.get("/export-history", authenticate, EnhancedEnrollmentController.getExportHistory);
router.get("/count", authenticate, EnhancedEnrollmentController.getEnrollmentCount);

// ==================== SYSTEM ADMIN ROUTES ====================
router.get("/admin/mooc-overview", authenticate, SystemAdminCourseController.getMOOCOverview);
router.get("/admin/spoc-overview", authenticate, SystemAdminCourseController.getSPOCOverview);
router.get("/admin/reports", authenticate, SystemAdminCourseController.getCourseReports);
router.get("/admin/moderation", authenticate, SystemAdminCourseController.getContentModeration);
router.patch("/admin/moderation/:id/approve", authenticate, SystemAdminCourseController.approveCourse);
router.patch("/admin/moderation/:id/reject", authenticate, SystemAdminCourseController.rejectCourse);
router.patch("/admin/moderation/:id/flag", authenticate, SystemAdminCourseController.flagCourse);

// ==================== ⚠️ DYNAMIC :id ROUTES (MUST BE LAST) ====================
router.get("/:id", authenticate, EnhancedCourseController.getCourseDetails);
router.put("/:id", authenticate, AccessControlMiddleware.checkCourseInstructor, uploadFields, handleMulterError, EnhancedCourseController.updateCourse);
router.put("/:id/modules", authenticate, EnhancedCourseController.updateCourseModules);
router.post("/:id/thumbnail", authenticate, AccessControlMiddleware.checkCourseInstructor, handleMulterError, EnhancedCourseController.updateCourseThumbnail);
router.patch("/:id/publish", authenticate, EnhancedCourseController.publishCourse);
router.patch("/:id/unpublish", authenticate, AccessControlMiddleware.checkCourseInstructor, EnhancedCourseController.unpublishCourse);
router.delete("/:id", authenticate, AccessControlMiddleware.checkInstitutionAdmin, EnhancedCourseController.deleteCourse);
router.post("/:id/clone", authenticate, AccessControlMiddleware.checkCourseInstructor, EnhancedCourseController.cloneCourse);
router.post("/:id/instructors", authenticate, AccessControlMiddleware.checkInstitutionAdmin, EnhancedCourseController.assignInstructorToCourse);
router.delete("/:id/instructors/:instructorId", authenticate, AccessControlMiddleware.checkInstitutionAdmin, EnhancedCourseController.removeInstructorFromCourse);
router.get("/:id/curriculum", AccessControlMiddleware.checkEnrollmentAccess, EnhancedCourseController.getCourseCurriculum);
router.post("/:id/access-codes", authenticate, EnhancedCourseController.generateAccessCodes);
router.get("/:id/analytics", authenticate, EnhancedCourseController.getCourseAnalytics);
router.get("/:id/analytics/export", authenticate, EnhancedCourseController.exportCourseAnalytics);

export default router;