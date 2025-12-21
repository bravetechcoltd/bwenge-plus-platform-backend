// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Lesson, LessonType } from "../database/models/Lesson";
import { Course } from "../database/models/Course";
import { Module } from "../database/models/Module";
import { UploadToCloud, DeleteFromCloud } from "../services/cloudinary";

export class LessonController {
  // ==================== CREATE LESSON WITH FILE UPLOAD ====================
  static async createLesson(req: Request, res: Response) {
    try {
      const { course_id, module_id, title, content, type, duration_minutes, is_preview } = req.body;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      if (!course_id || !title || !type) {
        return res.status(400).json({
          success: false,
          message: "Course ID, title, and type are required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const lessonRepo = dbConnection.getRepository(Lesson);

      const course = await courseRepo.findOne({ where: { id: course_id } });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Get next order index
      const existingLessons = await lessonRepo.find({
        where: module_id ? { module_id } : { course_id },
      });
      const order_index = existingLessons.length;

      let video_url: string | null = null;
      let thumbnail_url: string | null = null;
      let resources: any[] = [];

      // Upload video file
      if (files?.video && files.video[0]) {
        console.log("📹 Uploading video file...");
        const videoUpload = await UploadToCloud(files.video[0]);
        video_url = videoUpload.secure_url;
      }

      // Upload thumbnail
      if (files?.thumbnail && files.thumbnail[0]) {
        console.log("🖼️ Uploading thumbnail...");
        const thumbnailUpload = await UploadToCloud(files.thumbnail[0]);
        thumbnail_url = thumbnailUpload.secure_url;
      }

      // Upload resource files
      if (files?.resources) {
        console.log("📎 Uploading resource files...");
        for (const file of files.resources) {
          const upload = await UploadToCloud(file);
          resources.push({
            title: file.originalname,
            url: upload.secure_url,
            type: file.mimetype,
            size: file.size,
          });
        }
      }

      const lesson = lessonRepo.create({
        course_id,
        module_id: module_id || null,
        title,
        content,
        type: type as LessonType,
        duration_minutes: duration_minutes || 0,
        order_index,
        video_url,
        thumbnail_url,
        resources: resources.length > 0 ? resources : null,
        is_published: false,
        is_preview: is_preview || false,
      });

      await lessonRepo.save(lesson);

      res.status(201).json({
        success: true,
        message: "Lesson created successfully",
        data: lesson,
      });
    } catch (error: any) {
      console.error("❌ Create lesson error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create lesson",
        error: error.message,
      });
    }
  }

  // ==================== UPDATE LESSON WITH FILE UPLOAD ====================
  static async updateLesson(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updates = req.body;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      const lessonRepo = dbConnection.getRepository(Lesson);
      const lesson = await lessonRepo.findOne({ where: { id } });

      if (!lesson) {
        return res.status(404).json({
          success: false,
          message: "Lesson not found",
        });
      }

      // Handle video upload
      if (files?.video && files.video[0]) {
        console.log("📹 Updating video file...");
        
        // Delete old video if exists
        if (lesson.video_url) {
          try {
            const publicId = lesson.video_url.split("/").slice(-2).join("/").split(".")[0];
            await DeleteFromCloud(publicId, "video");
          } catch (err) {
            console.warn("⚠️ Could not delete old video:", err);
          }
        }

        const videoUpload = await UploadToCloud(files.video[0]);
        updates.video_url = videoUpload.secure_url;
      }

      // Handle thumbnail upload
      if (files?.thumbnail && files.thumbnail[0]) {
        console.log("🖼️ Updating thumbnail...");
        
        if (lesson.thumbnail_url) {
          try {
            const publicId = lesson.thumbnail_url.split("/").slice(-2).join("/").split(".")[0];
            await DeleteFromCloud(publicId, "image");
          } catch (err) {
            console.warn("⚠️ Could not delete old thumbnail:", err);
          }
        }

        const thumbnailUpload = await UploadToCloud(files.thumbnail[0]);
        updates.thumbnail_url = thumbnailUpload.secure_url;
      }

      // Handle resources upload
      if (files?.resources) {
        console.log("📎 Updating resource files...");
        const newResources = [];
        
        for (const file of files.resources) {
          const upload = await UploadToCloud(file);
          newResources.push({
            title: file.originalname,
            url: upload.secure_url,
            type: file.mimetype,
            size: file.size,
          });
        }

        updates.resources = [...(lesson.resources || []), ...newResources];
      }

      Object.assign(lesson, updates);
      await lessonRepo.save(lesson);

      res.json({
        success: true,
        message: "Lesson updated successfully",
        data: lesson,
      });
    } catch (error: any) {
      console.error("❌ Update lesson error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update lesson",
        error: error.message,
      });
    }
  }

