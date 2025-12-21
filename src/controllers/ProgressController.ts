// @ts-nocheck
import { Request, Response } from "express";
import dbConnection from "../database/db";
import { Progress } from "../database/models/Progress";
import { Enrollment, EnrollmentStatus } from "../database/models/Enrollment";
import { Course } from "../database/models/Course";
import { Assessment } from "../database/models/Assessment";
import { AssessmentAttempt } from "../database/models/AssessmentAttempt";
import { User } from "../database/models/User";
import { Not, IsNull, In } from "typeorm";
import { Lesson } from "../database/models/Lesson";
import { Answer } from "../database/models/Answer";

export class ProgressController {

// ==================== GET USER PROGRESS FOR A COURSE - FIXED VERSION ====================
static async getUserProgress(req: Request, res: Response) {
  try {
    const { courseId, userId } = req.params;
    const requestingUserId = req.user?.userId || req.user?.id;

    if (!courseId || !userId) {
      return res.status(400).json({
        success: false,
        message: "Course ID and User ID are required",
      });
    }

    // Verify user has access to view this progress
    const hasAccess = requestingUserId === userId ||
      await ProgressController.checkProgressViewAccess(courseId, requestingUserId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to view this progress",
      });
    }

    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const progressRepo = dbConnection.getRepository(Progress);
    const assessmentAttemptRepo = dbConnection.getRepository(AssessmentAttempt);
    const courseRepo = dbConnection.getRepository(Course);
    const answerRepo = dbConnection.getRepository(Answer);
    const assessmentRepo = dbConnection.getRepository(Assessment); // Moved up to avoid duplicate declaration

    // Get enrollment (required for final score and time tracking)
    const enrollment = await enrollmentRepo.findOne({
      where: {
        user_id: userId,
        course_id: courseId
      },
    });

