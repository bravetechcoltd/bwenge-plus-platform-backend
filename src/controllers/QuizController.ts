// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Quiz } from "../database/models/Quiz";
import { Question, QuestionType } from "../database/models/Question";
import { Course } from "../database/models/Course";

export class QuizController {
  // ==================== CREATE QUIZ ====================
  static async createQuiz(req: Request, res: Response) {
    try {
      const {
        course_id,
        lesson_id,
        title,
        description,
        passing_score,
        time_limit_minutes,
        max_attempts,
        shuffle_questions,
        show_correct_answers,
      } = req.body;

      if (!course_id || !title) {
        return res.status(400).json({
          success: false,
          message: "Course ID and title are required",
        });
      }

      const quizRepo = dbConnection.getRepository(Quiz);
      const courseRepo = dbConnection.getRepository(Course);

      const course = await courseRepo.findOne({ where: { id: course_id } });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      const quiz = quizRepo.create({
        course_id,
        lesson_id: lesson_id || null,
        title,
        description,
        passing_score: passing_score || 70,
        time_limit_minutes,
        max_attempts: max_attempts || 3,
        shuffle_questions: shuffle_questions || false,
        show_correct_answers: show_correct_answers || false,
        is_published: false,
      });

      await quizRepo.save(quiz);

      res.status(201).json({
        success: true,
        message: "Quiz created successfully",
        data: quiz,
      });
    } catch (error: any) {
      console.error("❌ Create quiz error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create quiz",
        error: error.message,
      });
    }
  }

  // ==================== GET QUIZZES BY LESSON ====================
  static async getQuizzesByLesson(req: Request, res: Response) {
    try {
      const { lessonId } = req.params;

      const quizRepo = dbConnection.getRepository(Quiz);
      const quizzes = await quizRepo.find({
        where: { lesson_id: lessonId, is_published: true },
        relations: ["questions"],
      });

      res.json({
        success: true,
        data: quizzes,
      });
    } catch (error: any) {
      console.error("❌ Get quizzes error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch quizzes",
        error: error.message,
      });
    }
  }

  // ==================== GET QUIZ BY ID ====================
  static async getQuizById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const quizRepo = dbConnection.getRepository(Quiz);
      const quiz = await quizRepo.findOne({
        where: { id },
        relations: ["questions", "lesson", "course"],
      });

      if (!quiz) {
        return res.status(404).json({
          success: false,
          message: "Quiz not found",
        });
      }

      // Sort questions by order_index
      if (quiz.questions) {
        quiz.questions.sort((a, b) => a.order_index - b.order_index);
      }

      res.json({
        success: true,
        data: quiz,
      });
    } catch (error: any) {
      console.error("❌ Get quiz error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch quiz",
        error: error.message,
      });
    }
  }

  // ==================== UPDATE QUIZ ====================
  static async updateQuiz(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const quizRepo = dbConnection.getRepository(Quiz);
      const quiz = await quizRepo.findOne({ where: { id } });

      if (!quiz) {
        return res.status(404).json({
          success: false,
          message: "Quiz not found",
        });
      }

      Object.assign(quiz, updates);
      await quizRepo.save(quiz);

      res.json({
        success: true,
        message: "Quiz updated successfully",
        data: quiz,
      });
    } catch (error: any) {
      console.error("❌ Update quiz error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update quiz",
        error: error.message,
      });
    }
  }

  // ==================== DELETE QUIZ ====================
  static async deleteQuiz(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const quizRepo = dbConnection.getRepository(Quiz);
      const quiz = await quizRepo.findOne({ where: { id } });

      if (!quiz) {
        return res.status(404).json({
          success: false,
          message: "Quiz not found",
        });
      }

      await quizRepo.remove(quiz);

      res.json({
        success: true,
        message: "Quiz deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete quiz error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete quiz",
        error: error.message,
      });
    }
  }

  // ==================== ADD QUESTION TO QUIZ ====================
  static async addQuestion(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const {
        question_text,
        question_type,
        options,
        correct_answer,
        explanation,
        points,
        image_url,
      } = req.body;

      if (!question_text || !question_type || !correct_answer) {
        return res.status(400).json({
          success: false,
          message: "Question text, type, and correct answer are required",
        });
      }

      const quizRepo = dbConnection.getRepository(Quiz);
      const questionRepo = dbConnection.getRepository(Question);

      const quiz = await quizRepo.findOne({
        where: { id },
        relations: ["questions"],
      });

      if (!quiz) {
        return res.status(404).json({
          success: false,
          message: "Quiz not found",
        });
      }

      const order_index = quiz.questions ? quiz.questions.length : 0;

      const question = questionRepo.create({
        quiz_id: id,
        question_text,
        question_type: question_type as QuestionType,
        options: options || null,
        correct_answer,
        explanation,
        points: points || 1,
        order_index,
        image_url,
      });

      await questionRepo.save(question);

      res.status(201).json({
        success: true,
        message: "Question added successfully",
        data: question,
      });
    } catch (error: any) {
      console.error("❌ Add question error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to add question",
        error: error.message,
      });
    }
  }

  // ==================== UPDATE QUESTION ====================
  static async updateQuestion(req: Request, res: Response) {
    try {
      const { id, questionId } = req.params;
      const updates = req.body;

      const questionRepo = dbConnection.getRepository(Question);
      const question = await questionRepo.findOne({
        where: { id: questionId, quiz_id: id },
      });

      if (!question) {
        return res.status(404).json({
          success: false,
          message: "Question not found",
        });
      }

      Object.assign(question, updates);
      await questionRepo.save(question);

      res.json({
        success: true,
        message: "Question updated successfully",
        data: question,
      });
    } catch (error: any) {
      console.error("❌ Update question error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update question",
        error: error.message,
      });
    }
  }

  // ==================== DELETE QUESTION ====================
  static async deleteQuestion(req: Request, res: Response) {
    try {
      const { id, questionId } = req.params;

      const questionRepo = dbConnection.getRepository(Question);
      const question = await questionRepo.findOne({
        where: { id: questionId, quiz_id: id },
      });

      if (!question) {
        return res.status(404).json({
          success: false,
          message: "Question not found",
        });
      }

      await questionRepo.remove(question);

      res.json({
        success: true,
        message: "Question deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete question error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete question",
        error: error.message,
      });
    }
  }

  // ==================== PUBLISH QUIZ ====================
  static async publishQuiz(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const quizRepo = dbConnection.getRepository(Quiz);
      const quiz = await quizRepo.findOne({
        where: { id },
        relations: ["questions"],
      });

      if (!quiz) {
        return res.status(404).json({
          success: false,
          message: "Quiz not found",
        });
      }

      if (!quiz.questions || quiz.questions.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot publish quiz without questions",
        });
      }

      quiz.is_published = true;
      await quizRepo.save(quiz);

      res.json({
        success: true,
        message: "Quiz published successfully",
        data: quiz,
      });
    } catch (error: any) {
      console.error("❌ Publish quiz error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to publish quiz",
        error: error.message,
      });
    }
  }

  // ==================== BULK ADD QUESTIONS ====================
  static async bulkAddQuestions(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { questions } = req.body;

      if (!Array.isArray(questions)) {
        return res.status(400).json({
          success: false,
          message: "Questions must be an array",
        });
      }

      const quizRepo = dbConnection.getRepository(Quiz);
      const questionRepo = dbConnection.getRepository(Question);

      const quiz = await quizRepo.findOne({
        where: { id },
        relations: ["questions"],
      });

      if (!quiz) {
        return res.status(404).json({
          success: false,
          message: "Quiz not found",
        });
      }

      let order_index = quiz.questions ? quiz.questions.length : 0;
      const savedQuestions = [];

      for (const questionData of questions) {
        const question = questionRepo.create({
          quiz_id: id,
          question_text: questionData.question_text,
          question_type: questionData.question_type as QuestionType,
          options: questionData.options || null,
          correct_answer: questionData.correct_answer,
          explanation: questionData.explanation,
          points: questionData.points || 1,
          order_index: order_index++,
          image_url: questionData.image_url,
        });

        const saved = await questionRepo.save(question);
        savedQuestions.push(saved);
      }

      res.status(201).json({
        success: true,
        message: `${savedQuestions.length} questions added successfully`,
        data: savedQuestions,
      });
    } catch (error: any) {
      console.error("❌ Bulk add questions error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to add questions",
        error: error.message,
      });
    }
  }
}