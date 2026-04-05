// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Course, CourseType, CourseStatus, CourseLevel } from "../database/models/Course";
import { BwengeRole, User } from "../database/models/User";
import { Institution } from "../database/models/Institution";
import { CourseInstructor } from "../database/models/CourseInstructor";
import { Module } from "../database/models/Module";
import { Lesson, LessonType, LessonMaterialRecord } from "../database/models/Lesson";

import { Assessment, AssessmentType } from "../database/models/Assessment";
import { Quiz } from "../database/models/Quiz";
import { Question, QuestionType } from "../database/models/Question";
import { CourseCategory } from "../database/models/CourseCategory";
import { ModuleFinalAssessment, ModuleFinalType } from "../database/models/ModuleFinalAssessment";
import * as crypto from "crypto";
import { sendEmail } from "../services/emailService";
import { UploadToCloud } from "../services/cloudinary";
import { InstitutionMember } from "../database/models/InstitutionMember";
import { NotificationService } from "../services/notificationService";
import { Enrollment, EnrollmentStatus } from "../database/models/Enrollment";
import { LessonProgress } from "../database/models/LessonProgress";
import { emitToCourse, emitToAdminRoom } from "../socket/socketEmitter";
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

function isBlobUrl(url: string | undefined): boolean {
  return typeof url === "string" && url.startsWith("blob:")
}

function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url || isBlobUrl(url)) return undefined
  return url
}

function sanitizeLessonUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("blob:")) {
    return undefined;
  }
  return url;
}

// ==================== HELPER: upload lesson video ====================
async function uploadLessonVideo(
  reqFiles: Record<string, Express.Multer.File[]>,
  modIdx: number,
  lesIdx: number,
  fallbackUrl: string | undefined
): Promise<string | undefined> {
  const tag = `[uploadLessonVideo][mod=${modIdx}][les=${lesIdx}]`;

  // Debug: show all multer field keys
  const allKeys = Object.keys(reqFiles);
  const relevantKeys = allKeys.filter(k => k.includes(`modules[${modIdx}]`) && k.includes(`lessons[${lesIdx}]`));

  const fieldName = `modules[${modIdx}].lessons[${lesIdx}].video`;
  const files = reqFiles[fieldName];


  if (files && Array.isArray(files) && files.length > 0) {
    const file = files[0];
    try {
      const result = await UploadToCloud(file);
      return result.secure_url;
    } catch (err) {
      // Fall through to fallback
    }
  } else {
  }

  // ── FIX: Never persist blob: URLs ─────────────────────────────────────────
  const safe = sanitizeLessonUrl(fallbackUrl);
  if (fallbackUrl && !safe) {
  }
  return safe ?? "";
}

// ==================== HELPER: upload lesson thumbnail ====================
async function uploadLessonThumbnail(
  reqFiles: Record<string, Express.Multer.File[]>,
  modIdx: number,
  lesIdx: number,
  fallbackUrl: string | undefined
): Promise<string | undefined> {
  const tag = `[uploadLessonThumbnail][mod=${modIdx}][les=${lesIdx}]`;

  const fieldName = `modules[${modIdx}].lessons[${lesIdx}].thumbnail`;
  const files = reqFiles[fieldName];


  if (files && Array.isArray(files) && files.length > 0) {
    const file = files[0];
    try {
      const result = await UploadToCloud(file);
      return result.secure_url;
    } catch (err) {
    }
  } else {
  }

  // ── FIX: Never persist blob: URLs ─────────────────────────────────────────
  const safe = sanitizeLessonUrl(fallbackUrl);
  if (fallbackUrl && !safe) {
  }
  return safe;
}

// ==================== HELPER: upload lesson materials ====================
async function uploadLessonMaterials(
  reqFiles: Record<string, Express.Multer.File[]>,
  modIdx: number,
  lesIdx: number,
  existingMaterials: LessonMaterialRecord[] = []
): Promise<LessonMaterialRecord[]> {
  const tag = `[uploadLessonMaterials][mod=${modIdx}][les=${lesIdx}]`;

  // Debug: list all multer fields for this lesson
  const allKeys = Object.keys(reqFiles);
  const lessonKeys = allKeys.filter(k => k.includes(`modules[${modIdx}]`) && k.includes(`lessons[${lesIdx}]`));

  const uploaded: LessonMaterialRecord[] = [];
  let matIdx = 0;
  let foundAny = false;

  // ── Pattern 1: indexed slots modules[M].lessons[L].materials[N] ──────────
  // Multer is configured to accept these in generateLessonVideoFields()
  while (true) {
    const fieldName = `modules[${modIdx}].lessons[${lesIdx}].materials[${matIdx}]`;
    const files = reqFiles[fieldName];

    if (!files || !Array.isArray(files) || files.length === 0) {
      break;
    }

    foundAny = true;

    for (const file of files) {
      try {
        const result = await UploadToCloud(file);
        const record: LessonMaterialRecord = {
          title: file.originalname,
          url: result.secure_url,
          public_id: result.public_id,
          type: file.mimetype,
          size_bytes: file.size,
          original_name: file.originalname,
        };
        uploaded.push(record);
      } catch (err) {
      }
    }
    matIdx++;
  }

  // ── Pattern 2: flat (non-indexed) field modules[M].lessons[L].materials ──
  // Fallback for multipart libraries that send multiple files under one key
  const flatField = `modules[${modIdx}].lessons[${lesIdx}].materials`;
  const flatFiles = reqFiles[flatField];
  if (flatFiles && Array.isArray(flatFiles) && flatFiles.length > 0) {
    foundAny = true;
    for (let fi = 0; fi < flatFiles.length; fi++) {
      const file = flatFiles[fi];
      try {
        const result = await UploadToCloud(file);
        const record: LessonMaterialRecord = {
          title: file.originalname,
          url: result.secure_url,
          public_id: result.public_id,
          type: file.mimetype,
          size_bytes: file.size,
          original_name: file.originalname,
        };
        uploaded.push(record);
      } catch (err) {
      }
    }
  }

  if (!foundAny) {
  }

  // Merge: keep existing (already-persisted) materials + newly uploaded ones
  const merged = [...existingMaterials, ...uploaded];
  return merged;
}

