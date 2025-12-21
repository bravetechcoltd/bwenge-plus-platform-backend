// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Assessment } from "../database/models/Assessment";
import { ModuleFinalSubmission } from "../database/models/ModuleFinalSubmission";
import { User } from "../database/models/User";
import { Course } from "../database/models/Course";
import { Enrollment } from "../database/models/Enrollment";
import { UploadToCloud, DeleteFromCloud } from "../services/cloudinary";
import { sendEmail } from "../services/emailService";

export class AssessmentUploadController {
  
  /**
   * POST /api/upload/assessment-file
   * This is the EXACT endpoint your frontend is calling
   */
  static async uploadAssessmentFile(req: Request, res: Response) {
    try {
      console.log("=".repeat(80));
      console.log("📁 [uploadAssessmentFile] Starting file upload");
      console.log("=".repeat(80));
      
      const userId = req.user?.userId || req.user?.id;
      const { assessment_id, course_id, enrollment_id } = req.body;
      
      console.log("📋 [uploadAssessmentFile] Request data:", {
        userId,
        assessment_id,
        course_id,
        enrollment_id,
        hasFile: !!req.file,
        fileInfo: req.file ? {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          fieldname: req.file.fieldname
        } : null
      });

      // ==================== VALIDATION ====================
      if (!userId) {
        console.error("❌ [uploadAssessmentFile] No user ID found");
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      if (!req.file) {
        console.error("❌ [uploadAssessmentFile] No file provided");
        return res.status(400).json({
          success: false,
          message: "Assessment file is required",
        });
      }

      if (!assessment_id) {
        console.error("❌ [uploadAssessmentFile] No assessment ID provided");
        return res.status(400).json({
          success: false,
          message: "Assessment ID is required",
        });
      }

      // ==================== INITIALIZE REPOSITORIES ====================
      const userRepo = dbConnection.getRepository(User);
      const assessmentRepo = dbConnection.getRepository(Assessment);
      const submissionRepo = dbConnection.getRepository(ModuleFinalSubmission);
      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      // ==================== VERIFY USER ====================
      console.log("👤 [uploadAssessmentFile] Verifying user...");
      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        console.error("❌ [uploadAssessmentFile] User not found");
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
      console.log("✅ [uploadAssessmentFile] User verified:", user.email);

      // ==================== VERIFY ASSESSMENT ====================
      console.log("📝 [uploadAssessmentFile] Verifying assessment...");
      const assessment = await assessmentRepo.findOne({
        where: { id: assessment_id },
        relations: ["module", "module.course"],
      });

      if (!assessment) {
        console.error("❌ [uploadAssessmentFile] Assessment not found");
        return res.status(404).json({
          success: false,
          message: "Assessment not found",
        });
      }
      console.log("✅ [uploadAssessmentFile] Assessment found:", assessment.title);

      // ==================== VERIFY ENROLLMENT ====================
      console.log("🎓 [uploadAssessmentFile] Verifying enrollment...");
      let enrollment: Enrollment | null = null;
      
      if (enrollment_id) {
        enrollment = await enrollmentRepo.findOne({
          where: { id: enrollment_id, user_id: userId },
        });
      } else {
        // Try to find enrollment automatically
        enrollment = await enrollmentRepo.findOne({
          where: {
            user_id: userId,
            course_id: assessment.course_id,
            status: "ACTIVE",
          },
        });
      }

      if (!enrollment && course_id) {
        // Try with provided course_id
        enrollment = await enrollmentRepo.findOne({
          where: {
            user_id: userId,
            course_id: course_id,
            status: "ACTIVE",
          },
        });
      }

      if (!enrollment) {
        console.warn("⚠️ [uploadAssessmentFile] No active enrollment found, but proceeding with upload");
      } else {
        console.log("✅ [uploadAssessmentFile] Enrollment verified:", enrollment.id);
      }

      // ==================== UPLOAD TO CLOUDINARY ====================
      console.log("☁️ [uploadAssessmentFile] Uploading to Cloudinary...");
      let uploadResult;
      try {
        // Create a temporary file-like object for Cloudinary
        const tempFile = {
          fieldname: req.file.fieldname,
          originalname: req.file.originalname,
          encoding: req.file.encoding,
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer,
          path: `/${req.file.originalname}`, // Virtual path
        };

        // Upload to Cloudinary with assessment-specific folder
        uploadResult = await UploadToCloud(tempFile as any);
        console.log("✅ [uploadAssessmentFile] File uploaded to Cloudinary:", {
          secure_url: uploadResult.secure_url,
          public_id: uploadResult.public_id,
          bytes: uploadResult.bytes
        });
      } catch (uploadError: any) {
        console.error("❌ [uploadAssessmentFile] Cloudinary upload failed:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload file to Cloudinary",
          error: uploadError.message,
          details: uploadError.http_code ? `Cloudinary error ${uploadError.http_code}` : undefined,
        });
      }

      // ==================== CREATE/UPDATE SUBMISSION ====================
      console.log("💾 [uploadAssessmentFile] Creating/updating submission...");
      
      // Check if submission already exists
      let submission = await submissionRepo.findOne({
        where: {
          user_id: userId,
          module_final_assessment_id: assessment.id,
        },
      });

      const submissionData = {
        file_name: req.file.originalname,
        file_size: req.file.size,
        file_type: req.file.mimetype,
        uploaded_at: new Date().toISOString(),
        uploaded_by: {
          id: user.id,
          name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
          email: user.email,
        },
        cloudinary: {
          public_id: uploadResult.public_id,
          version: uploadResult.version,
          format: uploadResult.format,
          resource_type: uploadResult.resource_type,
        }
      };

      if (submission) {
        // Delete old file from Cloudinary if exists
        if (submission.public_id) {
          try {
            await DeleteFromCloud(submission.public_id, "raw");
            console.log("🗑️ [uploadAssessmentFile] Deleted old file from Cloudinary:", submission.public_id);
          } catch (deleteError) {
            console.warn("⚠️ [uploadAssessmentFile] Failed to delete old file:", deleteError);
          }
        }

        // Update existing submission
        submission.submitted_file_url = uploadResult.secure_url;
        submission.public_id = uploadResult.public_id;
        submission.answer_data = {
          ...submission.answer_data,
          ...submissionData,
        };
        submission.submitted_at = new Date();
        submission.status = "PENDING";
        console.log("🔄 [uploadAssessmentFile] Updating existing submission:", submission.id);
      } else {
        // Create new submission
        submission = submissionRepo.create({
          module_final_assessment_id: assessment.id,
          user_id: userId,
          submitted_file_url: uploadResult.secure_url,
          public_id: uploadResult.public_id,
          answer_data: submissionData,
          submitted_at: new Date(),
          status: "PENDING",
        });
        console.log("✨ [uploadAssessmentFile] Creating new submission");
      }

      await submissionRepo.save(submission);
      console.log("✅ [uploadAssessmentFile] Submission saved:", submission.id);

      // ==================== SEND NOTIFICATION TO INSTRUCTOR ====================
      console.log("📧 [uploadAssessmentFile] Sending notifications...");
      try {
        // Get course with instructor
        const course = await courseRepo.findOne({
          where: { id: assessment.course_id },
          relations: ["instructor"],
        });

        if (course?.instructor) {
          await sendEmail({
            to: course.instructor.email,
            subject: `📎 New Assessment File Submitted: ${assessment.title}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a56db;">New Assessment File Submitted</h2>
                <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
                  <p><strong>Student:</strong> ${user.first_name || ''} ${user.last_name || ''} (${user.email})</p>
                  <p><strong>Assessment:</strong> ${assessment.title}</p>
                  <p><strong>Course:</strong> ${course.title}</p>
                  <p><strong>File:</strong> ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)</p>
                  <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
                </div>
                <div style="margin-top: 24px; padding: 12px; background-color: #dbeafe; border-radius: 6px;">
                  <p style="margin: 0;"><strong>Action Required:</strong> Please review the submitted file.</p>
                </div>
                <p style="margin-top: 24px;">
                  <a href="${process.env.CLIENT_URL}/instructor/assessments/${assessment.id}/submissions" 
                     style="display: inline-block; background-color: #1a56db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                    Review Submission
                  </a>
                </p>
              </div>
            `,
          });
          console.log("✅ [uploadAssessmentFile] Notification sent to instructor:", course.instructor.email);
        }
      } catch (emailError) {
        console.warn("⚠️ [uploadAssessmentFile] Failed to send email:", emailError);
      }

      // ==================== SEND RESPONSE (MATCHING FRONTEND EXPECTATIONS) ====================
      console.log("📤 [uploadAssessmentFile] Sending response to frontend...");
      const responseData = {
        success: true,
        data: {
          url: uploadResult.secure_url,
          public_id: uploadResult.public_id,
          submission_id: submission.id,
          file_name: req.file.originalname,
          file_size: req.file.size,
          file_type: req.file.mimetype,
          uploaded_at: submission.submitted_at,
          assessment_id: assessment.id,
          user_id: user.id,
          status: "uploaded"
        },
        message: "File uploaded successfully"
      };

      console.log("✅ [uploadAssessmentFile] Upload complete!");
      console.log("=".repeat(80));
      
      res.json(responseData);

    } catch (error: any) {
      console.error("❌ [uploadAssessmentFile] Error:", error);
      console.error("📋 [uploadAssessmentFile] Error details:", {
        message: error.message,
        stack: error.stack,
        code: error.code,
        http_code: error.http_code
      });
      console.log("=".repeat(80));
      
      res.status(500).json({
        success: false,
        message: "Failed to upload assessment file",
        error: error.message,
        ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
      });
    }
  }

