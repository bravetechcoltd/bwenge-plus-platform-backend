

// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Course, CourseType, CourseStatus, CourseLevel } from "../database/models/Course";
import { BwengeRole, User } from "../database/models/User";
import { Institution } from "../database/models/Institution";
import { CourseInstructor } from "../database/models/CourseInstructor";
import { Module } from "../database/models/Module";
import { Lesson, LessonType } from "../database/models/Lesson";
import { Assessment, AssessmentType } from "../database/models/Assessment";
import { Quiz } from "../database/models/Quiz";
import { Question, QuestionType } from "../database/models/Question";
import { CourseCategory } from "../database/models/CourseCategory";
import { ModuleFinalAssessment, ModuleFinalType } from "../database/models/ModuleFinalAssessment";
import * as crypto from "crypto";
import { sendEmail } from "../services/emailService";
import { UploadToCloud } from "../services/cloudinary";
import { InstitutionMember } from "../database/models/InstitutionMember";
import { Enrollment, EnrollmentStatus } from "../database/models/Enrollment";
import { LessonProgress } from "../database/models/LessonProgress";
import { Review } from "../database/models/ReviewModel";
import { format } from "date-fns";

export interface CustomRequest extends Request {
  user?: {
    userId: string;
    id: string;
    email: string;
    bwenge_role?: string;
  };
}
export class EnhancedCourseController {

  static async generateAccessCodes(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { count, expiry_date, usage_limit } = req.body;
      const userId = req.user?.userId || req.user?.id;

      if (!count || count < 1) {
        return res.status(400).json({
          success: false,
          message: "Valid count is required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const userRepo = dbConnection.getRepository(User);

      const course = await courseRepo.findOne({ where: { id } });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      if (course.course_type !== CourseType.SPOC) {
        return res.status(400).json({
          success: false,
          message: "Access codes can only be generated for SPOC courses",
        });
      }

      // ==================== PERMISSION CHECK ====================
      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized"
        });
      }

      // Allow SYSTEM_ADMIN or INSTITUTION_ADMIN who owns the course
      const isAuthorized = 
        user.bwenge_role === BwengeRole.SYSTEM_ADMIN ||
        (user.bwenge_role === BwengeRole.INSTITUTION_ADMIN && 
         course.institution_id === user.primary_institution_id);

      if (!isAuthorized) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to generate access codes for this course"
        });
      }

      // Generate unique codes
      const codes: string[] = [];
      for (let i = 0; i < count; i++) {
        const code = crypto.randomBytes(6).toString("hex").toUpperCase();
        codes.push(code);
      }

      if (!course.access_codes) course.access_codes = [];
      course.access_codes = [...course.access_codes, ...codes];
      await courseRepo.save(course);

      res.json({
        success: true,
        message: `${count} access codes generated successfully`,
        data: {
          codes,
          expiry_date,
          usage_limit,
        },
      });
    } catch (error: any) {
      console.error("❌ Generate access codes error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to generate access codes",
        error: error.message,
      });
    }
  }

static async getInstitutionOwnedCourses(req: Request, res: Response) {
  try {
    const { institutionId } = req.params;
    const userId = req.user?.userId || req.user?.id;
    const { page = 1, limit = 20, status, course_type } = req.query;

    console.log("🏢 [getInstitutionOwnedCourses] Fetching courses for institution:", institutionId);
    console.log("🏢 [getInstitutionOwnedCourses] Query params:", { page, limit, status, course_type });

    const userRepo = dbConnection.getRepository(User);
    const courseRepo = dbConnection.getRepository(Course);

    // Verify user has access to this institution
    const user = await userRepo.findOne({ where: { id: userId } });
    
    const hasAccess = 
      user?.bwenge_role === "SYSTEM_ADMIN" ||
      (user?.bwenge_role === "INSTITUTION_ADMIN" && 
       user.primary_institution_id === institutionId) ||
      user?.institution_ids?.includes(institutionId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this institution's courses"
      });
    }

    console.log("✅ [getInstitutionOwnedCourses] User has access to institution");

    // Build query - REMOVED course_type filter to get both MOOC and SPOC
    const queryBuilder = courseRepo
      .createQueryBuilder("course")
      .leftJoinAndSelect("course.instructor", "instructor")
      .leftJoinAndSelect("course.created_by_admin", "created_by_admin")
      .leftJoinAndSelect("course.institution", "institution")
      .leftJoinAndSelect("course.course_category", "course_category")
      .leftJoinAndSelect("course.modules", "modules")
      .leftJoinAndSelect("modules.lessons", "lessons")
      .where("course.institution_id = :institutionId", { institutionId });

    // Apply optional filters
    if (status) {
      queryBuilder.andWhere("course.status = :status", { status });
      console.log("🔍 [getInstitutionOwnedCourses] Filtering by status:", status);
    }

    // ✅ NEW: Allow filtering by course_type if provided
    if (course_type && (course_type === 'MOOC' || course_type === 'SPOC')) {
      queryBuilder.andWhere("course.course_type = :course_type", { course_type });
      console.log("🔍 [getInstitutionOwnedCourses] Filtering by course_type:", course_type);
    }

    // Get total count
    const total = await queryBuilder.getCount();
    console.log("📊 [getInstitutionOwnedCourses] Total courses found:", total);

    // Apply pagination and fetch
    const skip = (Number(page) - 1) * Number(limit);
    const courses = await queryBuilder
      .orderBy("course.created_at", "DESC")
      .skip(skip)
      .take(Number(limit))
      .getMany();

    console.log("✅ [getInstitutionOwnedCourses] Fetched", courses.length, "courses");

    // Clean and return courses
    const cleanedCourses = courses.map(course =>
      EnhancedCourseController.cleanCourseData(course)
    );

    // Calculate statistics
    const stats = {
      total: total,
      mooc_count: courses.filter(c => c.course_type === 'MOOC').length,
      spoc_count: courses.filter(c => c.course_type === 'SPOC').length,
      published_count: courses.filter(c => c.status === 'PUBLISHED').length,
      draft_count: courses.filter(c => c.status === 'DRAFT').length,
    };

    console.log("📊 [getInstitutionOwnedCourses] Stats:", stats);

    res.json({
      success: true,
      data: {
        courses: cleanedCourses,
        statistics: stats,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit))
        }
      }
    });

  } catch (error: any) {
    console.error("❌ Get institution courses error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch institution courses",
      error: error.message
    });
  }
}