    // Get course with modules and lessons for duration data
    const course = await courseRepo.findOne({
      where: { id: courseId },
      relations: [
        "modules",
        "modules.lessons",
        "modules.lessons.assessments",
        "modules.final_assessment",
      ],
      order: {
        modules: { order_index: "ASC" },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    // Get all progress records
    const progressRecords = await progressRepo.find({
      where: {
        user_id: userId,
        course_id: courseId,
      },
      relations: ["lesson", "assessment"],
      order: {
        last_accessed_at: "DESC",
      },
    });

    // ==================== FIX: GET ACTUAL ANSWERS FOR SCORE CALCULATION ====================
    // Get all answers for this user and course to calculate actual scores
    const assessmentIdsInProgress = progressRecords
      .filter(p => p.assessment_id)
      .map(p => p.assessment_id)
      .filter(Boolean) as string[];

    // Create a map of assessment_id -> total points earned from answers
    const assessmentScoreMap = new Map<string, { earned: number; possible: number }>();
    
    if (assessmentIdsInProgress.length > 0) {
      const allAnswers = await answerRepo.find({
        where: {
          user_id: userId,
          assessment_id: In(assessmentIdsInProgress),
          is_final_submission: true,
        },
        order: {
          created_at: "DESC",
        },
      });

      // Group answers by assessment
      for (const answer of allAnswers) {
        if (answer.assessment_id) {
          const key = answer.assessment_id;
          if (!assessmentScoreMap.has(key)) {
            assessmentScoreMap.set(key, { earned: 0, possible: -1 }); // -1 indicates not calculated yet
          }
          const current = assessmentScoreMap.get(key)!;
          current.earned += answer.points_earned || 0;
        }
      }

      // Get total possible points for each assessment
      for (const assessmentId of assessmentIdsInProgress) {
        const assessment = await assessmentRepo.findOne({
          where: { id: assessmentId },
          select: ["questions"]
        });
        
        if (assessment?.questions && Array.isArray(assessment.questions)) {
          const totalPossiblePoints = assessment.questions.reduce((sum, q) => sum + (q.points || 1), 0);
          if (assessmentScoreMap.has(assessmentId)) {
            const currentScore = assessmentScoreMap.get(assessmentId)!;
            currentScore.possible = totalPossiblePoints;
          } else {
            assessmentScoreMap.set(assessmentId, { earned: 0, possible: totalPossiblePoints });
          }
          
          console.log(`✅ [getUserProgress] Assessment ${assessmentId} points: ${assessmentScoreMap.get(assessmentId)?.earned}/${totalPossiblePoints}`);
        }
      }
    }

    // Get all assessment attempts for detailed history
    const assessmentAttempts = assessmentIdsInProgress.length > 0 ? await assessmentAttemptRepo.find({
      where: {
        user_id: userId,
        assessment_id: In(assessmentIdsInProgress),
      },
      relations: ["assessment"],
      order: {
        started_at: "DESC",
      },
    }) : [];

    // FIX: Filter out duplicate progress records
    const uniqueProgressRecords: Progress[] = [];
    const seenSteps = new Map<string, Progress>();

    progressRecords.forEach(progress => {
      let key: string;
      
      if (progress.lesson_id && !progress.assessment_id) {
        key = `lesson:${progress.lesson_id}`;
      } else if (progress.assessment_id) {
        key = `assessment:${progress.assessment_id}`;
      } else {
        return;
      }

      if (!seenSteps.has(key) || 
          (seenSteps.get(key)!.last_accessed_at < progress.last_accessed_at)) {
        seenSteps.set(key, progress);
      }
    });

    const filteredProgressRecords = Array.from(seenSteps.values());

    // ==================== FIX: CALCULATE TOTAL TIME SPENT ====================
    const totalTimeSpentSeconds = filteredProgressRecords.reduce((total, progress) => {
      return total + (progress.time_spent_seconds || 0);
    }, 0);

    const totalTimeSpentMinutes = Math.ceil(totalTimeSpentSeconds / 60);

    // ==================== FIX: BUILD COMPLETED STEPS WITH ACTUAL SCORE FROM ANSWERS ====================
    const completedSteps = filteredProgressRecords.map(progress => {
      if (progress.lesson_id && !progress.assessment_id) {
        // Get lesson duration from course structure if available
        const lessonDuration = course.modules
          ?.flatMap(m => m.lessons || [])
          .find(l => l.id === progress.lesson_id)
          ?.duration_minutes || 0;
        
        // Convert lesson duration to seconds for accurate time tracking
        const estimatedTimeSpent = lessonDuration * 60;
        const actualTimeSpent = progress.time_spent_seconds || estimatedTimeSpent || 0;
        
        return {
          type: "lesson",
          id: progress.lesson_id,
          lessonId: progress.lesson_id,
          assessmentId: null,
          isCompleted: progress.is_completed,
          completedAt: progress.completed_at,
          progress_percentage: progress.completion_percentage,
          time_spent_seconds: actualTimeSpent,
          last_accessed_at: progress.last_accessed_at,
          quiz_score: progress.score,
          status: progress.status,
        };
      } else if (progress.assessment_id) {
        // Get assessment time limit for time estimation
        const assessmentTimeLimit = assessmentAttempts
          .find(a => a.assessment_id === progress.assessment_id)
          ?.assessment?.time_limit_minutes || 0;
        
        // Convert assessment time limit to seconds
        const estimatedAssessmentTime = assessmentTimeLimit * 60;
        const actualAssessmentTime = progress.time_spent_seconds || estimatedAssessmentTime || 0;
        
        // Find the latest attempt for this assessment
        const latestAttempt = assessmentAttempts
          .filter(a => a.assessment_id === progress.assessment_id)
          .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
        
        // ==================== FIX: GET ACTUAL SCORE FROM ANSWERS ====================
        let actualScore = progress.score || latestAttempt?.score || null;
        let actualPercentage = progress.completion_percentage || latestAttempt?.percentage || 0;
        
        // If score is null but we have answers, calculate from answers
        if ((actualScore === null || actualScore === undefined) && assessmentScoreMap.has(progress.assessment_id)) {
          const scoreData = assessmentScoreMap.get(progress.assessment_id)!;
          if (scoreData.possible > 0) {
            actualScore = scoreData.earned;
            actualPercentage = (scoreData.earned / scoreData.possible) * 100;
            
            console.log(`🎯 [getUserProgress] Calculated actual score for ${progress.assessment_id}: ${actualScore}/${scoreData.possible} (${actualPercentage}%)`);
          }
        }
        
        return {
          type: "assessment",
          id: progress.assessment_id,
          lessonId: progress.lesson_id,
          assessmentId: progress.assessment_id,
          isCompleted: progress.is_completed,
          completedAt: progress.completed_at,
          score: actualScore, // ✅ FIX: Use actual calculated score
          percentage: actualPercentage, // ✅ FIX: Use actual calculated percentage
          passed: progress.is_completed || (latestAttempt?.passed || false),
          attempt_number: progress.attempt_count || latestAttempt?.attempt_number || 1,
          status: progress.status || (progress.is_completed ? "passed" : "pending"),
          time_spent_seconds: actualAssessmentTime,
        };
      }
      return null;
    }).filter(Boolean);

    // ==================== FIX: CALCULATE OVERALL PROGRESS (INCLUDES ASSESSMENTS) ====================
    const totalLessons = course.modules?.reduce(
      (sum, module) => sum + (module.lessons?.length || 0),
      0
    ) || 0;

    const totalAssessments = course.modules?.reduce(
      (sum, module) => {
        const lessonAssessments = module.lessons?.reduce(
          (lessonSum, lesson) => lessonSum + (lesson.assessments?.length || 0),
          0
        ) || 0;
        return sum + lessonAssessments + (module.final_assessment ? 1 : 0);
      },
      0
    ) || 0;

    const totalSteps = totalLessons + totalAssessments;

    // Count completed steps (lessons AND assessments)
    const completedStepsCount = filteredProgressRecords.filter(p => 
      p.is_completed && (p.lesson_id || p.assessment_id)
    ).length;

    const overallProgress = totalSteps > 0
      ? Math.round((completedStepsCount / totalSteps) * 100)
      : 0;

    // ==================== FIX: CALCULATE FINAL SCORE WITH ACTUAL ASSESSMENT SCORES ====================
    let finalScore: number | null = null;
    if (enrollment?.status === "COMPLETED" || overallProgress >= 100) {
      // Calculate average score from completed assessments using ACTUAL scores
      const assessmentScores = (completedSteps as any[])
        .filter((step: any) => step.type === "assessment" && step.score !== null && typeof step.score === 'number')
        .map((step: any) => step.score) as number[];
      
      if (assessmentScores.length > 0) {
        finalScore = Math.round(
          assessmentScores.reduce((sum, score) => sum + score, 0) / assessmentScores.length
        );
      } else {
        // If no assessment scores, use progress percentage as final score
        finalScore = overallProgress;
      }
    } else if (enrollment?.final_score !== null && enrollment?.final_score !== undefined) {
      // Use enrollment final score if available
      finalScore = enrollment.final_score;
    }

    // Find current step (last accessed)
    const sortedUniqueRecords = [...filteredProgressRecords].sort((a, b) => 
      new Date(b.last_accessed_at).getTime() - new Date(a.last_accessed_at).getTime()
    );
    
    const lastAccessed = sortedUniqueRecords[0];

    // ==================== FIX: ENSURE ENROLLMENT IS UPDATED WITH CALCULATIONS ====================
    if (enrollment) {
      // Update enrollment with calculated values
      enrollment.total_time_spent_minutes = totalTimeSpentMinutes;
      enrollment.completed_lessons = filteredProgressRecords.filter(p => 
        p.is_completed && p.lesson_id && !p.assessment_id
      ).length;
      enrollment.progress_percentage = overallProgress;
      
      if (overallProgress >= 100 && enrollment.status !== "COMPLETED") {
        enrollment.status = EnrollmentStatus.COMPLETED;
        enrollment.completion_date = new Date();
        if (finalScore !== null) {
          enrollment.final_score = finalScore;
        }
      }
      
      // If final score was calculated from answers and enrollment doesn't have one, update it
      if (finalScore !== null && (enrollment.final_score === null || enrollment.final_score === undefined)) {
        enrollment.final_score = finalScore;
      }
      
      await enrollmentRepo.save(enrollment);
    }

    // ==================== FIX: PROPERLY FORMAT FINAL SCORE ====================
    let formattedFinalScore: string | null = null;
    if (enrollment?.final_score !== null && enrollment?.final_score !== undefined) {
      // Enrollment final score is a number (decimal with precision 5, scale 2)
      formattedFinalScore = typeof enrollment.final_score === 'number' 
        ? enrollment.final_score.toFixed(2) 
        : parseFloat(enrollment.final_score as any).toFixed(2);
    } else if (finalScore !== null) {
      // Use calculated final score
      formattedFinalScore = finalScore.toFixed(2);
    }

    const response = {
      courseId,
      userId,
      enrollmentId: enrollment?.id || null,
      enrollmentStatus: enrollment?.status || "ACTIVE",
      completedSteps,
      overallProgress,
      enrollmentProgressPercentage: enrollment?.progress_percentage || 0,
      currentStepId: lastAccessed?.lesson_id || lastAccessed?.assessment_id || null,
      lastAccessedAt: lastAccessed?.last_accessed_at || enrollment?.enrolled_at || new Date(),
      totalLessons,
      completedLessons: enrollment?.completed_lessons || 0,
      totalTimeSpentMinutes,
      finalScore: formattedFinalScore, // ✅ FIX: Use properly formatted score
      completionDate: enrollment?.completion_date || null,
    };

    res.json({
      success: true,
      message: "User progress retrieved successfully",
      progress: response,
    });
  } catch (error: any) {
    console.error("❌ Get user progress error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user progress",
      error: error.message,
    });
  }
}
// ==================== GET COURSE PROGRESS FOR CURRENT USER (NEW ENDPOINT) ====================
static async getCourseProgressForCurrentUser(req: Request, res: Response) {
  try {
    const { courseId } = req.params;
    const userId = req.user?.userId || req.user?.id;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    console.log(`📊 [getCourseProgressForCurrentUser] Fetching progress for user ${userId}, course ${courseId}`);

    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const progressRepo = dbConnection.getRepository(Progress);
    const courseRepo = dbConnection.getRepository(Course);
    const answerRepo = dbConnection.getRepository(Answer);
    const assessmentRepo = dbConnection.getRepository(Assessment);

    // Get enrollment
    const enrollment = await enrollmentRepo.findOne({
      where: {
        user_id: userId,
        course_id: courseId
      },
    });

    if (!enrollment) {
      // User is not enrolled, return empty progress
      return res.json({
        success: true,
        progress: {
          courseId,
          userId,
          enrollmentId: null,
          enrollmentStatus: null,
          completedSteps: [],
          overallProgress: 0,
          enrollmentProgressPercentage: 0,
          currentStepId: null,
          lastAccessedAt: new Date(),
          totalLessons: 0,
          completedLessons: 0,
          totalTimeSpentMinutes: 0,
          finalScore: null,
          completionDate: null,
        },
      });
    }

    // Get course with modules and lessons
    const course = await courseRepo.findOne({
      where: { id: courseId },
      relations: [
        "modules",
        "modules.lessons",
        "modules.lessons.assessments",
        "modules.final_assessment",
      ],
      order: {
        modules: { order_index: "ASC" },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    // Get all progress records for this user and course
    const progressRecords = await progressRepo.find({
      where: {
        user_id: userId,
        course_id: courseId,
      },
      relations: ["lesson", "assessment"],
      order: {
        last_accessed_at: "DESC",
      },
    });

    // Filter out duplicate progress records (keep latest per step)
    const uniqueProgressRecords = ProgressController.deduplicateProgress(progressRecords);

    // Get assessment IDs for score calculation
    const assessmentIdsInProgress = uniqueProgressRecords
      .filter(p => p.assessment_id)
      .map(p => p.assessment_id)
      .filter(Boolean) as string[];

    // Create assessment score map from answers
    const assessmentScoreMap = new Map<string, { earned: number; possible: number }>();
    
    if (assessmentIdsInProgress.length > 0) {
      const allAnswers = await answerRepo.find({
        where: {
          user_id: userId,
          assessment_id: In(assessmentIdsInProgress),
          is_final_submission: true,
        },
        order: {
          created_at: "DESC",
        },
      });

      // Group answers by assessment
      for (const answer of allAnswers) {
        if (answer.assessment_id) {
          const key = answer.assessment_id;
          if (!assessmentScoreMap.has(key)) {
            assessmentScoreMap.set(key, { earned: 0, possible: -1 });
          }
          const current = assessmentScoreMap.get(key)!;
          current.earned += answer.points_earned || 0;
        }
      }

      // Get total possible points for each assessment
      for (const assessmentId of assessmentIdsInProgress) {
        const assessment = await assessmentRepo.findOne({
          where: { id: assessmentId },
          select: ["questions"]
        });
        
        if (assessment?.questions && Array.isArray(assessment.questions)) {
          const totalPossiblePoints = assessment.questions.reduce((sum, q) => sum + (q.points || 1), 0);
          if (assessmentScoreMap.has(assessmentId)) {
            const currentScore = assessmentScoreMap.get(assessmentId)!;
            currentScore.possible = totalPossiblePoints;
          } else {
            assessmentScoreMap.set(assessmentId, { earned: 0, possible: totalPossiblePoints });
          }
        }
      }
    }

    // Build completed steps array
    const completedSteps = uniqueProgressRecords.map(progress => {
      if (progress.lesson_id && !progress.assessment_id) {
        return {
          type: "lesson",
          id: progress.lesson_id,
          lessonId: progress.lesson_id,
          assessmentId: null,
          isCompleted: progress.is_completed,
          completedAt: progress.completed_at,
          progress_percentage: progress.completion_percentage,
          time_spent_seconds: progress.time_spent_seconds || 0,
          last_accessed_at: progress.last_accessed_at,
          quiz_score: progress.score,
          status: progress.status,
        };
      } else if (progress.assessment_id) {
        // Get score from map if available
        let actualScore = progress.score;
        let actualPercentage = progress.completion_percentage;
        
        if (assessmentScoreMap.has(progress.assessment_id)) {
          const scoreData = assessmentScoreMap.get(progress.assessment_id)!;
          if (scoreData.possible > 0) {
            actualScore = scoreData.earned;
            actualPercentage = (scoreData.earned / scoreData.possible) * 100;
          }
        }
        
        return {
          type: "assessment",
          id: progress.assessment_id,
          lessonId: progress.lesson_id,
          assessmentId: progress.assessment_id,
          isCompleted: progress.is_completed,
          completedAt: progress.completed_at,
          score: actualScore,
          percentage: actualPercentage,
          passed: progress.is_completed || progress.status === "passed",
          attempt_number: progress.attempt_count || 1,
          status: progress.status || (progress.is_completed ? "passed" : "pending"),
          time_spent_seconds: progress.time_spent_seconds || 0,
        };
      }
      return null;
    }).filter(Boolean);

    // Calculate total lessons and assessments
    const totalLessons = course.modules?.reduce(
      (sum, module) => sum + (module.lessons?.length || 0),
      0
    ) || 0;

    const totalAssessments = course.modules?.reduce(
      (sum, module) => {
        const lessonAssessments = module.lessons?.reduce(
          (lessonSum, lesson) => lessonSum + (lesson.assessments?.length || 0),
          0
        ) || 0;
        return sum + lessonAssessments + (module.final_assessment ? 1 : 0);
      },
      0
    ) || 0;

    const totalSteps = totalLessons + totalAssessments;

    // Count completed steps
    const completedStepsCount = uniqueProgressRecords.filter(p => 
      p.is_completed && (p.lesson_id || p.assessment_id)
    ).length;

    const overallProgress = totalSteps > 0
      ? Math.round((completedStepsCount / totalSteps) * 100)
      : 0;

    // Calculate total time spent
    const totalTimeSpentSeconds = uniqueProgressRecords.reduce(
      (total, progress) => total + (progress.time_spent_seconds || 0), 0
    );
    const totalTimeSpentMinutes = Math.ceil(totalTimeSpentSeconds / 60);

    // Find last accessed step
    const sortedRecords = [...uniqueProgressRecords].sort((a, b) => 
      new Date(b.last_accessed_at).getTime() - new Date(a.last_accessed_at).getTime()
    );
    
    const lastAccessed = sortedRecords[0];

    // Format final score
    let formattedFinalScore: string | null = null;
    if (enrollment.final_score !== null && enrollment.final_score !== undefined) {
      formattedFinalScore = typeof enrollment.final_score === 'number' 
        ? enrollment.final_score.toFixed(2) 
        : parseFloat(enrollment.final_score as any).toFixed(2);
    }

    // Prepare module progress data
    const modulesWithProgress = course.modules?.map(module => {
      const moduleLessons = module.lessons || [];
      
      // Find progress for each lesson in this module
      const lessonsWithProgress = moduleLessons.map(lesson => {
        const lessonProgress = uniqueProgressRecords.find(p => p.lesson_id === lesson.id);
        return {
          id: lesson.id,
          title: lesson.title,
          completed: lessonProgress?.is_completed || false,
          duration_minutes: lesson.duration_minutes || 0,
          progress_percentage: lessonProgress?.completion_percentage || 0,
        };
      });

      const completedCount = lessonsWithProgress.filter(l => l.completed).length;
      const moduleProgressPercentage = lessonsWithProgress.length > 0
        ? (completedCount / lessonsWithProgress.length) * 100
        : 0;

      return {
        id: module.id,
        title: module.title,
        progress: moduleProgressPercentage,
        lessons: lessonsWithProgress,
      };
    }) || [];

    const response = {
      courseId,
      userId,
      enrollmentId: enrollment.id,
      enrollmentStatus: enrollment.status,
      completedSteps,
      overallProgress,
      enrollmentProgressPercentage: enrollment.progress_percentage || 0,
      currentStepId: lastAccessed?.lesson_id || lastAccessed?.assessment_id || null,
      lastAccessedAt: lastAccessed?.last_accessed_at || enrollment.enrolled_at || new Date(),
      totalLessons,
      completedLessons: enrollment.completed_lessons || 0,
      totalTimeSpentMinutes,
      finalScore: formattedFinalScore,
      completionDate: enrollment.completion_date || null,
      modules: modulesWithProgress,
    };

    res.json({
      success: true,
      message: "Course progress retrieved successfully",
      progress: response,
    });

  } catch (error: any) {
    console.error("❌ Get course progress error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch course progress",
      error: error.message,
    });
  }
}

// ==================== COMPLETE STEP - FIXED WITH SCORE CALCULATION FROM ANSWERS ====================
static async completeStep(req: Request, res: Response) {
  try {
    const {
      courseId,
      userId,
      lessonId,
      assessmentId,
      score,
      percentage,
      answers,
      time_spent_seconds,
      isCompleted = true,
      passed = true,
    } = req.body;

    const requestingUserId = req.user?.userId || req.user?.id;

    console.log("📝 [completeStep] Request received:", {
      courseId,
      userId,
      lessonId,
      assessmentId,
      score,
      percentage,
      isCompleted,
      passed,
    });

    // ==================== VALIDATION ====================
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Verify user is completing their own progress
    if (requestingUserId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own progress",
      });
    }

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
      });
    }

    if (!lessonId && !assessmentId) {
      return res.status(400).json({
        success: false,
        message: "Either lesson ID or assessment ID is required",
      });
    }

    const progressRepo = dbConnection.getRepository(Progress);
    const assessmentAttemptRepo = dbConnection.getRepository(AssessmentAttempt);
    const assessmentRepo = dbConnection.getRepository(Assessment);
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const lessonRepo = dbConnection.getRepository(Lesson);
    const answerRepo = dbConnection.getRepository(Answer);

    // Try to get enrollment for enrollment_id (optional)
    const enrollment = await enrollmentRepo.findOne({
      where: {
        user_id: userId,
        course_id: courseId,
      },
    });

    const enrollmentId = enrollment?.id || null;

    let progressRecord: Progress | null = null;
    let finalScore: number | undefined = undefined;
    let finalPercentage: number | undefined = undefined;

    // ==================== FIX: IMPROVE TIME TRACKING ====================
    let actualTimeSpent = time_spent_seconds || 0;
    
    // If no time provided, calculate based on lesson/assessment duration
    if (!actualTimeSpent && lessonId && !assessmentId) {
      // Try to get lesson duration
      const lesson = await lessonRepo.findOne({ where: { id: lessonId } });
      if (lesson?.duration_minutes) {
        // Convert minutes to seconds (average viewing time)
        actualTimeSpent = Math.round(lesson.duration_minutes * 60 * 0.8); // Assume 80% completion
      } else {
        // Default to 5 minutes for lessons
        actualTimeSpent = 300; // 5 minutes in seconds
      }
    } else if (!actualTimeSpent && assessmentId) {
      // Try to get assessment time limit
      const assessment = await assessmentRepo.findOne({ where: { id: assessmentId } });
      if (assessment?.time_limit_minutes) {
        // Use 70% of time limit as estimated completion time
        actualTimeSpent = Math.round(assessment.time_limit_minutes * 60 * 0.7);
      } else {
        // Default to 15 minutes for assessments
        actualTimeSpent = 900; // 15 minutes in seconds
      }
    }

    console.log("⏱️ [completeStep] Time tracking:", {
      providedTime: time_spent_seconds,
      actualTimeSpent,
      isLesson: !!lessonId && !assessmentId,
      isAssessment: !!assessmentId,
    });

    // ==================== LESSON PROGRESS ====================
    if (lessonId && !assessmentId) {
      console.log("📚 [completeStep] Processing lesson progress:", lessonId);
      
      let progress = await progressRepo.findOne({
        where: {
          user_id: userId,
          course_id: courseId,
          lesson_id: lessonId,
          assessment_id: IsNull(),
        },
      });

      if (!progress) {
        console.log("✨ [completeStep] Creating new lesson progress");
        progress = progressRepo.create({
          enrollment_id: enrollmentId,
          lesson_id: lessonId,
          assessment_id: null,
          user_id: userId,
          course_id: courseId,
          is_completed: isCompleted,
          completion_percentage: isCompleted ? 100 : percentage || 0,
          time_spent_seconds: actualTimeSpent,
          score: score,
          status: isCompleted ? "completed" : "in_progress",
          last_accessed_at: new Date(),
          completed_at: isCompleted ? new Date() : null,
        });
      } else {
        console.log("🔄 [completeStep] Updating existing lesson progress");
        progress.is_completed = isCompleted;
        progress.completion_percentage = isCompleted ? 100 : percentage || progress.completion_percentage;
        // ✅ FIX: Accumulate time spent
        progress.time_spent_seconds = (progress.time_spent_seconds || 0) + actualTimeSpent;
        if (score !== undefined) {
          progress.score = score;
        }
        progress.status = isCompleted ? "completed" : "in_progress";
        progress.last_accessed_at = new Date();

        // ADD/UPDATE COMPLETED_AT FOR LESSONS
        if (isCompleted && !progress.completed_at) {
          progress.completed_at = new Date();
        }
      }

      await progressRepo.save(progress);
      progressRecord = progress;
      console.log("✅ [completeStep] Lesson progress saved:", progress.id);

      // Update enrollment progress if enrollment exists
      if (enrollmentId) {
        await ProgressController.updateEnrollmentProgress(enrollmentId);
      }
    }

    // ==================== ASSESSMENT PROGRESS - FIXED WITH SCORE CALCULATION ====================
    if (assessmentId) {
      console.log("📝 [completeStep] Processing assessment progress:", assessmentId);
      
      // ==================== CHECK IF ASSESSMENT EXISTS ====================
      const assessment = await assessmentRepo.findOne({
        where: { id: assessmentId },
      });

      const assessmentExists = !!assessment;

      if (assessmentExists) {
        console.log("✅ [completeStep] Assessment found in database:", assessment.title);
      } else {
        console.warn("⚠️ [completeStep] Assessment not found in database, skipping AssessmentAttempt creation");
      }

      // Find or create progress record for assessment
      let progress = await progressRepo.findOne({
        where: {
          user_id: userId,
          course_id: courseId,
          assessment_id: assessmentId,
        },
      });

      // ==================== FIX: CALCULATE ACTUAL SCORE FROM ANSWERS IF NOT PROVIDED ====================
      finalScore = score;
      finalPercentage = percentage;
      
      // If score is not provided, calculate from answers
      if ((finalScore === undefined || finalScore === null) && assessmentId) {
        try {
          // Fetch user's answers for this assessment
          const userAnswers = await answerRepo.find({
            where: {
              user_id: userId,
              assessment_id: assessmentId,
              is_final_submission: true,
            },
          });
          
          if (userAnswers.length > 0) {
            // Calculate total earned points from answers
            const totalEarned = userAnswers.reduce((sum, ans) => sum + (ans.points_earned || 0), 0);
            finalScore = totalEarned;
            
            console.log(`🎯 [completeStep] Calculated score from answers: ${totalEarned} points`);
            
            // Calculate percentage if not provided
            if (finalPercentage === undefined && assessmentExists) {
              // Calculate total possible points from assessment questions
              const totalPossiblePoints = assessment?.questions?.reduce((sum, q) => sum + (q.points || 1), 0) || 0;
              if (totalPossiblePoints > 0) {
                finalPercentage = (totalEarned / totalPossiblePoints) * 100;
                console.log(`📊 [completeStep] Calculated percentage from answers: ${finalPercentage}% (${totalEarned}/${totalPossiblePoints})`);
              }
            }
          }
        } catch (error) {
          console.error("❌ [completeStep] Error calculating score from answers:", error);
        }
      }

      // ==================== ONLY COUNT ATTEMPTS IF ASSESSMENT EXISTS ====================
      let attemptNumber = 1;
      if (assessmentExists) {
        const existingAttempts = await assessmentAttemptRepo.count({
          where: {
            user_id: userId,
            assessment_id: assessmentId,
          },
        });
        attemptNumber = existingAttempts + 1;

        console.log("🔢 [completeStep] Attempt number:", attemptNumber, "/ Max:", assessment.max_attempts);

        // Check if max attempts exceeded (warning only)
        if (assessment.max_attempts && attemptNumber > assessment.max_attempts) {
          console.warn(`⚠️ [completeStep] Max attempts (${assessment.max_attempts}) exceeded, but allowing completion`);
        }
      } else {
        // Use attempt count from progress if it exists
        attemptNumber = (progress?.attempt_count || 0) + 1;
        console.log("🔢 [completeStep] Using progress attempt count:", attemptNumber);
      }

      // Use calculated percentage/score, or fallback to provided values
      const calculatedPercentage = finalPercentage !== undefined ? finalPercentage : (finalScore || 0);
      const isPassed = assessmentExists 
        ? calculatedPercentage >= (assessment.passing_score || 70)
        : passed; // Use passed flag from frontend if assessment not found

      console.log("📊 [completeStep] Assessment results:", {
        score: finalScore,
        percentage: calculatedPercentage,
        passingScore: assessmentExists ? assessment.passing_score : "N/A",
        isPassed,
        frontendPassed: passed,
        assessmentExists,
        calculatedFromAnswers: finalScore !== score, // Flag if we calculated from answers
      });

      // ==================== ONLY CREATE ASSESSMENTATTEMPT IF ASSESSMENT EXISTS ====================
      if (assessmentExists) {
        try {
          const attempt = assessmentAttemptRepo.create({
            user_id: userId,
            assessment_id: assessmentId,
            attempt_number: attemptNumber,
            answers: answers || {},
            score: finalScore || 0,
            percentage: calculatedPercentage || 0,
            passed: isPassed,
            started_at: new Date(),
            submitted_at: isCompleted ? new Date() : null,
            time_taken_seconds: actualTimeSpent || 0,
          });

          await assessmentAttemptRepo.save(attempt);
          console.log("✅ [completeStep] Assessment attempt saved:", attempt.id);
        } catch (attemptError: any) {
          console.error("❌ [completeStep] Failed to save assessment attempt:", attemptError.message);
          // Don't block progress creation if attempt fails
        }
      } else {
        console.log("⏭️ [completeStep] Skipping AssessmentAttempt creation (assessment doesn't exist in DB)");
      }

      // ==================== ALWAYS CREATE/UPDATE PROGRESS RECORD ====================
      if (!progress) {
        console.log("✨ [completeStep] Creating new assessment progress");
        progress = progressRepo.create({
          enrollment_id: enrollmentId,
          assessment_id: assessmentId,
          lesson_id: lessonId || null,
          user_id: userId,
          course_id: courseId,
          is_completed: isPassed && isCompleted,
          completion_percentage: calculatedPercentage || 0,
          time_spent_seconds: actualTimeSpent,
          score: finalScore,
          status: isPassed ? "passed" : "failed",
          attempt_count: attemptNumber,
          answers: answers,
          last_accessed_at: new Date(),
          completed_at: (isPassed && isCompleted) ? new Date() : null,
        });
      } else {
        console.log("🔄 [completeStep] Updating existing assessment progress");
        // Update progress with latest attempt
        progress.is_completed = (isPassed && isCompleted);
        progress.completion_percentage = calculatedPercentage || progress.completion_percentage;
        progress.score = finalScore !== undefined ? finalScore : progress.score;
        progress.status = isPassed ? "passed" : "failed";
        progress.attempt_count = attemptNumber;
        // ✅ FIX: Accumulate time spent
        progress.time_spent_seconds = (progress.time_spent_seconds || 0) + actualTimeSpent;
        progress.answers = answers || progress.answers;
        progress.last_accessed_at = new Date();
        
        // FIX: SET/UPDATE COMPLETED_AT WHEN ASSESSMENT IS PASSED AND COMPLETED
        if (isPassed && isCompleted && !progress.completed_at) {
          progress.completed_at = new Date();
        }
      }

      await progressRepo.save(progress);
      progressRecord = progress;
      console.log("✅ [completeStep] Assessment progress saved:", progress.id, "with score:", progress.score);

      // Update enrollment progress if enrollment exists
      if (enrollmentId) {
        await ProgressController.updateEnrollmentProgress(enrollmentId);
      }
    }

    // ==================== FIX: CALCULATE FINAL SCORE IF COURSE IS COMPLETED ====================
    if (enrollment && (enrollment.progress_percentage === 100 || enrollment.status === "COMPLETED")) {
      console.log("🎯 [completeStep] Course appears completed, calculating final score...");
      
      // Use the calculateFinalScore helper function
      const finalScore = await ProgressController.calculateFinalScore(userId, courseId);
      
      if (finalScore !== null) {
        enrollment.final_score = finalScore;
        enrollment.status = EnrollmentStatus.COMPLETED;
        if (!enrollment.completion_date) {
          enrollment.completion_date = new Date();
        }
        
        await enrollmentRepo.save(enrollment);
        console.log("✅ [completeStep] Final score calculated and saved:", finalScore);
      } else {
        console.log("ℹ️ [completeStep] No final score calculated (no completed assessments)");
      }
    }

    res.json({
      success: true,
      message: "Step completed successfully",
      progress: progressRecord,
      calculatedScore: assessmentId ? finalScore : undefined, // Return the calculated score if applicable
    });
  } catch (error: any) {
    console.error("❌ Complete step error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete step",
      error: error.message,
    });
  }
}
  // ==================== MARK STEP AS PENDING ====================
  static async markStepPending(req: Request, res: Response) {
    try {
      const { courseId, userId, lessonId, assessmentId } = req.body;
      const requestingUserId = req.user?.userId || req.user?.id;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      if (requestingUserId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You can only update your own progress",
        });
      }

      if (!courseId) {
        return res.status(400).json({
          success: false,
          message: "Course ID is required",
        });
      }

      const enrollmentRepo = dbConnection.getRepository(Enrollment);
      const progressRepo = dbConnection.getRepository(Progress);

      // Try to get enrollment (optional)
      const enrollment = await enrollmentRepo.findOne({
        where: { user_id: userId, course_id: courseId },
      });

      const enrollmentId = enrollment?.id || null;

      let progress: Progress | null = null;

      if (lessonId) {
        progress = await progressRepo.findOne({
          where: {
            user_id: userId,
            course_id: courseId,
            lesson_id: lessonId,
            assessment_id: IsNull(),
          },
        });

        if (!progress) {
          progress = progressRepo.create({
            enrollment_id: enrollmentId,
            lesson_id: lessonId,
            assessment_id: null,
            user_id: userId,
            course_id: courseId,
            is_completed: false,
            completion_percentage: 0,
            status: "pending",
          });
        } else {
          progress.is_completed = false;
          progress.status = "pending";
        }

        progress.last_accessed_at = new Date();
        await progressRepo.save(progress);
      } else if (assessmentId) {
        progress = await progressRepo.findOne({
          where: {
            user_id: userId,
            course_id: courseId,
            assessment_id: assessmentId,
          },
        });

        if (!progress) {
          progress = progressRepo.create({
            enrollment_id: enrollmentId,
            assessment_id: assessmentId,
            lesson_id: null,
            user_id: userId,
            course_id: courseId,
            is_completed: false,
            completion_percentage: 0,
            status: "pending",
          });
        } else {
          progress.is_completed = false;
          progress.status = "pending";
        }

        progress.last_accessed_at = new Date();
        await progressRepo.save(progress);
      } else {
        return res.status(400).json({
          success: false,
          message: "Either lesson ID or assessment ID is required",
        });
      }

      res.json({
        success: true,
        message: "Step marked as pending",
        progress,
      });
    } catch (error: any) {
      console.error("❌ Mark step pending error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to mark step as pending",
        error: error.message,
      });
    }
  }