  /**
   * GET /api/upload/assessment-file/:submissionId
   * Get uploaded file details
   */
  static async getAssessmentFile(req: Request, res: Response) {
    try {
      const { submissionId } = req.params;
      const userId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const submissionRepo = dbConnection.getRepository(ModuleFinalSubmission);
      const userRepo = dbConnection.getRepository(User);

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Get submission
      const submission = await submissionRepo.findOne({
        where: { id: submissionId },
        relations: ["module_final_assessment"],
      });

      if (!submission) {
        return res.status(404).json({
          success: false,
          message: "Submission not found",
        });
      }

      // Check permissions
      const isOwner = submission.user_id === userId;
      const isInstructor = ["SYSTEM_ADMIN", "INSTRUCTOR", "CONTENT_CREATOR"].includes(user.bwenge_role);
      
      if (!isOwner && !isInstructor) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view this file",
        });
      }

      // Format response
      const response = {
        success: true,
        data: {
          submission_id: submission.id,
          file_url: submission.submitted_file_url,
          public_id: submission.public_id,
          file_name: submission.answer_data?.file_name || "Unknown",
          file_size: submission.answer_data?.file_size || 0,
          file_type: submission.answer_data?.file_type || "application/octet-stream",
          uploaded_at: submission.submitted_at,
          uploaded_by: submission.answer_data?.uploaded_by,
          assessment_id: submission.module_final_assessment_id,
          assessment_title: submission.module_final_assessment?.title,
          status: submission.status,
          score: submission.score,
          instructor_feedback: submission.instructor_feedback,
          graded_at: submission.graded_at,
        },
      };

      res.json(response);

    } catch (error: any) {
      console.error("❌ [getAssessmentFile] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch assessment file",
        error: error.message,
      });
    }
  }
}