export class EnhancedCourseController {

static async createCourse(req: Request, res: Response) {
  try {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }


    // ==================== PARSE REQUEST BODY ====================
    let coursePayload: any = {};

    if (req.body.title) {
      coursePayload = req.body;
    } else if (typeof req.body === "string") {
      try {
        coursePayload = JSON.parse(req.body);
      } catch (e) {
        return res.status(400).json({ success: false, message: "Invalid JSON in request body" });
      }
    }

    // Parse modules if string
    let modules = coursePayload.modules;
    if (typeof modules === "string") {
      try { modules = JSON.parse(modules); }
      catch (e) { modules = []; }
    }

    // Parse tags if string
    let tags = coursePayload.tags;
    if (typeof tags === "string") {
      try { tags = JSON.parse(tags); }
      catch (e) { tags = []; }
    }

    // Debug module structure
    if (modules && Array.isArray(modules)) {
      modules.forEach((mod: any, idx: number) => {
        if (mod.final_assessment || mod.finalAssessment) {
          const finalData = mod.final_assessment || mod.finalAssessment;
        }
      });
    }

    const {
      title, description, short_description, thumbnail_url, category_id, category_name,
      level, price, duration_minutes, requires_approval, max_enrollments, is_institution_wide,
      language, requirements, what_you_will_learn, is_certificate_available, course_type,
      institution_id, instructor_id: requestInstructorId, status,
    } = coursePayload;

    // ==================== VALIDATION ====================
    if (!title || !description) {
      return res.status(400).json({ success: false, message: "Title and description are required" });
    }
    if (!course_type || !Object.values(CourseType).includes(course_type)) {
      return res.status(400).json({ success: false, message: "Valid course type (SPOC or MOOC) is required" });
    }

    // ==================== REPOSITORIES ====================
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
    if (!user) return res.status(404).json({ success: false, message: "User not found" });


    // ==================== DETERMINE INSTITUTION ID ====================
    let finalInstitutionId: string | null = null;
    let institution: Institution | null = null;

    if (user.bwenge_role === BwengeRole.INSTITUTION_ADMIN) {
      if (!user.primary_institution_id) {
        return res.status(400).json({ success: false, message: "Your account is not associated with an institution" });
      }
      finalInstitutionId = user.primary_institution_id;
      institution = await institutionRepo.findOne({ where: { id: finalInstitutionId } });
      if (!institution) return res.status(404).json({ success: false, message: "Your institution was not found in the database" });
    } else if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN) {
      if (institution_id) {
        finalInstitutionId = institution_id;
        institution = await institutionRepo.findOne({ where: { id: finalInstitutionId } });
        if (!institution) return res.status(404).json({ success: false, message: "Institution not found" });
      } else if (course_type === CourseType.SPOC) {
        return res.status(400).json({ success: false, message: "Institution ID is required for SPOC courses" });
      } else {
        finalInstitutionId = null;
      }
    } else {
      if (institution_id) {
        if (user.institution_ids?.includes(institution_id) || user.primary_institution_id === institution_id) {
          finalInstitutionId = institution_id;
          institution = await institutionRepo.findOne({ where: { id: finalInstitutionId } });
          if (!institution) return res.status(404).json({ success: false, message: "Institution not found" });
        } else {
          return res.status(403).json({ success: false, message: "You don't have access to this institution" });
        }
      } else if (user.primary_institution_id) {
        finalInstitutionId = user.primary_institution_id;
        institution = await institutionRepo.findOne({ where: { id: finalInstitutionId } });
      }
    }


    // ==================== DETERMINE INSTRUCTOR ID ====================
    let finalInstructorId = userId;
    let createdByInstitutionAdminId = null;

