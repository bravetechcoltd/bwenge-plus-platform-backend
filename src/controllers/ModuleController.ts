// @ts-nocheck

import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Module } from "../database/models/Module";
import { Course } from "../database/models/Course";
import { ModuleFinalAssessment, ModuleFinalType } from "../database/models/ModuleFinalAssessment";
import { Assessment } from "../database/models/Assessment";

export class ModuleController {
  // ==================== CREATE MODULE ====================
  static async createModule(req: Request, res: Response) {
    try {
      const { course_id, title, description, estimated_duration_hours } = req.body;

      if (!course_id || !title) {
        return res.status(400).json({
          success: false,
          message: "Course ID and title are required",
        });
      }

      const courseRepo = dbConnection.getRepository(Course);
      const moduleRepo = dbConnection.getRepository(Module);

      const course = await courseRepo.findOne({ where: { id: course_id } });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Get next order index
      const existingModules = await moduleRepo.find({ where: { course_id } });
      const order_index = existingModules.length;

      const module = moduleRepo.create({
        course_id,
        title,
        description,
        order_index,
        estimated_duration_hours,
        is_published: false,
      });

      await moduleRepo.save(module);

      res.status(201).json({
        success: true,
        message: "Module created successfully",
        data: module,
      });
    } catch (error: any) {
      console.error("❌ Create module error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create module",
        error: error.message,
      });
    }
  }

  // ==================== GET MODULES BY COURSE ====================
  static async getModulesByCourse(req: Request, res: Response) {
    try {
      const { courseId } = req.params;

      const moduleRepo = dbConnection.getRepository(Module);
      const modules = await moduleRepo
        .createQueryBuilder("module")
        .where("module.course_id = :courseId", { courseId })
        .leftJoinAndSelect("module.lessons", "lessons")
        .leftJoinAndSelect("module.final_assessment", "final_assessment")
        .loadRelationCountAndMap("module.lessonCount", "module.lessons")
        .orderBy("module.order_index", "ASC")
        .addOrderBy("lessons.order_index", "ASC")
        .getMany();

      res.json({
        success: true,
        data: modules,
      });
    } catch (error: any) {
      console.error("❌ Get modules error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch modules",
        error: error.message,
      });
    }
  }

  // ==================== GET MODULE DETAILS ====================
  static async getModuleDetails(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || req.user?.id;

      const moduleRepo = dbConnection.getRepository(Module);
      const module = await moduleRepo
        .createQueryBuilder("module")
        .where("module.id = :id", { id })
        .leftJoinAndSelect("module.lessons", "lessons")
        .leftJoinAndSelect("lessons.assessments", "assessments")
        .leftJoinAndSelect("module.final_assessment", "final_assessment")
        .leftJoinAndSelect("final_assessment.assessment", "fa_assessment")
        .orderBy("lessons.order_index", "ASC")
        .getOne();

      if (!module) {
        return res.status(404).json({
          success: false,
          message: "Module not found",
        });
      }

      res.json({
        success: true,
        data: module,
      });
    } catch (error: any) {
      console.error("❌ Get module details error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch module details",
        error: error.message,
      });
    }
  }

  // ==================== UPDATE MODULE ====================
  static async updateModule(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const moduleRepo = dbConnection.getRepository(Module);
      const module = await moduleRepo.findOne({ where: { id } });

      if (!module) {
        return res.status(404).json({
          success: false,
          message: "Module not found",
        });
      }

      Object.assign(module, updates);
      await moduleRepo.save(module);

      res.json({
        success: true,
        message: "Module updated successfully",
        data: module,
      });
    } catch (error: any) {
      console.error("❌ Update module error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update module",
        error: error.message,
      });
    }
  }

  // ==================== DELETE MODULE ====================
  static async deleteModule(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const moduleRepo = dbConnection.getRepository(Module);
      const module = await moduleRepo.findOne({
        where: { id },
        relations: ["lessons"],
      });

      if (!module) {
        return res.status(404).json({
          success: false,
          message: "Module not found",
        });
      }

      await moduleRepo.remove(module);

      res.json({
        success: true,
        message: "Module deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete module error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete module",
        error: error.message,
      });
    }
  }

  // ==================== REORDER MODULES ====================
  static async reorderModules(req: Request, res: Response) {
    try {
      const { module_orders } = req.body; // Array of { id, order_index }

      if (!Array.isArray(module_orders)) {
        return res.status(400).json({
          success: false,
          message: "module_orders must be an array",
        });
      }

      const moduleRepo = dbConnection.getRepository(Module);

      for (const item of module_orders) {
        await moduleRepo.update({ id: item.id }, { order_index: item.order_index });
      }

      res.json({
        success: true,
        message: "Modules reordered successfully",
      });
    } catch (error: any) {
      console.error("❌ Reorder modules error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reorder modules",
        error: error.message,
      });
    }
  }

  // ==================== PUBLISH MODULE ====================
  static async publishModule(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const moduleRepo = dbConnection.getRepository(Module);
      const module = await moduleRepo.findOne({
        where: { id },
        relations: ["lessons"],
      });

      if (!module) {
        return res.status(404).json({
          success: false,
          message: "Module not found",
        });
      }

      if (!module.lessons || module.lessons.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot publish module without lessons",
        });
      }

      module.is_published = true;
      await moduleRepo.save(module);

      res.json({
        success: true,
        message: "Module published successfully",
        data: module,
      });
    } catch (error: any) {
      console.error("❌ Publish module error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to publish module",
        error: error.message,
      });
    }
  }

  // ==================== CREATE MODULE FINAL ASSESSMENT ====================
  static async createModuleFinalAssessment(req: Request, res: Response) {
    try {
      const { id } = req.params; // module_id
      const {
        title,
        type,
        assessment_id,
        project_instructions,
        passing_score_percentage,
        time_limit_minutes,
        requires_file_submission,
      } = req.body;

      if (!title || !type) {
        return res.status(400).json({
          success: false,
          message: "Title and type are required",
        });
      }

      const moduleRepo = dbConnection.getRepository(Module);
      const finalAssessmentRepo = dbConnection.getRepository(ModuleFinalAssessment);

      const module = await moduleRepo.findOne({
        where: { id },
        relations: ["final_assessment"],
      });

      if (!module) {
        return res.status(404).json({
          success: false,
          message: "Module not found",
        });
      }

      if (module.final_assessment) {
        return res.status(400).json({
          success: false,
          message: "Module already has a final assessment",
        });
      }

      const finalAssessment = finalAssessmentRepo.create({
        module_id: id,
        title,
        type: type as ModuleFinalType,
        assessment_id: type === "ASSESSMENT" ? assessment_id : null,
        project_instructions: type === "PROJECT" ? project_instructions : null,
        passing_score_percentage: passing_score_percentage || 70,
        time_limit_minutes,
        requires_file_submission: requires_file_submission || false,
      });

      await finalAssessmentRepo.save(finalAssessment);

      res.status(201).json({
        success: true,
        message: "Module final assessment created successfully",
        data: finalAssessment,
      });
    } catch (error: any) {
      console.error("❌ Create module final assessment error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create module final assessment",
        error: error.message,
      });
    }
  }
}