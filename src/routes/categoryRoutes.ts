import { Router } from "express";
import { CategoryController } from "../controllers/CategoryController";
import { authenticate } from "../middlewares/authMiddleware";
import { checkCategoryAccess } from "../middlewares/categoryAccessMiddleware";

const router = Router();

// ==================== PUBLIC ROUTES ====================

// Get active categories for public display
router.get("/public/institution/:institutionId", 
  CategoryController.getPublicCategories
);

// Get single category (public access for active categories)
router.get("/:id", 
  CategoryController.getCategoryById
);

// ==================== PROTECTED ROUTES ====================

// Get all categories for institution (with filters)
router.get("/institution/:institutionId",
  authenticate,
  CategoryController.getCategoriesForInstitution
);

// Create new category
router.post("/",
  authenticate,
  CategoryController.createCategory
);

// Update category
router.put("/:id",
  authenticate,
  checkCategoryAccess,
  CategoryController.updateCategory
);

// Delete category
router.delete("/:id",
  authenticate,
  checkCategoryAccess,
  CategoryController.deleteCategory
);

// Toggle category status
router.patch("/:id/toggle-status",
  authenticate,
  checkCategoryAccess,
  CategoryController.toggleCategoryStatus
);

// Reorder categories
router.post("/reorder",
  authenticate,
  CategoryController.reorderCategories
);

export default router;