    if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN) {
      if (requestInstructorId) {
        const assignedInstructor = await userRepo.findOne({ where: { id: requestInstructorId } });
        if (assignedInstructor) { finalInstructorId = requestInstructorId; }
      }
    } else if (user.bwenge_role === BwengeRole.INSTITUTION_ADMIN) {
      createdByInstitutionAdminId = userId;
      if (!requestInstructorId) {
        finalInstructorId = userId;
      } else {
        const assignedInstructor = await userRepo.findOne({ where: { id: requestInstructorId } });
        if (assignedInstructor && assignedInstructor.institution_ids?.includes(user.primary_institution_id || "")) {
          finalInstructorId = requestInstructorId;
        } else {
          return res.status(403).json({ success: false, message: "Can only assign instructors from your institution" });
        }
      }
    }


    // ==================== HANDLE CATEGORY ====================
    let category = null;
    if (category_id) {
      category = await categoryRepo.findOne({ where: { id: category_id } });
    } else if (category_name) {
      const whereClause: any = { name: category_name };
      if (finalInstitutionId) whereClause.institution_id = finalInstitutionId;
      category = await categoryRepo.findOne({ where: whereClause });
      if (!category) {
        category = categoryRepo.create({ name: category_name, institution_id: finalInstitutionId, is_active: true, order_index: 0 });
        await categoryRepo.save(category);
      }
    }

    // ==================== HANDLE COURSE THUMBNAIL ====================
    let thumbnailUrl = thumbnail_url;

    if (req.files) {
      let thumbnailFile = null;
      if (req.file) { thumbnailFile = req.file; }
      else if (req.files["thumbnail"]?.[0]) { thumbnailFile = req.files["thumbnail"][0]; }
      else if (req.files["thumbnail_url"]?.[0]) { thumbnailFile = req.files["thumbnail_url"][0]; }

      if (thumbnailFile) {
        try {
          const uploadResult = await UploadToCloud(thumbnailFile);
          thumbnailUrl = uploadResult.secure_url;
        } catch (uploadError) {
        }
      }
    }


    // ==================== CREATE COURSE ====================
    const isSPOC = course_type === CourseType.SPOC;
    const isMOOC = course_type === CourseType.MOOC;

    let courseStatus = CourseStatus.DRAFT;
    if (status && Object.values(CourseStatus).includes(status as CourseStatus)) {
      if (status === CourseStatus.PUBLISHED) {
        if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN || user.bwenge_role === BwengeRole.INSTITUTION_ADMIN) {
          courseStatus = CourseStatus.PUBLISHED;
        }
      } else {
        courseStatus = status as CourseStatus;
      }
    }

    const requestedDuration = duration_minutes || 0;
    const certificateAvailable = is_certificate_available !== undefined ? is_certificate_available : true;

    const courseData: any = {
      title, description, short_description,
      thumbnail_url: thumbnailUrl,
      institution_id: finalInstitutionId,
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

    if (courseStatus === CourseStatus.PUBLISHED) courseData.published_at = new Date();


    const course = courseRepo.create(courseData);
    const savedCourse = await courseRepo.save(course);


    // ==================== PROCESS MODULES ====================
    let totalLessons = 0;
    let totalDuration = 0;

    if (modules && Array.isArray(modules) && modules.length > 0) {

      for (const [modIndex, moduleData] of modules.entries()) {

        const module = moduleRepo.create({
          course_id: course.id,
          title: moduleData.title,
          description: moduleData.description,
          order_index: moduleData.order_index || moduleData.order || modIndex + 1,
          estimated_duration_hours: moduleData.estimated_duration_hours || 0,
          is_published: false,
        });
        await moduleRepo.save(module);

        // ==================== PROCESS LESSONS ====================
        if (moduleData.lessons && Array.isArray(moduleData.lessons)) {
          for (const [lesIndex, lessonData] of moduleData.lessons.entries()) {

            // --- VIDEO ---
            // FIX: Strip blob: URLs from payload before using as fallback.
            // The frontend sends video_url: "blob:http://..." when a local file is selected
            // but not yet uploaded. We must never persist that URL to the database.
            const payloadVideoUrl = sanitizeLessonUrl(lessonData.video_url || lessonData.videoUrl);
            const videoUrl = await uploadLessonVideo(
              req.files as any || {},
              modIndex, lesIndex,
              payloadVideoUrl
            );

            // --- THUMBNAIL ---
            // FIX: Same blob: URL stripping for thumbnail.
            const payloadThumbnailUrl = sanitizeLessonUrl(lessonData.thumbnail_url);
            const lessonThumbnail = await uploadLessonThumbnail(
              req.files as any || {},
              modIndex, lesIndex,
              payloadThumbnailUrl
            );

            // --- RESOURCES (existing link-based) ---
            let resourcesJson = lessonData.resources || [];
            if (req.files) {
              const resourceFieldName = `modules[${modIndex}].lessons[${lesIndex}].resources`;
              const resourceFiles = (req.files as any)[resourceFieldName];
              if (resourceFiles && Array.isArray(resourceFiles)) {
                for (const file of resourceFiles) {
                  try {
                    const uploadResult = await UploadToCloud(file);
                    resourcesJson.push({
                      title: file.originalname,
                      url: uploadResult.secure_url,
                      type: file.mimetype,
                      public_id: uploadResult.public_id
                    });
                  } catch (error) {
                  }
                }
              }
            }

            // --- LESSON MATERIALS ---
            // Merge persisted materials from payload with newly uploaded ones.
            // existingMaterials are already-saved Cloudinary records sent back by the frontend.
            // uploadLessonMaterials will additionally scan req.files for
            // modules[M].lessons[L].materials[N] fields registered in multer.ts.
            const persistedMaterials: LessonMaterialRecord[] = Array.isArray(lessonData.lesson_materials)
              ? lessonData.lesson_materials
              : [];
            const lessonMaterials = await uploadLessonMaterials(
              req.files as any || {},
              modIndex, lesIndex,
              persistedMaterials
            );

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
              lesson_materials: lessonMaterials,
            });
            await lessonRepo.save(lesson);

            totalLessons++;
            totalDuration += lesson.duration_minutes;

            // ==================== LESSON ASSESSMENTS ====================
            if (lessonData.assessments && Array.isArray(lessonData.assessments)) {
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
                    const correctAnswer = EnhancedCourseController.normalizeCorrectAnswer(questionData.correct_answer || questionData.correctAnswer, questionType);
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
                    const correctAnswer = EnhancedCourseController.normalizeCorrectAnswer(questionData.correct_answer || questionData.correctAnswer, questionType);
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
              }
            }
          }
        }

        // ==================== MODULE FINAL ASSESSMENT ====================
        if (moduleData.final_assessment || moduleData.finalAssessment) {
          const finalData = moduleData.final_assessment || moduleData.finalAssessment;

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
            let assessmentType = AssessmentType.EXAM;
            if (finalData.type === "ASSIGNMENT") assessmentType = AssessmentType.ASSIGNMENT;
            else if (finalData.type === "QUIZ") assessmentType = AssessmentType.QUIZ;
            else if (finalData.type === "PROJECT") assessmentType = AssessmentType.PROJECT;

            const finalAssessment = assessmentRepo.create({
              course_id: course.id,
              module_id: module.id,
              title: finalData.title,
              description: finalData.description || finalData.instructions || "",
              type: assessmentType,
              questions: [],
              passing_score: finalData.passing_score || finalData.passingScore || 70,
              time_limit_minutes: finalData.time_limit_minutes || finalData.timeLimit,
              max_attempts: finalData.max_attempts || 2,
              is_published: false,
              is_final_assessment: true,
              is_module_final: true,
            });

            const finalQuestions: any[] = [];
            for (const [qIdx, questionData] of finalData.questions.entries()) {
              const questionType = EnhancedCourseController.normalizeQuestionType(questionData.type);
              const correctAnswer = EnhancedCourseController.normalizeCorrectAnswer(questionData.correct_answer || questionData.correctAnswer, questionType);
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
          }

          await moduleFinalRepo.save(moduleFinal);
        }
      }
    }

    // ==================== UPDATE COURSE TOTALS ====================
    course.total_lessons = totalLessons;
    if (totalDuration > 0) course.duration_minutes = totalDuration;
    await courseRepo.save(course);

    // ==================== EMAIL NOTIFICATION ====================
    try {
      const courseTypeName = isSPOC ? "SPOC" : "MOOC";
      await sendEmail({
        to: user.email,
        subject: `${courseTypeName} Course Created: ${course.title}`,
        html: `
          <h2>Course Created Successfully</h2>
          <p>Your ${courseTypeName} course <strong>${course.title}</strong> has been created.</p>
          ${institution ? `<p><strong>Institution:</strong> ${institution.name}</p>` : ""}
          <p><strong>Total Modules:</strong> ${modules?.length || 0}</p>
          <p><strong>Total Lessons:</strong> ${totalLessons}</p>
          <p><strong>Status:</strong> ${courseStatus}</p>
        `,
      });
    } catch (emailError) {
    }

    // ==================== FETCH COMPLETE COURSE ====================
    const relations = [
      "instructor", "created_by_admin", "course_category",
      "modules", "modules.lessons", "modules.lessons.assessments",
      "modules.lessons.quizzes", "modules.lessons.quizzes.questions",
      "modules.final_assessment", "modules.final_assessment.assessment",
    ];
    if (finalInstitutionId) relations.splice(2, 0, "institution");

    const completeCourse = await courseRepo.findOne({ where: { id: course.id }, relations });


    res.status(201).json({
      success: true,
      message: `${isSPOC ? "SPOC" : "MOOC"} course created successfully`,
      data: completeCourse,
      summary: {
        course_id: course.id,
        course_type: course.course_type,
        instructor_id: course.instructor_id,
        created_by_institution_admin_id: course.created_by_institution_admin_id,
        institution_id: course.institution_id,
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
    res.status(500).json({
      success: false,
      message: "Failed to create course",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
}


// Add this method to EnhancedCourseController class

/**
 * Assign a public course to an institution by COPYING the full course.
 *
 * Behaviour:
 *  - The original course (no institution_id) is kept 100% intact — its type
 *    (MOOC or SPOC), content and public status are never touched.
 *  - A complete deep-copy (course + modules + lessons + assessments + quizzes
 *    + questions + module-final-assessments + course-instructors) is created
 *    and linked to the target institution.
 *  - Only the copy receives the new institution_id; everything else mirrors the
 *    original so no content is skipped.
 */
static async assignCourseToInstitution(req: Request, res: Response) {
  try {
    const { courseId, institutionId } = req.params;
    const userId = req.user?.userId || req.user?.id;

    // ==================== REPOSITORIES ====================
    const courseRepo           = dbConnection.getRepository(Course);
    const institutionRepo      = dbConnection.getRepository(Institution);
    const userRepo             = dbConnection.getRepository(User);
    const memberRepo           = dbConnection.getRepository(InstitutionMember);
    const moduleRepo           = dbConnection.getRepository(Module);
    const lessonRepo           = dbConnection.getRepository(Lesson);
    const assessmentRepo       = dbConnection.getRepository(Assessment);
    const quizRepo             = dbConnection.getRepository(Quiz);
    const questionRepo         = dbConnection.getRepository(Question);
    const moduleFinalRepo      = dbConnection.getRepository(ModuleFinalAssessment);
    const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

    // ==================== VERIFY COURSE EXISTS (load all content) ====================
    const course = await courseRepo.findOne({
      where: { id: courseId },
      relations: [
        "institution",
        "instructor",
        "modules",
        "modules.lessons",
        "modules.lessons.assessments",
        "modules.lessons.quizzes",
        "modules.lessons.quizzes.questions",
        "modules.final_assessment",
        "modules.final_assessment.assessment",
        "course_instructors",
        "course_instructors.instructor",
      ]
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    // ==================== VERIFY COURSE IS PUBLIC ====================
    if (!course.is_public) {
      return res.status(400).json({
        success: false,
        message: "Only public courses can be assigned to institutions"
      });
    }

    // ==================== ONLY ORIGINAL (NON-INSTITUTION) COURSES CAN BE COPIED ====================
    if (course.institution_id) {
      return res.status(400).json({
        success: false,
        message: `This course already belongs to institution: ${course.institution?.name || course.institution_id}. Only courses that do not belong to any institution can be copied to an institution.`
      });
    }

    // ==================== VERIFY INSTITUTION EXISTS ====================
    const institution = await institutionRepo.findOne({
      where: { id: institutionId }
    });

    if (!institution) {
      return res.status(404).json({
        success: false,
        message: "Institution not found"
      });
    }

    // ==================== CHECK USER PERMISSIONS ====================
    const user = await userRepo.findOne({ where: { id: userId } });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    let hasPermission = false;

    if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN) {
      hasPermission = true;
    } else if (user.bwenge_role === BwengeRole.INSTITUTION_ADMIN) {
      const isMember = await memberRepo.findOne({
        where: {
          institution_id: institutionId,
          user_id: userId,
          role: InstitutionMemberRole.ADMIN,
          is_active: true
        }
      });
      if (isMember) hasPermission = true;
    }

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to assign courses to this institution"
      });
    }

    // ==================== DEEP-COPY COURSE TO INSTITUTION ====================
    // Step 1: Create the new course (all fields copied, new UUID, institution_id set)
    const newCourse = courseRepo.create({
      title: course.title,
      description: course.description,
      short_description: course.short_description,
      thumbnail_url: course.thumbnail_url,
      category: course.category,
      tags: course.tags ? [...course.tags] : [],
      instructor_id: course.instructor_id,
      created_by_institution_admin_id: course.created_by_institution_admin_id,
      institution_id: institutionId,            // <-- key difference: linked to institution
      category_id: course.category_id,
      course_type: course.course_type,          // MOOC or SPOC — kept intact
      is_public: course.is_public,              // preserve original public flag
      access_codes: course.access_codes ? [...course.access_codes] : [],
      requires_approval: course.requires_approval,
      max_enrollments: course.max_enrollments,
      enrollment_start_date: course.enrollment_start_date,
      enrollment_end_date: course.enrollment_end_date,
      is_institution_wide: course.is_institution_wide,
      level: course.level,
      status: course.status,
      enrollment_count: 0,          // fresh copy starts with zero stats
      completion_rate: 0,
      average_rating: 0,
      total_reviews: 0,
      duration_minutes: course.duration_minutes,
      total_lessons: course.total_lessons,
      price: course.price,
      is_certificate_available: course.is_certificate_available,
      requirements: course.requirements,
      what_you_will_learn: course.what_you_will_learn,
      language: course.language,
    });
    const savedNewCourse = await courseRepo.save(newCourse);

    // oldAssessmentId -> newAssessmentId — needed to wire ModuleFinalAssessment
    const assessmentIdMap = new Map<string, string>();

    // Step 2: Copy modules → lessons → assessments / quizzes / questions
    for (const module of (course.modules || [])) {
      const newModule = moduleRepo.create({
        course_id: savedNewCourse.id,
        title: module.title,
        description: module.description,
        order_index: module.order_index,
        is_published: module.is_published,
        estimated_duration_hours: module.estimated_duration_hours,
      });
      const savedModule = await moduleRepo.save(newModule);

      for (const lesson of (module.lessons || [])) {
        const newLesson = lessonRepo.create({
          course_id: savedNewCourse.id,
          module_id: savedModule.id,
          title: lesson.title,
          content: lesson.content,
          video_url: lesson.video_url,
          thumbnail_url: lesson.thumbnail_url,
          duration_minutes: lesson.duration_minutes,
          order_index: lesson.order_index,
          type: lesson.type,
          is_published: lesson.is_published,
          is_preview: lesson.is_preview,
          resources: lesson.resources ? [...lesson.resources] : null,
          lesson_materials: lesson.lesson_materials ? [...lesson.lesson_materials] : [],
        });
        const savedLesson = await lessonRepo.save(newLesson);

        // Copy assessments for this lesson
        for (const assessment of (lesson.assessments || [])) {
          const newAssessment = assessmentRepo.create({
            course_id: savedNewCourse.id,
            lesson_id: savedLesson.id,
            module_id: savedModule.id,
            title: assessment.title,
            description: assessment.description,
            type: assessment.type,
            questions: assessment.questions ? [...assessment.questions] : [],
            passing_score: assessment.passing_score,
            max_attempts: assessment.max_attempts,
            time_limit_minutes: assessment.time_limit_minutes,
            is_published: assessment.is_published,
            is_final_assessment: assessment.is_final_assessment,
            is_module_final: assessment.is_module_final,
          });
          const savedAssessment = await assessmentRepo.save(newAssessment);
          assessmentIdMap.set(assessment.id, savedAssessment.id);
        }

        // Copy quizzes for this lesson
        for (const quiz of (lesson.quizzes || [])) {
          const newQuiz = quizRepo.create({
            course_id: savedNewCourse.id,
            lesson_id: savedLesson.id,
            title: quiz.title,
            description: quiz.description,
            passing_score: quiz.passing_score,
            time_limit_minutes: quiz.time_limit_minutes,
            max_attempts: quiz.max_attempts,
            shuffle_questions: quiz.shuffle_questions,
            show_correct_answers: quiz.show_correct_answers,
            is_published: quiz.is_published,
          });
          const savedQuiz = await quizRepo.save(newQuiz);

          // Copy questions for this quiz
          for (const question of (quiz.questions || [])) {
            const newQuestion = questionRepo.create({
              quiz_id: savedQuiz.id,
              question_text: question.question_text,
              question_type: question.question_type,
              options: question.options ? [...question.options] : null,
              correct_answer: question.correct_answer,
              explanation: question.explanation,
              points: question.points,
              order_index: question.order_index,
              image_url: question.image_url,
            });
            await questionRepo.save(newQuestion);
          }
        }
      }

      // Step 3: Copy module final assessment (if any), remapping assessment_id
      if (module.final_assessment) {
        const fa = module.final_assessment;
        const newFinalAssessment = moduleFinalRepo.create({
          module_id: savedModule.id,
          title: fa.title,
          type: fa.type,
          assessment_id: fa.assessment_id
            ? (assessmentIdMap.get(fa.assessment_id) ?? null)
            : null,
          project_instructions: fa.project_instructions,
          passing_score_percentage: fa.passing_score_percentage,
          time_limit_minutes: fa.time_limit_minutes,
          requires_file_submission: fa.requires_file_submission,
        });
        await moduleFinalRepo.save(newFinalAssessment);
      }
    }

    // Step 4: Copy course instructors
    for (const ci of (course.course_instructors || [])) {
      const newCI = courseInstructorRepo.create({
        course_id: savedNewCourse.id,
        instructor_id: ci.instructor_id,
        is_primary_instructor: ci.is_primary_instructor,
        can_grade_assignments: ci.can_grade_assignments,
        can_manage_enrollments: ci.can_manage_enrollments,
        can_edit_course_content: ci.can_edit_course_content,
      });
      await courseInstructorRepo.save(newCI);
    }

    // ==================== FETCH COMPLETE COPY FOR RESPONSE ====================
    const copiedCourse = await courseRepo.findOne({
      where: { id: savedNewCourse.id },
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
        "modules.final_assessment.assessment",
        "course_instructors",
        "course_instructors.instructor",
        "reviews",
        "enrollments"
      ]
    });

    const cleanedCourse = EnhancedCourseController.cleanCourseData(copiedCourse);
    const stats = EnhancedCourseController.calculateCourseStatistics(cleanedCourse);

    res.json({
      success: true,
      message: `Course "${course.title}" has been successfully copied to ${institution.name}. The original course remains available as a public course.`,
      data: {
        ...cleanedCourse,
        institution: {
          id: institution.id,
          name: institution.name,
          type: institution.type,
          logo_url: institution.logo_url
        },
        statistics: stats,
        original_course_id: courseId,           // reference to the untouched original
        copied_course_id: savedNewCourse.id,
        was_public: true,
        now_institution_course: true
      }
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to assign course to institution",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined
    });
  }
}

/**
 * Get public courses available for assignment to institutions
 * Returns courses with is_public=true and no institution assigned
 */
static async getPublicCoursesForAssignment(req: Request, res: Response) {
  try {
    const { page = 1, limit = 20, course_type, status, search } = req.query;
    const userId = req.user?.userId || req.user?.id;


    const courseRepo = dbConnection.getRepository(Course);
    const userRepo = dbConnection.getRepository(User);
    
    // Verify user has permission (SYSTEM_ADMIN or INSTITUTION_ADMIN)
    const user = await userRepo.findOne({ where: { id: userId } });
    
    if (!user || (user.bwenge_role !== BwengeRole.SYSTEM_ADMIN && user.bwenge_role !== BwengeRole.INSTITUTION_ADMIN)) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to view public courses for assignment"
      });
    }

    const queryBuilder = courseRepo
      .createQueryBuilder("course")
      .leftJoinAndSelect("course.instructor", "instructor")
      .leftJoinAndSelect("course.course_category", "course_category")
      .leftJoinAndSelect("course.modules", "modules")
      .leftJoinAndSelect("modules.lessons", "lessons")
      .where("course.is_public = :is_public", { is_public: true })
      .andWhere("course.institution_id IS NULL");

    if (course_type && Object.values(CourseType).includes(course_type as CourseType)) {
      queryBuilder.andWhere("course.course_type = :course_type", { course_type });
    }

    if (status && Object.values(CourseStatus).includes(status as CourseStatus)) {
      queryBuilder.andWhere("course.status = :status", { status });
    }

    if (search) {
      queryBuilder.andWhere(
        "(course.title ILIKE :search OR course.description ILIKE :search OR course.tags::text ILIKE :search)",
        { search: `%${search}%` }
      );
    }

    const total = await queryBuilder.getCount();
    const courses = await queryBuilder
      .orderBy("course.created_at", "DESC")
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit))
      .getMany();

    // Clean courses
    const cleanedCourses = courses.map(course => {
      const cleaned = EnhancedCourseController.cleanCourseData(course);
      const stats = EnhancedCourseController.calculateCourseStatistics(cleaned);
      return {
        ...cleaned,
        statistics: stats,
        is_public_course: true,
        can_be_assigned: true
      };
    });


    res.json({
      success: true,
      data: {
        courses: cleanedCourses,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit))
        }
      }
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch public courses",
      error: error.message
    });
  }
}