// ==================== UPDATE CURRENT STEP (BOOKMARK) - FIXED WITH TIME TRACKING ====================
static async updateCurrentStep(req: Request, res: Response) {
  try {
    const { courseId, userId, lessonId, assessmentId, time_spent_seconds } = req.body;
    const requestingUserId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    if (requestingUserId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own progress",
      });
    }

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
      });
    }

    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const progressRepo = dbConnection.getRepository(Progress);

    // Try to get enrollment (optional)
    const enrollment = await enrollmentRepo.findOne({
      where: { user_id: userId, course_id: courseId },
    });

    const enrollmentId = enrollment?.id || null;

    // ==================== FIX: BETTER TIME TRACKING ====================
    let actualTimeSpent = time_spent_seconds || 0;
    
    // If no time provided, estimate based on last access
    if (!actualTimeSpent && (lessonId || assessmentId)) {
      // Find existing progress to calculate time since last access
      const existingProgress = await progressRepo.findOne({
        where: {
          user_id: userId,
          course_id: courseId,
          lesson_id: lessonId || IsNull(),
          assessment_id: assessmentId || IsNull(),
        },
      });

      if (existingProgress?.last_accessed_at) {
        const timeSinceLastAccess = Date.now() - new Date(existingProgress.last_accessed_at).getTime();
        // Convert milliseconds to seconds, cap at reasonable time
        actualTimeSpent = Math.min(Math.floor(timeSinceLastAccess / 1000), 3600); // Max 1 hour
        console.log("⏱️ [updateCurrentStep] Calculated time since last access:", actualTimeSpent, "seconds");
      } else {
        // Default time if no previous record
        actualTimeSpent = 60; // 1 minute
        console.log("⏱️ [updateCurrentStep] Using default time:", actualTimeSpent, "seconds");
      }
    } else if (time_spent_seconds) {
      console.log("⏱️ [updateCurrentStep] Using provided time:", time_spent_seconds, "seconds");
    }

    if (lessonId) {
      let progress = await progressRepo.findOne({
        where: {
          user_id: userId,
          course_id: courseId,
          lesson_id: lessonId,
          assessment_id: IsNull(),
        },
      });

      if (!progress) {
        console.log("✨ [updateCurrentStep] Creating new lesson progress");
        progress = progressRepo.create({
          enrollment_id: enrollmentId,
          lesson_id: lessonId,
          assessment_id: null,
          user_id: userId,
          course_id: courseId,
          is_completed: false,
          completion_percentage: 0,
          time_spent_seconds: actualTimeSpent, // ✅ FIX: Track time
          status: "in_progress",
        });
      } else {
        console.log("🔄 [updateCurrentStep] Updating existing lesson progress");
        if (actualTimeSpent) {
          // ✅ FIX: Accumulate time spent
          progress.time_spent_seconds = (progress.time_spent_seconds || 0) + actualTimeSpent;
        }
      }

      progress.last_accessed_at = new Date();
      await progressRepo.save(progress);

      // Update enrollment last accessed if enrollment exists
      if (enrollment) {
        enrollment.last_accessed = new Date();
        await enrollmentRepo.save(enrollment);
      }

      res.json({
        success: true,
        message: "Current step updated",
        progress,
      });
    } else if (assessmentId) {
      let progress = await progressRepo.findOne({
        where: {
          user_id: userId,
          course_id: courseId,
          assessment_id: assessmentId,
        },
      });

      if (!progress) {
        console.log("✨ [updateCurrentStep] Creating new assessment progress");
        progress = progressRepo.create({
          enrollment_id: enrollmentId,
          assessment_id: assessmentId,
          lesson_id: null,
          user_id: userId,
          course_id: courseId,
          is_completed: false,
          completion_percentage: 0,
          time_spent_seconds: actualTimeSpent, // ✅ FIX: Track time
          status: "in_progress",
        });
      } else {
        console.log("🔄 [updateCurrentStep] Updating existing assessment progress");
        if (actualTimeSpent) {
          // ✅ FIX: Accumulate time spent
          progress.time_spent_seconds = (progress.time_spent_seconds || 0) + actualTimeSpent;
        }
      }

      progress.last_accessed_at = new Date();
      await progressRepo.save(progress);

      // Update enrollment last accessed if enrollment exists
      if (enrollment) {
        enrollment.last_accessed = new Date();
        await enrollmentRepo.save(enrollment);
      }

      res.json({
        success: true,
        message: "Current step updated",
        progress,
      });
    } else {
      // Just update last accessed if enrollment exists
      if (enrollment) {
        enrollment.last_accessed = new Date();
        await enrollmentRepo.save(enrollment);
      }

      res.json({
        success: true,
        message: "Last access time updated",
      });
    }
  } catch (error: any) {
    console.error("❌ Update current step error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update current step",
      error: error.message,
    });
  }
}
// ==================== HELPER: CALCULATE FINAL SCORE ====================
private static async calculateFinalScore(userId: string, courseId: string): Promise<number | null> {
  try {
    console.log("🎯 [calculateFinalScore] Calculating final score for user:", userId, "course:", courseId);
    
    const progressRepo = dbConnection.getRepository(Progress);
    const assessmentAttemptRepo = dbConnection.getRepository(AssessmentAttempt);
    
    // Get all completed assessments for this course
    const assessmentProgress = await progressRepo.find({
      where: {
        user_id: userId,
        course_id: courseId,
        assessment_id: Not(IsNull()),
        is_completed: true,
      },
    });

    console.log("📊 [calculateFinalScore] Found assessment progress records:", assessmentProgress.length);

    if (assessmentProgress.length === 0) {
      console.log("ℹ️ [calculateFinalScore] No completed assessments found");
      return null;
    }

    // Get scores from progress records
    const scoresFromProgress = assessmentProgress
      .map(p => p.score)
      .filter(score => score !== null) as number[];

    console.log("📝 [calculateFinalScore] Scores from progress:", scoresFromProgress);

    // Also get scores from assessment attempts for more accuracy
    const assessmentIds = assessmentProgress.map(p => p.assessment_id).filter(Boolean) as string[];
    
    let scoresFromAttempts: number[] = [];
    if (assessmentIds.length > 0) {
      const attempts = await assessmentAttemptRepo.find({
        where: {
          user_id: userId,
          assessment_id: In(assessmentIds),
          passed: true,
        },
        order: {
          started_at: "DESC",
        },
      });

      console.log("📝 [calculateFinalScore] Found assessment attempts:", attempts.length);

      // Group by assessment to get latest score per assessment
      const latestScores = new Map<string, number>();
      attempts.forEach(attempt => {
        if (!latestScores.has(attempt.assessment_id)) {
          latestScores.set(attempt.assessment_id, attempt.percentage);
        }
      });

      scoresFromAttempts = Array.from(latestScores.values());
      console.log("📝 [calculateFinalScore] Latest scores from attempts:", scoresFromAttempts);
    }

    // Combine scores, preferring attempts over progress records
    const allScores = [...scoresFromAttempts, ...scoresFromProgress];
    console.log("📊 [calculateFinalScore] All combined scores:", allScores);

    if (allScores.length === 0) {
      console.log("ℹ️ [calculateFinalScore] No valid scores found");
      return null;
    }

    // Calculate weighted average
    const totalScore = allScores.reduce((sum, score) => sum + score, 0);
    const averageScore = Math.round(totalScore / allScores.length);
    
    console.log("✅ [calculateFinalScore] Final average score:", averageScore);
    
    return averageScore;
  } catch (error) {
    console.error("❌ [calculateFinalScore] Error:", error);
    return null;
  }
}


