
// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Assessment } from "../database/models/Assessment";

export class AssessmentController {
  static async getAssessmentById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const assessmentRepo = dbConnection.getRepository(Assessment);
      const assessment = await assessmentRepo.findOne({
        where: { id },
        relations: ["course", "lesson", "module"]
      });

      if (!assessment) {
        return res.status(404).json({
          success: false,
          message: "Assessment not found"
        });
      }

      res.json({
        success: true,
        data: assessment
      });
    } catch (error: any) {
      console.error("❌ Get assessment error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch assessment",
        error: error.message
      });
    }
  }
}
