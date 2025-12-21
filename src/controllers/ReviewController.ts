// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Review } from "../database/models/ReviewModel";
import { User } from "../database/models/User";
import { Course } from "../database/models/Course";

export class ReviewController {
  /**
   * Create or update a review
   * POST /api/courses/:courseId/reviews
   */
  static async createOrUpdateReview(req: Request, res: Response) {
    try {
      const { courseId } = req.params;
      const userId = req.user?.userId || req.user?.id;
      const { rating, comment } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      if (!courseId || !rating) {
        return res.status(400).json({
          success: false,
          message: "Course ID and rating are required",
        });
      }

      if (rating < 1 || rating > 5) {
        return res.status(400).json({
          success: false,
          message: "Rating must be between 1 and 5",
        });
      }

      const reviewRepo = dbConnection.getRepository(Review);
      const courseRepo = dbConnection.getRepository(Course);
      const userRepo = dbConnection.getRepository(User);

      // Verify course exists
      const course = await courseRepo.findOne({ where: { id: courseId } });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Verify user exists
      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if review already exists
      let review = await reviewRepo.findOne({
        where: { user_id: userId, course_id: courseId },
        relations: ["user", "course"],
      });

      if (review) {
        // Update existing review
        review.rating = rating;
        review.comment = comment || review.comment;
        await reviewRepo.save(review);

        // Recalculate course average rating
        await ReviewController.updateCourseRating(courseId);

        return res.json({
          success: true,
          message: "Review updated successfully",
          data: {
            id: review.id,
            rating: review.rating,
            comment: review.comment,
            user_id: review.user_id,
            course_id: review.course_id,
            created_at: review.created_at,
            updated_at: review.updated_at,
            user: {
              id: user.id,
              first_name: user.first_name,
              last_name: user.last_name,
              email: user.email,
              profile_picture_url: user.profile_picture_url,
            },
          },
        });
      }

      // Create new review
      review = reviewRepo.create({
        user_id: userId,
        course_id: courseId,
        rating,
        comment: comment || null,
      });

      await reviewRepo.save(review);

      // Recalculate course average rating
      await ReviewController.updateCourseRating(courseId);

      return res.status(201).json({
        success: true,
        message: "Review created successfully",
        data: {
          id: review.id,
          rating: review.rating,
          comment: review.comment,
          user_id: review.user_id,
          course_id: review.course_id,
          created_at: review.created_at,
          updated_at: review.updated_at,
          user: {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            profile_picture_url: user.profile_picture_url,
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Create/update review error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create/update review",
        error: error.message,
      });
    }
  }

  /**
   * Get all reviews for a course
   * GET /api/courses/:courseId/reviews
   */
  static async getCourseReviews(req: Request, res: Response) {
    try {
      const { courseId } = req.params;
      const { page = 1, limit = 20, sort = "recent" } = req.query;

      if (!courseId) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      const reviewRepo = dbConnection.getRepository(Review);

      const queryBuilder = reviewRepo
        .createQueryBuilder("review")
        .leftJoinAndSelect("review.user", "user")
        .leftJoinAndSelect("review.course", "course")
        .where("review.course_id = :courseId", { courseId });

      // Sorting
      if (sort === "recent") {
        queryBuilder.orderBy("review.created_at", "DESC");
      } else if (sort === "rating_high") {
        queryBuilder.orderBy("review.rating", "DESC");
      } else if (sort === "rating_low") {
        queryBuilder.orderBy("review.rating", "ASC");
      }

      // Pagination
      const skip = (Number(page) - 1) * Number(limit);
      const [reviews, total] = await queryBuilder
        .skip(skip)
        .take(Number(limit))
        .getManyAndCount();

      // Transform data
      const sanitizedReviews = reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        user_id: review.user_id,
        course_id: review.course_id,
        created_at: review.created_at,
        updated_at: review.updated_at,
        user: {
          id: review.user.id,
          first_name: review.user.first_name,
          last_name: review.user.last_name,
          email: review.user.email,
          profile_picture_url: review.user.profile_picture_url,
        },
      }));

      return res.json({
        success: true,
        data: sanitizedReviews,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error: any) {
      console.error("❌ Get course reviews error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch course reviews",
        error: error.message,
      });
    }
  }