// ==================== HELPER: DEDUPLICATE PROGRESS RECORDS ====================
private static deduplicateProgress(progressRecords: Progress[]): Progress[] {
  const seenSteps = new Map<string, Progress>();

  progressRecords.forEach(progress => {
    let key: string;
    
    if (progress.lesson_id && !progress.assessment_id) {
      key = `lesson:${progress.lesson_id}`;
    } else if (progress.assessment_id) {
      key = `assessment:${progress.assessment_id}`;
    } else {
      return;
    }

    if (!seenSteps.has(key) || 
        (seenSteps.get(key)!.last_accessed_at < progress.last_accessed_at)) {
      seenSteps.set(key, progress);
    }
  });

  return Array.from(seenSteps.values());
}

  // ==================== RETAKE ASSESSMENT ====================
  static async retakeAssessment(req: Request, res: Response) {
    try {
      const { studentId, userId, assessmentId, courseId } = req.body;
      const requestingUserId = req.user?.userId || req.user?.id;

      const targetUserId = studentId || userId;

      console.log("🔄 [retakeAssessment] Request received:", {
        targetUserId,
        assessmentId,
        courseId,
        requestingUserId,
      });

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      if (!assessmentId) {
        return res.status(400).json({
          success: false,
          message: "Assessment ID is required",
        });
      }

      // Check permissions - user can reset their own, instructors can reset students'
      const canReset = requestingUserId === targetUserId ||
        await ProgressController.checkProgressViewAccess(courseId, requestingUserId);

      if (!canReset) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to reset this assessment",
        });
      }

      const assessmentRepo = dbConnection.getRepository(Assessment);
      const progressRepo = dbConnection.getRepository(Progress);
      const enrollmentRepo = dbConnection.getRepository(Enrollment);

      // Try to get assessment (but don't block if not found)
      const assessment = await assessmentRepo.findOne({
        where: { id: assessmentId },
      });

      if (assessment) {
        console.log("✅ [retakeAssessment] Assessment found:", assessment.title);
      } else {
        console.warn("⚠️ [retakeAssessment] Assessment not found, but continuing with retake");
      }

      // Try to get enrollment (optional)
      const enrollment = await enrollmentRepo.findOne({
        where: {
          user_id: targetUserId,
          course_id: courseId || (assessment?.course_id || ""),
        },
      });

      const enrollmentId = enrollment?.id || null;

      // Find progress
      const progress = await progressRepo.findOne({
        where: {
          user_id: targetUserId,
          assessment_id: assessmentId,
        },
      });

      if (!progress) {
        console.warn("⚠️ [retakeAssessment] No progress found, creating new record");
        // Create fresh progress in "pending" status
        const newProgress = progressRepo.create({
          enrollment_id: enrollmentId,
          user_id: targetUserId,
          course_id: courseId || (assessment?.course_id || ""),
          assessment_id: assessmentId,
          lesson_id: null,
          is_completed: false,
          status: "pending",
          completion_percentage: 0,
          score: null,
          attempt_count: 0,
        });

        await progressRepo.save(newProgress);

        return res.json({
          success: true,
          message: "Assessment reset for retake successfully",
          data: {
            assessmentId,
            userId: targetUserId,
            maxAttempts: assessment?.max_attempts || 3,
            currentAttempts: 0,
          },
        });
      }

      // Reset existing progress
      progress.is_completed = false;
      progress.status = "pending";
      progress.completion_percentage = 0;
      progress.score = null;
      progress.completed_at = null;
      // Don't reset attempt_count - keep the history
      
      await progressRepo.save(progress);
      
      console.log("✅ [retakeAssessment] Progress reset successfully");

      res.json({
        success: true,
        message: "Assessment reset for retake successfully",
        data: {
          assessmentId,
          userId: targetUserId,
          maxAttempts: assessment?.max_attempts || 3,
          currentAttempts: progress.attempt_count || 0,
        },
      });
    } catch (error: any) {
      console.error("❌ Retake assessment error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reset assessment",
        error: error.message,
      });
    }
  }

  // ==================== HELPER METHODS ====================

  private static async checkProgressViewAccess(courseId: string, userId: string): Promise<boolean> {
    if (!userId) return false;

    const userRepo = dbConnection.getRepository(User);
    const courseRepo = dbConnection.getRepository(Course);

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return false;

    // System admin can view all
    if (user.bwenge_role === "SYSTEM_ADMIN") return true;

    const course = await courseRepo.findOne({
      where: { id: courseId },
      relations: ["course_instructors"],
    });

    if (!course) return false;

    // Course instructor
    if (course.instructor_id === userId) return true;

    // Assigned instructor
    const isAssignedInstructor = course.course_instructors?.some(
      ci => ci.instructor_id === userId
    );

    return isAssignedInstructor || false;
  }
