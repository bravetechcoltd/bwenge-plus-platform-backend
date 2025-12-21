// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Certificate } from "../database/models/Certificate";
import { User } from "../database/models/User";
import { Course } from "../database/models/Course";
import { Enrollment, EnrollmentStatus } from "../database/models/Enrollment";
import { AssessmentAttempt } from "../database/models/AssessmentAttempt";
import { Assessment } from "../database/models/Assessment";
import { randomUUID } from "crypto";
import { sendEmail } from "../services/emailService";
import PDFDocument from "pdfkit";

export class CertificateController {
  
  // ==================== ISSUE CERTIFICATE ====================
  static async issueCertificate(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const { course_id, final_score } = req.body;

      console.log("🏅 [issueCertificate] Starting certificate issuance:", {
        userId,
        course_id,
        final_score,
      });

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      if (!course_id) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      const certRepo = dbConnection.getRepository(Certificate);
      const userRepo = dbConnection.getRepository(User);
      const courseRepo = dbConnection.getRepository(Course);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const assessmentRepo = dbConnection.getRepository(Assessment);
      const assessmentAttemptRepo = dbConnection.getRepository(AssessmentAttempt);

      // ==================== VERIFY USER ====================
      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      console.log("✅ [issueCertificate] User verified:", user.email);

      // ==================== VERIFY COURSE ====================
      const course = await courseRepo.findOne({
        where: { id: course_id },
        relations: ["instructor", "institution"],
      });

      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      console.log("✅ [issueCertificate] Course verified:", course.title);

      // ==================== CHECK COURSE CERTIFICATE AVAILABILITY ====================
      if (!course.is_certificate_available) {
        return res.status(400).json({
          success: false,
          message: "Certificate is not available for this course",
        });
      }

      // ==================== CHECK ENROLLMENT ====================
      const enrollment = await enrollmentRepo.findOne({
        where: {
          user_id: userId,
          course_id,
          status: EnrollmentStatus.COMPLETED,
        },
      });

      if (!enrollment) {
        return res.status(400).json({
          success: false,
          message: "Course not completed or enrollment not found",
        });
      }

      console.log("✅ [issueCertificate] Enrollment verified:", enrollment.status);

      // ==================== CHECK FOR EXISTING CERTIFICATE ====================
      const existingCertificate = await certRepo.findOne({
        where: {
          user_id: userId,
          course_id,
        },
        relations: ["user", "course", "course.instructor", "course.institution"],
      });

      if (existingCertificate) {
        console.log("⚠️ [issueCertificate] Certificate already exists");
        return res.status(200).json({
          success: true,
          message: "Certificate already exists",
          data: existingCertificate,
          summary: {
            certificate_number: existingCertificate.certificate_number,
            verification_code: existingCertificate.verification_code,
            final_score: existingCertificate.final_score,
            certificate_url: existingCertificate.certificate_url,
            issue_date: existingCertificate.issue_date,
          },
        });
      }

      // ==================== CALCULATE FINAL SCORE ====================
      let calculatedFinalScore = final_score || enrollment.final_score;

      if (!calculatedFinalScore) {
        console.log("📊 [issueCertificate] Calculating final score...");
        
        const assessments = await assessmentRepo.find({
          where: { course_id },
        });

        let totalWeightedScore = 0;
        let totalWeight = 0;
        let assessmentsCount = 0;

        for (const assessment of assessments) {
          const attempts = await assessmentAttemptRepo.find({
            where: {
              enrollment_id: enrollment.id,
              assessment_id: assessment.id,
            },
            order: { attempt_number: "DESC" },
            take: 1,
          });

          if (attempts.length > 0) {
            const latestAttempt = attempts[0];
            const weight = assessment.is_final_assessment ? 2 : 1;
            
            totalWeightedScore += latestAttempt.percentage * weight;
            totalWeight += weight;
            assessmentsCount++;
          }
        }

        calculatedFinalScore = assessmentsCount > 0 && totalWeight > 0 
          ? totalWeightedScore / totalWeight 
          : enrollment.progress_percentage || 70;

        console.log("📊 [issueCertificate] Calculated score:", {
          assessmentsCount,
          totalWeight,
          finalScore: calculatedFinalScore,
        });
      }

      calculatedFinalScore = Math.min(100, Math.max(0, calculatedFinalScore));

      // ==================== CHECK PASSING REQUIREMENTS ====================
      const passingScore = 70;
      if (calculatedFinalScore < passingScore) {
        return res.status(400).json({
          success: false,
          message: `Minimum score of ${passingScore}% required for certificate. Your score: ${calculatedFinalScore.toFixed(2)}%`,
          data: { final_score: calculatedFinalScore, passing_score: passingScore },
        });
      }

      // ==================== GENERATE UNIQUE IDENTIFIERS ====================
      const certificateNumber = `CERT-${Date.now()}-${randomUUID().substring(0, 8).toUpperCase()}`;
      const verificationCode = randomUUID();
      
      console.log("🔑 [issueCertificate] Generated identifiers:", {
        certificateNumber,
        verificationCode: verificationCode.substring(0, 8) + "...",
      });

      // ==================== CREATE CERTIFICATE ====================
      const certificate = certRepo.create({
        user_id: userId,
        course_id,
        enrollment_id: enrollment.id,
        certificate_number: certificateNumber,
        verification_code: verificationCode,
        final_score: calculatedFinalScore,
        issue_date: new Date(),
        is_valid: true,
        expires_at: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
      });

      await certRepo.save(certificate);

      console.log("✅ [issueCertificate] Certificate created:", certificate.id);

      // ==================== UPDATE ENROLLMENT ====================
      enrollment.certificate_issued = true;
      enrollment.final_score = calculatedFinalScore;
      await enrollmentRepo.save(enrollment);

      // ==================== UPDATE USER STATISTICS ====================
      user.certificates_earned = (user.certificates_earned || 0) + 1;
      await userRepo.save(user);

      console.log("📈 [issueCertificate] User statistics updated");

      // ==================== GENERATE CERTIFICATE URL ====================
      const certificateUrl = `${process.env.CLIENT_URL || process.env.FRONTEND_URL}/certificates/${certificate.id}`;
      
      certificate.certificate_url = certificateUrl;
      await certRepo.save(certificate);

      // ==================== SEND EMAIL NOTIFICATION ====================
      try {
        await sendEmail({
          to: user.email,
          subject: `🎉 Certificate of Completion: ${course.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #4CAF50; text-align: center;">Certificate of Completion</h2>
              
              <div style="background-color: #f9f9f9; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <h3 style="color: #333; margin-bottom: 10px;">Congratulations, ${user.first_name || user.email}!</h3>
                <p>You have successfully completed the course:</p>
                <h3 style="color: #2196F3; margin: 15px 0;">${course.title}</h3>
                
                <div style="background-color: white; padding: 15px; border-left: 4px solid #4CAF50; margin: 15px 0;">
                  <p><strong>Certificate Number:</strong> ${certificateNumber}</p>
                  <p><strong>Date Issued:</strong> ${new Date().toLocaleDateString()}</p>
                  <p><strong>Final Score:</strong> ${calculatedFinalScore.toFixed(2)}%</p>
                  <p><strong>Verification Code:</strong> ${verificationCode}</p>
                </div>
                
                <div style="text-align: center; margin: 25px 0;">
                  <a href="${certificateUrl}" 
                     style="background-color: #4CAF50; color: white; padding: 12px 30px; 
                            text-decoration: none; border-radius: 5px; font-weight: bold;">
                    View Your Certificate
                  </a>
                </div>
                
                <p style="font-size: 12px; color: #666; margin-top: 20px;">
                  You can verify your certificate anytime using the verification code: ${verificationCode}
                </p>
              </div>
              
              <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                <p style="color: #666; font-size: 12px;">
                  ${course.institution?.name || ''}<br>
                  ${process.env.CLIENT_URL}
                </p>
              </div>
            </div>
          `,
        });
        
        console.log("📧 [issueCertificate] Email notification sent");
      } catch (emailError) {
        console.error("⚠️ [issueCertificate] Failed to send email:", emailError);
      }

      // ==================== RETURN RESPONSE ====================
      const completeCertificate = await certRepo.findOne({
        where: { id: certificate.id },
        relations: ["user", "course", "course.instructor", "course.institution"],
      });

      res.status(201).json({
        success: true,
        message: "Certificate issued successfully",
        data: completeCertificate,
        summary: {
          certificate_number: certificateNumber,
          verification_code: verificationCode,
          final_score: calculatedFinalScore,
          certificate_url: certificateUrl,
          issue_date: certificate.issue_date,
        },
      });

    } catch (error: any) {
      console.error("❌ [issueCertificate] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to issue certificate",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  // ==================== CHECK CERTIFICATE EXISTS ====================
  static async checkCertificate(req: Request, res: Response) {
    try {
      const { userId, courseId } = req.params;
      const requestingUserId = req.user?.userId || req.user?.id;

      console.log("🔍 [checkCertificate] Checking certificate:", {
        userId,
        courseId,
        requestingUserId,
      });

      if (!userId || !courseId) {
        return res.status(400).json({
          success: false,
          message: "User ID and Course ID are required",
        });
      }

      if (requestingUserId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You can only check your own certificates",
        });
      }

      const certRepo = dbConnection.getRepository(Certificate);
      const courseRepo = dbConnection.getRepository(Course);
      const userRepo = dbConnection.getRepository(User);

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const course = await courseRepo.findOne({ where: { id: courseId } });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      const certificate = await certRepo.findOne({
        where: {
          user_id: userId,
          course_id: courseId,
        },
        relations: ["user", "course"],
      });

      if (!certificate) {
        return res.status(404).json({
          success: false,
          exists: false,
          message: "Certificate not found for this user and course",
        });
      }

      res.json({
        success: true,
        exists: true,
        message: "Certificate found",
        data: {
          id: certificate.id,
          certificate_number: certificate.certificate_number,
          verification_code: certificate.verification_code,
          issue_date: certificate.issue_date,
          final_score: certificate.final_score,
          is_valid: certificate.is_valid,
          expires_at: certificate.expires_at,
          certificate_url: certificate.certificate_url,
          user: {
            id: certificate.user.id,
            name: `${certificate.user.first_name} ${certificate.user.last_name}`,
            email: certificate.user.email,
          },
          course: {
            id: certificate.course.id,
            title: certificate.course.title,
            instructor: certificate.course.instructor_id,
            institution: certificate.course.institution_id,
          },
        },
      });

    } catch (error: any) {
      console.error("❌ [checkCertificate] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to check certificate",
        error: error.message,
      });
    }
  }

  // ==================== VERIFY CERTIFICATE ====================
  static async verifyCertificate(req: Request, res: Response) {
    try {
      const { code } = req.params;

      console.log("🔐 [verifyCertificate] Verifying certificate:", code);

      if (!code) {
        return res.status(400).json({
          success: false,
          message: "Certificate verification code is required",
        });
      }

      const certRepo = dbConnection.getRepository(Certificate);
      
      const certificate = await certRepo.findOne({
        where: { verification_code: code },
        relations: [
          "user", 
          "course", 
          "course.instructor", 
          "course.institution",
          "course.course_category"
        ],
      });

      if (!certificate) {
        return res.status(404).json({
          success: false,
          valid: false,
          message: "Certificate not found or invalid verification code",
        });
      }

      console.log("✅ [verifyCertificate] Certificate found:", certificate.id);

      if (!certificate.is_valid) {
        return res.status(400).json({
          success: false,
          valid: false,
          message: "Certificate has been revoked",
        });
      }

      if (certificate.expires_at && new Date() > certificate.expires_at) {
        return res.status(400).json({
          success: false,
          valid: false,
          message: "Certificate has expired",
        });
      }

      res.json({
        success: true,
        valid: true,
        message: "Certificate is valid",
        data: {
          certificate: {
            id: certificate.id,
            certificate_number: certificate.certificate_number,
            verification_code: certificate.verification_code,
            issue_date: certificate.issue_date,
            final_score: certificate.final_score,
            is_valid: certificate.is_valid,
            expires_at: certificate.expires_at,
            certificate_url: certificate.certificate_url,
          },
          user: {
            id: certificate.user.id,
            first_name: certificate.user.first_name,
            last_name: certificate.user.last_name,
            email: certificate.user.email,
            profile_picture_url: certificate.user.profile_picture_url,
          },
          course: {
            id: certificate.course.id,
            title: certificate.course.title,
            description: certificate.course.description,
            level: certificate.course.level,
            duration_minutes: certificate.course.duration_minutes,
            language: certificate.course.language,
            is_certificate_available: certificate.course.is_certificate_available,
          },
          instructor: certificate.course.instructor ? {
            id: certificate.course.instructor.id,
            name: `${certificate.course.instructor.first_name} ${certificate.course.instructor.last_name}`,
            email: certificate.course.instructor.email,
          } : null,
          institution: certificate.course.institution ? {
            id: certificate.course.institution.id,
            name: certificate.course.institution.name,
            type: certificate.course.institution.type,
            logo_url: certificate.course.institution.logo_url,
          } : null,
          verification_details: {
            verified_at: new Date().toISOString(),
            verification_method: "online_verification",
            verification_url: `${process.env.APP_URL}/api/certificates/verify/${code}`,
          },
        },
      });

    } catch (error: any) {
      console.error("❌ [verifyCertificate] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to verify certificate",
        error: error.message,
      });
    }
  }

  // ==================== GET USER CERTIFICATES ====================
  static async getUserCertificates(req: Request, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const { page = 1, limit = 20, include_expired = false } = req.query;

      console.log("📜 [getUserCertificates] Fetching certificates for user:", userId);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const certRepo = dbConnection.getRepository(Certificate);
      const userRepo = dbConnection.getRepository(User);

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const queryBuilder = certRepo
        .createQueryBuilder("certificate")
        .leftJoinAndSelect("certificate.course", "course")
        .leftJoinAndSelect("course.instructor", "instructor")
        .leftJoinAndSelect("course.institution", "institution")
        .where("certificate.user_id = :userId", { userId });

      if (include_expired !== "true") {
        queryBuilder.andWhere(
          "(certificate.expires_at IS NULL OR certificate.expires_at > :now)",
          { now: new Date() }
        );
      }

      queryBuilder.andWhere("certificate.is_valid = :isValid", { isValid: true });

      const skip = (Number(page) - 1) * Number(limit);
      const [certificates, total] = await queryBuilder
        .orderBy("certificate.issue_date", "DESC")
        .skip(skip)
        .take(Number(limit))
        .getManyAndCount();

      const enhancedCertificates = certificates.map(cert => ({
        id: cert.id,
        certificate_number: cert.certificate_number,
        verification_code: cert.verification_code,
        issue_date: cert.issue_date,
        final_score: cert.final_score,
        is_valid: cert.is_valid,
        expires_at: cert.expires_at,
        certificate_url: cert.certificate_url,
        course: {
          id: cert.course.id,
          title: cert.course.title,
          description: cert.course.description,
          thumbnail_url: cert.course.thumbnail_url,
          level: cert.course.level,
          duration_minutes: cert.course.duration_minutes,
          language: cert.course.language,
          category: cert.course.category,
          tags: cert.course.tags,
          instructor: cert.course.instructor ? {
            id: cert.course.instructor.id,
            name: `${cert.course.instructor.first_name} ${cert.course.instructor.last_name}`,
            profile_picture_url: cert.course.instructor.profile_picture_url,
          } : null,
          institution: cert.course.institution ? {
            id: cert.course.institution.id,
            name: cert.course.institution.name,
            logo_url: cert.course.institution.logo_url,
          } : null,
        },
        status: CertificateController.getCertificateStatus(cert),
        shareable_links: {
          public_verification: `${process.env.CLIENT_URL}/certificates/verify/${cert.verification_code}`,
          api_verification: `${process.env.APP_URL}/api/certificates/verify/${cert.verification_code}`,
        },
      }));

      const totalCertificates = await certRepo.count({ where: { user_id: userId } });
      const validCertificates = await certRepo.count({ 
        where: { 
          user_id: userId, 
          is_valid: true,
        } 
      });

      res.json({
        success: true,
        message: "Certificates retrieved successfully",
        data: {
          certificates: enhancedCertificates,
          user: {
            id: user.id,
            name: `${user.first_name} ${user.last_name}`,
            email: user.email,
            certificates_earned: user.certificates_earned,
          },
          statistics: {
            total_certificates: totalCertificates,
            valid_certificates: validCertificates,
            current_page_count: certificates.length,
          },
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });

    } catch (error: any) {
      console.error("❌ [getUserCertificates] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch certificates",
        error: error.message,
      });
    }
  }

  // ==================== GET CERTIFICATE BY ID ====================
  static async getCertificateById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      console.log("🔍 [getCertificateById] Fetching certificate:", id);

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Certificate ID is required",
        });
      }

      const certRepo = dbConnection.getRepository(Certificate);

      const certificate = await certRepo.findOne({
        where: { id },
        relations: [
          "user", 
          "course", 
          "course.instructor", 
          "course.institution",
          "course.course_category",
          "course.modules",
        ],
      });

      if (!certificate) {
        return res.status(404).json({
          success: false,
          message: "Certificate not found",
        });
      }

      if (certificate.user_id !== userId) {
        const userRepo = dbConnection.getRepository(User);
        const user = await userRepo.findOne({ where: { id: userId } });
        
        if (!user || !["SYSTEM_ADMIN", "INSTITUTION_ADMIN", "INSTRUCTOR"].includes(user.bwenge_role)) {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to view this certificate",
          });
        }
      }

      const enhancedCertificate = {
        id: certificate.id,
        certificate_number: certificate.certificate_number,
        verification_code: certificate.verification_code,
        issue_date: certificate.issue_date,
        final_score: certificate.final_score,
        is_valid: certificate.is_valid,
        expires_at: certificate.expires_at,
        certificate_url: certificate.certificate_url,
        user: {
          id: certificate.user.id,
          first_name: certificate.user.first_name,
          last_name: certificate.user.last_name,
          email: certificate.user.email,
          profile_picture_url: certificate.user.profile_picture_url,
          account_type: certificate.user.account_type,
          bwenge_role: certificate.user.bwenge_role,
        },
        course: {
          id: certificate.course.id,
          title: certificate.course.title,
          description: certificate.course.description,
          thumbnail_url: certificate.course.thumbnail_url,
          level: certificate.course.level,
          duration_minutes: certificate.course.duration_minutes,
          language: certificate.course.language,
          category: certificate.course.category,
          tags: certificate.course.tags,
          course_type: certificate.course.course_type,
          total_lessons: certificate.course.total_lessons,
          average_rating: certificate.course.average_rating,
          instructor: certificate.course.instructor ? {
            id: certificate.course.instructor.id,
            name: `${certificate.course.instructor.first_name} ${certificate.course.instructor.last_name}`,
            email: certificate.course.instructor.email,
            profile_picture_url: certificate.course.instructor.profile_picture_url,
          } : null,
          institution: certificate.course.institution ? {
            id: certificate.course.institution.id,
            name: certificate.course.institution.name,
            type: certificate.course.institution.type,
            logo_url: certificate.course.institution.logo_url,
          } : null,
          modules: certificate.course.modules?.map(module => ({
            id: module.id,
            title: module.title,
            description: module.description,
            estimated_duration_hours: module.estimated_duration_hours,
          })) || [],
        },
        verification_details: {
          verification_url: `${process.env.CLIENT_URL}/certificates/verify/${certificate.verification_code}`,
          api_verification_url: `${process.env.APP_URL}/api/certificates/verify/${certificate.verification_code}`,
          qr_code_url: CertificateController.generateQRCodeUrl(certificate.verification_code),
        },
        status: CertificateController.getCertificateStatus(certificate),
      };

      res.json({
        success: true,
        message: "Certificate retrieved successfully",
        data: enhancedCertificate,
      });

    } catch (error: any) {
      console.error("❌ [getCertificateById] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch certificate",
        error: error.message,
      });
    }
  }

  // ==================== REVOKE CERTIFICATE ====================
  static async revokeCertificate(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;
      const { reason } = req.body;

      console.log("🚫 [revokeCertificate] Revoking certificate:", { id, userId, reason });

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Certificate ID is required",
        });
      }

      const certRepo = dbConnection.getRepository(Certificate);
      const userRepo = dbConnection.getRepository(User);

      const certificate = await certRepo.findOne({
        where: { id },
        relations: ["user", "course"],
      });

      if (!certificate) {
        return res.status(404).json({
          success: false,
          message: "Certificate not found",
        });
      }

      const user = await userRepo.findOne({ where: { id: userId } });
      const canRevoke = 
        user?.bwenge_role === "SYSTEM_ADMIN" ||
        user?.bwenge_role === "INSTITUTION_ADMIN" ||
        certificate.course.instructor_id === userId;

      if (!canRevoke) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to revoke this certificate",
        });
      }

      certificate.is_valid = false;
      await certRepo.save(certificate);

      console.log("✅ [revokeCertificate] Certificate revoked:", certificate.id);

      try {
        await sendEmail({
          to: certificate.user.email,
          subject: `Certificate Revoked: ${certificate.course.title}`,
          html: `
            <h2>Certificate Revocation Notice</h2>
            <p>Dear ${certificate.user.first_name || certificate.user.email},</p>
            <p>Your certificate for <strong>${certificate.course.title}</strong> has been revoked.</p>
            ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
            <p>Certificate Number: ${certificate.certificate_number}</p>
            <p>If you believe this is an error, please contact support.</p>
          `,
        });
      } catch (emailError) {
        console.error("⚠️ [revokeCertificate] Failed to send email:", emailError);
      }

      res.json({
        success: true,
        message: "Certificate revoked successfully",
        data: {
          id: certificate.id,
          certificate_number: certificate.certificate_number,
          is_valid: certificate.is_valid,
          revoked_at: new Date(),
          revoked_by: userId,
          reason,
        },
      });

    } catch (error: any) {
      console.error("❌ [revokeCertificate] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to revoke certificate",
        error: error.message,
      });
    }
  }

  // ==================== GENERATE CERTIFICATE PDF ====================
  static async generateCertificatePDF(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      console.log("📄 [generateCertificatePDF] Generating PDF for certificate:", id);

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Certificate ID is required",
        });
      }

      const certRepo = dbConnection.getRepository(Certificate);

      const certificate = await certRepo.findOne({
        where: { id },
        relations: ["user", "course", "course.instructor", "course.institution"],
      });

      if (!certificate) {
        return res.status(404).json({
          success: false,
          message: "Certificate not found",
        });
      }

      if (certificate.user_id !== userId) {
        const userRepo = dbConnection.getRepository(User);
        const user = await userRepo.findOne({ where: { id: userId } });
        
        if (!user || !["SYSTEM_ADMIN", "INSTITUTION_ADMIN", "INSTRUCTOR"].includes(user.bwenge_role)) {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to generate this certificate PDF",
          });
        }
      }

      if (!certificate.is_valid) {
        return res.status(400).json({
          success: false,
          message: "Certificate is not valid",
        });
      }

      const apiUrl = process.env.APP_URL || process.env.FRONTEND_URL;
      const pdfUrl = `${apiUrl}/api/certificates/${id}/pdf/download`;

      res.json({
        success: true,
        message: "Certificate PDF generated successfully",
        data: {
          certificate_id: certificate.id,
          certificate_number: certificate.certificate_number,
          pdf_url: pdfUrl,
          download_url: `${pdfUrl}?download=true`,
          generated_at: new Date(),
          file_size: "2.5 MB",
          file_format: "PDF",
          pages: 1,
        },
      });

    } catch (error: any) {
      console.error("❌ [generateCertificatePDF] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to generate certificate PDF",
        error: error.message,
      });
    }
  }

  // ==================== DOWNLOAD CERTIFICATE PDF ====================
  static async downloadCertificatePDF(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { download } = req.query;

      console.log("📥 [downloadCertificatePDF] Downloading PDF for certificate:", id);

      const certRepo = dbConnection.getRepository(Certificate);

      const certificate = await certRepo.findOne({
        where: { id },
        relations: ["user", "course", "course.instructor", "course.institution"],
      });

      if (!certificate) {
        return res.status(404).json({
          success: false,
          message: "Certificate not found",
        });
      }

      if (!certificate.is_valid) {
        return res.status(400).json({
          success: false,
          message: "Certificate is not valid",
        });
      }

      // Create PDF
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 50, bottom: 50, left: 72, right: 72 }
      });

      // Set response headers
      res.setHeader('Content-Type', 'application/pdf');
      
      if (download === 'true') {
        res.setHeader('Content-Disposition', `attachment; filename="certificate-${certificate.certificate_number}.pdf"`);
      } else {
        res.setHeader('Content-Disposition', `inline; filename="certificate-${certificate.certificate_number}.pdf"`);
      }

      // Pipe PDF to response
      doc.pipe(res);

      // ==================== DESIGN CERTIFICATE ====================
      
      // Border
      doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60)
         .lineWidth(3)
         .strokeColor('#2563eb')
         .stroke();

      doc.rect(40, 40, doc.page.width - 80, doc.page.height - 80)
         .lineWidth(1)
         .strokeColor('#2563eb')
         .stroke();

      // Title
      doc.fontSize(36)
         .fillColor('#2563eb')
         .font('Helvetica-Bold')
         .text('Certificate of Completion', 0, 100, {
           align: 'center',
           width: doc.page.width
         });

      // Trophy Icon (text-based)
      doc.fontSize(48)
         .fillColor('#fbbf24')
         .text('🏆', 0, 160, {
           align: 'center',
           width: doc.page.width
         });

      // "This certifies that"
      doc.fontSize(16)
         .fillColor('#6b7280')
         .font('Helvetica')
         .text('This certifies that', 0, 230, {
           align: 'center',
           width: doc.page.width
         });

      // Student Name
      const studentName = `${certificate.user.first_name} ${certificate.user.last_name}`;
      doc.fontSize(28)
         .fillColor('#000000')
         .font('Helvetica-Bold')
         .text(studentName, 0, 260, {
           align: 'center',
           width: doc.page.width
         });

      // "has successfully completed"
      doc.fontSize(16)
         .fillColor('#6b7280')
         .font('Helvetica')
         .text('has successfully completed', 0, 300, {
           align: 'center',
           width: doc.page.width
         });

      // Course Title
      doc.fontSize(22)
         .fillColor('#2563eb')
         .font('Helvetica-Bold')
         .text(certificate.course.title, 100, 330, {
           align: 'center',
           width: doc.page.width - 200
         });

      // Score and Date Box
      const boxY = 390;
      const boxWidth = 200;
      const leftBoxX = (doc.page.width - boxWidth * 2 - 50) / 2;
      const rightBoxX = leftBoxX + boxWidth + 50;

      // Score Box
      doc.rect(leftBoxX, boxY, boxWidth, 60)
         .fillColor('#f3f4f6')
         .fill();

      doc.fontSize(12)
         .fillColor('#6b7280')
         .font('Helvetica')
         .text('Final Score', leftBoxX, boxY + 15, {
           align: 'center',
           width: boxWidth
         });

      doc.fontSize(24)
         .fillColor('#2563eb')
         .font('Helvetica-Bold')
         .text(`${certificate.final_score}%`, leftBoxX, boxY + 30, {
           align: 'center',
           width: boxWidth
         });

      // Date Box
      doc.rect(rightBoxX, boxY, boxWidth, 60)
         .fillColor('#f3f4f6')
         .fill();

      doc.fontSize(12)
         .fillColor('#6b7280')
         .font('Helvetica')
         .text('Date Issued', rightBoxX, boxY + 15, {
           align: 'center',
           width: boxWidth
         });

      doc.fontSize(16)
         .fillColor('#000000')
         .font('Helvetica')
         .text(new Date(certificate.issue_date).toLocaleDateString('en-US', {
           year: 'numeric',
           month: 'long',
           day: 'numeric'
         }), rightBoxX, boxY + 35, {
           align: 'center',
           width: boxWidth
         });

      // Signatures Section
      const sigY = 480;
      const sigWidth = 200;
      const leftSigX = 120;
      const rightSigX = doc.page.width - 320;

      // Instructor Signature
      doc.moveTo(leftSigX, sigY)
         .lineTo(leftSigX + sigWidth, sigY)
         .stroke();

      const instructorName = certificate.course.instructor 
        ? `${certificate.course.instructor.first_name} ${certificate.course.instructor.last_name}`
        : 'Course Instructor';

      doc.fontSize(12)
         .fillColor('#000000')
         .font('Helvetica-Bold')
         .text(instructorName, leftSigX, sigY + 10, {
           align: 'center',
           width: sigWidth
         });

      doc.fontSize(10)
         .fillColor('#6b7280')
         .font('Helvetica')
         .text('Course Instructor', leftSigX, sigY + 28, {
           align: 'center',
           width: sigWidth
         });

      // Platform/Institution Signature
      doc.moveTo(rightSigX, sigY)
         .lineTo(rightSigX + sigWidth, sigY)
         .stroke();

      const institutionName = certificate.course.institution?.name || 'Bwenge Plus';
      
      doc.fontSize(12)
         .fillColor('#000000')
         .font('Helvetica-Bold')
         .text(institutionName, rightSigX, sigY + 10, {
           align: 'center',
           width: sigWidth
         });

      doc.fontSize(10)
         .fillColor('#6b7280')
         .font('Helvetica')
         .text('Platform Director', rightSigX, sigY + 28, {
           align: 'center',
           width: sigWidth
         });

      // Footer Information
      doc.fontSize(8)
         .fillColor('#9ca3af')
         .font('Helvetica')
         .text(
           `Certificate Number: ${certificate.certificate_number} | Verification Code: ${certificate.verification_code}`,
           0,
           doc.page.height - 60,
           {
             align: 'center',
             width: doc.page.width
           }
         );

      const verifyUrl = `${process.env.CLIENT_URL}/certificates/verify/${certificate.verification_code}`;
      doc.fontSize(8)
         .fillColor('#2563eb')
         .text(`Verify at: ${verifyUrl}`, 0, doc.page.height - 45, {
           align: 'center',
           width: doc.page.width,
           link: verifyUrl
         });

      // Finalize PDF
      doc.end();

      console.log("✅ [downloadCertificatePDF] PDF generated and sent");

    } catch (error: any) {
      console.error("❌ [downloadCertificatePDF] Error:", error);
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "Failed to download certificate PDF",
          error: error.message,
        });
      }
    }
  }

  // ==================== HELPER METHODS ====================






  private static getCertificateStatus(certificate: Certificate): string {
    if (!certificate.is_valid) {
      return "REVOKED";
    }

    if (certificate.expires_at && new Date() > certificate.expires_at) {
      return "EXPIRED";
    }

    return "VALID";
  }

  private static generateQRCodeUrl(verificationCode: string): string {
    const verificationUrl = `${process.env.CLIENT_URL}/certificates/verify/${verificationCode}`;
    return `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verificationUrl)}`;
  }
}