  /**
   * Get all reviews by a user
   * GET /api/reviews/user/:userId
   */
  static async getUserReviews(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 20 } = req.query;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      const reviewRepo = dbConnection.getRepository(Review);

      const skip = (Number(page) - 1) * Number(limit);
      const [reviews, total] = await reviewRepo.findAndCount({
        where: { user_id: userId },
        relations: ["course", "user"],
        order: { created_at: "DESC" },
        skip,
        take: Number(limit),
      });

      const sanitizedReviews = reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        user_id: review.user_id,
        course_id: review.course_id,
        created_at: review.created_at,
        updated_at: review.updated_at,
        course: {
          id: review.course.id,
          title: review.course.title,
          thumbnail_url: review.course.thumbnail_url,
        },
      }));

      return res.json({
        success: true,
        data: sanitizedReviews,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error: any) {
      console.error("❌ Get user reviews error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch user reviews",
        error: error.message,
      });
    }
  }

  /**
   * Get user's review for a specific course
   * GET /api/courses/:courseId/reviews/user
   */
  static async getUserReviewForCourse(req: Request, res: Response) {
    try {
      const { courseId } = req.params;
      const userId = req.user?.userId || req.user?.id;



      if (!courseId) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      const reviewRepo = dbConnection.getRepository(Review);
      const review = await reviewRepo.findOne({
        where: { user_id: userId, course_id: courseId },
        relations: ["user", "course"],
      });

      if (!review) {
        return res.json({
          success: true,
          data: null,
          message: "No review found",
        });
      }

      return res.json({
        success: true,
        data: {
          id: review.id,
          rating: review.rating,
          comment: review.comment,
          user_id: review.user_id,
          course_id: review.course_id,
          created_at: review.created_at,
          updated_at: review.updated_at,
          user: {
            id: review.user.id,
            first_name: review.user.first_name,
            last_name: review.user.last_name,
            email: review.user.email,
            profile_picture_url: review.user.profile_picture_url,
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Get user course review error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch user review",
        error: error.message,
      });
    }
  }

  /**
   * Delete a review
   * DELETE /api/reviews/:reviewId
   */
  static async deleteReview(req: Request, res: Response) {
    try {
      const { reviewId } = req.params;
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      if (!reviewId) {
        return res.status(400).json({
          success: false,
          message: "Review ID is required",
        });
      }

      const reviewRepo = dbConnection.getRepository(Review);
      const review = await reviewRepo.findOne({
        where: { id: reviewId },
        relations: ["user"],
      });

      if (!review) {
        return res.status(404).json({
          success: false,
          message: "Review not found",
        });
      }

      // Check if user owns the review or is admin
      const userRepo = dbConnection.getRepository(User);
      const user = await userRepo.findOne({ where: { id: userId } });

      if (
        review.user_id !== userId &&
        user?.bwenge_role !== "SYSTEM_ADMIN"
      ) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to delete this review",
        });
      }

      const courseId = review.course_id;
      await reviewRepo.remove(review);

      // Recalculate course average rating
      await ReviewController.updateCourseRating(courseId);

      return res.json({
        success: true,
        message: "Review deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete review error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete review",
        error: error.message,
      });
    }
  }

  /**
   * Helper: Update course average rating
   */
  private static async updateCourseRating(courseId: string) {
    try {
      const reviewRepo = dbConnection.getRepository(Review);
      const courseRepo = dbConnection.getRepository(Course);

      const reviews = await reviewRepo.find({
        where: { course_id: courseId },
      });

      const course = await courseRepo.findOne({ where: { id: courseId } });
      if (!course) return;

      if (reviews.length === 0) {
        course.average_rating = 0;
        course.total_reviews = 0;
      } else {
        const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
        course.average_rating = totalRating / reviews.length;
        course.total_reviews = reviews.length;
      }

      await courseRepo.save(course);
    } catch (error) {
      console.error("❌ Update course rating error:", error);
    }
  }
}