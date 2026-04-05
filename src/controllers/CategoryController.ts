// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { CourseCategory } from "../database/models/CourseCategory";
import { Institution } from "../database/models/Institution";
import { User, BwengeRole } from "../database/models/User";
import { InstitutionMember, InstitutionMemberRole } from "../database/models/InstitutionMember";
import { Course } from "../database/models/Course";
import { Like, Not, IsNull, Brackets } from "typeorm";

export class CategoryController {
  
  // ==================== ENHANCED: GET CATEGORIES FOR INSTITUTION ====================
  static async getCategoriesForInstitution(req: Request, res: Response) {
    try {
      const { institutionId } = req.params;
      const {
        page = 1,
        limit = 20,
        search = "",
        is_active,
        sort_by = "order_index",
        sort_order = "ASC",
        include_course_count = "true",
        hierarchical = "true"
      } = req.query;
      
      const userId = req.user?.userId || req.user?.id;
      const user = req.user as unknown as User;

      // Validate institution exists
      const institutionRepo = dbConnection.getRepository(Institution);
      const institution = await institutionRepo.findOne({ 
        where: { id: institutionId } 
      });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found",
        });
      }

      // Check access permissions
      const hasAccess = await CategoryController.checkCategoryAccess(
        user,
        institutionId,
        null
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view categories for this institution",
        });
      }

      const categoryRepo = dbConnection.getRepository(CourseCategory);
      const queryBuilder = categoryRepo
        .createQueryBuilder("category")
        .leftJoinAndSelect("category.institution", "institution")
        .leftJoinAndSelect("category.parent_category", "parent_category")
        .leftJoinAndSelect("category.subcategories", "subcategories")
        .where("category.institution_id = :institutionId", { institutionId });

      // Apply filters
      if (is_active !== undefined) {
        queryBuilder.andWhere("category.is_active = :is_active", {
          is_active: is_active === "true"
        });
      }

      if (search) {
        queryBuilder.andWhere(
          new Brackets(qb => {
            qb.where("category.name ILIKE :search", { search: `%${search}%` })
              .orWhere("category.description ILIKE :search", { search: `%${search}%` });
          })
        );
      }

      // Apply sorting
      switch (sort_by) {
        case "name":
          queryBuilder.orderBy("category.name", sort_order === "DESC" ? "DESC" : "ASC");
          break;
        case "course_count":
          // Will handle after fetching
          queryBuilder.orderBy("category.order_index", "ASC");
          break;
        case "order_index":
        default:
          queryBuilder.orderBy("category.order_index", sort_order === "DESC" ? "DESC" : "ASC");
          break;
      }

      // Add order for subcategories
      queryBuilder.addOrderBy("subcategories.order_index", "ASC");

      // Count total for pagination
      const total = await queryBuilder.getCount();

      // Apply pagination
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;
      
      let categories = await queryBuilder
        .skip(skip)
        .take(limitNum)
        .getMany();

      // Load course counts if requested
      if (include_course_count === "true") {
        categories = await Promise.all(
          categories.map(async (category) => {
            const courseCount = await dbConnection.getRepository(Course).count({
              where: { category_id: category.id }
            });
            
            // Also get course counts for subcategories
            if (category.subcategories && category.subcategories.length > 0) {
              category.subcategories = await Promise.all(
                category.subcategories.map(async (subcategory) => {
                  const subCourseCount = await dbConnection.getRepository(Course).count({
                    where: { category_id: subcategory.id }
                  });
                  return {
                    ...subcategory,
                    course_count: subCourseCount
                  };
                })
              );
            }
            
            return {
              ...category,
              course_count: courseCount
            };
          })
        );
      }

      // Build hierarchical structure if requested
      let resultCategories = categories;
      if (hierarchical === "true") {
        const rootCategories = categories.filter(cat => !cat.parent_category_id);
        const buildTree = (parentId: string | null): any[] => {
          return categories
            .filter(cat => cat.parent_category_id === parentId)
            .map(cat => ({
              ...cat,
              subcategories: buildTree(cat.id)
            }));
        };

        resultCategories = rootCategories.map(cat => ({
          ...cat,
          subcategories: buildTree(cat.id)
        }));
      }

      // If sorting by course count, sort after loading counts
      if (sort_by === "course_count" && include_course_count === "true") {
        resultCategories.sort((a: any, b: any) => {
          const aCount = a.course_count || 0;
          const bCount = b.course_count || 0;
          return sort_order === "DESC" ? bCount - aCount : aCount - bCount;
        });
      }

      res.json({
        success: true,
        message: "Categories retrieved successfully",
        data: {
          categories: resultCategories,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum)
          }
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch categories",
        error: error.message,
      });
    }
  }

  // ==================== ENHANCED: CREATE CATEGORY ====================
  static async createCategory(req: Request, res: Response) {
    try {
      const {
        name,
        description,
        institution_id,
        parent_category_id,
        order_index,
        is_active = true
      } = req.body;

      const userId = req.user?.userId || req.user?.id;
      const user = req.user as unknown as User;

      // Validate required fields
      if (!name || !institution_id) {
        return res.status(400).json({
          success: false,
          message: "Name and institution ID are required",
        });
      }

      // Validate name length
      if (name.length < 3 || name.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Category name must be between 3 and 100 characters",
        });
      }

      // Validate description length
      if (description && description.length > 500) {
        return res.status(400).json({
          success: false,
          message: "Description must not exceed 500 characters",
        });
      }

      // Check access permissions
      const hasAccess = await CategoryController.checkCategoryAccess(
        user,
        institution_id,
        null
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to create categories for this institution",
        });
      }

      // Validate institution exists and is active
      const institutionRepo = dbConnection.getRepository(Institution);
      const institution = await institutionRepo.findOne({
        where: { id: institution_id, is_active: true }
      });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found or inactive",
        });
      }

      const categoryRepo = dbConnection.getRepository(CourseCategory);

      // Check for duplicate category name within the same institution
      const existingCategory = await categoryRepo.findOne({
        where: {
          name,
          institution_id,
          parent_category_id: parent_category_id || null
        }
      });

      if (existingCategory) {
        return res.status(400).json({
          success: false,
          message: "A category with this name already exists in this institution",
        });
      }

      // Validate parent category if provided
      if (parent_category_id) {
        const parentCategory = await categoryRepo.findOne({
          where: { id: parent_category_id, institution_id }
        });

        if (!parentCategory) {
          return res.status(404).json({
            success: false,
            message: "Parent category not found or belongs to different institution",
          });
        }

        // Prevent circular reference (parent cannot be a subcategory of itself)
        if (parentCategory.parent_category_id) {
          return res.status(400).json({
            success: false,
            message: "Parent category cannot be a subcategory itself",
          });
        }
      }

      // Determine order index if not provided
      let finalOrderIndex = order_index;
      if (!finalOrderIndex) {
        const maxOrderQuery = categoryRepo
          .createQueryBuilder("category")
          .where("category.institution_id = :institutionId", { institutionId: institution_id })
          .select("MAX(category.order_index)", "max");
        
        if (parent_category_id) {
          maxOrderQuery.andWhere("category.parent_category_id = :parentId", {
            parentId: parent_category_id
          });
        } else {
          maxOrderQuery.andWhere("category.parent_category_id IS NULL");
        }
        
        const maxOrder = await maxOrderQuery.getRawOne();
        finalOrderIndex = (maxOrder?.max || 0) + 1;
      }

      // Generate slug from name
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      // Create category
      const category = categoryRepo.create({
        name,
        description,
        institution_id,
        parent_category_id: parent_category_id || null,
        order_index: finalOrderIndex,
        is_active,
        slug
      });

      await categoryRepo.save(category);

      // Load complete category with relations
      const completeCategory = await categoryRepo.findOne({
        where: { id: category.id },
        relations: ["institution", "parent_category", "subcategories"]
      });

      // Load course count
      const courseCount = await dbConnection.getRepository(Course).count({
        where: { category_id: category.id }
      });

      res.status(201).json({
        success: true,
        message: "Category created successfully",
        data: {
          category: {
            ...completeCategory,
            course_count: courseCount
          }
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to create category",
        error: error.message,
      });
    }
  }

  // ==================== ENHANCED: UPDATE CATEGORY ====================
  static async updateCategory(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updates = req.body;
      const userId = req.user?.userId || req.user?.id;
      const user = req.user as unknown as User;

      const categoryRepo = dbConnection.getRepository(CourseCategory);
      const category = await categoryRepo.findOne({
        where: { id },
        relations: ["institution"]
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      // Check access permissions
      const hasAccess = await CategoryController.checkCategoryAccess(
        user,
        category.institution_id,
        id
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this category",
        });
      }

      // Prevent changing institution_id
      if (updates.institution_id && updates.institution_id !== category.institution_id) {
        return res.status(400).json({
          success: false,
          message: "Cannot change institution of a category",
        });
      }

      // Validate parent category if being changed
      if (updates.parent_category_id !== undefined) {
        if (updates.parent_category_id === id) {
          return res.status(400).json({
            success: false,
            message: "Category cannot be its own parent",
          });
        }

        if (updates.parent_category_id) {
          const parentCategory = await categoryRepo.findOne({
            where: { id: updates.parent_category_id, institution_id: category.institution_id }
          });

          if (!parentCategory) {
            return res.status(404).json({
              success: false,
              message: "Parent category not found or belongs to different institution",
            });
          }

          // Prevent circular references
          if (await CategoryController.hasCircularReference(id, updates.parent_category_id)) {
            return res.status(400).json({
              success: false,
              message: "Circular reference detected. This would create an infinite loop.",
            });
          }
        }
      }

      // Update slug if name is changed
      if (updates.name && updates.name !== category.name) {
        // Check for duplicate name in same institution and parent level
        const existingCategory = await categoryRepo.findOne({
          where: {
            name: updates.name,
            institution_id: category.institution_id,
            parent_category_id: updates.parent_category_id || category.parent_category_id || null
          }
        });

        if (existingCategory && existingCategory.id !== id) {
          return res.status(400).json({
            success: false,
            message: "A category with this name already exists at this level",
          });
        }

        updates.slug = updates.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
      }

      // Validate description length
      if (updates.description && updates.description.length > 500) {
        return res.status(400).json({
          success: false,
          message: "Description must not exceed 500 characters",
        });
      }

      // Apply updates
      Object.assign(category, updates);
      category.updated_at = new Date();
      
      await categoryRepo.save(category);

      // Load complete category with relations
      const updatedCategory = await categoryRepo.findOne({
        where: { id: category.id },
        relations: ["institution", "parent_category", "subcategories"]
      });

      // Load course count
      const courseCount = await dbConnection.getRepository(Course).count({
        where: { category_id: category.id }
      });

      res.json({
        success: true,
        message: "Category updated successfully",
        data: {
          category: {
            ...updatedCategory,
            course_count: courseCount
          }
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to update category",
        error: error.message,
      });
    }
  }

  // ==================== ENHANCED: DELETE CATEGORY ====================
  static async deleteCategory(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { force_delete, reassign_to } = req.query;
      const userId = req.user?.userId || req.user?.id;
      const user = req.user as unknown as User;

      const categoryRepo = dbConnection.getRepository(CourseCategory);
      const category = await categoryRepo.findOne({
        where: { id },
        relations: ["institution", "subcategories"]
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      // Check access permissions
      const hasAccess = await CategoryController.checkCategoryAccess(
        user,
        category.institution_id,
        id
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to delete this category",
        });
      }

      // Check if category has subcategories
      const subcategories = await categoryRepo.count({
        where: { parent_category_id: id, is_active: true }
      });

      // Check if category has courses
      const courseCount = await dbConnection.getRepository(Course).count({
        where: { category_id: id }
      });

      // Handle deletion based on options
      if (force_delete === "true") {
        // Force delete - only allowed if no subcategories and no courses
        if (subcategories > 0) {
          return res.status(400).json({
            success: false,
            message: `Cannot force delete category with ${subcategories} subcategories. Please delete or reassign subcategories first.`,
          });
        }

        if (courseCount > 0) {
          return res.status(400).json({
            success: false,
            message: `Cannot force delete category with ${courseCount} courses. Please reassign courses first.`,
          });
        }

        // Hard delete
        await categoryRepo.delete(id);

        // Log deletion action (you would implement your logging system here)

      } else if (reassign_to) {
        // Reassign courses to another category
        const reassignCategory = await categoryRepo.findOne({
          where: { id: reassign_to as string, institution_id: category.institution_id }
        });

        if (!reassignCategory) {
          return res.status(404).json({
            success: false,
            message: "Reassign category not found or belongs to different institution",
          });
        }

        // Reassign courses
        await dbConnection.getRepository(Course)
          .createQueryBuilder()
          .update(Course)
          .set({ category_id: reassign_to })
          .where("category_id = :categoryId", { categoryId: id })
          .execute();

        // Reassign subcategories if any
        if (subcategories > 0) {
          await categoryRepo
            .createQueryBuilder()
            .update(CourseCategory)
            .set({ parent_category_id: reassign_to })
            .where("parent_category_id = :parentId", { parentId: id })
            .execute();
        }

        // Soft delete the category
        await categoryRepo.update(id, { is_active: false });

      } else {
        // Regular deletion - soft delete if no courses, otherwise error
        if (courseCount > 0) {
          return res.status(400).json({
            success: false,
            message: `Category has ${courseCount} courses. Use reassign_to parameter to reassign courses, or force_delete=true to delete (if no courses).`,
          });
        }

        // For subcategories, we can soft delete them too
        if (subcategories > 0) {
          // Soft delete subcategories as well
          await categoryRepo
            .createQueryBuilder()
            .update(CourseCategory)
            .set({ is_active: false })
            .where("parent_category_id = :parentId", { parentId: id })
            .execute();
        }

        // Soft delete the category
        await categoryRepo.update(id, { is_active: false });
      }

      res.json({
        success: true,
        message: "Category deleted successfully",
        data: {
          category_id: id,
          action: force_delete === "true" ? "hard_delete" : reassign_to ? "reassign_and_soft_delete" : "soft_delete",
          courses_reassigned: reassign_to ? courseCount : 0,
          subcategories_affected: subcategories
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to delete category",
        error: error.message,
      });
    }
  }

  // ==================== NEW: REORDER CATEGORIES ====================
  static async reorderCategories(req: Request, res: Response) {
    try {
      const { category_orders } = req.body; // Array of {id, order_index}
      const userId = req.user?.userId || req.user?.id;
      const user = req.user as unknown as User;

      if (!Array.isArray(category_orders) || category_orders.length === 0) {
        return res.status(400).json({
          success: false,
          message: "category_orders must be a non-empty array",
        });
      }

      const categoryRepo = dbConnection.getRepository(CourseCategory);
      const queryRunner = dbConnection.createQueryRunner();
      
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Get first category to verify institution
        const firstCategory = await categoryRepo.findOne({
          where: { id: category_orders[0].id }
        });

        if (!firstCategory) {
          throw new Error("Category not found");
        }

        // Check access permissions
        const hasAccess = await CategoryController.checkCategoryAccess(
          user,
          firstCategory.institution_id,
          null
        );

        if (!hasAccess) {
          throw new Error("You don't have permission to reorder categories in this institution");
        }

        // Verify all categories belong to the same institution
        const categoryIds = category_orders.map(order => order.id);
        const categories = await categoryRepo.find({
          where: { id: In(categoryIds) }
        });

        const institutionIds = [...new Set(categories.map(cat => cat.institution_id))];
        if (institutionIds.length > 1) {
          throw new Error("Categories must belong to the same institution");
        }

        // Update order for each category
        for (const order of category_orders) {
          await queryRunner.manager.update(
            CourseCategory,
            { id: order.id },
            { order_index: order.order_index }
          );
        }

        await queryRunner.commitTransaction();

        // Fetch updated categories
        const updatedCategories = await categoryRepo.find({
          where: { id: In(categoryIds) },
          relations: ["institution", "parent_category"],
          order: { order_index: "ASC" }
        });

        res.json({
          success: true,
          message: "Categories reordered successfully",
          data: {
            categories: updatedCategories
          }
        });

      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to reorder categories",
        error: error.message,
      });
    }
  }

  // ==================== NEW: TOGGLE CATEGORY STATUS ====================
  static async toggleCategoryStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;
      const user = req.user as unknown as User;

      const categoryRepo = dbConnection.getRepository(CourseCategory);
      const category = await categoryRepo.findOne({
        where: { id },
        relations: ["institution"]
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      // Check access permissions
      const hasAccess = await CategoryController.checkCategoryAccess(
        user,
        category.institution_id,
        id
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this category",
        });
      }

      // Toggle status
      const newStatus = !category.is_active;
      
      // If deactivating, check if we should cascade to subcategories
      if (!newStatus) {
        // Optionally deactivate subcategories as well
        await categoryRepo
          .createQueryBuilder()
          .update(CourseCategory)
          .set({ is_active: false })
          .where("parent_category_id = :parentId", { parentId: id })
          .execute();
      }

      await categoryRepo.update(id, { is_active: newStatus });

      const updatedCategory = await categoryRepo.findOne({
        where: { id },
        relations: ["institution", "parent_category"]
      });

      res.json({
        success: true,
        message: `Category ${newStatus ? "activated" : "deactivated"} successfully`,
        data: {
          category: updatedCategory
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to toggle category status",
        error: error.message,
      });
    }
  }

  // ==================== NEW: GET PUBLIC CATEGORIES ====================
  static async getPublicCategories(req: Request, res: Response) {
    try {
      const { institutionId } = req.params;
      const { hierarchical = "true" } = req.query;

      // Validate institution exists and is active
      const institutionRepo = dbConnection.getRepository(Institution);
      const institution = await institutionRepo.findOne({
        where: { id: institutionId, is_active: true }
      });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Institution not found or inactive",
        });
      }

      const categoryRepo = dbConnection.getRepository(CourseCategory);
      
      // Get only active categories
      const categories = await categoryRepo
        .createQueryBuilder("category")
        .leftJoinAndSelect("category.parent_category", "parent_category")
        .leftJoinAndSelect("category.subcategories", "subcategories")
        .where("category.institution_id = :institutionId", { institutionId })
        .andWhere("category.is_active = :isActive", { isActive: true })
        .andWhere("(subcategories.is_active = :subActive OR subcategories.id IS NULL)", { subActive: true })
        .orderBy("category.order_index", "ASC")
        .addOrderBy("subcategories.order_index", "ASC")
        .getMany();

      // Load course counts
      const categoriesWithCounts = await Promise.all(
        categories.map(async (category) => {
          const courseCount = await dbConnection.getRepository(Course)
            .createQueryBuilder("course")
            .where("course.category_id = :categoryId", { categoryId: category.id })
            .andWhere("course.status = :status", { status: "PUBLISHED" })
            .andWhere("course.is_public = :isPublic", { isPublic: true })
            .getCount();

          return {
            ...category,
            course_count: courseCount
          };
        })
      );

      // Build hierarchical structure if requested
      let resultCategories = categoriesWithCounts;
      if (hierarchical === "true") {
        const rootCategories = categoriesWithCounts.filter(cat => !cat.parent_category_id);
        const buildTree = (parentId: string | null): any[] => {
          return categoriesWithCounts
            .filter(cat => cat.parent_category_id === parentId)
            .map(cat => ({
              ...cat,
              subcategories: buildTree(cat.id)
            }));
        };

        resultCategories = rootCategories.map(cat => ({
          ...cat,
          subcategories: buildTree(cat.id)
        }));
      }

      res.json({
        success: true,
        message: "Public categories retrieved successfully",
        data: {
          categories: resultCategories,
          institution: {
            id: institution.id,
            name: institution.name,
            logo_url: institution.logo_url
          }
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch public categories",
        error: error.message,
      });
    }
  }

  // ==================== HELPER: CHECK CATEGORY ACCESS ====================
  private static async checkCategoryAccess(
    user: User,
    institutionId: string,
    categoryId: string | null
  ): Promise<boolean> {
    // SYSTEM_ADMIN can do anything
    if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN) {
      return true;
    }

    // INSTITUTION_ADMIN must be admin of the specific institution
    if (user.bwenge_role === BwengeRole.INSTITUTION_ADMIN) {
      // Check if user is admin of this institution
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const membership = await memberRepo.findOne({
        where: {
          user_id: user.id,
          institution_id: institutionId,
          role: InstitutionMemberRole.ADMIN,
          is_active: true
        }
      });
      
      return !!membership;
    }

    // INSTITUTION_INSTRUCTOR can access their institution's categories
    if (user.bwenge_role === BwengeRole.INSTITUTION_INSTRUCTOR) {
      const memberRepo = dbConnection.getRepository(InstitutionMember);
      const membership = await memberRepo.findOne({
        where: {
          user_id: user.id,
          institution_id: institutionId,
          role: InstitutionMemberRole.INSTRUCTOR,
          is_active: true
        }
      });
      
      return !!membership;
    }

    // Check if user has any membership (any role) in the institution
    const memberRepo = dbConnection.getRepository(InstitutionMember);
    const anyMembership = await memberRepo.findOne({
      where: {
        user_id: user.id,
        institution_id: institutionId,
        is_active: true
      }
    });
    
    if (anyMembership) {
      return true;
    }

    // For other users, check if they're viewing their own category (if categoryId is provided)
    if (categoryId) {
      const categoryRepo = dbConnection.getRepository(CourseCategory);
      const category = await categoryRepo.findOne({
        where: { id: categoryId },
        relations: ["institution"]
      });

      if (category && category.institution_id === user.primary_institution_id) {
        // Allow users to view categories from their own institution
        return true;
      }
    }

    return false;
  }

  // ==================== HELPER: CHECK CIRCULAR REFERENCE ====================
  private static async hasCircularReference(
    categoryId: string,
    potentialParentId: string
  ): Promise<boolean> {
    const categoryRepo = dbConnection.getRepository(CourseCategory);
    
    // Check if the potential parent is already a descendant of this category
    const checkDescendant = async (parentId: string, targetId: string): Promise<boolean> => {
      if (parentId === targetId) {
        return true; // Circular reference found
      }

      const children = await categoryRepo.find({
        where: { parent_category_id: parentId }
      });

      for (const child of children) {
        if (await checkDescendant(child.id, targetId)) {
          return true;
        }
      }

      return false;
    };

    return await checkDescendant(potentialParentId, categoryId);
  }

  // ==================== GET SINGLE CATEGORY ====================
  static async getCategoryById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;
      const user = req.user as unknown as User;

      const categoryRepo = dbConnection.getRepository(CourseCategory);
      const category = await categoryRepo.findOne({
        where: { id },
        relations: ["institution", "parent_category", "subcategories"]
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      // Check access permissions
      const hasAccess = await CategoryController.checkCategoryAccess(
        user,
        category.institution_id,
        id
      );

      // For public access (no auth), only show active categories
      if (!user && !category.is_active) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      // For authenticated users without admin access, only show active categories
      if (user && !hasAccess && !category.is_active) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view this category",
        });
      }

      // Load course count
      const courseCount = await dbConnection.getRepository(Course).count({
        where: { category_id: id }
      });

      // Load subcategory course counts
      if (category.subcategories && category.subcategories.length > 0) {
        category.subcategories = await Promise.all(
          category.subcategories.map(async (subcategory) => {
            const subCourseCount = await dbConnection.getRepository(Course).count({
              where: { category_id: subcategory.id }
            });
            return {
              ...subcategory,
              course_count: subCourseCount
            };
          })
        );
      }

      res.json({
        success: true,
        message: "Category retrieved successfully",
        data: {
          category: {
            ...category,
            course_count: courseCount
          }
        }
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch category",
        error: error.message,
      });
    }
  }
}

// Helper function for IN operator
function In(values: any[]): any {
  return values;
}