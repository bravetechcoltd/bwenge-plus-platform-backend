import { Router } from "express";
import { ReviewController } from "../controllers/ReviewController";
import { authenticate } from "../middlewares/authMiddleware";

const router = Router();

// ==================== COURSE-SPECIFIC REVIEW ROUTES ====================

// Create or update review for a course (authenticated)
router.post(
  "/courses/:courseId/reviews",
  authenticate,

  ReviewController.createOrUpdateReview
);

// Get all reviews for a course (public)
router.get(
  "/courses/:courseId/reviews",
    authenticate,
  
  ReviewController.getCourseReviews
);

// Get current user's review for a course (authenticated)
router.get(
  "/courses/:courseId/reviews/user",
  authenticate,

  ReviewController.getUserReviewForCourse
);

// ==================== USER-SPECIFIC REVIEW ROUTES ====================

// Get all reviews by a user (authenticated)
router.get(
  "/reviews/user/:userId",
  authenticate,

  ReviewController.getUserReviews
);

// ==================== REVIEW MANAGEMENT ROUTES ====================

// Delete a review (authenticated - owner or admin)
router.delete(
  "/reviews/:reviewId",
    authenticate,
  
  ReviewController.deleteReview
);

export default router;