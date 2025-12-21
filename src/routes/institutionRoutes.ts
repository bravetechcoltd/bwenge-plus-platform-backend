import { Router } from "express";
import { InstitutionController } from "../controllers/InstitutionController";
import { authenticate } from "../middlewares/authMiddleware";
import upload, { uploadFields, handleMulterError } from "../services/multer";

const router = Router();

// ==================== PUBLIC ROUTES ====================
router.get("/public/homepage", InstitutionController.getPublicInstitutionsForHomepage);

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