private static async updateEnrollmentProgress(enrollmentId: string) {
  try {
    const enrollmentRepo = dbConnection.getRepository(Enrollment);
    const progressRepo = dbConnection.getRepository(Progress);
    const courseRepo = dbConnection.getRepository(Course);

    const enrollment = await enrollmentRepo.findOne({
      where: { id: enrollmentId },
    });

    if (!enrollment) return;

    // Get total lessons in course
    const course = await courseRepo.findOne({
      where: { id: enrollment.course_id },
      relations: ["modules", "modules.lessons"],
    });

    if (!course) return;

    const totalLessons = course.modules?.reduce(
      (sum, module) => sum + (module.lessons?.length || 0),
      0
    ) || 0;

    // Get completed lessons (progress records for lessons only, not assessments)
    const completedLessons = await progressRepo.count({
      where: {
        user_id: enrollment.user_id,
        course_id: enrollment.course_id,
        is_completed: true,
        lesson_id: Not(IsNull()),
        assessment_id: IsNull(),
      },
    });

    // ==================== FIX: INCLUDE ASSESSMENTS IN PROGRESS CALCULATION ====================
    // Get total assessments in course
    const totalAssessments = course.modules?.reduce(
      (sum, module) => {
        const lessonAssessments = module.lessons?.reduce(
          (lessonSum, lesson) => lessonSum + (lesson.assessments?.length || 0),
          0
        ) || 0;
        return sum + lessonAssessments + (module.final_assessment ? 1 : 0);
      },
      0
    ) || 0;

    // Get completed assessments
    const completedAssessments = await progressRepo.count({
      where: {
        user_id: enrollment.user_id,
        course_id: enrollment.course_id,
        is_completed: true,
        assessment_id: Not(IsNull()),
      },
    });

    const totalSteps = totalLessons + totalAssessments;
    const completedSteps = completedLessons + completedAssessments;

    // Update enrollment
    enrollment.completed_lessons = completedLessons;
    enrollment.progress_percentage = totalSteps > 0
      ? Math.round((completedSteps / totalSteps) * 100)
      : 0;

    console.log("📊 [updateEnrollmentProgress] Progress calculated:", {
      completedLessons,
      completedAssessments,
      totalLessons,
      totalAssessments,
      percentage: enrollment.progress_percentage,
    });

    // ==================== FIX: CALCULATE FINAL SCORE IF COURSE IS COMPLETED ====================
    if (enrollment.progress_percentage === 100 && enrollment.status === EnrollmentStatus.ACTIVE) {
      enrollment.status = EnrollmentStatus.COMPLETED;
      enrollment.completion_date = new Date();
      
      // Calculate final score using the helper function
      const finalScore = await ProgressController.calculateFinalScore(enrollment.user_id, enrollment.course_id);
      if (finalScore !== null) {
        enrollment.final_score = finalScore;
        console.log("✅ [updateEnrollmentProgress] Final score calculated:", finalScore);
      } else {
        // If no assessments, use progress percentage as final score
        enrollment.final_score = enrollment.progress_percentage;
        console.log("ℹ️ [updateEnrollmentProgress] Using progress percentage as final score:", enrollment.progress_percentage);
      }
    }

    // ==================== FIX: CALCULATE TOTAL TIME SPENT ====================
    const allProgress = await progressRepo.find({
      where: {
        user_id: enrollment.user_id,
        course_id: enrollment.course_id,
      },
    });

    const totalTimeSpentSeconds = allProgress.reduce((total, progress) => {
      return total + (progress.time_spent_seconds || 0);
    }, 0);

    enrollment.total_time_spent_minutes = Math.ceil(totalTimeSpentSeconds / 60);
    
    console.log("⏱️ [updateEnrollmentProgress] Total time spent:", {
      seconds: totalTimeSpentSeconds,
      minutes: enrollment.total_time_spent_minutes,
    });

    await enrollmentRepo.save(enrollment);

    console.log("✅ [updateEnrollmentProgress] Enrollment progress updated:", {
      enrollmentId,
      completedLessons,
      completedAssessments,
      totalSteps,
      percentage: enrollment.progress_percentage,
      status: enrollment.status,
      finalScore: enrollment.final_score,
      totalTimeMinutes: enrollment.total_time_spent_minutes,
    });
  } catch (error) {
    console.error("❌ [updateEnrollmentProgress] Error:", error);
  }
}
}