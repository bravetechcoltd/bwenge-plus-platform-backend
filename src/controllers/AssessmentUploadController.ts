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
      
      const userId = req.user?.userId || req.user?.id;
      const { assessment_id, course_id, enrollment_id } = req.body;
      

      // ==================== VALIDATION ====================
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Assessment file is required",
        });
      }

      if (!assessment_id) {
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
      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // ==================== VERIFY ASSESSMENT ====================
      const assessment = await assessmentRepo.findOne({
        where: { id: assessment_id },
        relations: ["module", "module.course"],
      });

      if (!assessment) {
        return res.status(404).json({
          success: false,
          message: "Assessment not found",
        });
      }

      // ==================== VERIFY ENROLLMENT ====================
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
      } else {
      }

      // ==================== UPLOAD TO CLOUDINARY ====================
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
      } catch (uploadError: any) {
        return res.status(500).json({
          success: false,
          message: "Failed to upload file to Cloudinary",
          error: uploadError.message,
          details: uploadError.http_code ? `Cloudinary error ${uploadError.http_code}` : undefined,
        });
      }

      // ==================== CREATE/UPDATE SUBMISSION ====================
      
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
          } catch (deleteError) {
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
      }

      await submissionRepo.save(submission);

      // ==================== SEND NOTIFICATION TO INSTRUCTOR ====================
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
        }
      } catch (emailError) {
      }

      // ==================== SEND RESPONSE (MATCHING FRONTEND EXPECTATIONS) ====================
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

      
      res.json(responseData);

    } catch (error: any) {
      
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
      res.status(500).json({
        success: false,
        message: "Failed to fetch assessment file",
        error: error.message,
      });
    }
  }
}