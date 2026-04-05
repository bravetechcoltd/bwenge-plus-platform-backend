// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Course } from "../database/models/Course";
import { CourseInstructor } from "../database/models/CourseInstructor";
import { InstructorMaterials, MaterialType, MaterialStatus } from "../database/models/InstructorMaterials";
import { UploadToCloud } from "../services/cloudinary";
import { sendEmail } from "../services/emailService";
import * as path from "path";

export class MaterialsController {
  
  // ==================== GET COURSE MATERIALS ====================
  static async getCourseMaterials(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { course_id } = req.params;
      const { module_id, lesson_id, material_type, status } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Verify course access
      const courseRepo = dbConnection.getRepository(Course);
      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

      const isPrimaryInstructor = await courseRepo.findOne({
        where: { id: course_id, instructor_id: userId },
      });

      const isAdditionalInstructor = await courseInstructorRepo.findOne({
        where: { course_id, instructor_id: userId },
      });

      if (!isPrimaryInstructor && !isAdditionalInstructor) {
        return res.status(403).json({
          success: false,
          message: "You don't have access to this course",
        });
      }

      // Get materials from database
      const materialsRepo = dbConnection.getRepository(InstructorMaterials);
      const queryBuilder = materialsRepo
        .createQueryBuilder("material")
        .leftJoinAndSelect("material.course", "course")
        .leftJoinAndSelect("material.module", "module")
        .leftJoinAndSelect("material.lesson", "lesson")
        .leftJoinAndSelect("material.uploader", "uploader")
        .where("material.course_id = :course_id", { course_id })
        .andWhere("material.status != :deleted", { deleted: MaterialStatus.DELETED });

      // Apply filters
      if (module_id) {
        queryBuilder.andWhere("material.module_id = :module_id", { module_id });
      }
      if (lesson_id) {
        queryBuilder.andWhere("material.lesson_id = :lesson_id", { lesson_id });
      }
      if (material_type) {
        queryBuilder.andWhere("material.material_type = :material_type", { material_type });
      }
      if (status) {
        queryBuilder.andWhere("material.status = :status", { status });
      }

      const materials = await queryBuilder
        .orderBy("material.created_at", "DESC")
        .getMany();

      // Format response
      const formattedMaterials = materials.map(material => ({
        id: material.id,
        title: material.title,
        description: material.description,
        file_url: material.file_url,
        file_name: material.file_name,
        material_type: material.material_type,
        file_extension: material.file_extension,
        file_size: material.file_size,
        is_downloadable: material.is_downloadable,
        is_required: material.is_required,
        download_count: material.download_count,
        view_count: material.view_count,
        status: material.status,
        module: material.module ? {
          id: material.module.id,
          title: material.module.title,
        } : null,
        lesson: material.lesson ? {
          id: material.lesson.id,
          title: material.lesson.title,
        } : null,
        uploaded_by: {
          id: material.uploader.id,
          name: `${material.uploader.first_name} ${material.uploader.last_name}`,
        },
        created_at: material.created_at,
      }));

      res.json({
        success: true,
        data: {
          materials: formattedMaterials,
          total: materials.length,
        },
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch materials",
        error: error.message,
      });
    }
  }

  // ==================== UPLOAD MATERIALS ====================
  static async uploadMaterials(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const {
        course_id,
        title,
        description,
        module_id,
        lesson_id,
        is_downloadable,
        is_required,
      } = req.body;

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

      // Handle files from multer.fields() - returns object with field names as keys
      const filesObject = req.files as { [fieldname: string]: Express.Multer.File[] };
      const files = filesObject?.files || [];

      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No files uploaded",
        });
      }

      // Verify course access
      const courseRepo = dbConnection.getRepository(Course);
      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

      const isPrimaryInstructor = await courseRepo.findOne({
        where: { id: course_id, instructor_id: userId },
      });

      const isAdditionalInstructor = await courseInstructorRepo.findOne({
        where: { course_id, instructor_id: userId },
      });

      if (!isPrimaryInstructor && !isAdditionalInstructor) {
        return res.status(403).json({
          success: false,
          message: "You don't have access to this course",
        });
      }

      // Upload files and save to database
      const materialsRepo = dbConnection.getRepository(InstructorMaterials);
      const uploadedMaterials = [];

      for (const file of files) {
        try {
          const uploadResult = await UploadToCloud(file);
          
          // Determine material type from file extension
          const fileExt = path.extname(file.originalname).toLowerCase();
          let materialType = MaterialType.OTHER;
          
          if (['.pdf'].includes(fileExt)) materialType = MaterialType.PDF;
          else if (['.mp4', '.avi', '.mov', '.wmv'].includes(fileExt)) materialType = MaterialType.VIDEO;
          else if (['.mp3', '.wav', '.ogg'].includes(fileExt)) materialType = MaterialType.AUDIO;
          else if (['.doc', '.docx', '.txt', '.rtf'].includes(fileExt)) materialType = MaterialType.DOCUMENT;
          else if (['.ppt', '.pptx'].includes(fileExt)) materialType = MaterialType.PRESENTATION;
          else if (['.xls', '.xlsx', '.csv'].includes(fileExt)) materialType = MaterialType.SPREADSHEET;
          else if (['.jpg', '.jpeg', '.png', '.gif', '.svg'].includes(fileExt)) materialType = MaterialType.IMAGE;
          else if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(fileExt)) materialType = MaterialType.ARCHIVE;

          // Create material record
          const material = materialsRepo.create({
            title: title || file.originalname,
            description: description || undefined,
            course_id,
            module_id: module_id || undefined,
            lesson_id: lesson_id || undefined,
            file_url: uploadResult.secure_url,
            file_name: file.originalname,
            material_type: materialType,
            file_extension: fileExt,
            file_size: file.size,
            cloudinary_public_id: uploadResult.public_id,
            is_downloadable: is_downloadable === 'true' || is_downloadable === true,
            is_required: is_required === 'true' || is_required === true,
            status: MaterialStatus.ACTIVE,
            uploaded_by: userId,
          });

          await materialsRepo.save(material);
          
          uploadedMaterials.push({
            id: material.id,
            title: material.title,
            file_url: material.file_url,
            file_name: material.file_name,
            material_type: material.material_type,
            file_size: material.file_size,
            created_at: material.created_at,
          });
        } catch (uploadError) {
        }
      }

      // Send notification
      try {
        await sendEmail({
          to: (req.user as any).email,
          subject: "Materials Uploaded Successfully",
          html: `
            <h2>Materials Uploaded</h2>
            <p>You have successfully uploaded ${uploadedMaterials.length} file(s).</p>
            <p>Course ID: ${course_id}</p>
          `,
        });
      } catch (emailError) {
      }

      res.status(201).json({
        success: true,
        message: `${uploadedMaterials.length} files uploaded successfully`,
        data: {
          materials: uploadedMaterials,
          total_uploaded: uploadedMaterials.length,
        },
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to upload materials",
        error: error.message,
      });
    }
  }

  // ==================== DELETE MATERIAL ====================
  static async deleteMaterial(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Find material
      const materialsRepo = dbConnection.getRepository(InstructorMaterials);
      const materialId = Array.isArray(id) ? id[0] : id;
      const material = await materialsRepo.findOne({
        where: { id: materialId },
        relations: ["course"],
      });

      if (!material) {
        return res.status(404).json({
          success: false,
          message: "Material not found",
        });
      }

      // Verify access
      const courseRepo = dbConnection.getRepository(Course);
      const courseInstructorRepo = dbConnection.getRepository(CourseInstructor);

      const isPrimaryInstructor = await courseRepo.findOne({
        where: { id: material.course_id, instructor_id: userId },
      });

      const isAdditionalInstructor = await courseInstructorRepo.findOne({
        where: { course_id: material.course_id, instructor_id: userId },
      });

      if (!isPrimaryInstructor && !isAdditionalInstructor && material.uploaded_by !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to delete this material",
        });
      }

      // Soft delete by setting status to DELETED
      material.status = MaterialStatus.DELETED;
      await materialsRepo.save(material);

      res.json({
        success: true,
        message: "Material deleted successfully",
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to delete material",
        error: error.message,
      });
    }
  }

  // ==================== GET MATERIAL STATISTICS ====================
  static async getMaterialsStats(req: Request, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Get all courses where user is instructor
      const courseRepo = dbConnection.getRepository(Course);
      const courses = await courseRepo
        .createQueryBuilder("course")
        .where(
          `(
            course.instructor_id = :userId 
            OR EXISTS (
              SELECT 1 FROM course_instructors ci 
              WHERE ci.course_id = course.id 
              AND ci.instructor_id = :userId 
              AND ci.can_edit_course_content = true
            )
          )`,
          { userId }
        )
        .getMany();

      const courseIds = courses.map(c => c.id);

      // Get materials statistics from database
      const materialsRepo = dbConnection.getRepository(InstructorMaterials);
      
      let materials = [];
      if (courseIds.length > 0) {
        materials = await materialsRepo
          .createQueryBuilder("material")
          .where("material.course_id IN (:...courseIds)", { courseIds })
          .andWhere("material.status != :deleted", { deleted: MaterialStatus.DELETED })
          .getMany();
      }

      // Calculate statistics
      const totalSize = materials.reduce((sum, m) => sum + (m.file_size || 0), 0);
      const totalSizeMB = totalSize / (1024 * 1024);
      
      const totalDownloads = materials.reduce((sum, m) => sum + (m.download_count || 0), 0);
      const totalViews = materials.reduce((sum, m) => sum + (m.view_count || 0), 0);

      // Materials uploaded this week
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const materialsThisWeek = materials.filter(m => new Date(m.created_at) >= oneWeekAgo).length;

      // Storage limit (5GB)
      const storageLimitMB = 5120;
      const storageUsedPercentage = (totalSizeMB / storageLimitMB) * 100;

      const stats = {
        total_materials: materials.length,
        total_size_mb: Math.round(totalSizeMB * 100) / 100,
        total_downloads: totalDownloads,
        total_views: totalViews,
        materials_by_course: courseIds.length,
        materials_uploaded_this_week: materialsThisWeek,
        storage_used_percentage: Math.round(storageUsedPercentage * 100) / 100,
        storage_limit_mb: storageLimitMB,
        materials_by_type: {
          pdf: materials.filter(m => m.material_type === MaterialType.PDF).length,
          video: materials.filter(m => m.material_type === MaterialType.VIDEO).length,
          audio: materials.filter(m => m.material_type === MaterialType.AUDIO).length,
          document: materials.filter(m => m.material_type === MaterialType.DOCUMENT).length,
          presentation: materials.filter(m => m.material_type === MaterialType.PRESENTATION).length,
          spreadsheet: materials.filter(m => m.material_type === MaterialType.SPREADSHEET).length,
          image: materials.filter(m => m.material_type === MaterialType.IMAGE).length,
          archive: materials.filter(m => m.material_type === MaterialType.ARCHIVE).length,
          other: materials.filter(m => m.material_type === MaterialType.OTHER).length,
        },
      };

      res.json({
        success: true,
        data: stats,
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch materials statistics",
        error: error.message,
      });
    }
  }
}