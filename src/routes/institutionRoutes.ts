import { Router } from "express";
import { InstitutionController } from "../controllers/InstitutionController";
import { authenticate } from "../middlewares/authMiddleware";
import upload, {  handleMulterError } from "../services/multer";

const router = Router();

// ==================== PUBLIC ROUTES ====================
router.get("/public/homepage", InstitutionController.getPublicInstitutionsForHomepage);

// ==================== INVITE LINK JOIN (public verify, authenticated accept) ====================
router.get("/invite/verify", InstitutionController.verifyInviteToken);
router.post("/invite/accept", authenticate, InstitutionController.acceptInvite);

// ==================== GENERAL INSTITUTION ROUTES ====================
router.get("/", InstitutionController.getAllInstitutions);
router.get("/:id", InstitutionController.getInstitutionById);

router.post(
  "/",
  upload.single("logoFile"),
  handleMulterError,
  InstitutionController.createInstitution
);

router.put(
  "/:id",
  upload.single("logoFile"),
  handleMulterError,
  InstitutionController.updateInstitution
);

// ==================== STATUS MANAGEMENT ROUTES ====================
router.patch(
  "/:id/toggle-status",
  InstitutionController.toggleInstitutionStatus
);

router.patch(
  "/:id/activate",
  authenticate,
  InstitutionController.activateInstitution
);

router.patch(
  "/:id/deactivate",
  authenticate,
  InstitutionController.deactivateInstitution
);

router.delete(
  "/:id",
  authenticate,
  InstitutionController.deleteInstitution
);

// ==================== ADMIN MANAGEMENT ROUTES ====================
router.get(
  "/:id/admin",
  authenticate,
  InstitutionController.getInstitutionAdmin
);

router.put(
  "/:id/replace-admin",
  authenticate,
  InstitutionController.replaceInstitutionAdmin
);

// ==================== MEMBER MANAGEMENT ROUTES ====================
router.get(
  "/:id/members",
  authenticate,
  InstitutionController.getInstitutionMembers
);

// ✅ NEW: Check if user is a member of institution
router.get(
  "/:id/members/check/:userId",
  authenticate,
  InstitutionController.checkUserIsMember
);


router.get(
  "/:id/limits",
  authenticate,
  InstitutionController.getInstitutionLimits
);

router.post(
  "/:id/members",
  authenticate,
  InstitutionController.addMemberToInstitution
);

router.delete(
  "/:id/members/:userId",
  authenticate,
  InstitutionController.removeMemberFromInstitution
);

router.patch(
  "/:id/members/:userId/role",
  authenticate,
  InstitutionController.updateMemberRole
);

// ==================== INVITATION ROUTES ====================
router.get(
  "/:id/invitations",
  authenticate,
  InstitutionController.getInvitations
);

router.post(
  "/:id/invite",
  authenticate,
  InstitutionController.inviteUser
);

router.post(
  "/:id/invite/bulk",
  authenticate,
  InstitutionController.bulkInvite
);

router.post(
  "/:id/invite-link",
  authenticate,
  InstitutionController.generateInviteLink
);

router.post(
  "/:id/invitations/:inviteId/resend",
  authenticate,
  InstitutionController.resendInvitation
);

router.delete(
  "/:id/invitations/:inviteId",
  authenticate,
  InstitutionController.cancelInvitation
);

// ==================== BULK IMPORT JOB ROUTES ====================
router.get(
  "/:id/bulk-import/jobs",
  authenticate,
  InstitutionController.getBulkImportJobs
);

router.get(
  "/:id/bulk-import/jobs/:jobId",
  authenticate,
  InstitutionController.getBulkImportJob
);

router.post(
  "/:id/members/promote",
  authenticate,
  InstitutionController.promoteMember
);

router.post(
  "/:id/bulk-import",
  authenticate,
  upload.single("file"),
  handleMulterError,
  InstitutionController.bulkImport
);

// ==================== SETTINGS ROUTES ====================
router.get(
  "/:id/settings",
  authenticate,
  InstitutionController.getInstitutionSettings
);

router.put(
  "/:id/settings",
  authenticate,
  InstitutionController.updateInstitutionSettings
);

router.put(
  "/:id/settings/security",
  authenticate,
  InstitutionController.updateSecuritySettings
);

export default router;