  // ==================== GET LESSONS BY COURSE ====================
  static async getLessonsByCourse(req: Request, res: Response) {
    try {
      const { courseId } = req.params;

      const lessonRepo = dbConnection.getRepository(Lesson);
      const lessons = await lessonRepo.find({
        where: { course_id: courseId },
        order: { order_index: "ASC" },
      });

      res.json({
        success: true,
        data: lessons,
      });
    } catch (error: any) {
      console.error("❌ Get lessons error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch lessons",
        error: error.message,
      });
    }
  }

  // ==================== GET LESSONS BY MODULE ====================
  static async getLessonsByModule(req: Request, res: Response) {
    try {
      const { moduleId } = req.params;

      const lessonRepo = dbConnection.getRepository(Lesson);
      const lessons = await lessonRepo.find({
        where: { module_id: moduleId },
        order: { order_index: "ASC" },
      });

      res.json({
        success: true,
        data: lessons,
      });
    } catch (error: any) {
      console.error("❌ Get module lessons error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch lessons",
        error: error.message,
      });
    }
  }

  // ==================== GET LESSON BY ID ====================
  static async getLessonById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const lessonRepo = dbConnection.getRepository(Lesson);
      const lesson = await lessonRepo.findOne({
        where: { id },
        relations: ["course", "module", "quizzes"],
      });

      if (!lesson) {
        return res.status(404).json({
          success: false,
          message: "Lesson not found",
        });
      }

      res.json({
        success: true,
        data: lesson,
      });
    } catch (error: any) {
      console.error("❌ Get lesson error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch lesson",
        error: error.message,
      });
    }
  }

  // ==================== DELETE LESSON ====================
  static async deleteLesson(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const lessonRepo = dbConnection.getRepository(Lesson);
      const lesson = await lessonRepo.findOne({ where: { id } });

      if (!lesson) {
        return res.status(404).json({
          success: false,
          message: "Lesson not found",
        });
      }

      // Delete video from cloud
      if (lesson.video_url) {
        try {
          const publicId = lesson.video_url.split("/").slice(-2).join("/").split(".")[0];
          await DeleteFromCloud(publicId, "video");
        } catch (err) {
          console.warn("⚠️ Could not delete video:", err);
        }
      }

      // Delete thumbnail from cloud
      if (lesson.thumbnail_url) {
        try {
          const publicId = lesson.thumbnail_url.split("/").slice(-2).join("/").split(".")[0];
          await DeleteFromCloud(publicId, "image");
        } catch (err) {
          console.warn("⚠️ Could not delete thumbnail:", err);
        }
      }

      // Delete resources from cloud
      if (lesson.resources && Array.isArray(lesson.resources)) {
        for (const resource of lesson.resources) {
          try {
            const publicId = resource.url.split("/").slice(-2).join("/").split(".")[0];
            await DeleteFromCloud(publicId, "raw");
          } catch (err) {
            console.warn("⚠️ Could not delete resource:", err);
          }
        }
      }

      await lessonRepo.remove(lesson);

      res.json({
        success: true,
        message: "Lesson deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete lesson error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete lesson",
        error: error.message,
      });
    }
  }

  // ==================== REORDER LESSONS ====================
  static async reorderLessons(req: Request, res: Response) {
    try {
      const { lesson_orders } = req.body;

      if (!Array.isArray(lesson_orders)) {
        return res.status(400).json({
          success: false,
          message: "lesson_orders must be an array",
        });
      }

      const lessonRepo = dbConnection.getRepository(Lesson);

      for (const item of lesson_orders) {
        await lessonRepo.update({ id: item.id }, { order_index: item.order_index });
      }

      res.json({
        success: true,
        message: "Lessons reordered successfully",
      });
    } catch (error: any) {
      console.error("❌ Reorder lessons error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reorder lessons",
        error: error.message,
      });
    }
  }

  // ==================== PUBLISH LESSON ====================
  static async publishLesson(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const lessonRepo = dbConnection.getRepository(Lesson);
      const lesson = await lessonRepo.findOne({ where: { id } });

      if (!lesson) {
        return res.status(404).json({
          success: false,
          message: "Lesson not found",
        });
      }

      lesson.is_published = true;
      await lessonRepo.save(lesson);

      res.json({
        success: true,
        message: "Lesson published successfully",
        data: lesson,
      });
    } catch (error: any) {
      console.error("❌ Publish lesson error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to publish lesson",
        error: error.message,
      });
    }
  }

  // ==================== DELETE RESOURCE ====================
  static async deleteResource(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { resource_url } = req.body;

      const lessonRepo = dbConnection.getRepository(Lesson);
      const lesson = await lessonRepo.findOne({ where: { id } });

      if (!lesson) {
        return res.status(404).json({
          success: false,
          message: "Lesson not found",
        });
      }

      if (!lesson.resources) {
        return res.status(404).json({
          success: false,
          message: "No resources found",
        });
      }

      // Remove resource from array
      lesson.resources = lesson.resources.filter((r: any) => r.url !== resource_url);

      // Delete from cloud
      try {
        const publicId = resource_url.split("/").slice(-2).join("/").split(".")[0];
        await DeleteFromCloud(publicId, "raw");
      } catch (err) {
        console.warn("⚠️ Could not delete resource from cloud:", err);
      }

      await lessonRepo.save(lesson);

      res.json({
        success: true,
        message: "Resource deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete resource error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete resource",
        error: error.message,
      });
    }
  }
}