static async createCourse(req: Request, res: Response) {
  try {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    console.log("🎓 [createCourse] ====================================");
    console.log("🎓 [createCourse] User ID from auth:", userId);

    // ==================== PARSE REQUEST BODY ====================
    let coursePayload: any = {};

    if (req.body.title) {
      coursePayload = req.body;
    } else if (typeof req.body === 'string') {
      try {
        coursePayload = JSON.parse(req.body);
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: "Invalid JSON in request body",
        });
      }
    }

    // Parse modules if it's a string
    let modules = coursePayload.modules;
    if (typeof modules === 'string') {
      try {
        modules = JSON.parse(modules);
        console.log("🎓 [createCourse] Parsed modules from string");
      } catch (e) {
        console.error("Failed to parse modules:", e);
        modules = [];
      }
    }

    // Parse tags if it's a string
    let tags = coursePayload.tags;
    if (typeof tags === 'string') {
      try {
        tags = JSON.parse(tags);
      } catch (e) {
        console.error("Failed to parse tags:", e);
        tags = [];
      }
    }

    // ✅ DEBUG: Log modules structure
    if (modules && Array.isArray(modules)) {
      console.log(`🎓 [createCourse] Processing ${modules.length} modules`);
      modules.forEach((mod: any, idx: number) => {
        console.log(`🎓 Module ${idx + 1}: "${mod.title}"`);
        console.log(`   - Lessons: ${mod.lessons?.length || 0}`);
        if (mod.final_assessment || mod.finalAssessment) {
          const finalData = mod.final_assessment || mod.finalAssessment;
          console.log(`   - Has final_assessment: YES`);
          console.log(`   - Final assessment type: ${finalData.type}`);
          console.log(`   - Final assessment questions: ${finalData.questions?.length || 0}`);
          if (finalData.questions && finalData.questions.length > 0) {
            console.log(`   ✅ Questions found for type ${finalData.type}`);
          }
        }
      });
    }

    const {
      title,
      description,
      short_description,
      thumbnail_url,
      category_id,
      category_name,
      level,
      price,
      duration_minutes,
      requires_approval,
      max_enrollments,
      is_institution_wide,
      language,
      requirements,
      what_you_will_learn,
      is_certificate_available,
      course_type,
      institution_id, // ✅ CRITICAL: Extract institution_id from payload
      instructor_id: requestInstructorId,
      status,
    } = coursePayload;

    // ==================== VALIDATION ====================
    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: "Title and description are required",
      });
    }

    if (!course_type || !Object.values(CourseType).includes(course_type)) {
      return res.status(400).json({
        success: false,
        message: "Valid course type (SPOC or MOOC) is required",
      });
    }

    const courseRepo = dbConnection.getRepository(Course);
    const institutionRepo = dbConnection.getRepository(Institution);
    const categoryRepo = dbConnection.getRepository(CourseCategory);
    const moduleRepo = dbConnection.getRepository(Module);
    const lessonRepo = dbConnection.getRepository(Lesson);
    const assessmentRepo = dbConnection.getRepository(Assessment);
    const quizRepo = dbConnection.getRepository(Quiz);
    const questionRepo = dbConnection.getRepository(Question);
    const moduleFinalRepo = dbConnection.getRepository(ModuleFinalAssessment);
    const userRepo = dbConnection.getRepository(User);

    // ==================== VERIFY USER ====================
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log("👤 [createCourse] User found:", user.email, "Role:", user.bwenge_role);
    console.log("🏢 [createCourse] User institution info:", {
      primary_institution_id: user.primary_institution_id,
      institution_ids: user.institution_ids,
      is_institution_member: user.is_institution_member
    });
    console.log("🏢 [createCourse] Received institution_id from frontend:", institution_id);

    // ==================== ✅ FIXED: DETERMINE INSTITUTION ID ====================
    let finalInstitutionId: string | null = null;
    let institution: Institution | null = null;

    console.log("🏢 [createCourse] Processing institution assignment...");
    console.log("🏢 [createCourse] Course type:", course_type);
    console.log("🏢 [createCourse] User role:", user.bwenge_role);

    if (user.bwenge_role === BwengeRole.INSTITUTION_ADMIN) {
      // INSTITUTION_ADMIN: ALWAYS use their primary_institution_id for ANY course type
      if (!user.primary_institution_id) {
        return res.status(400).json({
          success: false,
          message: "Your account is not associated with an institution",
        });
      }

      finalInstitutionId = user.primary_institution_id;
      console.log("✅ [createCourse] Institution Admin - Using primary_institution_id:", finalInstitutionId);
      
      // Verify institution exists
      institution = await institutionRepo.findOne({
        where: { id: finalInstitutionId }
      });

      if (!institution) {
        return res.status(404).json({
          success: false,
          message: "Your institution was not found in the database",
        });
      }

      console.log("✅ [createCourse] Institution verified:", institution.name);
    }
    else if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN) {
      // SYSTEM_ADMIN: Use institution_id from frontend if provided
      if (institution_id) {
        finalInstitutionId = institution_id;
        console.log("✅ [createCourse] System Admin - Using frontend institution_id:", finalInstitutionId);
        
        // Verify institution exists
        institution = await institutionRepo.findOne({
          where: { id: finalInstitutionId }
        });

        if (!institution) {
          return res.status(404).json({
            success: false,
            message: "Institution not found",
          });
        }

        console.log("✅ [createCourse] Institution verified:", institution.name);
      } else if (course_type === CourseType.SPOC) {
        // SPOC courses MUST have an institution
        return res.status(400).json({
          success: false,
          message: "Institution ID is required for SPOC courses",
        });
      } else {
        // MOOC courses can be without institution for SYSTEM_ADMIN
        finalInstitutionId = null;
        console.log("ℹ️ [createCourse] System Admin - MOOC course without institution");
      }
    }
    else {
      // CONTENT_CREATOR/INSTRUCTOR: Use institution_id from frontend OR user's primary_institution_id
      if (institution_id) {
        // Verify user has access to this institution
        if (user.institution_ids?.includes(institution_id) || user.primary_institution_id === institution_id) {
          finalInstitutionId = institution_id;
          console.log("✅ [createCourse] User - Using frontend institution_id:", finalInstitutionId);
          
          institution = await institutionRepo.findOne({
            where: { id: finalInstitutionId }
          });

          if (!institution) {
            return res.status(404).json({
              success: false,
              message: "Institution not found",
            });
          }
        } else {
          return res.status(403).json({
            success: false,
            message: "You don't have access to this institution",
          });
        }
      } else if (user.primary_institution_id) {
        // Fallback to user's primary institution
        finalInstitutionId = user.primary_institution_id;
        institution = await institutionRepo.findOne({
          where: { id: finalInstitutionId }
        });
        console.log("✅ [createCourse] User - Using primary_institution_id:", finalInstitutionId);
      }
    }

    console.log("🏢 [createCourse] ✅✅✅ FINAL institution_id to be saved:", finalInstitutionId || "null");
    if (institution) {
      console.log("🏢 [createCourse] ✅✅✅ Institution name:", institution.name);
    }

    // ==================== DETERMINE INSTRUCTOR ID ====================
    let finalInstructorId = userId;
    let createdByInstitutionAdminId = null;

    // SYSTEM_ADMIN: Can create both MOOC and SPOC for any institution and assign any instructor
    if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN) {
      if (requestInstructorId) {
        const assignedInstructor = await userRepo.findOne({ where: { id: requestInstructorId } });
        if (assignedInstructor) {
          finalInstructorId = requestInstructorId;
          console.log("👨‍🏫 [createCourse] System Admin assigned instructor:", assignedInstructor.email);
        }
      }
    }
    // INSTITUTION_ADMIN - Can create both MOOC and SPOC for their institution
    else if (user.bwenge_role === BwengeRole.INSTITUTION_ADMIN) {
      createdByInstitutionAdminId = userId;
      
      // Handle instructor assignment
      if (!requestInstructorId) {
        finalInstructorId = userId; // Admin becomes instructor by default
      } else {
        // Verify assigned instructor is from same institution
        const assignedInstructor = await userRepo.findOne({ 
          where: { id: requestInstructorId } 
        });
        
        if (assignedInstructor && 
            assignedInstructor.institution_ids?.includes(user.primary_institution_id || '')) {
          finalInstructorId = requestInstructorId;
        } else {
          return res.status(403).json({
            success: false,
            message: "Can only assign instructors from your institution"
          });
        }
      }
      
      console.log("✅ Institution admin creating course for:", user.primary_institution_id);
      console.log("✅ Course type:", course_type);
    }

    console.log("✅ [createCourse] Final instructor ID:", finalInstructorId);
    console.log("✅ [createCourse] Created by institution admin ID:", createdByInstitutionAdminId);

    // ==================== HANDLE CATEGORY ====================
    let category = null;
    if (category_id) {
      category = await categoryRepo.findOne({ where: { id: category_id } });
    } else if (category_name) {
      const whereClause: any = { name: category_name };
      if (finalInstitutionId) {
        whereClause.institution_id = finalInstitutionId;
      }

      category = await categoryRepo.findOne({ where: whereClause });

      if (!category) {
        category = categoryRepo.create({
          name: category_name,
          institution_id: finalInstitutionId,
          is_active: true,
          order_index: 0,
        });
        await categoryRepo.save(category);
        console.log("📁 [createCourse] Created new category:", category_name);
      }
    }

    // ==================== HANDLE THUMBNAIL ====================
    let thumbnailUrl = thumbnail_url;

    // Check for uploaded thumbnail file in req.files
    if (req.files) {
      console.log("🖼️ [createCourse] Checking for thumbnail in files:", Object.keys(req.files));

      let thumbnailFile = null;

      if (req.file) {
        thumbnailFile = req.file;
        console.log("🖼️ [createCourse] Found thumbnail in req.file:", thumbnailFile.originalname);
      }

      if (req.files['thumbnail'] && Array.isArray(req.files['thumbnail']) && req.files['thumbnail'].length > 0) {
        thumbnailFile = req.files['thumbnail'][0];
        console.log("🖼️ [createCourse] Found thumbnail in req.files['thumbnail']:", thumbnailFile.originalname);
      }

      if (req.files['thumbnail_url'] && Array.isArray(req.files['thumbnail_url']) && req.files['thumbnail_url'].length > 0) {
        thumbnailFile = req.files['thumbnail_url'][0];
        console.log("🖼️ [createCourse] Found thumbnail in req.files['thumbnail_url']:", thumbnailFile.originalname);
      }

      if (thumbnailFile) {
        try {
          console.log("☁️ [createCourse] Uploading thumbnail to Cloudinary...");
          const uploadResult = await UploadToCloud(thumbnailFile);
          thumbnailUrl = uploadResult.secure_url;
          console.log("✅ [createCourse] Thumbnail uploaded successfully:", thumbnailUrl);
        } catch (uploadError) {
          console.error("❌ [createCourse] Failed to upload thumbnail:", uploadError);
        }
      } else {
        console.log("ℹ️ [createCourse] No thumbnail file found in request, using provided URL or none");
      }
    }

    console.log("🖼️ [createCourse] Final thumbnail URL:", thumbnailUrl);

    // ==================== CREATE COURSE ====================
    const isSPOC = course_type === CourseType.SPOC;
    const isMOOC = course_type === CourseType.MOOC;

    let courseStatus = CourseStatus.DRAFT;
    if (status && Object.values(CourseStatus).includes(status as CourseStatus)) {
      if (status === CourseStatus.PUBLISHED) {
        if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN || user.bwenge_role === BwengeRole.INSTITUTION_ADMIN) {
          courseStatus = CourseStatus.PUBLISHED;
          console.log("✅ [createCourse] Admin creating course as PUBLISHED");
        } else {
          console.log("⚠️ [createCourse] Non-admin cannot create published course, defaulting to DRAFT");
        }
      } else {
        courseStatus = status as CourseStatus;
      }
    }

    const requestedDuration = duration_minutes || 0;
    const certificateAvailable = is_certificate_available !== undefined ? is_certificate_available : true;

    // ✅✅✅ CRITICAL FIX: Explicitly set institution_id in course data
    const courseData: any = {
      title,
      description,
      short_description,
      thumbnail_url: thumbnailUrl,
      institution_id: finalInstitutionId, // ✅ THIS IS THE KEY FIX - Use finalInstitutionId instead of conditional
      category_id: category?.id || null,
      instructor_id: finalInstructorId,
      created_by_institution_admin_id: createdByInstitutionAdminId,
      course_type,
      is_public: isMOOC,
      level: level || CourseLevel.BEGINNER,
      price: price || 0,
      duration_minutes: requestedDuration,
      status: courseStatus,
      tags: tags || [],
      language: language || "English",
      requirements,
      what_you_will_learn,
      is_certificate_available: certificateAvailable,
      total_lessons: 0,
      enrollment_count: 0,
      average_rating: 0,
      total_reviews: 0,
    };

    if (isSPOC) {
      courseData.requires_approval = requires_approval || false;
      courseData.max_enrollments = max_enrollments;
      courseData.is_institution_wide = is_institution_wide || false;
    } else {
      courseData.requires_approval = false;
      courseData.max_enrollments = null;
      courseData.is_institution_wide = false;
    }

    if (courseStatus === CourseStatus.PUBLISHED) {
      courseData.published_at = new Date();
    }

    console.log("📚 [createCourse] ✅✅✅ Creating course with institution_id:", courseData.institution_id);
    console.log("📚 [createCourse] Creating course with data:", {
      title: courseData.title,
      instructor_id: courseData.instructor_id,
      created_by_institution_admin_id: courseData.created_by_institution_admin_id,
      institution_id: courseData.institution_id, // ✅ Verify it's here
      course_type: courseData.course_type,
      status: courseData.status,
      is_certificate_available: courseData.is_certificate_available,
      duration_minutes: courseData.duration_minutes,
      thumbnail_url: courseData.thumbnail_url ? "Yes" : "No",
    });

    const course = courseRepo.create(courseData);
    const savedCourse = await courseRepo.save(course);

    console.log("✅✅✅ [createCourse] Course saved to database!");
    console.log("✅✅✅ [createCourse] Course ID:", savedCourse.id);
    console.log("✅✅✅ [createCourse] Course institution_id in DB:", savedCourse.institution_id);

    // ==================== PROCESS MODULES ====================
    let totalLessons = 0;
    let totalDuration = 0;

    if (modules && Array.isArray(modules) && modules.length > 0) {
      console.log(`\n📦 [createCourse] Processing ${modules.length} modules...`);

      for (const [modIndex, moduleData] of modules.entries()) {
        console.log(`\n📦 [Module ${modIndex + 1}] ========================================`);
        console.log(`📦 [Module ${modIndex + 1}] Title: "${moduleData.title}"`);

        const module = moduleRepo.create({
          course_id: course.id,
          title: moduleData.title,
          description: moduleData.description,
          order_index: moduleData.order_index || moduleData.order || modIndex + 1,
          estimated_duration_hours: moduleData.estimated_duration_hours || 0,
          is_published: false,
        });
        await moduleRepo.save(module);
        console.log(`📦 [Module ${modIndex + 1}] ✅ Module created with ID: ${module.id}`);

        // ==================== PROCESS LESSONS ====================
        if (moduleData.lessons && Array.isArray(moduleData.lessons)) {
          console.log(`📦 [Module ${modIndex + 1}] Processing ${moduleData.lessons.length} lessons...`);

          for (const [lesIndex, lessonData] of moduleData.lessons.entries()) {
            let videoUrl = lessonData.video_url || lessonData.videoUrl;
            if (req.files) {
              const videoFieldName = `modules[${modIndex}].lessons[${lesIndex}].video`;
              if (req.files[videoFieldName] && Array.isArray(req.files[videoFieldName]) && req.files[videoFieldName].length > 0) {
                try {
                  const videoUpload = await UploadToCloud(req.files[videoFieldName][0]);
                  videoUrl = videoUpload.secure_url;
                } catch (error) {
                  console.error("Failed to upload lesson video:", error);
                }
              }
            }

            let lessonThumbnail = lessonData.thumbnail_url;
            if (req.files) {
              const thumbnailFieldName = `modules[${modIndex}].lessons[${lesIndex}].thumbnail`;
              if (req.files[thumbnailFieldName] && Array.isArray(req.files[thumbnailFieldName]) && req.files[thumbnailFieldName].length > 0) {
                try {
                  const thumbUpload = await UploadToCloud(req.files[thumbnailFieldName][0]);
                  lessonThumbnail = thumbUpload.secure_url;
                  console.log(`✅ [Lesson ${lesIndex + 1}] Thumbnail uploaded: ${lessonThumbnail}`);
                } catch (error) {
                  console.error("Failed to upload lesson thumbnail:", error);
                }
              } else {
                console.log(`ℹ️ [Lesson ${lesIndex + 1}] No thumbnail file found, using: ${lessonThumbnail || 'none'}`);
              }
            }

            let resourcesJson = lessonData.resources || [];
            if (req.files) {
              const resourceFieldName = `modules[${modIndex}].lessons[${lesIndex}].resources`;
              if (req.files[resourceFieldName] && Array.isArray(req.files[resourceFieldName])) {
                for (const file of req.files[resourceFieldName]) {
                  try {
                    const uploadResult = await UploadToCloud(file);
                    resourcesJson.push({
                      title: file.originalname,
                      url: uploadResult.secure_url,
                      type: file.mimetype,
                      public_id: uploadResult.public_id
                    });
                  } catch (error) {
                    console.error("Failed to upload resource:", error);
                  }
                }
              }
            }

            const lesson = lessonRepo.create({
              course_id: course.id,
              module_id: module.id,
              title: lessonData.title,
              content: lessonData.content || "",
              video_url: videoUrl,
              thumbnail_url: lessonThumbnail,
              duration_minutes: lessonData.duration_minutes || lessonData.duration || 0,
              order_index: lessonData.order_index || lessonData.order || lesIndex + 1,
              type: lessonData.type || LessonType.VIDEO,
              is_published: false,
              is_preview: lessonData.is_preview || false,
              resources: resourcesJson,
            });
            await lessonRepo.save(lesson);

            totalLessons++;
            totalDuration += lesson.duration_minutes;
            console.log(`📦 [Module ${modIndex + 1}] ✅ Lesson ${lesIndex + 1} created: ${lesson.title}`);
            console.log(`   - Thumbnail URL: ${lesson.thumbnail_url || 'None'}`);

            // ==================== PROCESS LESSON ASSESSMENTS ====================
            if (lessonData.assessments && Array.isArray(lessonData.assessments)) {
              console.log(`📦 [Module ${modIndex + 1}] Processing ${lessonData.assessments.length} lesson assessments...`);

              for (const assessmentData of lessonData.assessments) {
                const assessment = assessmentRepo.create({
                  course_id: course.id,
                  lesson_id: lesson.id,
                  module_id: module.id,
                  title: assessmentData.title,
                  description: assessmentData.description || "",
                  type: assessmentData.type || AssessmentType.QUIZ,
                  questions: [],
                  passing_score: assessmentData.passing_score || assessmentData.passingScore || 70,
                  max_attempts: assessmentData.max_attempts || 3,
                  time_limit_minutes: assessmentData.time_limit_minutes || assessmentData.timeLimit,
                  is_published: false,
                  is_final_assessment: false,
                  is_module_final: false,
                });

                if (assessmentData.questions && Array.isArray(assessmentData.questions)) {
                  const assessmentQuestions: any[] = [];

                  for (const [qIdx, questionData] of assessmentData.questions.entries()) {
                    const questionType = EnhancedCourseController.normalizeQuestionType(questionData.type);
                    const correctAnswer = EnhancedCourseController.normalizeCorrectAnswer(
                      questionData.correct_answer || questionData.correctAnswer,
                      questionType
                    );

                    assessmentQuestions.push({
                      id: questionData.id || crypto.randomUUID(),
                      question: questionData.question,
                      type: questionType,
                      options: questionData.options || [],
                      correct_answer: correctAnswer,
                      points: questionData.points || 1,
                      order_index: questionData.order_index || qIdx + 1,
                    });
                  }

                  assessment.questions = assessmentQuestions;
                  console.log(`📦 [Module ${modIndex + 1}] Assessment will have ${assessmentQuestions.length} questions`);
                }

                await assessmentRepo.save(assessment);

                const quiz = quizRepo.create({
                  course_id: course.id,
                  lesson_id: lesson.id,
                  title: assessmentData.title,
                  description: assessmentData.description || "",
                  passing_score: assessment.passing_score,
                  time_limit_minutes: assessment.time_limit_minutes,
                  max_attempts: assessment.max_attempts,
                  shuffle_questions: assessmentData.shuffle_questions || false,
                  show_correct_answers: assessmentData.show_correct_answers !== false,
                  is_published: false,
                });
                await quizRepo.save(quiz);

                if (assessmentData.questions && Array.isArray(assessmentData.questions)) {
                  for (const [qIdx, questionData] of assessmentData.questions.entries()) {
                    const questionType = EnhancedCourseController.normalizeQuestionType(questionData.type);
                    const correctAnswer = EnhancedCourseController.normalizeCorrectAnswer(
                      questionData.correct_answer || questionData.correctAnswer,
                      questionType
                    );

                    const question = questionRepo.create({
                      quiz_id: quiz.id,
                      question_text: questionData.question,
                      question_type: questionType as QuestionType,
                      options: questionData.options || [],
                      correct_answer: correctAnswer,
                      explanation: questionData.explanation,
                      points: questionData.points || 1,
                      order_index: questionData.order_index || qIdx + 1,
                      image_url: questionData.image_url,
                    });
                    await questionRepo.save(question);
                  }
                }

                console.log(`📦 [Module ${modIndex + 1}] ✅ Assessment created with ${assessment.questions?.length || 0} questions`);
              }
            }
          }
        }

        // ==================== PROCESS MODULE FINAL ASSESSMENT ====================
        if (moduleData.final_assessment || moduleData.finalAssessment) {
          const finalData = moduleData.final_assessment || moduleData.finalAssessment;

          console.log(`\n📋 [Module ${modIndex + 1}] ========================================`);
          console.log(`📋 [Module ${modIndex + 1}] Processing FINAL ASSESSMENT`);
          console.log(`📋 [Module ${modIndex + 1}] Title: "${finalData.title}"`);
          console.log(`📋 [Module ${modIndex + 1}] Type: ${finalData.type}`);
          console.log(`📋 [Module ${modIndex + 1}] Questions: ${finalData.questions?.length || 0}`);

          const moduleFinal = moduleFinalRepo.create({
            module_id: module.id,
            title: finalData.title,
            type: finalData.type === "project" || finalData.type === "PROJECT"
              ? ModuleFinalType.PROJECT
              : ModuleFinalType.ASSESSMENT,
            project_instructions: finalData.instructions || finalData.description || finalData.project_instructions,
            passing_score_percentage: finalData.passing_score_percentage || finalData.passingScore || 70,
            time_limit_minutes: finalData.time_limit_minutes || finalData.timeLimit,
            requires_file_submission: finalData.requires_file_submission || finalData.fileRequired || false,
          });

          if (finalData.questions && Array.isArray(finalData.questions) && finalData.questions.length > 0) {
            console.log(`📋 [Module ${modIndex + 1}] Creating assessment for final (has questions)...`);

            let assessmentType = AssessmentType.EXAM;
            if (finalData.type === "ASSIGNMENT") {
              assessmentType = AssessmentType.ASSIGNMENT;
            } else if (finalData.type === "QUIZ") {
              assessmentType = AssessmentType.QUIZ;
            } else if (finalData.type === "ASSESSMENT") {
              assessmentType = AssessmentType.EXAM;
            } else if (finalData.type === "PROJECT") {
              assessmentType = AssessmentType.PROJECT;
            }

            const finalAssessment = assessmentRepo.create({
              course_id: course.id,
              module_id: module.id,
              title: finalData.title,
              description: finalData.description || finalData.instructions || '',
              type: assessmentType,
              questions: [],
              passing_score: finalData.passing_score || finalData.passingScore || 70,
              time_limit_minutes: finalData.time_limit_minutes || finalData.timeLimit,
              max_attempts: finalData.max_attempts || 2,
              is_published: false,
              is_final_assessment: true,
              is_module_final: true,
            });

            console.log(`📋 [Module ${modIndex + 1}] 📝 Adding ${finalData.questions.length} questions to final assessment (type: ${assessmentType})`);

            const finalQuestions: any[] = [];

            for (const [qIdx, questionData] of finalData.questions.entries()) {
              const questionType = EnhancedCourseController.normalizeQuestionType(questionData.type);
              const correctAnswer = EnhancedCourseController.normalizeCorrectAnswer(
                questionData.correct_answer || questionData.correctAnswer,
                questionType
              );

              console.log(`📋 [Module ${modIndex + 1}]    Question ${qIdx + 1}: "${questionData.question?.substring(0, 50)}..."`);
              console.log(`📋 [Module ${modIndex + 1}]    Type: ${questionType}`);
              console.log(`📋 [Module ${modIndex + 1}]    Correct: "${correctAnswer?.substring(0, 40)}..."`);

              finalQuestions.push({
                id: questionData.id || crypto.randomUUID(),
                question: questionData.question,
                type: questionType,
                options: questionData.options || questionData.pairs || [],
                correct_answer: correctAnswer,
                points: questionData.points || 1,
                order_index: questionData.order_index || qIdx + 1,
              });
            }

            finalAssessment.questions = finalQuestions;
            await assessmentRepo.save(finalAssessment);
            moduleFinal.assessment_id = finalAssessment.id;

            console.log(`📋 [Module ${modIndex + 1}] ✅✅✅ Final assessment created with ID: ${finalAssessment.id}`);
            console.log(`📋 [Module ${modIndex + 1}] ✅✅✅ Question count: ${finalAssessment.questions.length}`);
            console.log(`📋 [Module ${modIndex + 1}] ✅✅✅ Assessment type: ${finalAssessment.type}`);
          } else if (finalData.questions && Array.isArray(finalData.questions) && finalData.questions.length === 0) {
            console.log(`📋 [Module ${modIndex + 1}] ℹ️ Empty questions array provided for ${finalData.type}`);
          } else {
            console.log(`📋 [Module ${modIndex + 1}] ℹ️ No questions array provided for final assessment type: ${finalData.type}`);
          }

          await moduleFinalRepo.save(moduleFinal);
          console.log(`📋 [Module ${modIndex + 1}] ✅ Module final assessment saved`);
          console.log(`📋 [Module ${modIndex + 1}] ========================================\n`);
        }
      }
    }

    // ==================== UPDATE COURSE TOTALS ====================
    course.total_lessons = totalLessons;
    if (totalDuration > 0) {
      course.duration_minutes = totalDuration;
      console.log(`📊 [createCourse] Using calculated duration: ${totalDuration} minutes`);
    } else if (course.duration_minutes <= 0 && requestedDuration > 0) {
      console.log(`📊 [createCourse] Using requested duration: ${requestedDuration} minutes`);
    } else {
      console.log(`📊 [createCourse] Using default duration: ${course.duration_minutes} minutes`);
    }
    await courseRepo.save(course);

    console.log("\n📊 [createCourse] Course totals updated:", {
      totalLessons,
      totalDuration,
      finalDuration: course.duration_minutes,
      status: course.status,
      is_certificate_available: course.is_certificate_available
    });

    // ==================== SEND EMAIL NOTIFICATION ====================
    try {
      const courseTypeName = isSPOC ? "SPOC" : "MOOC";
      await sendEmail({
        to: user.email,
        subject: `${courseTypeName} Course Created: ${course.title}`,
        html: `
          <h2>Course Created Successfully</h2>
          <p>Your ${courseTypeName} course <strong>${course.title}</strong> has been created.</p>
          ${institution ? `<p><strong>Institution:</strong> ${institution.name}</p>` : ''}
          <p><strong>Total Modules:</strong> ${modules?.length || 0}</p>
          <p><strong>Total Lessons:</strong> ${totalLessons}</p>
          <p><strong>Status:</strong> ${courseStatus}</p>
        `,
      });
    } catch (emailError) {
      console.error("Failed to send email:", emailError);
    }

    // ==================== FETCH COMPLETE COURSE ====================
    const relations = [
      "instructor",
      "created_by_admin",
      "course_category",
      "modules",
      "modules.lessons",
      "modules.lessons.assessments",
      "modules.lessons.quizzes",
      "modules.lessons.quizzes.questions",
      "modules.final_assessment",
      "modules.final_assessment.assessment",
    ];

    if (finalInstitutionId) {
      relations.splice(2, 0, "institution"); // ✅ Include institution relation
    }

    const completeCourse = await courseRepo.findOne({
      where: { id: course.id },
      relations: relations,
    });

    // ✅ VERIFICATION
    console.log("\n🔍 [VERIFICATION] Checking created course:");
    console.log(`🔍 Course ID: ${completeCourse?.id}`);
    console.log(`🔍 Institution ID in DB: ${completeCourse?.institution_id}`);
    console.log(`🔍 Institution Name: ${completeCourse?.institution?.name || 'N/A'}`);
    console.log(`🔍 Course Type: ${completeCourse?.course_type}`);
    console.log(`🔍 Course Status: ${completeCourse?.status}`);
    console.log(`🔍 Certificate Available: ${completeCourse?.is_certificate_available}`);
    console.log(`🔍 Duration: ${completeCourse?.duration_minutes} minutes`);

    completeCourse?.modules?.forEach((module, idx) => {
      console.log(`\n🔍 Module ${idx + 1}: "${module.title}"`);
      console.log(`   - Lessons: ${module.lessons?.length || 0}`);

      if (module.final_assessment) {
        console.log(`   ✅ Has final_assessment`);
        console.log(`   - Module Final Type: ${module.final_assessment.type}`);
        console.log(`   - assessment_id: ${module.final_assessment.assessment_id || 'NULL'}`);

        if (module.final_assessment.assessment) {
          console.log(`   ✅✅✅ Assessment EXISTS`);
          console.log(`   - Assessment type: ${module.final_assessment.assessment.type}`);
          console.log(`   - Question count: ${module.final_assessment.assessment.questions?.length || 0}`);

          const moduleType = module.final_assessment.type;
          const assessmentType = module.final_assessment.assessment.type;

          if ((moduleType === "ASSESSMENT" && assessmentType === "EXAM") ||
            (moduleType === "ASSESSMENT" && assessmentType === "ASSIGNMENT")) {
            console.log(`   ✅ Type consistency: Module=${moduleType}, Assessment=${assessmentType}`);
          } else if (moduleType === "PROJECT" && assessmentType === "PROJECT") {
            console.log(`   ✅ Type consistency: Both are PROJECT`);
          } else {
            console.log(`   ⚠️ Type mismatch: Module=${moduleType}, Assessment=${assessmentType}`);
          }

          if (module.final_assessment.assessment.questions?.length > 0) {
            console.log(`   ✅ Questions verified in database for type: ${module.final_assessment.type}`);
          } else {
            console.log(`   ℹ️ No questions in database for type: ${module.final_assessment.type}`);
          }
        } else {
          console.log(`   ℹ️ No assessment created for type: ${module.final_assessment.type}`);
        }
      }
    });

    console.log("\n✅✅✅ [createCourse] Course creation complete!\n");

    res.status(201).json({
      success: true,
      message: `${isSPOC ? 'SPOC' : 'MOOC'} course created successfully`,
      data: completeCourse,
      summary: {
        course_id: course.id,
        course_type: course.course_type,
        instructor_id: course.instructor_id,
        created_by_institution_admin_id: course.created_by_institution_admin_id,
        institution_id: course.institution_id, // ✅ Verify in response
        institution_name: institution?.name || null,
        total_modules: modules?.length || 0,
        total_lessons: totalLessons,
        total_duration_minutes: completeCourse?.duration_minutes || totalDuration,
        status: completeCourse?.status || courseStatus,
        is_public: course.is_public,
        is_certificate_available: completeCourse?.is_certificate_available || false,
      },
    });
  } catch (error: any) {
    console.error("❌ [createCourse] Error:", error);
    console.error("Stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to create course",
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}


  private static cleanAndDeduplicateModules(modules: any[]): any[] {
    console.log("🧹 [cleanAndDeduplicateModules] Starting cleaning process...");

    return modules.map((module, index) => {
      console.log(`🧹 [cleanAndDeduplicateModules] Processing module ${index + 1}: "${module.title}"`);

      const cleanedModule = {
        ...module,
        order_index: module.order_index || index + 1,
        lessons: (module.lessons || []).map((lesson: any, lessonIndex: number) => {
          // Deduplicate resources by URL
          const uniqueResources = lesson.resources
            ? Array.from(
              new Map(
                lesson.resources.map((r: any) => [r.url, r])
              ).values()
            )
            : [];

          return {
            ...lesson,
            order_index: lesson.order_index || lessonIndex + 1,
            resources: uniqueResources,
            assessments: (lesson.assessments || []).map((assessment: any) => ({
              ...assessment,
              questions: (assessment.questions || []).map((q: any, qIndex: number) => ({
                ...q,
                order_index: q.order_index || qIndex + 1
              }))
            }))
          };
        })
      };

      // ✅✅✅ CRITICAL FIX: PRESERVE FINAL ASSESSMENT QUESTIONS FOR ALL TYPES ✅✅✅
      if (module.final_assessment || module.finalAssessment) {
        const finalData = module.final_assessment || module.finalAssessment;

        console.log(`🧹 [cleanAndDeduplicateModules] Module "${module.title}" has final_assessment:`);
        console.log(`   - Type: ${finalData.type}`);
        console.log(`   - Questions in original: ${finalData.questions?.length || 0}`);

        // ✅ PRESERVE all final assessment data INCLUDING QUESTIONS REGARDLESS OF TYPE
        cleanedModule.final_assessment = {
          ...finalData,
          // ✅ CRITICAL: Ensure questions array is preserved for ALL types (ASSIGNMENT, ASSESSMENT, etc.)
          questions: (finalData.questions || []).map((q: any, qIndex: number) => ({
            ...q,
            order_index: q.order_index || qIndex + 1
          }))
        };

        console.log(`   - Questions after cleaning: ${cleanedModule.final_assessment.questions?.length || 0}`);

        if (cleanedModule.final_assessment.questions && cleanedModule.final_assessment.questions.length > 0) {
          console.log(`   ✅ Questions preserved for type: ${cleanedModule.final_assessment.type}`);
          console.log(`   - First question: "${cleanedModule.final_assessment.questions[0].question?.substring(0, 50)}..."`);
        } else {
          console.log(`   ℹ️ No questions in final_assessment (type: ${cleanedModule.final_assessment.type})`);
        }
      }

      return cleanedModule;
    });
  }

  // ==================== COMPLETE FIXED updateCourseModules METHOD ====================
  static async updateCourseModules(req: Request, res: Response) {
    const startTime = Date.now();

    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      console.log("📦 [updateCourseModules] ====================================");
      console.log("📦 [updateCourseModules] Starting update for course:", id);
      console.log("📦 [updateCourseModules] User ID:", userId);

      // ==================== STEP 1: PARSE AND VALIDATE REQUEST ====================
      let payload: any = {};

      if (!req.body) {
        return res.status(400).json({
          success: false,
          message: "Request body is missing",
        });
      }

      if (req.body && typeof req.body === 'object') {
        payload = { ...req.body };

        if (payload.modules && typeof payload.modules === 'string') {
          try {
            payload.modules = JSON.parse(payload.modules);
            console.log("📦 [STEP 1] Parsed modules from string");
          } catch (e: any) {
            return res.status(400).json({
              success: false,
              message: "Invalid modules format - JSON parse error",
              error: e.message,
            });
          }
        }
      }

      const { modules } = payload;

      if (!modules || !Array.isArray(modules)) {
        return res.status(400).json({
          success: false,
          message: "Modules array is required",
          received: { modules, type: typeof modules }
        });
      }

      console.log(`📦 [STEP 1] ✅ Validated ${modules.length} modules in request`);

      // ✅ DEBUG: Log final assessment questions BEFORE cleaning
      modules.forEach((mod: any, idx: number) => {
        if (mod.final_assessment || mod.finalAssessment) {
          const finalData = mod.final_assessment || mod.finalAssessment;
          console.log(`📦 [STEP 1] Module ${idx + 1} "${mod.title}" BEFORE CLEANING:`);
          console.log(`   - final_assessment exists: true`);
          console.log(`   - questions array: ${finalData.questions ? 'EXISTS' : 'NULL'}`);
          console.log(`   - question count: ${finalData.questions?.length || 0}`);
          if (finalData.questions && finalData.questions.length > 0) {
            console.log(`   - First question: "${finalData.questions[0].question?.substring(0, 60)}..."`);
          }
        }
      });

      // ==================== STEP 2: VERIFY COURSE AND PERMISSIONS ====================
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({
        where: { id },
        relations: ["modules", "modules.lessons", "modules.final_assessment"]
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found"
        });
      }

      if (course.instructor_id !== userId && req.user?.bwenge_role !== "SYSTEM_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this course"
        });
      }

      console.log("📦 [STEP 2] ✅ Course verified and permissions checked");

      // ==================== STEP 3: CLEAN AND DEDUPLICATE DATA ====================
      console.log("\n📦 [STEP 3] ========================================");
      const cleanedModules = EnhancedCourseController.cleanAndDeduplicateModules(modules);
      console.log("📦 [STEP 3] ✅ Cleaning complete");

      // ✅ DEBUG: Verify questions AFTER cleaning
      console.log("\n📦 [STEP 3] VERIFICATION AFTER CLEANING:");
      cleanedModules.forEach((mod, idx) => {
        if (mod.final_assessment || mod.finalAssessment) {
          const finalData = mod.final_assessment || mod.finalAssessment;
          console.log(`📦 [STEP 3] Module ${idx + 1} "${mod.title}" AFTER CLEANING:`);
          console.log(`   - Title: ${finalData.title}`);
          console.log(`   - Type: ${finalData.type}`);
          console.log(`   - Questions array: ${finalData.questions ? 'EXISTS' : 'NULL'}`);
          console.log(`   - Question count: ${finalData.questions?.length || 0}`);
          if (finalData.questions && finalData.questions.length > 0) {
            console.log(`   ✅ Questions preserved in cleaning`);
            finalData.questions.forEach((q: any, qIdx: number) => {
              console.log(`   Question ${qIdx + 1}: "${q.question?.substring(0, 50)}..."`);
            });
          } else {
            console.log(`   ❌❌❌ QUESTIONS LOST DURING CLEANING!`);
          }
        }
      });

      // ==================== STEP 4: USE DATABASE TRANSACTION ====================
      const queryRunner = dbConnection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      console.log("\n📦 [STEP 4] ✅ Database transaction started");

      try {
        const moduleRepo = queryRunner.manager.getRepository(Module);
        const lessonRepo = queryRunner.manager.getRepository(Lesson);
        const assessmentRepo = queryRunner.manager.getRepository(Assessment);
        const quizRepo = queryRunner.manager.getRepository(Quiz);
        const questionRepo = queryRunner.manager.getRepository(Question);
        const moduleFinalRepo = queryRunner.manager.getRepository(ModuleFinalAssessment);

        const processedModuleIds: string[] = [];
        const processedLessonIds: string[] = [];
        const processedAssessmentIds: string[] = [];

        // ==================== STEP 5: BATCH PROCESS MODULES ====================
        for (const [modIndex, mod] of cleanedModules.entries()) {
          console.log(`\n📦 [STEP 5.${modIndex + 1}] ========================================`);
          console.log(`📦 [STEP 5.${modIndex + 1}] Processing module: "${mod.title}"`);
          console.log(`📦 [STEP 5.${modIndex + 1}] Module ID: ${mod.id || 'NEW'}`);

          let moduleEntity: Module;

          if (mod.id && !mod.id.toString().startsWith('temp-')) {
            moduleEntity = await moduleRepo.findOne({
              where: { id: mod.id, course_id: id },
              relations: ["lessons", "final_assessment", "final_assessment.assessment"]
            });

            if (moduleEntity) {
              console.log(`📦 [STEP 5.${modIndex + 1}] ✅ Found existing module`);

              Object.assign(moduleEntity, {
                title: mod.title ?? moduleEntity.title,
                description: mod.description ?? moduleEntity.description,
                order_index: mod.order_index ?? modIndex + 1,
                estimated_duration_hours: mod.estimated_duration_hours ?? moduleEntity.estimated_duration_hours,
                updated_at: new Date()
              });
              await moduleRepo.save(moduleEntity);
              processedModuleIds.push(moduleEntity.id);
            } else {
              console.log(`⚠️  [STEP 5.${modIndex + 1}] Module ${mod.id} not found, skipping`);
              continue;
            }
          } else {
            moduleEntity = moduleRepo.create({
              course_id: id,
              title: mod.title || 'Untitled Module',
              description: mod.description || '',
              order_index: mod.order_index || modIndex + 1,
              estimated_duration_hours: mod.estimated_duration_hours || 0,
              is_published: false
            });
            await moduleRepo.save(moduleEntity);
            processedModuleIds.push(moduleEntity.id);
          }

          // ==================== STEP 6: BATCH PROCESS LESSONS ====================
          if (mod.lessons && Array.isArray(mod.lessons)) {
            const lessonsToSave: Lesson[] = [];

            for (const [lesIndex, les] of mod.lessons.entries()) {
              let lessonEntity: Lesson;

              if (les.id && !les.id.toString().startsWith('temp-')) {
                lessonEntity = await lessonRepo.findOne({
                  where: { id: les.id, module_id: moduleEntity.id }
                });

                if (lessonEntity) {
                  Object.assign(lessonEntity, {
                    title: les.title ?? lessonEntity.title,
                    content: les.content ?? lessonEntity.content,
                    video_url: les.videoUrl || les.video_url ?? lessonEntity.video_url,
                    thumbnail_url: les.thumbnail_url ?? lessonEntity.thumbnail_url,
                    duration_minutes: les.duration || les.duration_minutes ?? lessonEntity.duration_minutes,
                    order_index: les.order_index || lesIndex + 1,
                    type: les.type ?? lessonEntity.type,
                    is_preview: les.is_preview ?? lessonEntity.is_preview,
                    resources: les.resources ?? lessonEntity.resources,
                    updated_at: new Date()
                  });
                  lessonsToSave.push(lessonEntity);
                  processedLessonIds.push(lessonEntity.id);
                }
              } else {
                lessonEntity = lessonRepo.create({
                  course_id: id,
                  module_id: moduleEntity.id,
                  title: les.title || 'Untitled Lesson',
                  content: les.content || '',
                  video_url: les.videoUrl || les.video_url || '',
                  thumbnail_url: les.thumbnail_url || '',
                  duration_minutes: les.duration || les.duration_minutes || 0,
                  order_index: les.order_index || lesIndex + 1,
                  type: les.type || "VIDEO",
                  is_published: false,
                  is_preview: les.is_preview || false,
                  resources: les.resources || []
                });
                lessonsToSave.push(lessonEntity);
              }

              if (les.assessments && Array.isArray(les.assessments)) {
                for (const ass of les.assessments) {
                  await EnhancedCourseController.processAssessment(
                    ass,
                    lessonEntity.id || crypto.randomUUID(),
                    moduleEntity.id,
                    id,
                    assessmentRepo,
                    quizRepo,
                    questionRepo,
                    processedAssessmentIds
                  );
                }
              }
            }

            if (lessonsToSave.length > 0) {
              await lessonRepo.save(lessonsToSave);
              lessonsToSave.forEach(l => {
                if (!processedLessonIds.includes(l.id)) {
                  processedLessonIds.push(l.id);
                }
              });
            }
          }
// ==================== ✅✅✅ FIXED STEP 7: PROCESS MODULE FINAL ASSESSMENT FOR ALL TYPES ✅✅✅ ====================
if (mod.final_assessment || mod.finalAssessment) {
  const finalData = mod.final_assessment || mod.finalAssessment;

  console.log(`\n📋 [STEP 7] ========================================`);
  console.log(`📋 [STEP 7] Processing FINAL ASSESSMENT for module: "${moduleEntity.title}"`);
  console.log(`📋 [STEP 7] Module ID: ${moduleEntity.id}`);
  console.log(`📋 [STEP 7] Final assessment data received:`);
  console.log(`   - Title: "${finalData.title}"`);
  console.log(`   - Type: "${finalData.type}"`);
  console.log(`   - Questions provided: ${!!(finalData.questions)}`);
  console.log(`   - Question count: ${finalData.questions?.length || 0}`);

  if (finalData.questions && Array.isArray(finalData.questions)) {
    console.log(`📋 [STEP 7] ✅ Question details:`);
    finalData.questions.forEach((q: any, qIdx: number) => {
      console.log(`   Question ${qIdx + 1}:`);
      console.log(`     - Text: "${q.question?.substring(0, 60)}..."`);
      console.log(`     - Type: ${q.type}`);
      console.log(`     - Options: ${q.options?.length || 0}`);
      console.log(`     - Correct: "${(q.correct_answer || q.correctAnswer)?.substring(0, 40)}..."`);
    });
  } else {
    console.log(`📋 [STEP 7] No questions array in finalData`);
  }

  let moduleFinal = await moduleFinalRepo.findOne({
    where: { module_id: moduleEntity.id },
    relations: ['assessment']
  });

  if (moduleFinal) {
    console.log(`📋 [STEP 7] 🔄 UPDATING existing module final`);
    
    // ✅ Determine module final type based on finalData.type
    let moduleFinalType = ModuleFinalType.ASSESSMENT;
    if (finalData.type === "project" || finalData.type === "PROJECT") {
      moduleFinalType = ModuleFinalType.PROJECT;
    }
    
    Object.assign(moduleFinal, {
      title: finalData.title ?? moduleFinal.title,
      type: moduleFinalType,
      project_instructions: finalData.instructions || finalData.description ?? moduleFinal.project_instructions,
      passing_score_percentage: finalData.passingScore ?? finalData.passing_score_percentage ?? moduleFinal.passing_score_percentage,
      time_limit_minutes: finalData.timeLimit ?? finalData.time_limit_minutes ?? moduleFinal.time_limit_minutes,
      requires_file_submission: finalData.fileRequired ?? finalData.requires_file_submission ?? moduleFinal.requires_file_submission,
      updated_at: new Date()
    });

    // ✅✅✅ PROCESS QUESTIONS FOR ALL TYPES THAT HAVE THEM (ASSIGNMENT, ASSESSMENT, etc.)
    if (finalData.questions && Array.isArray(finalData.questions) && finalData.questions.length > 0) {
      console.log(`📋 [STEP 7] Processing ${finalData.questions.length} questions for type: ${finalData.type}`);
      
      if (moduleFinal.assessment_id && moduleFinal.assessment) {
        console.log(`📋 [STEP 7] Updating existing assessment ${moduleFinal.assessment.id} for type: ${finalData.type}`);
        
        const assessment = await assessmentRepo.findOne({
          where: { id: moduleFinal.assessment.id }
        });

        if (assessment) {
          // ✅ Determine assessment type based on finalData.type
          let assessmentType = "EXAM"; // default
          if (finalData.type === "ASSIGNMENT") {
            assessmentType = "ASSIGNMENT";
          } else if (finalData.type === "QUIZ") {
            assessmentType = "QUIZ";
          } else if (finalData.type === "ASSESSMENT") {
            assessmentType = "EXAM";
          } else if (finalData.type === "PROJECT") {
            assessmentType = "PROJECT";
          }
          
          assessment.type = assessmentType;
          assessment.title = finalData.title ?? assessment.title;
          assessment.description = finalData.description || finalData.instructions || assessment.description;
          assessment.passing_score = finalData.passingScore ?? finalData.passing_score_percentage ?? assessment.passing_score;
          assessment.time_limit_minutes = finalData.timeLimit ?? finalData.time_limit_minutes ?? assessment.time_limit_minutes;
          assessment.max_attempts = finalData.max_attempts ?? assessment.max_attempts;
          assessment.updated_at = new Date();
          
          console.log(`📋 [STEP 7] 📝 Updating with ${finalData.questions.length} questions for ${assessmentType}`);

          assessment.questions = finalData.questions.map((q: any, qIndex: number) => {
            const questionType = EnhancedCourseController.normalizeQuestionType(q.type);
            const correctAnswer = EnhancedCourseController.normalizeCorrectAnswer(
              q.correctAnswer || q.correct_answer,
              questionType
            );
            
            return {
              id: q.id || crypto.randomUUID(),
              question: q.question,
              type: questionType,
              options: q.options || [],
              correct_answer: correctAnswer,
              points: q.points || 1,
              order_index: q.order_index || qIndex + 1
            };
          });

          await assessmentRepo.save(assessment);
          console.log(`📋 [STEP 7] ✅✅✅ Assessment UPDATED with ${assessment.questions.length} questions for type: ${assessmentType}`);
        }
      } else {
        console.log(`📋 [STEP 7] Creating NEW assessment for type: ${finalData.type}`);
        
        // ✅ Determine assessment type based on finalData.type
        let assessmentType = "EXAM"; // default
        if (finalData.type === "ASSIGNMENT") {
          assessmentType = "ASSIGNMENT";
        } else if (finalData.type === "QUIZ") {
          assessmentType = "QUIZ";
        } else if (finalData.type === "ASSESSMENT") {
          assessmentType = "EXAM";
        } else if (finalData.type === "PROJECT") {
          assessmentType = "PROJECT";
        }
        
        const newAssessment = assessmentRepo.create({
          course_id: id,
          module_id: moduleEntity.id,
          title: finalData.title,
          description: finalData.description || finalData.instructions || '',
          type: assessmentType,
          passing_score: finalData.passingScore ?? finalData.passing_score_percentage ?? 70,
          time_limit_minutes: finalData.timeLimit ?? finalData.time_limit_minutes,
          max_attempts: finalData.max_attempts || 2,
          is_published: false,
          is_final_assessment: true,
          is_module_final: true,
          questions: []
        });

        console.log(`📋 [STEP 7] 📝 Adding ${finalData.questions.length} questions to new assessment (type: ${assessmentType})`);

        newAssessment.questions = finalData.questions.map((q: any, qIndex: number) => ({
          id: q.id || crypto.randomUUID(),
          question: q.question,
          type: EnhancedCourseController.normalizeQuestionType(q.type),
          options: q.options || [],
          correct_answer: EnhancedCourseController.normalizeCorrectAnswer(
            q.correctAnswer || q.correct_answer,
            EnhancedCourseController.normalizeQuestionType(q.type)
          ),
          points: q.points || 1,
          order_index: q.order_index || qIndex + 1
        }));

        await assessmentRepo.save(newAssessment);
        moduleFinal.assessment_id = newAssessment.id;
        
        console.log(`📋 [STEP 7] ✅✅✅ Assessment CREATED with ${newAssessment.questions.length} questions for type: ${assessmentType}`);
      }
    } else if (moduleFinal.assessment_id && moduleFinal.assessment && (!finalData.questions || finalData.questions.length === 0)) {
      // If no questions provided but assessment exists, keep it (don't delete)
      console.log(`📋 [STEP 7] No questions provided, keeping existing assessment for ${finalData.type}`);
    }

    await moduleFinalRepo.save(moduleFinal);
    
  } else {
    console.log(`📋 [STEP 7] Creating NEW module final assessment`);
    
    // ✅ Determine module final type based on finalData.type
    let moduleFinalType = ModuleFinalType.ASSESSMENT;
    if (finalData.type === "project" || finalData.type === "PROJECT") {
      moduleFinalType = ModuleFinalType.PROJECT;
    }
    
    const newModuleFinal = moduleFinalRepo.create({
      module_id: moduleEntity.id,
      title: finalData.title,
      type: moduleFinalType,
      project_instructions: finalData.instructions || finalData.description,
      passing_score_percentage: finalData.passingScore ?? finalData.passing_score_percentage ?? 70,
      time_limit_minutes: finalData.timeLimit ?? finalData.time_limit_minutes,
      requires_file_submission: finalData.fileRequired ?? finalData.requires_file_submission ?? false
    });

    // ✅✅✅ CREATE ASSESSMENT WITH QUESTIONS FOR ALL TYPES THAT HAVE THEM
    if (finalData.questions && Array.isArray(finalData.questions) && finalData.questions.length > 0) {
      console.log(`📋 [STEP 7] Creating assessment with questions for type: ${finalData.type}`);
      
      // ✅ Determine assessment type based on finalData.type
      let assessmentType = "EXAM"; // default
      if (finalData.type === "ASSIGNMENT") {
        assessmentType = "ASSIGNMENT";
      } else if (finalData.type === "QUIZ") {
        assessmentType = "QUIZ";
      } else if (finalData.type === "ASSESSMENT") {
        assessmentType = "EXAM";
      } else if (finalData.type === "PROJECT") {
        assessmentType = "PROJECT";
      }
      
      const assessment = assessmentRepo.create({
        course_id: id,
        module_id: moduleEntity.id,
        title: finalData.title,
        description: finalData.description || finalData.instructions || '',
        type: assessmentType,
        passing_score: finalData.passingScore ?? finalData.passing_score_percentage ?? 70,
        time_limit_minutes: finalData.timeLimit ?? finalData.time_limit_minutes,
        max_attempts: finalData.max_attempts || 2,
        is_published: false,
        is_final_assessment: true,
        is_module_final: true,
        questions: []
      });

      if (finalData.questions && Array.isArray(finalData.questions)) {
        console.log(`📋 [STEP 7] 📝 Adding ${finalData.questions.length} questions for ${assessmentType}`);
        
        assessment.questions = finalData.questions.map((q: any, qIndex: number) => ({
          id: crypto.randomUUID(),
          question: q.question,
          type: EnhancedCourseController.normalizeQuestionType(q.type),
          options: q.options || [],
          correct_answer: EnhancedCourseController.normalizeCorrectAnswer(
            q.correctAnswer || q.correct_answer,
            EnhancedCourseController.normalizeQuestionType(q.type)
          ),
          points: q.points || 1,
          order_index: q.order_index || qIndex + 1
        }));
      }

      await assessmentRepo.save(assessment);
      newModuleFinal.assessment_id = assessment.id;
      
      console.log(`📋 [STEP 7] ✅✅✅ Assessment CREATED with ${assessment.questions.length} questions for type: ${assessmentType}`);
    } else {
      console.log(`📋 [STEP 7] No questions to add for type: ${finalData.type}`);
    }

    await moduleFinalRepo.save(newModuleFinal);
  }
  
  console.log(`📋 [STEP 7] ========================================\n`);
}
        }

        // Steps 8-10 remain the same...
        if (processedLessonIds.length > 0) {
          await lessonRepo
            .createQueryBuilder()
            .delete()
            .from(Lesson)
            .where("module_id IN (:...moduleIds)", { moduleIds: processedModuleIds })
            .andWhere("id NOT IN (:...lessonIds)", { lessonIds: processedLessonIds })
            .execute();
        }

        const result = await EnhancedCourseController.calculateCourseTotals(id);
        course.total_lessons = result.totalLessons;
        course.duration_minutes = result.totalDuration;
        course.updated_at = new Date();
        await courseRepo.save(course);

        await queryRunner.commitTransaction();

        const duration = Date.now() - startTime;

        const updatedCourse = await courseRepo.findOne({
          where: { id },
          relations: [
            "instructor",
            "institution",
            "course_category",
            "modules",
            "modules.lessons",
            "modules.lessons.assessments",
            "modules.lessons.quizzes",
            "modules.lessons.quizzes.questions",
            "modules.final_assessment",
            "modules.final_assessment.assessment"
          ]
        });

        console.log("\n🔍 [VERIFICATION] Final check:");
        updatedCourse?.modules?.forEach((module, idx) => {
          if (module.final_assessment?.assessment) {
            console.log(`Module ${idx + 1}: ${module.final_assessment.assessment.questions?.length || 0} questions`);
          }
        });

        res.json({
          success: true,
          message: "Course modules updated successfully",
          data: updatedCourse,
          summary: {
            total_modules: cleanedModules.length,
            total_lessons: result.totalLessons,
            total_duration_minutes: result.totalDuration,
            processing_time_ms: duration
          }
        });

      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }

    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`\n❌ [ERROR] After ${duration}ms:`, error.message);

      res.status(500).json({
        success: false,
        message: "Failed to update course modules",
        error: error.message,
        processing_time_ms: duration,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }


  static async getInstructorCoursesById(req: Request, res: Response) {
    try {
      const { instructorId } = req.params;
      const { page = 1, limit = 20, status, type } = req.query;
      const requestingUserId = req.user?.userId || req.user?.id;

      console.log("👨‍🏫 [getInstructorCoursesById] Fetching courses for instructor:", instructorId);

      const userRepo = dbConnection.getRepository(User);
      const courseRepo = dbConnection.getRepository(Course);

      // Verify the instructor exists
      const instructor = await userRepo.findOne({
        where: { id: instructorId }
      });

      if (!instructor) {
        return res.status(404).json({
          success: false,
          message: "Instructor not found",
        });
      }



      const queryBuilder = courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.modules", "modules")
        .leftJoinAndSelect("modules.lessons", "lessons")
        .leftJoinAndSelect("course.instructor", "instructor")
        .leftJoinAndSelect("course.course_category", "course_category")
        .leftJoinAndSelect("course.institution", "institution")
        .where("course.instructor_id = :instructorId", { instructorId })
        .orWhere("course.id IN (SELECT course_id FROM course_instructors WHERE instructor_id = :instructorId)", { instructorId });

      // Apply filters
      if (status) {
        queryBuilder.andWhere("course.status = :status", { status });
      }

      if (type) {
        queryBuilder.andWhere("course.course_type = :type", { type });
      }

      const total = await queryBuilder.getCount();
      const courses = await queryBuilder
        .orderBy("course.created_at", "DESC")
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      // Clean courses before returning
      const cleanedCourses = courses.map(course =>
        EnhancedCourseController.cleanCourseData(course)
      );

      // Calculate instructor statistics
      const instructorStats = {
        total_courses: total,
        published_courses: courses.filter(c => c.status === CourseStatus.PUBLISHED).length,
        draft_courses: courses.filter(c => c.status === CourseStatus.DRAFT).length,
        mooc_courses: courses.filter(c => c.course_type === CourseType.MOOC).length,
        spoc_courses: courses.filter(c => c.course_type === CourseType.SPOC).length,
        total_enrollments: courses.reduce((sum, course) => sum + (course.enrollment_count || 0), 0),
        average_rating: courses.length > 0
          ? courses.reduce((sum, course) => sum + (parseFloat(course.average_rating?.toString()) || 0), 0) / courses.length
          : 0,
      };

      console.log(`✅ [getInstructorCoursesById] Fetched ${cleanedCourses.length} courses for instructor ${instructorId}`);

      res.json({
        success: true,
        message: "Instructor courses retrieved successfully",
        data: {
          instructor: {
            id: instructor.id,
            first_name: instructor.first_name,
            last_name: instructor.last_name,
            email: instructor.email,
            profile_picture_url: instructor.profile_picture_url,
            bwenge_role: instructor.bwenge_role,
            institution_role: instructor.institution_role,
          },
          courses: cleanedCourses,
          statistics: instructorStats,
        },
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error: any) {
      console.error("❌ Get instructor courses by ID error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch instructor courses",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  // ==================== HELPER: PROCESS ASSESSMENT ====================
  private static async processAssessment(
    ass: any,
    lessonId: string,
    moduleId: string,
    courseId: string,
    assessmentRepo: any,
    quizRepo: any,
    questionRepo: any,
    processedIds: string[]
  ) {
    let assessmentEntity: Assessment;

    if (ass.id && !ass.id.toString().startsWith('temp-')) {
      assessmentEntity = await assessmentRepo.findOne({ where: { id: ass.id } });

      if (assessmentEntity) {
        Object.assign(assessmentEntity, {
          title: ass.title ?? assessmentEntity.title,
          description: ass.description ?? assessmentEntity.description,
          type: ass.type ?? assessmentEntity.type,
          passing_score: ass.passingScore || ass.passing_score ?? assessmentEntity.passing_score,
          time_limit_minutes: ass.timeLimit || ass.time_limit_minutes ?? assessmentEntity.time_limit_minutes,
          max_attempts: ass.max_attempts ?? assessmentEntity.max_attempts,
          updated_at: new Date()
        });

        if (ass.questions && Array.isArray(ass.questions)) {
          assessmentEntity.questions = ass.questions.map((q: any, qIndex: number) => ({
            id: q.id || crypto.randomUUID(),
            question: q.question,
            type: EnhancedCourseController.normalizeQuestionType(q.type),
            options: q.options || [],
            correct_answer: EnhancedCourseController.normalizeCorrectAnswer(
              q.correctAnswer || q.correct_answer,
              EnhancedCourseController.normalizeQuestionType(q.type)
            ),
            points: q.points || 1,
            order_index: q.order_index || qIndex + 1
          }));
        }

        await assessmentRepo.save(assessmentEntity);
        processedIds.push(assessmentEntity.id);
      }
    } else {
      // Create new assessment
      const newAssessment = assessmentRepo.create({
        course_id: courseId,
        lesson_id: lessonId,
        module_id: moduleId,
        title: ass.title,
        description: ass.description || '',
        type: ass.type || "QUIZ",
        passing_score: ass.passingScore || ass.passing_score || 70,
        max_attempts: ass.max_attempts || 3,
        time_limit_minutes: ass.timeLimit || ass.time_limit_minutes,
        is_published: false,
        questions: []
      });

      // Create quiz
      const quiz = quizRepo.create({
        course_id: courseId,
        lesson_id: lessonId,
        title: ass.title,
        description: ass.description || '',
        passing_score: newAssessment.passing_score,
        time_limit_minutes: newAssessment.time_limit_minutes,
        max_attempts: newAssessment.max_attempts,
        is_published: false
      });
      await quizRepo.save(quiz);

      // Add questions
      if (ass.questions && Array.isArray(ass.questions)) {
        newAssessment.questions = ass.questions.map((q: any, qIndex: number) => ({
          id: crypto.randomUUID(),
          question: q.question,
          type: EnhancedCourseController.normalizeQuestionType(q.type),
          options: q.options || [],
          correct_answer: EnhancedCourseController.normalizeCorrectAnswer(
            q.correctAnswer || q.correct_answer,
            EnhancedCourseController.normalizeQuestionType(q.type)
          ),
          points: q.points || 1,
          order_index: q.order_index || qIndex + 1
        }));

        // Create quiz questions
        for (const q of ass.questions) {
          const questionType = EnhancedCourseController.normalizeQuestionType(q.type);
          const quizQuestion = questionRepo.create({
            quiz_id: quiz.id,
            question_text: q.question,
            question_type: questionType as QuestionType,
            options: q.options || [],
            correct_answer: EnhancedCourseController.normalizeCorrectAnswer(
              q.correctAnswer || q.correct_answer,
              questionType
            ),
            explanation: q.explanation,
            points: q.points || 1,
            order_index: q.order_index || 0
          });
          await questionRepo.save(quizQuestion);
        }
      }

      await assessmentRepo.save(newAssessment);
      processedIds.push(newAssessment.id);
    }
  }

  // ==================== DELETE MODULE ENDPOINT ====================
  static async deleteModule(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      const moduleRepo = dbConnection.getRepository(Module);
      const module = await moduleRepo.findOne({
        where: { id },
        relations: ["course", "lessons", "final_assessment"]
      });

      if (!module) {
        return res.status(404).json({
          success: false,
          message: "Module not found"
        });
      }

      // Check permissions
      if (module.course.instructor_id !== userId && req.user?.bwenge_role !== "SYSTEM_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to delete this module"
        });
      }

      const courseId = module.course_id;
      await moduleRepo.remove(module);

      // Recalculate course totals
      const courseRepo = dbConnection.getRepository(Course);
      const result = await EnhancedCourseController.calculateCourseTotals(courseId);

      const course = await courseRepo.findOne({ where: { id: courseId } });
      if (course) {
        course.total_lessons = result.totalLessons;
        course.duration_minutes = result.totalDuration;
        await courseRepo.save(course);
      }

      res.json({
        success: true,
        message: "Module deleted successfully"
      });
    } catch (error: any) {
      console.error("❌ Delete module error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete module",
        error: error.message
      });
    }
  }

  // ==================== DELETE LESSON ENDPOINT ====================
  static async deleteLesson(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      const lessonRepo = dbConnection.getRepository(Lesson);
      const lesson = await lessonRepo.findOne({
        where: { id },
        relations: ["course", "assessments", "quizzes"]
      });

      if (!lesson) {
        return res.status(404).json({
          success: false,
          message: "Lesson not found"
        });
      }

      // Check permissions
      if (lesson.course.instructor_id !== userId && req.user?.bwenge_role !== "SYSTEM_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to delete this lesson"
        });
      }

      const courseId = lesson.course_id;
      await lessonRepo.remove(lesson);

      // Recalculate course totals
      const courseRepo = dbConnection.getRepository(Course);
      const result = await EnhancedCourseController.calculateCourseTotals(courseId);

      const course = await courseRepo.findOne({ where: { id: courseId } });
      if (course) {
        course.total_lessons = result.totalLessons;
        course.duration_minutes = result.totalDuration;
        await courseRepo.save(course);
      }

      res.json({
        success: true,
        message: "Lesson deleted successfully"
      });
    } catch (error: any) {
      console.error("❌ Delete lesson error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete lesson",
        error: error.message
      });
    }
  }

  // ==================== DELETE ASSESSMENT ENDPOINT ====================
  static async deleteAssessment(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      const assessmentRepo = dbConnection.getRepository(Assessment);
      const assessment = await assessmentRepo.findOne({
        where: { id },
        relations: ["course", "lesson"]
      });

      if (!assessment) {
        return res.status(404).json({
          success: false,
          message: "Assessment not found"
        });
      }

      // Check permissions
      if (assessment.course.instructor_id !== userId && req.user?.bwenge_role !== "SYSTEM_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to delete this assessment"
        });
      }

      await assessmentRepo.remove(assessment);

      res.json({
        success: true,
        message: "Assessment deleted successfully"
      });
    } catch (error: any) {
      console.error("❌ Delete assessment error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete assessment",
        error: error.message
      });
    }
  }

  static async getCourseStudents(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Missing course ID",
        });
      }

      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const userRepo = dbConnection.getRepository(User);

      // First, verify the course exists
      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({ where: { id } });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Check if user has permission to view students
      const hasPermission = await EnhancedCourseController.checkCourseAccess(course, userId);
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view students for this course",
        });
      }

      // Get all enrollments for this course with user relations
      const enrollments = await enrollmentRepo.find({
        where: {
          course_id: id,
          status: EnrollmentStatus.ACTIVE // Only active enrollments
        },
        relations: ["user"],
        order: {
          enrolled_at: "DESC"
        }
      });

      // Extract unique users from enrollments
      const users = enrollments.map(enrollment => enrollment.user);

      // Remove duplicates (in case of multiple enrollments per user)
      const uniqueUsers = Array.from(
        new Map(users.map(user => [user.id, user])).values()
      );

      // Sanitize user data (remove sensitive information)
      const sanitizedStudents = uniqueUsers.map((student) => ({
        id: student.id,
        firstName: student.first_name,
        lastName: student.last_name,
        email: student.email,
        profilePicture: student.profile_picture_url,
        account_type: student.account_type,
        bwenge_role: student.bwenge_role,
        institution_role: student.institution_role,
        date_joined: student.date_joined,
        last_login: student.last_login,
        is_active: student.is_active,
        is_verified: student.is_verified,
        country: student.country,
        city: student.city,
        bio: student.bio,
        phone_number: student.phone_number,
        // Enrollment-specific data
        enrollmentData: enrollments
          .filter(e => e.user_id === student.id)
          .map(e => ({
            enrollment_id: e.id,
            enrolled_at: e.enrolled_at,
            progress_percentage: e.progress_percentage,
            status: e.status,
            completion_date: e.completion_date,
            final_score: e.final_score,
            total_time_spent_minutes: e.total_time_spent_minutes,
            completed_lessons: e.completed_lessons,
            last_accessed: e.last_accessed
          }))[0] // Take the first/latest enrollment
      }));

      // Get additional statistics
      const totalStudents = uniqueUsers.length;
      const activeStudents = enrollments.filter(e => e.status === EnrollmentStatus.ACTIVE).length;
      const completedStudents = enrollments.filter(e => e.status === EnrollmentStatus.COMPLETED).length;

      // Calculate average progress
      const averageProgress = enrollments.length > 0
        ? enrollments.reduce((sum, e) => sum + e.progress_percentage, 0) / enrollments.length
        : 0;

      res.json({
        success: true,
        message: "Students retrieved successfully",
        data: {
          students: sanitizedStudents,
          statistics: {
            total_students: totalStudents,
            active_students: activeStudents,
            completed_students: completedStudents,
            average_progress: averageProgress.toFixed(2),
            total_enrollments: enrollments.length
          },
          course: {
            id: course.id,
            title: course.title,
            course_type: course.course_type,
            instructor_name: course.instructor ?
              `${course.instructor.first_name} ${course.instructor.last_name}` :
              "Unknown Instructor"
          }
        }
      });
    } catch (error: any) {
      console.error("❌ Get course students error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch students",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }


  static async exportCourseStudents(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { format = 'csv' } = req.query;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Missing course ID",
        });
      }

      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      // Get all enrollments with user relations
      const enrollments = await enrollmentRepo.find({
        where: { course_id: id },
        relations: ["user"],
        order: { enrolled_at: "DESC" }
      });

      if (format === 'csv') {
        // Convert to CSV
        const headers = [
          'Student ID',
          'First Name',
          'Last Name',
          'Email',
          'Enrollment Date',
          'Progress %',
          'Status',
          'Completed Lessons',
          'Total Time Spent (min)',
          'Final Score',
          'Last Accessed'
        ];

        const rows = enrollments.map(enrollment => [
          enrollment.user.id,
          enrollment.user.first_name || '',
          enrollment.user.last_name || '',
          enrollment.user.email,
          enrollment.enrolled_at.toISOString().split('T')[0],
          enrollment.progress_percentage,
          enrollment.status,
          enrollment.completed_lessons,
          enrollment.total_time_spent_minutes,
          enrollment.final_score || '',
          enrollment.last_accessed ? enrollment.last_accessed.toISOString().split('T')[0] : ''
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=students_${id}_${new Date().toISOString().split('T')[0]}.csv`);

        return res.send(csvContent);
      }

      // Default JSON response
      const students = enrollments.map(enrollment => ({
        student: {
          id: enrollment.user.id,
          firstName: enrollment.user.first_name,
          lastName: enrollment.user.last_name,
          email: enrollment.user.email
        },
        enrollment: {
          id: enrollment.id,
          enrolled_at: enrollment.enrolled_at,
          progress_percentage: enrollment.progress_percentage,
          status: enrollment.status,
          completed_lessons: enrollment.completed_lessons,
          total_time_spent_minutes: enrollment.total_time_spent_minutes,
          final_score: enrollment.final_score,
          last_accessed: enrollment.last_accessed
        }
      }));

      res.json({
        success: true,
        message: "Students data exported successfully",
        data: {
          students,
          total: enrollments.length,
          exported_at: new Date().toISOString()
        }
      });
    } catch (error: any) {
      console.error("❌ Export students error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to export students data",
        error: error.message,
      });
    }
  }



  private static normalizeQuestionType(type: string): string {
    const normalized = type?.toUpperCase();
    if (normalized === "MCQ" || normalized === "MULTIPLE_CHOICE") return "MULTIPLE_CHOICE";
    if (normalized === "TRUE_FALSE" || normalized === "TRUEFALSE") return "TRUE_FALSE";
    if (normalized === "SHORT_ANSWER" || normalized === "SHORTANSWER") return "SHORT_ANSWER";
    if (normalized === "ESSAY") return "ESSAY";
    return "MULTIPLE_CHOICE";
  }

  // ==================== HELPER: NORMALIZE CORRECT ANSWER ====================
  private static normalizeCorrectAnswer(answer: any, questionType: string): string {
    if (!answer) return "";
    if (questionType === "MULTIPLE_CHOICE" && Array.isArray(answer)) {
      return JSON.stringify(answer);
    }
    if (questionType === "MATCHING" && typeof answer === "object") {
      return JSON.stringify(answer);
    }
    if (typeof answer === "boolean") {
      return answer.toString();
    }
    return String(answer);
  }




  static async updateCourse(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      console.log("📝 [updateCourse] Request body type:", typeof req.body);
      console.log("📝 [updateCourse] Request body keys:", Object.keys(req.body || {}));
      console.log("📝 [updateCourse] Has files:", !!req.files);

      // ==================== PARSE REQUEST BODY ====================
      let coursePayload: any = {};

      // Handle multipart/form-data from multer
      if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
        coursePayload = { ...req.body };

        // Parse stringified fields that multer treats as strings
        const fieldsToParseAsJSON = ['modules', 'tags', 'requirements', 'what_you_will_learn'];

        for (const field of fieldsToParseAsJSON) {
          if (coursePayload[field] && typeof coursePayload[field] === 'string') {
            try {
              coursePayload[field] = JSON.parse(coursePayload[field]);
            } catch (e) {
              console.warn(`⚠️ Failed to parse ${field}, keeping as string`);
            }
          }
        }
      } else if (typeof req.body === 'string') {
        // Handle JSON string
        try {
          coursePayload = JSON.parse(req.body);
        } catch (e) {
          console.error("❌ Failed to parse request body JSON:", e);
          return res.status(400).json({
            success: false,
            message: "Invalid JSON in request body",
          });
        }
      } else {
        console.error("❌ Unexpected request body format");
        return res.status(400).json({
          success: false,
          message: "Invalid request body format",
        });
      }

      console.log("✅ [updateCourse] Parsed payload keys:", Object.keys(coursePayload));

      // Extract modules and tags
      let modules = coursePayload.modules;
      if (typeof modules === 'string') {
        try {
          modules = JSON.parse(modules);
        } catch (e) {
          console.error("Failed to parse modules:", e);
          modules = [];
        }
      }

      let tags = coursePayload.tags;
      if (typeof tags === 'string') {
        try {
          tags = JSON.parse(tags);
        } catch (e) {
          console.error("Failed to parse tags:", e);
          tags = [];
        }
      }

      // Extract course fields
      const {
        title,
        description,
        short_description,
        thumbnail_url, // Existing URL
        category_id,
        category_name,
        level,
        price,
        duration_minutes,
        requires_approval,
        max_enrollments,
        is_institution_wide,
        language,
        requirements,
        what_you_will_learn,
        is_certificate_available,
        status,
        course_type,
      } = coursePayload;

      console.log("📚 [updateCourse] Course title:", title);
      console.log("📦 [updateCourse] Modules count:", Array.isArray(modules) ? modules.length : 0);

      // ==================== REPOSITORY SETUP ====================
      const courseRepo = dbConnection.getRepository(Course);
      const categoryRepo = dbConnection.getRepository(CourseCategory);

      // ==================== FIND EXISTING COURSE ====================
      const course = await courseRepo.findOne({
        where: { id },
        relations: ["modules", "modules.lessons", "modules.final_assessment"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found"
        });
      }

      console.log("✅ [updateCourse] Found course:", course.title);

      // ==================== PERMISSION CHECK ====================
      if (course.instructor_id !== userId && req.user?.bwenge_role !== "SYSTEM_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this course"
        });
      }

      // ==================== FIXED: HANDLE THUMBNAIL UPLOAD ====================
      let finalThumbnailUrl = thumbnail_url || course.thumbnail_url;

      // Check for uploaded thumbnail in request files
      if (req.files) {
        console.log("🖼️ [updateCourse] Checking for thumbnail in files:", Object.keys(req.files));

        let thumbnailFile = null;

        // Check different possible field names
        if (req.file) {
          thumbnailFile = req.file;
        } else if (req.files['thumbnail'] && Array.isArray(req.files['thumbnail']) && req.files['thumbnail'].length > 0) {
          thumbnailFile = req.files['thumbnail'][0];
        } else if (req.files['thumbnail_url'] && Array.isArray(req.files['thumbnail_url']) && req.files['thumbnail_url'].length > 0) {
          thumbnailFile = req.files['thumbnail_url'][0];
        }

        if (thumbnailFile) {
          try {
            console.log("☁️ [updateCourse] Uploading new thumbnail...");
            const uploadResult = await UploadToCloud(thumbnailFile);
            finalThumbnailUrl = uploadResult.secure_url;
            console.log("✅ [updateCourse] New thumbnail uploaded:", finalThumbnailUrl);
          } catch (uploadError) {
            console.error("❌ [updateCourse] Failed to upload thumbnail:", uploadError);
          }
        }
      }

      // ==================== HANDLE CATEGORY ====================
      if (category_id) {
        const category = await categoryRepo.findOne({ where: { id: category_id } });
        if (category) {
          course.category_id = category_id;
        }
      } else if (category_name) {
        let category = await categoryRepo.findOne({
          where: {
            name: category_name,
            institution_id: course.institution_id || null
          },
        });

        if (!category) {
          category = categoryRepo.create({
            name: category_name,
            institution_id: course.institution_id || null,
            is_active: true,
            order_index: 0,
          });
          await categoryRepo.save(category);
          console.log("📁 [updateCourse] Created new category:", category_name);
        }
        course.category_id = category.id;
      }

      // ==================== UPDATE BASIC FIELDS ====================
      if (title !== undefined) course.title = title;
      if (description !== undefined) course.description = description;
      if (finalThumbnailUrl !== undefined) course.thumbnail_url = finalThumbnailUrl;
      if (short_description !== undefined) course.short_description = short_description;
      if (thumbnail_url !== undefined) course.thumbnail_url = thumbnail_url;
      if (level !== undefined) course.level = level;
      if (price !== undefined) course.price = price;
      if (duration_minutes !== undefined) course.duration_minutes = duration_minutes;
      if (tags !== undefined) course.tags = tags;
      if (language !== undefined) course.language = language;
      if (requirements !== undefined) course.requirements = requirements;
      if (what_you_will_learn !== undefined) course.what_you_will_learn = what_you_will_learn;
      if (is_certificate_available !== undefined) course.is_certificate_available = is_certificate_available;
      if (status !== undefined) course.status = status;

      // ==================== UPDATE SPOC FIELDS ====================
      if (course.course_type === CourseType.SPOC) {
        if (requires_approval !== undefined) course.requires_approval = requires_approval;
        if (max_enrollments !== undefined) course.max_enrollments = max_enrollments;
        if (is_institution_wide !== undefined) course.is_institution_wide = is_institution_wide;
      }

      await courseRepo.save(course);
      console.log("✅ [updateCourse] Basic course fields updated");

      // ==================== UPDATE MODULES ====================
      if (modules && Array.isArray(modules) && modules.length > 0) {
        console.log(`📦 [updateCourse] Processing ${modules.length} modules...`);

        // Clean and validate modules
        const cleanedModules = await EnhancedCourseController.cleanModuleData(modules);
        console.log(`🧹 [updateCourse] Cleaned modules, processing updates...`);

        await EnhancedCourseController.updateCourseModulesWithUploads(
          course.id,
          cleanedModules,
          req.files
        );

        // Recalculate totals
        const result = await EnhancedCourseController.calculateCourseTotals(course.id);
        course.total_lessons = result.totalLessons;
        course.duration_minutes = result.totalDuration;
        await courseRepo.save(course);

        console.log("📊 [updateCourse] Updated totals:", {
          totalLessons: result.totalLessons,
          totalDuration: result.totalDuration
        });
      }

      // ==================== FETCH UPDATED COURSE ====================
      const relations = [
        "instructor",
        "course_category",
        "modules",
        "modules.lessons",
        "modules.lessons.assessments",
        "modules.lessons.quizzes",
        "modules.lessons.quizzes.questions",
        "modules.final_assessment",
        "modules.final_assessment.assessment",
      ];

      if (course.course_type === CourseType.SPOC) {
        relations.splice(1, 0, "institution");
      }

      const updatedCourse = await courseRepo.findOne({
        where: { id: course.id },
        relations: relations,
      });

      console.log("✅ [updateCourse] Course update complete!");

      res.json({
        success: true,
        message: `${course.course_type} course updated successfully`,
        data: updatedCourse,
      });
    } catch (error: any) {
      console.error("❌ [updateCourse] Error:", error);
      console.error("❌ [updateCourse] Stack:", error.stack);
      res.status(500).json({
        success: false,
        message: "Failed to update course",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }
  // ==================== UPDATE COURSE MODULES WITH UPLOADS ====================
  private static async updateCourseModulesWithUploads(courseId: string, modules: any[], files?: any[]) {
    const moduleRepo = dbConnection.getRepository(Module);
    const lessonRepo = dbConnection.getRepository(Lesson);
    const assessmentRepo = dbConnection.getRepository(Assessment);
    const quizRepo = dbConnection.getRepository(Quiz);
    const questionRepo = dbConnection.getRepository(Question);
    const moduleFinalRepo = dbConnection.getRepository(ModuleFinalAssessment);

    for (const modIndex in modules) {
      const mod = modules[modIndex];
      let moduleEntity: Module;

      if (mod.id) {
        // Update Existing Module
        moduleEntity = await moduleRepo.findOne({
          where: { id: mod.id, course_id: courseId },
          relations: ["lessons", "final_assessment"],
        });

        if (moduleEntity) {
          moduleEntity.title = mod.title ?? moduleEntity.title;
          moduleEntity.description = mod.description ?? moduleEntity.description;
          moduleEntity.order_index = mod.order_index ?? mod.order ?? moduleEntity.order_index;
          moduleEntity.estimated_duration_hours = mod.estimated_duration_hours ?? moduleEntity.estimated_duration_hours;
          await moduleRepo.save(moduleEntity);
        } else {
          continue;
        }
      } else {
        // Create New Module
        moduleEntity = moduleRepo.create({
          course_id: courseId,
          title: mod.title,
          description: mod.description,
          order_index: mod.order_index || mod.order || 0,
          estimated_duration_hours: mod.estimated_duration_hours || 0,
          is_published: false,
        });
        await moduleRepo.save(moduleEntity);
      }

      // Update/Create Lessons with uploads
      if (mod.lessons && Array.isArray(mod.lessons)) {
        for (const lesIndex in mod.lessons) {
          const les = mod.lessons[lesIndex];

          if (les.id) {
            // Update Existing Lesson
            const lesson = await lessonRepo.findOne({
              where: { id: les.id, module_id: moduleEntity.id },
              relations: ["quizzes"],
            });

            if (lesson) {
              lesson.title = les.title ?? lesson.title;
              lesson.content = les.content ?? lesson.content;

              // Handle video upload
              if (files && Array.isArray(files)) {
                const videoFile = files.find((file: any) =>
                  file.fieldname === `modules[${modIndex}].lessons[${lesIndex}].video`
                );
                if (videoFile) {
                  try {
                    const videoUpload = await UploadToCloud(videoFile);
                    lesson.video_url = videoUpload.secure_url;
                  } catch (uploadError) {
                    console.error(`Failed to upload video:`, uploadError);
                  }
                } else {
                  lesson.video_url = les.videoUrl || les.video_url ?? lesson.video_url;
                }
              } else {
                lesson.video_url = les.videoUrl || les.video_url ?? lesson.video_url;
              }

              // Handle thumbnail upload
              if (files && Array.isArray(files)) {
                const thumbnailFile = files.find((file: any) =>
                  file.fieldname === `modules[${modIndex}].lessons[${lesIndex}].thumbnail`
                );
                if (thumbnailFile) {
                  try {
                    const thumbnailUpload = await UploadToCloud(thumbnailFile);
                    lesson.thumbnail_url = thumbnailUpload.secure_url;
                  } catch (uploadError) {
                    console.error(`Failed to upload thumbnail:`, uploadError);
                  }
                } else {
                  lesson.thumbnail_url = les.thumbnail_url ?? lesson.thumbnail_url;
                }
              } else {
                lesson.thumbnail_url = les.thumbnail_url ?? lesson.thumbnail_url;
              }

              // Handle resource files upload
              if (files && Array.isArray(files)) {
                const resourceFiles = files.filter((file: any) =>
                  file.fieldname === `modules[${modIndex}].lessons[${lesIndex}].files`
                );

                if (resourceFiles.length > 0) {
                  const uploadedResources = [];
                  for (const file of resourceFiles) {
                    try {
                      const uploadResult = await UploadToCloud(file);
                      uploadedResources.push({
                        title: file.originalname,
                        url: uploadResult.secure_url,
                        type: file.mimetype,
                        public_id: uploadResult.public_id
                      });
                    } catch (uploadError) {
                      console.error(`Failed to upload resource:`, uploadError);
                    }
                  }

                  // Merge with existing resources
                  const existingResources = lesson.resources || [];
                  lesson.resources = [...existingResources, ...uploadedResources];
                }
              }

              lesson.duration_minutes = les.duration || les.duration_minutes ?? lesson.duration_minutes;
              lesson.order_index = les.order_index || les.order ?? lesson.order_index;
              lesson.type = les.type ?? lesson.type;
              lesson.is_preview = les.is_preview ?? lesson.is_preview;

              // Add resources from request body if not already processed
              if (les.resources && Array.isArray(les.resources) && les.resources.length > 0) {
                if (!lesson.resources) lesson.resources = [];
                lesson.resources = [...lesson.resources, ...les.resources];
              }

              await lessonRepo.save(lesson);

              // Update Assessments
              await this.updateLessonAssessments(lesson.id, moduleEntity.id, courseId, les.assessments);
            }
          } else {
            // Create New Lesson with uploads
            let videoUrl = les.videoUrl || les.video_url;
            let thumbnailUrl = les.thumbnail_url;
            let resourcesJson = les.resources;

            // Process uploads for new lesson
            if (files && Array.isArray(files)) {
              // Video upload
              const videoFile = files.find((file: any) =>
                file.fieldname === `modules[${modIndex}].lessons[${lesIndex}].video`
              );
              if (videoFile) {
                try {
                  const videoUpload = await UploadToCloud(videoFile);
                  videoUrl = videoUpload.secure_url;
                } catch (uploadError) {
                  console.error(`Failed to upload video:`, uploadError);
                }
              }

              // Thumbnail upload
              const thumbnailFile = files.find((file: any) =>
                file.fieldname === `modules[${modIndex}].lessons[${lesIndex}].thumbnail`
              );
              if (thumbnailFile) {
                try {
                  const thumbnailUpload = await UploadToCloud(thumbnailFile);
                  thumbnailUrl = thumbnailUpload.secure_url;
                } catch (uploadError) {
                  console.error(`Failed to upload thumbnail:`, uploadError);
                }
              }

              // Resource files upload
              const resourceFiles = files.filter((file: any) =>
                file.fieldname === `modules[${modIndex}].lessons[${lesIndex}].files`
              );

              if (resourceFiles.length > 0) {
                const uploadedResources = [];
                for (const file of resourceFiles) {
                  try {
                    const uploadResult = await UploadToCloud(file);
                    uploadedResources.push({
                      title: file.originalname,
                      url: uploadResult.secure_url,
                      type: file.mimetype,
                      public_id: uploadResult.public_id
                    });
                  } catch (uploadError) {
                    console.error(`Failed to upload resource:`, uploadError);
                  }
                }

                if (!resourcesJson) resourcesJson = [];
                resourcesJson = [...resourcesJson, ...uploadedResources];
              }
            }

            const newLesson = lessonRepo.create({
              course_id: courseId,
              module_id: moduleEntity.id,
              title: les.title,
              content: les.content,
              video_url: videoUrl,
              thumbnail_url: thumbnailUrl,
              duration_minutes: les.duration || les.duration_minutes || 0,
              order_index: les.order_index || les.order || 0,
              type: les.type || "VIDEO",
              is_published: false,
              is_preview: les.is_preview || false,
              resources: resourcesJson,
            });
            await lessonRepo.save(newLesson);

            await this.updateLessonAssessments(newLesson.id, moduleEntity.id, courseId, les.assessments);
          }
        }
      }

      // Update Module Final Assessment (existing code preserved)
      if (mod.finalAssessment || mod.final_assessment) {
        const finalData = mod.finalAssessment || mod.final_assessment;
        let moduleFinal = await moduleFinalRepo.findOne({
          where: { module_id: moduleEntity.id },
          relations: ["assessment"],
        });

        if (moduleFinal) {
          // Update Existing
          moduleFinal.title = finalData.title ?? moduleFinal.title;
          moduleFinal.type = finalData.type === "project" ? ModuleFinalType.PROJECT : ModuleFinalType.ASSESSMENT;
          moduleFinal.project_instructions = finalData.instructions ?? moduleFinal.project_instructions;
          moduleFinal.passing_score_percentage = finalData.passingScore ?? moduleFinal.passing_score_percentage;
          moduleFinal.time_limit_minutes = finalData.timeLimit ?? moduleFinal.time_limit_minutes;
          moduleFinal.requires_file_submission = finalData.fileRequired ?? moduleFinal.requires_file_submission;

          if (finalData.type === "assessment" && moduleFinal.assessment) {
            await this.updateFinalAssessment(moduleFinal.assessment.id, finalData);
          } else if (finalData.type === "assessment" && !moduleFinal.assessment) {
            const newAssessment = await this.createFinalAssessment(courseId, moduleEntity.id, finalData);
            moduleFinal.assessment_id = newAssessment.id;
          }

          await moduleFinalRepo.save(moduleFinal);
        } else {
          // Create New Module Final
          const newModuleFinal = moduleFinalRepo.create({
            module_id: moduleEntity.id,
            title: finalData.title,
            type: finalData.type === "project" ? ModuleFinalType.PROJECT : ModuleFinalType.ASSESSMENT,
            project_instructions: finalData.instructions,
            passing_score_percentage: finalData.passingScore || 70,
            time_limit_minutes: finalData.timeLimit,
            requires_file_submission: finalData.fileRequired || false,
          });

          if (finalData.type === "assessment") {
            const assessment = await this.createFinalAssessment(courseId, moduleEntity.id, finalData);
            newModuleFinal.assessment_id = assessment.id;
          }

          await moduleFinalRepo.save(newModuleFinal);
        }
      }
    }
  }

  // ==================== UPDATE COURSE THUMBNAIL WITH CLOUDINARY ====================
  static async updateCourseThumbnail(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          message: "Thumbnail file is required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({ where: { id } });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Upload to Cloudinary
      let thumbnailUrl = course.thumbnail_url;
      if (file) {
        try {
          const uploadResult = await UploadToCloud(file);
          thumbnailUrl = uploadResult.secure_url;
        } catch (uploadError: any) {
          console.error("❌ Failed to upload thumbnail:", uploadError);
          return res.status(500).json({
            success: false,
            message: "Failed to upload thumbnail to Cloudinary",
            error: uploadError.message,
          });
        }
      }

      // Update course thumbnail
      course.thumbnail_url = thumbnailUrl;
      await courseRepo.save(course);

      res.json({
        success: true,
        message: "Course thumbnail updated successfully",
        data: { thumbnail_url: thumbnailUrl },
      });
    } catch (error: any) {
      console.error("❌ Update course thumbnail error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update course thumbnail",
        error: error.message,
      });
    }
  }

  // Add this helper method in EnhancedCourseController class
  private static async cleanModuleData(modules: any[]): Promise<any[]> {
    return modules.map((module) => {
      const cleanedModule = {
        ...module,
        lessons: (module.lessons || []).map((lesson: any) => {
          // Remove duplicate resources
          const uniqueResources = lesson.resources
            ? Array.from(
              new Map(
                lesson.resources.map((r: any) => [r.url, r])
              ).values()
            )
            : [];

          return {
            ...lesson,
            resources: uniqueResources,
            // Ensure assessments are clean
            assessments: (lesson.assessments || []).map((assessment: any) => ({
              ...assessment,
              questions: assessment.questions || []
            }))
          };
        })
      };

      // Remove temporary IDs
      if (cleanedModule.id && cleanedModule.id.toString().startsWith('temp-')) {
        delete cleanedModule.id;
      }

      cleanedModule.lessons?.forEach((lesson: any) => {
        if (lesson.id && lesson.id.toString().startsWith('temp-')) {
          delete lesson.id;
        }

        lesson.assessments?.forEach((assessment: any) => {
          if (assessment.id && assessment.id.toString().startsWith('temp-')) {
            delete assessment.id;
          }
        });
      });

      return cleanedModule;
    });
  }




  // ==================== ASSIGN INSTRUCTOR TO COURSE ====================
  static async assignInstructorToCourse(req: Request, res: Response) {
    try {
      const { id } = req.params; // course_id
      const {
        instructor_id,
        is_primary_instructor,
        can_grade_assignments,
        can_manage_enrollments,
        can_edit_course_content,
      } = req.body;

      if (!instructor_id) {
        return res.status(400).json({
          success: false,
          message: "Instructor ID is required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const userRepo = dbConnection.getRepository(User);
      const instructorRepo = dbConnection.getRepository(CourseInstructor);

      const course = await courseRepo.findOne({ where: { id } });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      const instructor = await userRepo.findOne({ where: { id: instructor_id } });
      if (!instructor) {
        return res.status(404).json({
          success: false,
          message: "Instructor not found",
        });
      }

      // Check if already assigned
      const existing = await instructorRepo.findOne({
        where: { course_id: id, instructor_id },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Instructor already assigned to this course",
        });
      }

      const assignment = instructorRepo.create({
        course_id: id,
        instructor_id,
        is_primary_instructor: is_primary_instructor || false,
        can_grade_assignments: can_grade_assignments !== false,
        can_manage_enrollments: can_manage_enrollments || false,
        can_edit_course_content: can_edit_course_content || false,
      });

      await instructorRepo.save(assignment);

      // Send notification email
      await sendEmail({
        to: instructor.email,
        subject: `You've been assigned to ${course.title}`,
        html: `
          <h2>Course Assignment</h2>
          <p>You have been assigned as an instructor for <strong>${course.title}</strong>.</p>
          <p>Visit ${process.env.CLIENT_URL}/courses/${course.id} to manage the course.</p>
        `,
      });

      res.status(201).json({
        success: true,
        message: "Instructor assigned successfully",
        data: assignment,
      });
    } catch (error: any) {
      console.error("❌ Assign instructor error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to assign instructor",
        error: error.message,
      });
    }
  }

  // ==================== REMOVE INSTRUCTOR FROM COURSE ====================
  static async removeInstructorFromCourse(req: Request, res: Response) {
    try {
      const { id, instructorId } = req.params;

      const instructorRepo = dbConnection.getRepository(CourseInstructor);
      const assignment = await instructorRepo.findOne({
        where: { course_id: id, instructor_id: instructorId },
      });

      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: "Instructor assignment not found",
        });
      }

      await instructorRepo.remove(assignment);

      res.json({
        success: true,
        message: "Instructor removed successfully",
      });
    } catch (error: any) {
      console.error("❌ Remove instructor error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove instructor",
        error: error.message,
      });
    }
  }


  // ==================== VALIDATE ACCESS CODE ====================
  static async validateAccessCode(req: Request, res: Response) {
    try {
      const { id } = req.params; // course_id
      const { access_code } = req.body;

      if (!access_code) {
        return res.status(400).json({
          success: false,
          message: "Access code is required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({ where: { id } });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      const isValid =
        course.access_codes && course.access_codes.includes(access_code);

      res.json({
        success: true,
        data: {
          valid: isValid,
          course_id: course.id,
          course_title: course.title,
        },
      });
    } catch (error: any) {
      console.error("❌ Validate access code error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to validate access code",
        error: error.message,
      });
    }
  }



  // ==================== HELPER METHODS (PRESERVED) ====================

  private static async updateLessonAssessments(lessonId: string, moduleId: string, courseId: string, assessments: any[]) {
    // Existing implementation preserved
    if (!assessments || !Array.isArray(assessments)) return;

    const assessmentRepo = dbConnection.getRepository(Assessment);
    const quizRepo = dbConnection.getRepository(Quiz);
    const questionRepo = dbConnection.getRepository(Question);

    for (const ass of assessments) {
      if (ass.id) {
        // Update Existing
        const assessment = await assessmentRepo.findOne({ where: { id: ass.id } });
        if (assessment) {
          assessment.title = ass.title ?? assessment.title;
          assessment.description = ass.description ?? assessment.description;
          assessment.type = ass.type ?? assessment.type;
          assessment.passing_score = ass.passingScore || ass.passing_score ?? assessment.passing_score;
          assessment.time_limit_minutes = ass.timeLimit || ass.time_limit_minutes ?? assessment.time_limit_minutes;
          assessment.max_attempts = ass.max_attempts ?? assessment.max_attempts;

          if (ass.questions && Array.isArray(ass.questions)) {
            assessment.questions = [];
            for (const q of ass.questions) {
              const questionType = this.normalizeQuestionType(q.type);
              assessment.questions.push({
                id: crypto.randomUUID(),
                question: q.question,
                type: questionType,
                options: q.options || [],
                correct_answer: this.normalizeCorrectAnswer(q.correctAnswer || q.correct_answer, questionType),
                points: q.points || 1,
              } as any);
            }
          }

          await assessmentRepo.save(assessment);
        }
      } else {
        // Create New
        const newAssessment = assessmentRepo.create({
          course_id: courseId,
          lesson_id: lessonId,
          module_id: moduleId,
          title: ass.title,
          description: ass.description,
          type: ass.type || "QUIZ",
          passing_score: ass.passingScore || ass.passing_score || 70,
          max_attempts: ass.max_attempts || 3,
          time_limit_minutes: ass.timeLimit || ass.time_limit_minutes,
          is_published: false,
          questions: [],
        });

        const newQuiz = quizRepo.create({
          course_id: courseId,
          lesson_id: lessonId,
          title: ass.title,
          description: ass.description,
          passing_score: ass.passingScore || 70,
          time_limit_minutes: ass.timeLimit,
          max_attempts: ass.max_attempts || 3,
          is_published: false,
        });
        await quizRepo.save(newQuiz);

        if (ass.questions && Array.isArray(ass.questions)) {
          for (const q of ass.questions) {
            const questionType = this.normalizeQuestionType(q.type);
            const correctAnswer = this.normalizeCorrectAnswer(q.correctAnswer || q.correct_answer, questionType);

            newAssessment.questions.push({
              id: crypto.randomUUID(),
              question: q.question,
              type: questionType,
              options: q.options || [],
              correct_answer: correctAnswer,
              points: q.points || 1,
            } as any);

            const quizQuestion = questionRepo.create({
              quiz_id: newQuiz.id,
              question_text: q.question,
              question_type: questionType as QuestionType,
              options: q.options || [],
              correct_answer: correctAnswer,
              explanation: q.explanation,
              points: q.points || 1,
            });
            await questionRepo.save(quizQuestion);
          }
        }

        await assessmentRepo.save(newAssessment);
      }
    }
  }

  private static async createFinalAssessment(courseId: string, moduleId: string, finalData: any) {
    const assessmentRepo = dbConnection.getRepository(Assessment);

    const assessment = assessmentRepo.create({
      course_id: courseId,
      module_id: moduleId,
      title: finalData.title,
      description: finalData.description || finalData.instructions,
      type: "EXAM",
      passing_score: finalData.passingScore || 70,
      time_limit_minutes: finalData.timeLimit,
      max_attempts: finalData.max_attempts || 2,
      is_published: false,
      is_final_assessment: true,
      is_module_final: true,
      questions: [],
    });

    if (finalData.questions && Array.isArray(finalData.questions)) {
      for (const q of finalData.questions) {
        const questionType = this.normalizeQuestionType(q.type);
        assessment.questions.push({
          id: crypto.randomUUID(),
          question: q.question,
          type: questionType,
          options: q.options || q.pairs || [],
          correct_answer: this.normalizeCorrectAnswer(q.correctAnswer || q.correct_answer, questionType),
          points: q.points || 1,
        } as any);
      }
    }

    await assessmentRepo.save(assessment);
    return assessment;
  }

  private static async updateFinalAssessment(assessmentId: string, finalData: any) {
    const assessmentRepo = dbConnection.getRepository(Assessment);
    const assessment = await assessmentRepo.findOne({ where: { id: assessmentId } });

    if (assessment) {
      assessment.title = finalData.title ?? assessment.title;
      assessment.description = finalData.description ?? assessment.description;
      assessment.passing_score = finalData.passingScore ?? assessment.passing_score;
      assessment.time_limit_minutes = finalData.timeLimit ?? assessment.time_limit_minutes;
      assessment.max_attempts = finalData.max_attempts ?? assessment.max_attempts;

      if (finalData.questions && Array.isArray(finalData.questions)) {
        assessment.questions = [];
        for (const q of finalData.questions) {
          const questionType = this.normalizeQuestionType(q.type);
          assessment.questions.push({
            id: crypto.randomUUID(),
            question: q.question,
            type: questionType,
            options: q.options || q.pairs || [],
            correct_answer: this.normalizeCorrectAnswer(q.correctAnswer || q.correct_answer, questionType),
            points: q.points || 1,
          } as any);
        }
      }

      await assessmentRepo.save(assessment);
    }
  }

  private static async calculateCourseTotals(courseId: string) {
    const moduleRepo = dbConnection.getRepository(Module);
    const modules = await moduleRepo.find({
      where: { course_id: courseId },
      relations: ["lessons"],
    });

    let totalLessons = 0;
    let totalDuration = 0;

    for (const module of modules) {
      totalLessons += module.lessons?.length || 0;
      totalDuration += module.lessons?.reduce((sum, lesson) => sum + (lesson.duration_minutes || 0), 0) || 0;
    }

    return { totalLessons, totalDuration };
  }



  // EnhancedCourseController.ts - PART 2: Continuation of methods

  // ==================== NEW ENDPOINT: GET COURSE CATEGORIES ====================
  /**
   * GET /api/courses/categories
   * Get all course categories with optional filtering
   */
  static async getCourseCategories(req: Request, res: Response) {
    try {
      const { institution_id, include_subcategories, active_only } = req.query;

      const categoryRepo = dbConnection.getRepository(CourseCategory);
      const queryBuilder = categoryRepo
        .createQueryBuilder("category")
        .leftJoinAndSelect("category.institution", "institution");

      // Filter by institution if provided
      if (institution_id) {
        queryBuilder.andWhere(
          "(category.institution_id = :institution_id OR category.institution_id IS NULL)",
          { institution_id }
        );
      }

      // Filter active categories only
      if (active_only === "true") {
        queryBuilder.andWhere("category.is_active = :is_active", { is_active: true });
      }

      // Include subcategories if requested
      if (include_subcategories === "true") {
        queryBuilder.leftJoinAndSelect("category.subcategories", "subcategories");
      }

      // Get parent categories only (categories without parent)
      queryBuilder.andWhere("category.parent_category_id IS NULL");

      // Order by order_index
      queryBuilder.orderBy("category.order_index", "ASC");

      const categories = await queryBuilder.getMany();

      // Count courses per category
      const categoriesWithCounts = await Promise.all(
        categories.map(async (category) => {
          const courseCount = await dbConnection
            .getRepository(Course)
            .count({
              where: {
                category_id: category.id,
                status: CourseStatus.PUBLISHED,
              },
            });

          // If subcategories are included, count their courses too
          let subcategoriesWithCounts = category.subcategories;
          if (include_subcategories === "true" && category.subcategories) {
            subcategoriesWithCounts = await Promise.all(
              category.subcategories.map(async (sub) => {
                const subCourseCount = await dbConnection
                  .getRepository(Course)
                  .count({
                    where: {
                      category_id: sub.id,
                      status: CourseStatus.PUBLISHED,
                    },
                  });
                return { ...sub, course_count: subCourseCount };
              })
            );
          }

          return {
            ...category,
            course_count: courseCount,
            subcategories: subcategoriesWithCounts,
          };
        })
      );

      res.json({
        success: true,
        data: {
          categories: categoriesWithCounts,
          total: categoriesWithCounts.length,
        },
      });
    } catch (error: any) {
      console.error("❌ Get course categories error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch course categories",
        error: error.message,
      });
    }
  }

// In EnhancedCourseController.ts - Update getAllCoursesWithFullInfo method

static async getAllCoursesWithFullInfo(req: Request, res: Response) {
  try {
    const userId = req.user?.userId || req.user?.id;
    const {
      page = 1,
      limit = 20,
      course_type,
      status,
      category_id,
      level,
      search,
    } = req.query;

    const courseRepo = dbConnection.getRepository(Course);
    const queryBuilder = courseRepo
      .createQueryBuilder("course")
      // Instructor information
      .leftJoinAndSelect("course.instructor", "instructor")
      // Only include institutions if they exist (for public courses, this will be null)
      .leftJoinAndSelect("course.institution", "institution")
      // Category information
      .leftJoinAndSelect("course.course_category", "course_category")
      // Modules with lessons
      .leftJoinAndSelect("course.modules", "modules")
      .leftJoinAndSelect("modules.lessons", "lessons")
      // Lesson assessments with complete questions
      .leftJoinAndSelect("lessons.assessments", "lesson_assessments")
      // Lesson quizzes with questions
      .leftJoinAndSelect("lessons.quizzes", "lesson_quizzes")
      .leftJoinAndSelect("lesson_quizzes.questions", "quiz_questions")
      // Module final assessments
      .leftJoinAndSelect("modules.final_assessment", "module_final_assessment")
      .leftJoinAndSelect("module_final_assessment.assessment", "final_assessment_detail")
      // Course instructors (additional instructors)
      .leftJoinAndSelect("course.course_instructors", "course_instructors")
      .leftJoinAndSelect("course_instructors.instructor", "additional_instructor")
      // Reviews
      .leftJoinAndSelect("course.reviews", "reviews")
      .leftJoinAndSelect("reviews.user", "review_user")
      // Enrollments
      .leftJoinAndSelect("course.enrollments", "enrollments")
      // ✅ CRITICAL: Only return courses that are NOT attached to any institution
      .where("course.institution_id IS NULL");

    // Filter by course type
    if (course_type && Object.values(CourseType).includes(course_type as CourseType)) {
      queryBuilder.andWhere("course.course_type = :course_type", { course_type });
    }

    // Filter by status
    if (status && Object.values(CourseStatus).includes(status as CourseStatus)) {
      queryBuilder.andWhere("course.status = :status", { status });
    }

    // Filter by category
    if (category_id) {
      queryBuilder.andWhere("course.category_id = :category_id", { category_id });
    }

    // Filter by level
    if (level && Object.values(CourseLevel).includes(level as CourseLevel)) {
      queryBuilder.andWhere("course.level = :level", { level });
    }

    // Search functionality
    if (search) {
      queryBuilder.andWhere(
        "(course.title ILIKE :search OR course.description ILIKE :search OR course.short_description ILIKE :search OR course.tags::text ILIKE :search)",
        { search: `%${search}%` }
      );
    }

    // Order by creation date (newest first)
    queryBuilder
      .orderBy("course.created_at", "DESC")
      .addOrderBy("modules.order_index", "ASC")
      .addOrderBy("lessons.order_index", "ASC");

    // Count total matching courses
    const total = await queryBuilder.getCount();

    // Apply pagination
    const courses = await queryBuilder
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit))
      .getMany();

    // Enhance courses with additional computed data
    const enhancedCourses = courses.map((course) => {
      // Sort modules and lessons by order_index
      if (course.modules) {
        course.modules = course.modules.sort((a, b) => a.order_index - b.order_index);

        course.modules.forEach(module => {
          if (module.lessons) {
            module.lessons = module.lessons.sort((a, b) => a.order_index - b.order_index);

            // Sort questions within quizzes by order_index
            module.lessons.forEach(lesson => {
              if (lesson.quizzes) {
                lesson.quizzes.forEach(quiz => {
                  if (quiz.questions) {
                    quiz.questions = quiz.questions.sort((a, b) => a.order_index - b.order_index);
                  }
                });
              }
            });
          }
        });
      }

      // Calculate comprehensive statistics
      const stats = EnhancedCourseController.calculateCourseStatistics(course);

      return {
        ...course,
        statistics: stats,
        // Explicitly indicate this is a public course
        is_public_course: true,
        institution: null, // Ensure institution is null for public courses
      };
    });

    res.json({
      success: true,
      data: {
        courses: enhancedCourses,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
        filters_applied: {
          course_type: course_type || "all",
          status: status || "all",
          category_id: category_id || null,
          level: level || "all",
          search: search || null,
        },
      },
    });
  } catch (error: any) {
    console.error("❌ Get all courses with full info error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch public courses",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
}


static async getCourseDetails(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id;

    console.log("📖 [getCourseDetails] Fetching course:", id);

    const courseRepo = dbConnection.getRepository(Course);


    const course = await courseRepo.findOne({
      where: { id },
      relations: [
        "instructor",

        "institution",
        "institution.members",       
        "institution.members.user",   

        "course_category",
        "modules",
        "modules.lessons",
        "modules.lessons.assessments",
        "modules.lessons.quizzes",
        "modules.lessons.quizzes.questions",
        "modules.final_assessment",
        "modules.final_assessment.assessment",

        "course_instructors",
        "course_instructors.instructor",
        "reviews",
        "reviews.user",
        "enrollments",
      ],
      order: {
        modules: {
          order_index: "ASC",
        },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    const cleanedCourse = EnhancedCourseController.cleanCourseData(course);

    if (cleanedCourse.modules && Array.isArray(cleanedCourse.modules)) {
      cleanedCourse.modules.forEach((module: any) => {
        if (module.lessons && Array.isArray(module.lessons)) {
          module.lessons.forEach((lesson: any) => {

            if (lesson.assessments && lesson.assessments.length > 0) {
              if (lesson.quizzes && lesson.quizzes.length > 0) {
                const uniqueQuizzes: any[] = [];
                const seenAssessmentTitles = new Set<string>();

                lesson.assessments.forEach((assessment: any) => {
                  if (assessment.title) {
                    seenAssessmentTitles.add(assessment.title.trim().toLowerCase());
                  }
                });

                lesson.quizzes.forEach((quiz: any) => {
                  if (quiz.title && !seenAssessmentTitles.has(quiz.title.trim().toLowerCase())) {
                    uniqueQuizzes.push(quiz);
                  }
                });

                lesson.quizzes = uniqueQuizzes;
              }
            }

            if (
              lesson.assessments && lesson.quizzes &&
              lesson.assessments.length > 0 && lesson.quizzes.length > 0
            ) {
              const uniqueEntries = new Map();

              lesson.assessments.forEach((assessment: any) => {
                const key = `${assessment.title}-${assessment.description || ""}`;
                uniqueEntries.set(key, { type: "assessment", data: assessment });
              });

              lesson.quizzes.forEach((quiz: any) => {
                const key = `${quiz.title}-${quiz.description || ""}`;
                if (!uniqueEntries.has(key)) {
                  uniqueEntries.set(key, { type: "quiz", data: quiz });
                } else {
                  console.log(`🔄 [getCourseDetails] Skipping duplicate quiz: ${quiz.title}`);
                }
              });

              const filteredAssessments: any[] = [];
              const filteredQuizzes: any[] = [];

              uniqueEntries.forEach((entry) => {
                if (entry.type === "assessment") {
                  filteredAssessments.push(entry.data);
                } else {
                  filteredQuizzes.push(entry.data);
                }
              });

              lesson.assessments = filteredAssessments;
              lesson.quizzes    = filteredQuizzes;
            }

            if (lesson.assessments && lesson.assessments.length > 0) {
              console.log(`📝 [getCourseDetails] Lesson "${lesson.title}" has ${lesson.assessments.length} assessments:`);
              lesson.assessments.forEach((assessment: any, idx: number) => {
                console.log(`   Assessment ${idx + 1}: ${assessment.title} (${assessment.type})`);
              });
            }

            if (lesson.quizzes && lesson.quizzes.length > 0) {
              console.log(`📝 [getCourseDetails] Lesson "${lesson.title}" has ${lesson.quizzes.length} quizzes:`);
              lesson.quizzes.forEach((quiz: any, idx: number) => {
                console.log(`   Quiz ${idx + 1}: ${quiz.title}`);
              });
            }
          });
        }
      });
    }


    let institutionWithMembers: any = null;

    if (cleanedCourse.institution) {
      const rawInstitution: any = cleanedCourse.institution;

      // Build the members array with FULL user information
      const membersWithFullInfo = (rawInstitution.members || []).map((member: any) => {
        // Destructure so we never leak password_hash
        const {
          user,
          ...memberFields
        } = member;

        // Strip sensitive field from the user object
        if (user) {
          const {
            password_hash,    // never expose
            ...safeUserFields
          } = user;

          return {
            ...memberFields,
            user: {
              // Core identity
              id:                     safeUserFields.id,
              email:                  safeUserFields.email,
              username:               safeUserFields.username,
              first_name:             safeUserFields.first_name,
              last_name:              safeUserFields.last_name,
              phone_number:           safeUserFields.phone_number,
              profile_picture_url:    safeUserFields.profile_picture_url,
              bio:                    safeUserFields.bio,

              // Account meta
              account_type:           safeUserFields.account_type,
              bwenge_role:            safeUserFields.bwenge_role,
              institution_role:       safeUserFields.institution_role,
              is_verified:            safeUserFields.is_verified,
              is_active:              safeUserFields.is_active,
              date_joined:            safeUserFields.date_joined,
              last_login:             safeUserFields.last_login,
              last_login_bwenge:      safeUserFields.last_login_bwenge,

              // Location
              country:                safeUserFields.country,
              city:                   safeUserFields.city,

              // Institution membership
              primary_institution_id: safeUserFields.primary_institution_id,
              institution_ids:        safeUserFields.institution_ids,
              is_institution_member:  safeUserFields.is_institution_member,

              // Social / auth
              social_auth_provider:   safeUserFields.social_auth_provider,

              // Learning stats
              enrolled_courses_count: safeUserFields.enrolled_courses_count,
              completed_courses_count:safeUserFields.completed_courses_count,
              total_learning_hours:   safeUserFields.total_learning_hours,
              certificates_earned:    safeUserFields.certificates_earned,
              bwenge_profile_completed: safeUserFields.bwenge_profile_completed,
              learning_preferences:   safeUserFields.learning_preferences,

              // Timestamps
              updated_at:             safeUserFields.updated_at,
            },
          };
        }

        // Member row exists but user relation is null (shouldn't happen, but guard it)
        return {
          ...memberFields,
          user: null,
        };
      });

      // Sort members: ADMIN first, then CONTENT_CREATOR, INSTRUCTOR, MEMBER
      const roleOrder: Record<string, number> = {
        ADMIN: 0,
        CONTENT_CREATOR: 1,
        INSTRUCTOR: 2,
        MEMBER: 3,
      };
      membersWithFullInfo.sort((a: any, b: any) => {
        const aOrder = roleOrder[a.role] ?? 99;
        const bOrder = roleOrder[b.role] ?? 99;
        return aOrder - bOrder;
      });

      // Count members by role for a quick summary
      const memberSummary = membersWithFullInfo.reduce((acc: Record<string, number>, m: any) => {
        const role = m.role || "UNKNOWN";
        acc[role] = (acc[role] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      institutionWithMembers = {
        // All Institution entity columns
        id:          rawInstitution.id,
        name:        rawInstitution.name,
        slug:        rawInstitution.slug,
        type:        rawInstitution.type,
        logo_url:    rawInstitution.logo_url,
        description: rawInstitution.description,
        is_active:   rawInstitution.is_active,
        settings:    rawInstitution.settings,
        created_at:  rawInstitution.created_at,
        updated_at:  rawInstitution.updated_at,

        // ✅ Full members roster
        members: membersWithFullInfo,

        // ✅ Convenience summary
        member_summary: {
          total:           membersWithFullInfo.length,
          active:          membersWithFullInfo.filter((m: any) => m.is_active).length,
          by_role:         memberSummary,
        },
      };

      console.log(
        `✅ [getCourseDetails] Institution "${institutionWithMembers.name}" loaded with ${membersWithFullInfo.length} members`
      );
    }

    // ==================== STATISTICS ====================
    const stats = EnhancedCourseController.calculateCourseStatistics(cleanedCourse);

    console.log("✅ [getCourseDetails] Course fetched and cleaned successfully");

    // ==================== RESPONSE ====================
    // Spread cleanedCourse but override .institution with the enriched version
    res.json({
      success: true,
      data: {
        ...cleanedCourse,
        institution: institutionWithMembers,   // ✅ replaces the raw relation
        statistics: stats,
      },
    });

  } catch (error: any) {
    console.error("❌ Get course details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch course details",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
}

// ==================== HELPER: CLEAN COURSE DATA (DEDUPLICATE RESOURCES AND ASSESSMENTS) ====================
private static cleanCourseData(course: Course): Course {
  console.log("🧹 [cleanCourseData] Starting data cleaning...");

  if (!course.modules || !Array.isArray(course.modules)) {
    return course;
  }

  // Sort and clean modules
  course.modules = course.modules
    .sort((a, b) => a.order_index - b.order_index)
    .map(module => {
      if (!module.lessons || !Array.isArray(module.lessons)) {
        return module;
      }

      // Sort and clean lessons
      module.lessons = module.lessons
        .sort((a, b) => a.order_index - b.order_index)
        .map(lesson => {
          let originalResourceCount = 0;
          let deduplicatedResourceCount = 0;

          // CRITICAL FIX: Deduplicate resources by URL
          if (lesson.resources && Array.isArray(lesson.resources)) {
            originalResourceCount = lesson.resources.length;

            // Deduplicate by URL using Map
            const uniqueResourcesMap = new Map();

            lesson.resources.forEach(resource => {
              if (resource && resource.url) {
                // Use URL as key to ensure uniqueness
                if (!uniqueResourcesMap.has(resource.url)) {
                  uniqueResourcesMap.set(resource.url, {
                    url: resource.url,
                    type: resource.type,
                    title: resource.title,
                    public_id: resource.public_id
                  });
                }
              }
            });

            lesson.resources = Array.from(uniqueResourcesMap.values());
            deduplicatedResourceCount = lesson.resources.length;

            if (originalResourceCount !== deduplicatedResourceCount) {
              console.log(`⚠️  [cleanCourseData] Lesson "${lesson.title}": Removed ${originalResourceCount - deduplicatedResourceCount} duplicate resources (${originalResourceCount} → ${deduplicatedResourceCount})`);
            }
          } else {
            lesson.resources = [];
          }

          // ==================== NEW FIX: DEDUPLICATE ASSESSMENTS AND QUIZZES ====================
          // Check for assessments and quizzes with same content
          const assessmentsAndQuizzes: any[] = [];
          
          // Process assessments
          if (lesson.assessments && Array.isArray(lesson.assessments)) {
            lesson.assessments.forEach(assessment => {
              if (assessment) {
                assessmentsAndQuizzes.push({
                  type: 'assessment',
                  data: assessment
                });
              }
            });
          } else {
            lesson.assessments = [];
          }

          // Process quizzes
          if (lesson.quizzes && Array.isArray(lesson.quizzes)) {
            lesson.quizzes.forEach(quiz => {
              if (quiz) {
                assessmentsAndQuizzes.push({
                  type: 'quiz',
                  data: quiz
                });
              }
            });
          } else {
            lesson.quizzes = [];
          }

          // Deduplicate by title and content
          const uniqueAssessmentsMap = new Map();
          const duplicateQuizzesMap = new Map();
          
          assessmentsAndQuizzes.forEach(item => {
            const key = item.data.title?.trim().toLowerCase() || '';
            const description = item.data.description?.trim().toLowerCase() || '';
            const fullKey = `${key}_${description}`;
            
            if (!uniqueAssessmentsMap.has(fullKey)) {
              uniqueAssessmentsMap.set(fullKey, item);
            } else {
              // This is a duplicate - mark it
              duplicateQuizzesMap.set(fullKey, item.data.title || 'Unknown');
              console.log(`🔄 [cleanCourseData] Found duplicate: ${item.data.title}`);
            }
          });

          // Separate back into assessments and quizzes, preferring assessments
          const finalAssessments: any[] = [];
          const finalQuizzes: any[] = [];
          const seenKeys = new Set<string>();

          assessmentsAndQuizzes.forEach(item => {
            const key = item.data.title?.trim().toLowerCase() || '';
            const description = item.data.description?.trim().toLowerCase() || '';
            const fullKey = `${key}_${description}`;
            
            if (!seenKeys.has(fullKey)) {
              seenKeys.add(fullKey);
              if (item.type === 'assessment') {
                finalAssessments.push(item.data);
              } else {
                finalQuizzes.push(item.data);
              }
            }
          });

          lesson.assessments = finalAssessments;
          lesson.quizzes = finalQuizzes;

          // Clean and sort assessments
          if (lesson.assessments && Array.isArray(lesson.assessments)) {
            lesson.assessments = lesson.assessments.map(assessment => {
              if (!assessment.questions || !Array.isArray(assessment.questions)) {
                assessment.questions = [];
              }
              return assessment;
            });
          } else {
            lesson.assessments = [];
          }

          // Clean and sort quizzes with questions
          if (lesson.quizzes && Array.isArray(lesson.quizzes)) {
            lesson.quizzes = lesson.quizzes.map(quiz => {
              if (quiz.questions && Array.isArray(quiz.questions)) {
                quiz.questions = quiz.questions.sort((a, b) =>
                  (a.order_index || 0) - (b.order_index || 0)
                );
              } else {
                quiz.questions = [];
              }
              return quiz;
            });
          } else {
            lesson.quizzes = [];
          }

          return lesson;
        });

      // Clean module final assessment
      if (module.final_assessment?.assessment) {
        if (!module.final_assessment.assessment.questions ||
          !Array.isArray(module.final_assessment.assessment.questions)) {
          module.final_assessment.assessment.questions = [];
        }
      }

      return module;
    });

  console.log("✅ [cleanCourseData] Data cleaning completed");
  return course;
}


  // ==================== HELPER: CALCULATE COURSE STATISTICS ====================
  private static calculateCourseStatistics(course: Course) {
    // Calculate total duration from all lessons
    const totalLessonDuration = course.modules?.reduce(
      (sum, module) =>
        sum +
        (module.lessons?.reduce(
          (lessonSum, lesson) => lessonSum + (lesson.duration_minutes || 0),
          0
        ) || 0),
      0
    ) || 0;

    // Count total assessments (lesson assessments + quizzes + module finals)
    const totalAssessments = course.modules?.reduce(
      (sum, module) =>
        sum +
        (module.lessons?.reduce(
          (lessonSum, lesson) =>
            lessonSum +
            (lesson.assessments?.length || 0) +
            (lesson.quizzes?.length || 0),
          0
        ) || 0) +
        (module.final_assessment ? 1 : 0),
      0
    ) || 0;

    // Count total quizzes
    const totalQuizzes = course.modules?.reduce(
      (sum, module) =>
        sum +
        (module.lessons?.reduce(
          (lessonSum, lesson) => lessonSum + (lesson.quizzes?.length || 0),
          0
        ) || 0),
      0
    ) || 0;

    // Count total questions across all quizzes
    const totalQuestions = course.modules?.reduce(
      (sum, module) =>
        sum +
        (module.lessons?.reduce(
          (lessonSum, lesson) =>
            lessonSum +
            (lesson.quizzes?.reduce(
              (quizSum, quiz) => quizSum + (quiz.questions?.length || 0),
              0
            ) || 0),
          0
        ) || 0),
      0
    ) || 0;

    // Count total lessons
    const totalRequiredLessons = course.modules?.reduce(
      (sum, module) => sum + (module.lessons?.length || 0),
      0
    ) || 0;

    // Count module final assessments
    const totalModuleFinals = course.modules?.filter(
      (module) => module.final_assessment
    ).length || 0;

    // Count video lessons
    const totalVideoLessons = course.modules?.reduce(
      (sum, module) =>
        sum +
        (module.lessons?.filter((lesson) => lesson.type === "VIDEO").length || 0),
      0
    ) || 0;

    // Count resources across all lessons
    const totalResources = course.modules?.reduce(
      (sum, module) =>
        sum +
        (module.lessons?.reduce(
          (lessonSum, lesson) => lessonSum + (lesson.resources?.length || 0),
          0
        ) || 0),
      0
    ) || 0;

    // Get all instructors (primary + additional)
    const allInstructors = [
      course.instructor,
      ...(course.course_instructors?.map((ci) => ci.instructor) || []),
    ].filter(Boolean);

    // Calculate estimated total hours
    const estimatedTotalHours = Math.ceil(totalLessonDuration / 60);

    return {
      total_modules: course.modules?.length || 0,
      total_lessons: totalRequiredLessons,
      total_video_lessons: totalVideoLessons,
      total_duration_minutes: totalLessonDuration,
      estimated_total_hours: estimatedTotalHours,
      total_assessments: totalAssessments,
      total_quizzes: totalQuizzes,
      total_questions: totalQuestions,
      total_module_finals: totalModuleFinals,
      total_resources: totalResources,
      has_certificate: course.is_certificate_available,
      all_instructors: allInstructors,
      instructor_count: allInstructors.length,
      enrollment_count: course.enrollment_count || 0,
      average_rating: parseFloat(course.average_rating?.toString() || "0"),
      total_reviews: course.total_reviews || 0,
      active_enrollments: course.enrollments?.filter(
        (e) => e.status === "ACTIVE"
      ).length || 0,
    };
  }

  // ==================== HELPER: CHECK COURSE ACCESS ====================
  private static async checkCourseAccess(course: Course, userId: string): Promise<boolean> {
    // Check if user is the instructor
    if (course.instructor_id === userId) return true;

    // Check if user is an assigned instructor
    const instructorRepo = dbConnection.getRepository(CourseInstructor);
    const assignment = await instructorRepo.findOne({
      where: { course_id: course.id, instructor_id: userId },
    });
    if (assignment) return true;

    // Check if user is enrolled
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const enrollment = await enrollmentRepo.findOne({
      where: { course_id: course.id, user_id: userId, status: "ACTIVE" },
    });
    if (enrollment) return true;

    // Check if user is institution admin/member for SPOC
    if (course.course_type === CourseType.SPOC && course.institution_id) {
      const institutionMemberRepo = dbConnection.getRepository(InstitutionMember);
      const member = await institutionMemberRepo.findOne({
        where: { institution_id: course.institution_id, user_id: userId },
      });
      if (member && (member.role === "ADMIN" || member.role === "INSTRUCTOR")) {
        return true;
      }
    }

    // For public MOOC courses
    if (course.course_type === CourseType.MOOC && course.is_public) {
      return true;
    }

    return false;
  }



  static async publishCourse(req: Request, res: Response) {
    // Existing implementation preserved
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({
        where: { id },
        relations: ["modules", "modules.lessons"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Validate course can be published
      if (course.status === CourseStatus.PUBLISHED) {
        return res.status(400).json({
          success: false,
          message: "Course is already published",
        });
      }

      if (!course.modules || course.modules.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Course must have at least one module to publish",
        });
      }

      // Check if all required fields are present
      const missingFields = [];
      if (!course.title) missingFields.push("title");
      if (!course.description) missingFields.push("description");
      if (!course.category_id) missingFields.push("category");

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required fields: ${missingFields.join(", ")}`,
        });
      }

      // Update course status
      course.status = CourseStatus.PUBLISHED;
      course.published_at = new Date();
      await courseRepo.save(course);

      // Send notification
      const userRepo = dbConnection.getRepository(User);
      const instructor = await userRepo.findOne({ where: { id: course.instructor_id } });

      if (instructor) {
        await sendEmail({
          to: instructor.email,
          subject: `Course Published: ${course.title}`,
          html: `
            <h2>Course Published Successfully</h2>
            <p>Your course <strong>${course.title}</strong> has been published and is now available to students.</p>
            <p>Visit ${process.env.CLIENT_URL}/courses/${course.id} to view your course.</p>
          `,
        });
      }

      res.json({
        success: true,
        message: "Course published successfully",
        data: course,
      });
    } catch (error: any) {
      console.error("❌ Publish course error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to publish course",
        error: error.message,
      });
    }
  }

  static async unpublishCourse(req: Request, res: Response) {
    // Existing implementation preserved
    try {
      const { id } = req.params;

      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({ where: { id } });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      course.status = CourseStatus.DRAFT;
      await courseRepo.save(course);

      res.json({
        success: true,
        message: "Course unpublished successfully",
        data: course,
      });
    } catch (error: any) {
      console.error("❌ Unpublish course error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to unpublish course",
        error: error.message,
      });
    }
  }

  static async deleteCourse(req: Request, res: Response) {
    // Existing implementation preserved
    try {
      const { id } = req.params;

      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo.findOne({ where: { id } });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Soft delete
      course.status = CourseStatus.ARCHIVED;
      await courseRepo.save(course);

      res.json({
        success: true,
        message: "Course deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete course error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete course",
        error: error.message,
      });
    }
  }

  static async cloneCourse(req: Request, res: Response) {
    // Existing implementation preserved
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      const courseRepo = dbConnection.getRepository(Course);
      const originalCourse = await courseRepo.findOne({
        where: { id },
        relations: ["modules", "modules.lessons"],
      });

      if (!originalCourse) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Create cloned course
      const clonedCourse = courseRepo.create({
        ...originalCourse,
        id: undefined,
        title: `${originalCourse.title} (Copy)`,
        status: CourseStatus.DRAFT,
        enrollment_count: 0,
        average_rating: 0,
        total_reviews: 0,
        created_at: new Date(),
        updated_at: new Date(),
        instructor_id: userId,
      });

      await courseRepo.save(clonedCourse);

      res.json({
        success: true,
        message: "Course cloned successfully",
        data: clonedCourse,
      });
    } catch (error: any) {
      console.error("❌ Clone course error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to clone course",
        error: error.message,
      });
    }
  }



  static async getPublicMOOCs(req: Request, res: Response) {
    try {
      const { page = 1, limit = 20, category, level, search } = req.query;

      console.log("📚 [getPublicMOOCs] Fetching MOOC courses");

      const courseRepo = dbConnection.getRepository(Course);
      const queryBuilder = courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .leftJoinAndSelect("course.course_category", "course_category")
        .leftJoinAndSelect("course.modules", "modules")
        .leftJoinAndSelect("modules.lessons", "lessons")
        .where("course.course_type = :type", { type: CourseType.MOOC })
        .andWhere("course.is_public = :is_public", { is_public: true })
        .andWhere("course.status = :status", { status: "PUBLISHED" });

      if (category) {
        queryBuilder.andWhere("course.category_id = :category", { category });
      }

      if (level) {
        queryBuilder.andWhere("course.level = :level", { level });
      }

      if (search) {
        queryBuilder.andWhere(
          "(course.title ILIKE :search OR course.description ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      const total = await queryBuilder.getCount();

      const courses = await queryBuilder
        .orderBy("course.created_at", "DESC")
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      // CRITICAL FIX: Clean all courses before returning
      const cleanedCourses = courses.map(course =>
        EnhancedCourseController.cleanCourseData(course)
      );

      console.log(`✅ [getPublicMOOCs] Fetched and cleaned ${cleanedCourses.length} courses`);

      res.json({
        success: true,
        data: {
          courses: cleanedCourses,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Get MOOCs error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch MOOC courses",
        error: error.message,
      });
    }
  }

  // ==================== FIX: GET INSTITUTION SPOCS ====================
  static async getInstitutionSPOCs(req: Request, res: Response) {
    try {
      const { institutionId } = req.params;
      const userId = req.user?.userId || req.user?.id;

      console.log("🏢 [getInstitutionSPOCs] Fetching SPOC courses for institution:", institutionId);

      const courseRepo = dbConnection.getRepository(Course);
      const courses = await courseRepo.find({
        where: {
          institution_id: institutionId,
          course_type: CourseType.SPOC,
        },
        relations: [
          "instructor",
          "course_category",
          "course_instructors",
          "modules",
          "modules.lessons"
        ],
        order: { created_at: "DESC" },
      });

      // CRITICAL FIX: Clean all courses before returning
      const cleanedCourses = courses.map(course =>
        EnhancedCourseController.cleanCourseData(course)
      );

      console.log(`✅ [getInstitutionSPOCs] Fetched and cleaned ${cleanedCourses.length} courses`);

      res.json({
        success: true,
        data: cleanedCourses,
      });
    } catch (error: any) {
      console.error("❌ Get SPOC courses error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch SPOC courses",
        error: error.message,
      });
    }
  }

  // ==================== FIX: GET COURSES BY CATEGORY ====================
  static async getCoursesByCategory(req: Request, res: Response) {
    try {
      const { categoryId } = req.params;
      const userId = req.user?.userId || req.user?.id;

      console.log("📁 [getCoursesByCategory] Fetching courses for category:", categoryId);

      const courseRepo = dbConnection.getRepository(Course);
      const queryBuilder = courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .leftJoinAndSelect("course.institution", "institution")
        .leftJoinAndSelect("course.modules", "modules")
        .leftJoinAndSelect("modules.lessons", "lessons")
        .where("course.category_id = :categoryId", { categoryId })
        .andWhere("course.status = :status", { status: "PUBLISHED" });

      // Filter based on access
      queryBuilder.andWhere(
        "(course.course_type = :mooc OR (course.course_type = :spoc AND course.institution_id IN (SELECT institution_id FROM institution_members WHERE user_id = :userId)))",
        { mooc: CourseType.MOOC, spoc: CourseType.SPOC, userId }
      );

      const courses = await queryBuilder
        .orderBy("course.created_at", "DESC")
        .getMany();

      // CRITICAL FIX: Clean all courses before returning
      const cleanedCourses = courses.map(course =>
        EnhancedCourseController.cleanCourseData(course)
      );

      console.log(`✅ [getCoursesByCategory] Fetched and cleaned ${cleanedCourses.length} courses`);

      res.json({
        success: true,
        data: cleanedCourses,
      });
    } catch (error: any) {
      console.error("❌ Get courses by category error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch courses",
        error: error.message,
      });
    }
  }

  // ==================== FIX: SEARCH COURSES ====================
  static async searchCourses(req: Request, res: Response) {
    try {
      const {
        q,
        type,
        level,
        category,
        institution,
        minPrice,
        maxPrice,
        duration,
        page = 1,
        limit = 20,
        sortBy = "relevance",
      } = req.query;

      console.log("🔍 [searchCourses] Searching courses with query:", q);

      const courseRepo = dbConnection.getRepository(Course);
      const queryBuilder = courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .leftJoinAndSelect("course.institution", "institution")
        .leftJoinAndSelect("course.course_category", "course_category")
        .leftJoinAndSelect("course.modules", "modules")
        .leftJoinAndSelect("modules.lessons", "lessons")
        .where("course.status = :status", { status: "PUBLISHED" });

      // Search query
      if (q) {
        queryBuilder.andWhere(
          "(course.title ILIKE :q OR course.description ILIKE :q OR course.tags::text ILIKE :q)",
          { q: `%${q}%` }
        );
      }

      // Filters
      if (type) {
        queryBuilder.andWhere("course.course_type = :type", { type });
      }

      if (level) {
        queryBuilder.andWhere("course.level = :level", { level });
      }

      if (category) {
        queryBuilder.andWhere("course.category_id = :category", { category });
      }

      if (institution) {
        queryBuilder.andWhere("course.institution_id = :institution", { institution });
      }

      if (minPrice) {
        queryBuilder.andWhere("course.price >= :minPrice", { minPrice: Number(minPrice) });
      }

      if (maxPrice) {
        queryBuilder.andWhere("course.price <= :maxPrice", { maxPrice: Number(maxPrice) });
      }

      if (duration) {
        queryBuilder.andWhere("course.duration_minutes <= :duration", { duration: Number(duration) });
      }

      // Sorting
      switch (sortBy) {
        case "price_asc":
          queryBuilder.orderBy("course.price", "ASC");
          break;
        case "price_desc":
          queryBuilder.orderBy("course.price", "DESC");
          break;
        case "rating":
          queryBuilder.orderBy("course.average_rating", "DESC");
          break;
        case "enrollments":
          queryBuilder.orderBy("course.enrollment_count", "DESC");
          break;
        case "recent":
          queryBuilder.orderBy("course.created_at", "DESC");
          break;
        default:
          queryBuilder.orderBy("course.created_at", "DESC");
      }

      const total = await queryBuilder.getCount();
      const courses = await queryBuilder
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      // CRITICAL FIX: Clean all courses before returning
      const cleanedCourses = courses.map(course =>
        EnhancedCourseController.cleanCourseData(course)
      );

      console.log(`✅ [searchCourses] Found and cleaned ${cleanedCourses.length} courses`);

      res.json({
        success: true,
        data: {
          courses: cleanedCourses,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Search courses error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to search courses",
        error: error.message,
      });
    }
  }

  // ==================== FIX: GET INSTRUCTOR COURSES ====================
  static async getInstructorCourses(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const { page = 1, limit = 20, status, type } = req.query;

      console.log("👨‍🏫 [getInstructorCourses] Fetching courses for instructor:", userId);

      const courseRepo = dbConnection.getRepository(Course);
      const queryBuilder = courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.modules", "modules")
        .leftJoinAndSelect("modules.lessons", "lessons")
        .where("course.instructor_id = :userId", { userId })
        .orWhere("course.id IN (SELECT course_id FROM course_instructors WHERE instructor_id = :userId)", { userId });

      if (status) {
        queryBuilder.andWhere("course.status = :status", { status });
      }

      if (type) {
        queryBuilder.andWhere("course.course_type = :type", { type });
      }

      const total = await queryBuilder.getCount();
      const courses = await queryBuilder
        .orderBy("course.created_at", "DESC")
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      // CRITICAL FIX: Clean all courses before returning
      const cleanedCourses = courses.map(course =>
        EnhancedCourseController.cleanCourseData(course)
      );

      console.log(`✅ [getInstructorCourses] Fetched and cleaned ${cleanedCourses.length} courses`);

      res.json({
        success: true,
        data: {
          courses: cleanedCourses,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Get instructor courses error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch instructor courses",
        error: error.message,
      });
    }
  }

  // ==================== FIX: GET COURSE CURRICULUM ====================
  static async getCourseCurriculum(req: Request, res: Response) {
    try {
      const { id } = req.params;

      console.log("📖 [getCourseCurriculum] Fetching curriculum for course:", id);

      const courseRepo = dbConnection.getRepository(Course);
      const course = await courseRepo
        .createQueryBuilder("course")
        .where("course.id = :id", { id })
        .leftJoinAndSelect("course.modules", "modules")
        .leftJoinAndSelect("modules.lessons", "lessons")
        .leftJoinAndSelect("lessons.assessments", "assessments")
        .leftJoinAndSelect("modules.final_assessment", "final_assessment")
        .orderBy("modules.order_index", "ASC")
        .addOrderBy("lessons.order_index", "ASC")
        .getOne();

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // CRITICAL FIX: Clean course data before returning
      const cleanedCourse = EnhancedCourseController.cleanCourseData(course);

      console.log("✅ [getCourseCurriculum] Curriculum fetched and cleaned successfully");

      res.json({
        success: true,
        data: cleanedCourse,
      });
    } catch (error: any) {
      console.error("❌ Get course curriculum error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch course curriculum",
        error: error.message,
      });
    }
  }



  static async getCourseAnalytics(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const userRepo = dbConnection.getRepository(User);
      const lessonProgressRepo = dbConnection.getRepository(LessonProgress);
      const assessmentRepo = dbConnection.getRepository(Assessment);
      const reviewRepo = dbConnection.getRepository(Review);

      const course = await courseRepo.findOne({
        where: { id },
        relations: ["modules", "modules.lessons", "instructor"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Check permissions
      const user = await userRepo.findOne({ where: { id: userId } });
      const hasAccess = 
        user?.bwenge_role === "SYSTEM_ADMIN" ||
        (user?.bwenge_role === "INSTITUTION_ADMIN" && 
         course.institution_id === user.primary_institution_id) ||
        course.instructor_id === userId;

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view analytics for this course",
        });
      }

      // Get all enrollments for this course
      const enrollments = await enrollmentRepo.find({
        where: { course_id: id },
        relations: ["user", "lesson_progress"],
      });

      // Enrollment Statistics
      const total_enrollments = enrollments.length;
      const active_enrollments = enrollments.filter(e => e.status === "ACTIVE").length;
      const completed_enrollments = enrollments.filter(e => e.status === "COMPLETED").length;
      const dropped_enrollments = enrollments.filter(e => e.status === "DROPPED").length;
      const pending_enrollments = enrollments.filter(e => e.status === "PENDING").length;

      const completion_rate = total_enrollments > 0 
        ? completed_enrollments / total_enrollments 
        : 0;

      const retention_rate = total_enrollments > 0
        ? (active_enrollments + completed_enrollments) / total_enrollments
        : 0;

      // Progress Statistics
      const progressPercentages = enrollments.map(e => e.progress_percentage);
      const average_progress = progressPercentages.length > 0
        ? progressPercentages.reduce((a, b) => a + b, 0) / progressPercentages.length
        : 0;

      // Median progress
      const sortedProgress = [...progressPercentages].sort((a, b) => a - b);
      const median_progress = sortedProgress.length > 0
        ? sortedProgress.length % 2 === 0
          ? (sortedProgress[sortedProgress.length / 2 - 1] + sortedProgress[sortedProgress.length / 2]) / 2
          : sortedProgress[Math.floor(sortedProgress.length / 2)]
        : 0;

      const students_completed = enrollments.filter(e => e.status === "COMPLETED").length;
      const students_in_progress = enrollments.filter(e => 
        e.status === "ACTIVE" && e.progress_percentage > 0 && e.progress_percentage < 100
      ).length;
      const students_not_started = enrollments.filter(e => 
        e.status === "ACTIVE" && e.progress_percentage === 0
      ).length;

      // Calculate average completion time
      const completedEnrollments = enrollments.filter(e => 
        e.status === "COMPLETED" && e.completion_date && e.enrolled_at
      );
      const completionDays = completedEnrollments.map(e => {
        const diffTime = Math.abs(e.completion_date!.getTime() - e.enrolled_at.getTime());
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      });
      const average_completion_days = completionDays.length > 0
        ? completionDays.reduce((a, b) => a + b, 0) / completionDays.length
        : 0;

      // Lesson completion rate
      const totalLessons = course.modules?.reduce((sum, m) => sum + (m.lessons?.length || 0), 0) || 0;
      const totalCompletedLessons = enrollments.reduce((sum, e) => sum + (e.completed_lessons || 0), 0);
      const totalPossibleCompletions = total_enrollments * totalLessons;
      const lesson_completion_rate = totalPossibleCompletions > 0
        ? totalCompletedLessons / totalPossibleCompletions
        : 0;

      // Engagement Statistics
      const total_time_spent_minutes = enrollments.reduce((sum, e) => sum + (e.total_time_spent_minutes || 0), 0);
      const average_time_spent_minutes = total_enrollments > 0
        ? total_time_spent_minutes / total_enrollments
        : 0;
      const total_time_spent_hours = total_time_spent_minutes / 60;

      // Active users (last 7/30 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const daily_active_users = enrollments.filter(e => 
        e.last_accessed && e.last_accessed >= sevenDaysAgo
      ).length;

      const weekly_active_users = enrollments.filter(e => 
        e.last_accessed && e.last_accessed >= sevenDaysAgo
      ).length;

      const monthly_active_users = enrollments.filter(e => 
        e.last_accessed && e.last_accessed >= thirtyDaysAgo
      ).length;

      // Average sessions per user (approximated by last accessed updates)
      const totalSessions = enrollments.reduce((sum, e) => sum + (e.lesson_progress?.length || 0), 0);
      const average_sessions_per_user = total_enrollments > 0
        ? totalSessions / total_enrollments
        : 0;

      // Assessment Statistics
      const assessments = await assessmentRepo.find({
        where: { course_id: id },
      });

      let total_assessments_taken = 0;
      let assessments_passed = 0;
      let assessments_failed = 0;
      let total_scores = 0;
      let total_attempts = 0;

      // This would need an assessment_attempts table in a real implementation
      // For now, using mock data
      const assessment_stats = {
        average_score: 78.5,
      pass_rate: 0.82,
      total_assessments_taken: 1250,
      assessments_passed: 1025,
      assessments_failed: 225,
      average_attempts: 1.3,
    };

    // Rating Statistics
    const reviews = await reviewRepo.find({
      where: { course_id: id },
    });

    const total_reviews = reviews.length;
    const average_rating = total_reviews > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / total_reviews
      : 0;

    const rating_distribution = [1, 2, 3, 4, 5].map(stars => ({
      stars,
      count: reviews.filter(r => Math.floor(r.rating) === stars).length,
    }));

    // Content Statistics
    const total_modules = course.modules?.length || 0;
    const total_lessons = course.modules?.reduce((sum, m) => sum + (m.lessons?.length || 0), 0) || 0;
    const total_videos = course.modules?.reduce((sum, m) => 
      sum + (m.lessons?.filter(l => l.type === "VIDEO").length || 0), 0
    ) || 0;
    const total_quizzes = course.modules?.reduce((sum, m) => 
      sum + (m.lessons?.filter(l => l.type === "QUIZ" || l.type === "ASSIGNMENT").length || 0), 0
    ) || 0;
    const total_resources = course.modules?.reduce((sum, m) => 
      sum + (m.lessons?.reduce((lsum, l) => lsum + (l.resources?.length || 0), 0) || 0), 0
    ) || 0;

    // Daily Enrollments (last 30 days)
    const thirtyDaysAgoDate = new Date();
    thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);

    const daily_enrollments = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const count = enrollments.filter(e => 
        e.enrolled_at >= date && e.enrolled_at < nextDate
      ).length;

      daily_enrollments.push({
        date: format(date, "MMM d"),
        count,
      });
    }
    daily_enrollments.reverse();

    // Top Students
    const top_students = enrollments
      .filter(e => e.user && e.progress_percentage > 0)
      .sort((a, b) => b.progress_percentage - a.progress_percentage)
      .slice(0, 10)
      .map(e => ({
        user_id: e.user.id,
        user_name: `${e.user.first_name || ''} ${e.user.last_name || ''}`.trim() || e.user.email,
        user_email: e.user.email,
        progress_percentage: e.progress_percentage,
        time_spent_minutes: e.total_time_spent_minutes || 0,
        score: e.final_score || 0,
      }));

    res.json({
      success: true,
      data: {
        course_id: course.id,
        course_title: course.title,
        course_type: course.course_type,
        status: course.status,
        created_at: course.created_at,
        published_at: course.published_at,
        
        enrollment_stats: {
          total_enrollments,
          active_enrollments,
          completed_enrollments,
          dropped_enrollments,
          pending_enrollments,
          completion_rate,
          retention_rate,
        },
        
        progress_stats: {
          average_progress,
          median_progress,
          students_completed,
          students_in_progress,
          students_not_started,
          average_completion_days,
          lesson_completion_rate,
        },
        
        engagement_stats: {
          average_time_spent_minutes,
          total_time_spent_hours,
          daily_active_users,
          weekly_active_users,
          monthly_active_users,
          average_sessions_per_user,
        },
        
        assessment_stats: assessment_stats,
        
        rating_stats: {
          average_rating,
          total_reviews,
          rating_distribution,
        },
        
        content_stats: {
          total_modules,
          total_lessons,
          total_videos,
          total_quizzes,
          total_resources,
          total_duration_minutes: course.duration_minutes || 0,
        },
        
        daily_enrollments,
        top_students,
      },
    });
  } catch (error: any) {
    console.error("❌ Get course analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch course analytics",
      error: error.message,
    });
  }
}

static async exportCourseAnalytics(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
      });
    }

    const enrollmentRepo = dbConnection.getRepository(Enrollment);

    const enrollments = await enrollmentRepo.find({
      where: { course_id: id },
      relations: ["user", "course"],
      order: { enrolled_at: "DESC" },
    });

    const headers = [
      'Student ID',
      'Student Email',
      'Student Name',
      'Enrolled Date',
      'Status',
      'Progress %',
      'Time Spent (min)',
      'Completed Lessons',
      'Last Accessed',
      'Completion Date',
      'Final Score',
      'Certificate Issued',
    ];

    const rows = enrollments.map(e => [
      e.user.id,
      e.user.email,
      `${e.user.first_name || ''} ${e.user.last_name || ''}`.trim(),
      format(e.enrolled_at, 'yyyy-MM-dd'),
      e.status,
      e.progress_percentage,
      e.total_time_spent_minutes || 0,
      e.completed_lessons || 0,
      e.last_accessed ? format(e.last_accessed, 'yyyy-MM-dd') : '',
      e.completion_date ? format(e.completion_date, 'yyyy-MM-dd') : '',
      e.final_score || '',
      e.certificate_issued ? 'Yes' : 'No',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=course_analytics_${id}_${format(new Date(), 'yyyy-MM-dd')}.csv`);

    return res.send(csvContent);
  } catch (error: any) {
    console.error("❌ Export course analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to export course analytics",
      error: error.message,
    });
  }
}

}