static async updateCourse(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id;


    // ==================== PARSE REQUEST BODY ====================
    let coursePayload: any = {};

    if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
      coursePayload = { ...req.body };
      const fieldsToParseAsJSON = ["modules", "tags", "requirements", "what_you_will_learn"];
      for (const field of fieldsToParseAsJSON) {
        if (coursePayload[field] && typeof coursePayload[field] === "string") {
          try { coursePayload[field] = JSON.parse(coursePayload[field]); }
          catch (e) { /* keep as string */ }
        }
      }
    } else if (typeof req.body === "string") {
      try { coursePayload = JSON.parse(req.body); }
      catch (e) {
        return res.status(400).json({ success: false, message: "Invalid JSON in request body" });
      }
    } else {
      return res.status(400).json({ success: false, message: "Invalid request body format" });
    }


    let modules = coursePayload.modules;
    if (typeof modules === "string") {
      try { modules = JSON.parse(modules); } catch (e) { modules = []; }
    }

    let tags = coursePayload.tags;
    if (typeof tags === "string") {
      try { tags = JSON.parse(tags); } catch (e) { tags = []; }
    }

    const {
      title, description, short_description, thumbnail_url,
      category_id, category_name, level, price, duration_minutes,
      requires_approval, max_enrollments, is_institution_wide,
      language, requirements, what_you_will_learn, is_certificate_available, status, course_type,
    } = coursePayload;


    // ==================== REPOSITORIES ====================
    const courseRepo = dbConnection.getRepository(Course);
    const categoryRepo = dbConnection.getRepository(CourseCategory);

    // ==================== FIND EXISTING COURSE ====================
    const course = await courseRepo.findOne({
      where: { id },
      relations: ["modules", "modules.lessons", "modules.final_assessment"],
    });
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });


    // ==================== PERMISSION CHECK ====================
    if (course.instructor_id !== userId && req.user?.bwenge_role !== "SYSTEM_ADMIN") {
      return res.status(403).json({ success: false, message: "You don't have permission to update this course" });
    }

    // ==================== HANDLE COURSE THUMBNAIL ====================
    let finalThumbnailUrl = thumbnail_url || course.thumbnail_url;

    if (req.files) {
      let thumbnailFile = null;
      if (req.file) { thumbnailFile = req.file; }
      else if ((req.files as any)["thumbnail"]?.[0]) { thumbnailFile = (req.files as any)["thumbnail"][0]; }
      else if ((req.files as any)["thumbnail_url"]?.[0]) { thumbnailFile = (req.files as any)["thumbnail_url"][0]; }

      if (thumbnailFile) {
        try {
          const uploadResult = await UploadToCloud(thumbnailFile);
          finalThumbnailUrl = uploadResult.secure_url;
        } catch (uploadError) {
        }
      }
    }

    // ==================== HANDLE CATEGORY ====================
    if (category_id) {
      const category = await categoryRepo.findOne({ where: { id: category_id } });
      if (category) course.category_id = category_id;
    } else if (category_name) {
      let category = await categoryRepo.findOne({ where: { name: category_name, institution_id: course.institution_id || null } });
      if (!category) {
        category = categoryRepo.create({ name: category_name, institution_id: course.institution_id || null, is_active: true, order_index: 0 });
        await categoryRepo.save(category);
      }
      course.category_id = category.id;
    }

    // ==================== UPDATE BASIC FIELDS ====================
    if (title !== undefined) course.title = title;
    if (description !== undefined) course.description = description;
    if (finalThumbnailUrl !== undefined) course.thumbnail_url = finalThumbnailUrl;
    if (short_description !== undefined) course.short_description = short_description;
    if (level !== undefined) course.level = level;
    if (price !== undefined) course.price = price;
    if (duration_minutes !== undefined) course.duration_minutes = duration_minutes;
    if (tags !== undefined) course.tags = tags;
    if (language !== undefined) course.language = language;
    if (requirements !== undefined) course.requirements = requirements;
    if (what_you_will_learn !== undefined) course.what_you_will_learn = what_you_will_learn;
    if (is_certificate_available !== undefined) course.is_certificate_available = is_certificate_available;
    if (status !== undefined) course.status = status;
    if (course_type !== undefined) course.course_type = course_type;

    // ==================== UPDATE SPOC-SPECIFIC FIELDS ====================
    const effectiveCourseType = course_type !== undefined ? course_type : course.course_type;
    if (effectiveCourseType === CourseType.SPOC) {
      if (requires_approval !== undefined) course.requires_approval = requires_approval;
      if (max_enrollments !== undefined) course.max_enrollments = max_enrollments;
      if (is_institution_wide !== undefined) course.is_institution_wide = is_institution_wide;
    }

    await courseRepo.save(course);

    // ==================== UPDATE MODULES WITH FILE UPLOADS ====================
    if (modules && Array.isArray(modules) && modules.length > 0) {
      const cleanedModules = await EnhancedCourseController.cleanModuleData(modules);

      // Process each module's lessons to upload media files.
      // FIX: sanitize blob: URLs before passing as fallback to upload helpers,
      // so they are never written to the database.
      for (const [modIndex, moduleData] of cleanedModules.entries()) {
        if (moduleData.lessons && Array.isArray(moduleData.lessons)) {
          for (const [lesIndex, lessonData] of moduleData.lessons.entries()) {

            // Video — FIX: strip blob: URL from payload before using as fallback
            const payloadVideoUrl = sanitizeLessonUrl(lessonData.video_url);
            lessonData.video_url = await uploadLessonVideo(
              req.files as any || {}, modIndex, lesIndex, payloadVideoUrl
            );

            // Thumbnail — FIX: strip blob: URL from payload before using as fallback
            const payloadThumbnailUrl = sanitizeLessonUrl(lessonData.thumbnail_url);
            lessonData.thumbnail_url = await uploadLessonThumbnail(
              req.files as any || {}, modIndex, lesIndex, payloadThumbnailUrl
            );

            // Materials
            const existingMaterials: LessonMaterialRecord[] = Array.isArray(lessonData.lesson_materials)
              ? lessonData.lesson_materials : [];
            lessonData.lesson_materials = await uploadLessonMaterials(
              req.files as any || {}, modIndex, lesIndex, existingMaterials
            );
          }
        }
      }

      await EnhancedCourseController.updateCourseModulesWithUploads(course.id, cleanedModules, req.files);

      const result = await EnhancedCourseController.calculateCourseTotals(course.id);
      course.total_lessons = result.totalLessons;
      course.duration_minutes = result.totalDuration;
      await courseRepo.save(course);

    }

    // ==================== FETCH UPDATED COURSE ====================
    const relations = [
      "instructor", "course_category",
      "modules", "modules.lessons", "modules.lessons.assessments",
      "modules.lessons.quizzes", "modules.lessons.quizzes.questions",
      "modules.final_assessment", "modules.final_assessment.assessment",
    ];
    if (course.course_type === CourseType.SPOC) relations.splice(1, 0, "institution");

    const updatedCourse = await courseRepo.findOne({ where: { id: course.id }, relations });


    res.json({
      success: true,
      message: `${course.course_type} course updated successfully`,
      data: updatedCourse,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to update course",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
}
  static async getAllCoursesWithFullInfo(req: Request, res: Response) {
    try {
      const { page = 1, limit = 20, course_type, status, category_id, level, search } = req.query;

      const courseRepo = dbConnection.getRepository(Course);
      const queryBuilder = courseRepo
        .createQueryBuilder("course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .leftJoinAndSelect("course.institution", "institution")
        .leftJoinAndSelect("course.course_category", "course_category")
        .leftJoinAndSelect("course.modules", "modules")
        .leftJoinAndSelect("modules.lessons", "lessons")
        .leftJoinAndSelect("lessons.assessments", "lesson_assessments")
        .leftJoinAndSelect("lessons.quizzes", "lesson_quizzes")
        .leftJoinAndSelect("lesson_quizzes.questions", "quiz_questions")
        .leftJoinAndSelect("modules.final_assessment", "module_final_assessment")
        .leftJoinAndSelect("module_final_assessment.assessment", "final_assessment_detail")
        .leftJoinAndSelect("course.course_instructors", "course_instructors")
        .leftJoinAndSelect("course_instructors.instructor", "additional_instructor")
        .leftJoinAndSelect("course.reviews", "reviews")
        .leftJoinAndSelect("reviews.user", "review_user")
        .leftJoinAndSelect("course.enrollments", "enrollments")
        // Only return courses not attached to any institution
        .where("course.institution_id IS NULL");

      if (course_type && Object.values(CourseType).includes(course_type as CourseType)) {
        queryBuilder.andWhere("course.course_type = :course_type", { course_type });
      }
      if (status && Object.values(CourseStatus).includes(status as CourseStatus)) {
        queryBuilder.andWhere("course.status = :status", { status });
      }
      if (category_id) {
        queryBuilder.andWhere("course.category_id = :category_id", { category_id });
      }
      if (level && Object.values(CourseLevel).includes(level as CourseLevel)) {
        queryBuilder.andWhere("course.level = :level", { level });
      }
      if (search) {
        queryBuilder.andWhere(
          "(course.title ILIKE :search OR course.description ILIKE :search OR course.short_description ILIKE :search OR course.tags::text ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      queryBuilder
        .orderBy("course.created_at", "DESC")
        .addOrderBy("modules.order_index", "ASC")
        .addOrderBy("lessons.order_index", "ASC");

      const total = await queryBuilder.getCount();
      const courses = await queryBuilder
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      const enhancedCourses = courses.map((course) => {
        if (course.modules) {
          course.modules = course.modules.sort((a, b) => a.order_index - b.order_index);
          course.modules.forEach(module => {
            if (module.lessons) {
              module.lessons = module.lessons.sort((a, b) => a.order_index - b.order_index);
              // lesson_materials and thumbnail_url are returned as-is from DB (Cloudinary URLs)
              module.lessons.forEach(lesson => {
                if (lesson.quizzes) {
                  lesson.quizzes.forEach(quiz => {
                    if (quiz.questions) quiz.questions = quiz.questions.sort((a, b) => a.order_index - b.order_index);
                  });
                }
              });
            }
          });
        }

        const stats = EnhancedCourseController.calculateCourseStatistics(course);
        return { ...course, statistics: stats, is_public_course: true, institution: null };
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
      res.status(500).json({
        success: false,
        message: "Failed to fetch public courses",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }


  // ==================== GET COURSE DETAILS ====================

  static async getCourseDetails(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;


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
        order: { modules: { order_index: "ASC" } },
      });

      if (!course) {
        return res.status(404).json({ success: false, message: "Course not found" });
      }

      const cleanedCourse = EnhancedCourseController.cleanCourseData(course);

      // ==================== DEDUPLICATE ASSESSMENTS/QUIZZES & LOG MEDIA ====================
      if (cleanedCourse.modules && Array.isArray(cleanedCourse.modules)) {
        cleanedCourse.modules.forEach((module: any) => {
          if (module.lessons && Array.isArray(module.lessons)) {
            module.lessons.forEach((lesson: any) => {

              // Log lesson media for debugging

              // Deduplicate quizzes vs assessments (existing logic preserved)
              if (lesson.assessments && lesson.assessments.length > 0) {
                if (lesson.quizzes && lesson.quizzes.length > 0) {
                  const seenAssessmentTitles = new Set<string>();
                  lesson.assessments.forEach((a: any) => { if (a.title) seenAssessmentTitles.add(a.title.trim().toLowerCase()); });
                  lesson.quizzes = lesson.quizzes.filter((q: any) => q.title && !seenAssessmentTitles.has(q.title.trim().toLowerCase()));
                }
              }

              if (lesson.assessments && lesson.quizzes && lesson.assessments.length > 0 && lesson.quizzes.length > 0) {
                const uniqueEntries = new Map();
                lesson.assessments.forEach((a: any) => { uniqueEntries.set(`${a.title}-${a.description || ""}`, { type: "assessment", data: a }); });
                lesson.quizzes.forEach((q: any) => {
                  const key = `${q.title}-${q.description || ""}`;
                  if (!uniqueEntries.has(key)) uniqueEntries.set(key, { type: "quiz", data: q });
                });
                const filteredAssessments: any[] = [];
                const filteredQuizzes: any[] = [];
                uniqueEntries.forEach((entry) => {
                  if (entry.type === "assessment") filteredAssessments.push(entry.data);
                  else filteredQuizzes.push(entry.data);
                });
                lesson.assessments = filteredAssessments;
                lesson.quizzes = filteredQuizzes;
              }
            });
          }
        });
      }

      // ==================== BUILD INSTITUTION WITH MEMBERS ====================
      let institutionWithMembers: any = null;

      if (cleanedCourse.institution) {
        const rawInstitution: any = cleanedCourse.institution;

        const membersWithFullInfo = (rawInstitution.members || []).map((member: any) => {
          const { user, ...memberFields } = member;
          if (user) {
            const { password_hash, ...safeUserFields } = user;
            return {
              ...memberFields,
              user: {
                id: safeUserFields.id, email: safeUserFields.email, username: safeUserFields.username,
                first_name: safeUserFields.first_name, last_name: safeUserFields.last_name,
                phone_number: safeUserFields.phone_number, profile_picture_url: safeUserFields.profile_picture_url,
                bio: safeUserFields.bio, account_type: safeUserFields.account_type, bwenge_role: safeUserFields.bwenge_role,
                institution_role: safeUserFields.institution_role, is_verified: safeUserFields.is_verified,
                is_active: safeUserFields.is_active, date_joined: safeUserFields.date_joined,
                last_login: safeUserFields.last_login, last_login_bwenge: safeUserFields.last_login_bwenge,
                country: safeUserFields.country, city: safeUserFields.city,
                primary_institution_id: safeUserFields.primary_institution_id,
                institution_ids: safeUserFields.institution_ids, is_institution_member: safeUserFields.is_institution_member,
                social_auth_provider: safeUserFields.social_auth_provider,
                enrolled_courses_count: safeUserFields.enrolled_courses_count,
                completed_courses_count: safeUserFields.completed_courses_count,
                total_learning_hours: safeUserFields.total_learning_hours,
                certificates_earned: safeUserFields.certificates_earned,
                bwenge_profile_completed: safeUserFields.bwenge_profile_completed,
                learning_preferences: safeUserFields.learning_preferences,
                updated_at: safeUserFields.updated_at,
              },
            };
          }
          return { ...memberFields, user: null };
        });

        const roleOrder: Record<string, number> = { ADMIN: 0, CONTENT_CREATOR: 1, INSTRUCTOR: 2, MEMBER: 3 };
        membersWithFullInfo.sort((a: any, b: any) => (roleOrder[a.role] ?? 99) - (roleOrder[b.role] ?? 99));

        const memberSummary = membersWithFullInfo.reduce((acc: Record<string, number>, m: any) => {
          const role = m.role || "UNKNOWN";
          acc[role] = (acc[role] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        institutionWithMembers = {
          id: rawInstitution.id, name: rawInstitution.name, slug: rawInstitution.slug,
          type: rawInstitution.type, logo_url: rawInstitution.logo_url, description: rawInstitution.description,
          is_active: rawInstitution.is_active, settings: rawInstitution.settings,
          created_at: rawInstitution.created_at, updated_at: rawInstitution.updated_at,
          members: membersWithFullInfo,
          member_summary: {
            total: membersWithFullInfo.length,
            active: membersWithFullInfo.filter((m: any) => m.is_active).length,
            by_role: memberSummary,
          },
        };

      }

      const stats = EnhancedCourseController.calculateCourseStatistics(cleanedCourse);


      res.json({
        success: true,
        data: {
          ...cleanedCourse,
          institution: institutionWithMembers,
          statistics: stats,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch course details",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }








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
    }

    // ✅ NEW: Allow filtering by course_type if provided
    if (course_type && (course_type === 'MOOC' || course_type === 'SPOC')) {
      queryBuilder.andWhere("course.course_type = :course_type", { course_type });
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination and fetch
    const skip = (Number(page) - 1) * Number(limit);
    const courses = await queryBuilder
      .orderBy("course.created_at", "DESC")
      .skip(skip)
      .take(Number(limit))
      .getMany();


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
    res.status(500).json({
      success: false,
      message: "Failed to fetch institution courses",
      error: error.message
    });
  }
}



  private static cleanAndDeduplicateModules(modules: any[]): any[] {

    return modules.map((module, index) => {

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


        // ✅ PRESERVE all final assessment data INCLUDING QUESTIONS REGARDLESS OF TYPE
        cleanedModule.final_assessment = {
          ...finalData,
          // ✅ CRITICAL: Ensure questions array is preserved for ALL types (ASSIGNMENT, ASSESSMENT, etc.)
          questions: (finalData.questions || []).map((q: any, qIndex: number) => ({
            ...q,
            order_index: q.order_index || qIndex + 1
          }))
        };


        if (cleanedModule.final_assessment.questions && cleanedModule.final_assessment.questions.length > 0) {
        } else {
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


      // ✅ DEBUG: Log final assessment questions BEFORE cleaning
      modules.forEach((mod: any, idx: number) => {
        if (mod.final_assessment || mod.finalAssessment) {
          const finalData = mod.final_assessment || mod.finalAssessment;
          if (finalData.questions && finalData.questions.length > 0) {
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


      // ==================== STEP 3: CLEAN AND DEDUPLICATE DATA ====================
      const cleanedModules = EnhancedCourseController.cleanAndDeduplicateModules(modules);

      // ✅ DEBUG: Verify questions AFTER cleaning
      cleanedModules.forEach((mod, idx) => {
        if (mod.final_assessment || mod.finalAssessment) {
          const finalData = mod.final_assessment || mod.finalAssessment;
          if (finalData.questions && finalData.questions.length > 0) {
            finalData.questions.forEach((q: any, qIdx: number) => {
            });
          } else {
          }
        }
      });

      // ==================== STEP 4: USE DATABASE TRANSACTION ====================
      const queryRunner = dbConnection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();


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

          let moduleEntity: Module;

          if (mod.id && !mod.id.toString().startsWith('temp-')) {
            moduleEntity = await moduleRepo.findOne({
              where: { id: mod.id, course_id: id },
              relations: ["lessons", "final_assessment", "final_assessment.assessment"]
            });

            if (moduleEntity) {

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


  if (finalData.questions && Array.isArray(finalData.questions)) {
    finalData.questions.forEach((q: any, qIdx: number) => {
    });
  } else {
  }

  let moduleFinal = await moduleFinalRepo.findOne({
    where: { module_id: moduleEntity.id },
    relations: ['assessment']
  });

  if (moduleFinal) {
    
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
      
      if (moduleFinal.assessment_id && moduleFinal.assessment) {
        
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
        }
      } else {
        
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
        
      }
    } else if (moduleFinal.assessment_id && moduleFinal.assessment && (!finalData.questions || finalData.questions.length === 0)) {
      // If no questions provided but assessment exists, keep it (don't delete)
    }

    await moduleFinalRepo.save(moduleFinal);
    
  } else {
    
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
      
    } else {
    }

    await moduleFinalRepo.save(newModuleFinal);
  }
  
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

        updatedCourse?.modules?.forEach((module, idx) => {
          if (module.final_assessment?.assessment) {
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
      res.status(500).json({
        success: false,
        message: "Failed to fetch course categories",
        error: error.message,
      });
    }
  }



// ==================== HELPER: CLEAN COURSE DATA (DEDUPLICATE RESOURCES AND ASSESSMENTS) ====================
private static cleanCourseData(course: Course): Course {

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

      // Notify institution admins about course publication
      if (course.institution_id) {
        NotificationService.onCoursePublished(
          course.institution_id,
          course.title,
          course.id,
          userId
        ).catch(() => {});
      }

      // ── Real-time: Notify enrolled students and admin dashboards ──────────
      emitToCourse(course.id, "course-published", {
        courseId: course.id,
        courseName: course.title,
      });
      emitToAdminRoom("dashboard-kpi-updated", {
        type: "course-published",
        courseId: course.id,
      });

      res.json({
        success: true,
        message: "Course published successfully",
        data: course,
      });
    } catch (error: any) {
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


      res.json({
        success: true,
        data: cleanedCourses,
      });
    } catch (error: any) {
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


      res.json({
        success: true,
        data: cleanedCourses,
      });
    } catch (error: any) {
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


      res.json({
        success: true,
        data: cleanedCourse,
      });
    } catch (error: any) {
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
    res.status(500).json({
      success: false,
      message: "Failed to export course analytics",
      error: error.message,
    });
  }
}

}