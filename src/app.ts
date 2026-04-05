import express, { Application } from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes";
import ssoRoutes from "./routes/ssoRoutes";
import institutionRoutes from "./routes/institutionRoutes";
import categoryRoutes from "./routes/categoryRoutes";
import moduleRoutes from "./routes/moduleRoutes";
import enhancedCourseRoutes from "./routes/courseRoutes";
import enhancedEnrollmentRoutes from "./routes/enhancedEnrollmentRoutes";
import answerRoutes from "./routes/answerRoutes";
import progressRoutes from "./routes/progressRoutes";
import lessonRoutes from "./routes/lessonRoutes";
import quizRoutes from "./routes/quizRoutes";
import subscribeRoutes from "./routes/subscribe";
import { errorHandler } from "./middlewares/errorHandler";
import reviewRoutes from "./routes/reviewRoutes";
import uploadRoutes from "./routes/uploadRoutes";
import certificateRoutes from "./routes/certificateRoutes";
import institutionAdminRoutes from "./routes/institutionAdminRoutes";
import courseInstructorRoutes from './routes/courseInstructorRoutes';
import instructorRoutes from "./routes/instructorRoutes"
import Systemadminuserroutes from "./routes/Systemadminuserroutes"
import messageRoutes from "./routes/messageRoutes";
import ConversationRoutes from "./routes/conversationRoutes";
import SpaceRoutes from "./routes/spaceRoutes";
import systemSettingsRoutes from "./routes/systemSettingsRoutes";
import savedCoursesRoutes from "./routes/savedCoursesRoutes";
import gradeRoutes from "./routes/gradeRoutes";
import scheduleRoutes from "./routes/scheduleRoutes";
import materialsRoutes from "./routes/materialsRoutes";
import instructorAnalyticsRoutes from "./routes/instructorAnalyticsRoutes";
import systemAdminInstitutionAnalyticsRoutes from "./routes/systemAdminInstitutionAnalyticsRoutes";
import assessmentRoutes from "./routes/assessmentRoutes";
import  Systemadminextendedroutes from "./routes/Systemadminextendedroutes";
import securityRoute from "./routes/securityRoute";
import userPresenceRoutes from "./routes/userPresenceRoutes";

const app: Application = express();

app.use(cookieParser());

// Serve uploaded files as static assets
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.use(cors({
  origin: [
    // Local development
    'http://localhost:3000', 
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    // Production frontends
    'https://plus.bwenge.com',
    'https://www.plus.bwenge.com',
    'https://bwenge.com',
    'https://www.bwenge.com',
    'https://ongera.rw',
    'https://www.ongera.rw',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'Cookie',
    'X-Requested-With',
    'X-FedCM-CSRF',
    'Sec-Fetch-Dest'
  ],
  exposedHeaders: ['Set-Cookie', 'X-FedCM-CSRF'],
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.use((req, res, next) => {
  if (req.body && Object.keys(req.body).length > 0) {
  }
  next();
});
app.use(morgan("dev"));
app.use(express.json({ limit: '50mb' })); // Increased from default 100kb
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.get("/", (req, res) => {
  res.json({ 
    message: "Welcome to BWENGE PLUS Platform API",
    sso_enabled: true,
    supported_systems: ["BWENGE_PLUS", "ONGERA"],
    features: [
      "MOOC/SPOC Support",
      "Institution Management",
      "Course Categories",
      "Module-based Curriculum",
      "Access Code System",
      "Enrollment Approval Workflow"
    ]
  });
});

// Routes
app.use("/api", reviewRoutes);
app.use("/api/instructor", instructorRoutes)
app.use("/api/auth", authRoutes);
app.use("/api/auth", ssoRoutes);
app.use("/api/subscribe", subscribeRoutes);
app.use("/api/institutions", institutionRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/courses", enhancedCourseRoutes); 
app.use("/api/enrollments", enhancedEnrollmentRoutes); 
app.use("/api/answers", answerRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/lessons", lessonRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/institution-admin", institutionAdminRoutes);
app.use('/api/course-instructors', courseInstructorRoutes);
app.use("/api/system-admin", Systemadminextendedroutes);
app.use("/api/system-admin",Systemadminuserroutes)
app.use("/api/messages", messageRoutes)
app.use("/api/users", userPresenceRoutes)
app.use("/api/conversations", ConversationRoutes)
app.use("/api/space", SpaceRoutes)
app.use("/api/system-settings", systemSettingsRoutes);
app.use("/api/system-settings", systemSettingsRoutes);
app.use("/api/saved-courses", savedCoursesRoutes);
app.use("/api/grades", gradeRoutes);
app.use("/api/instructor/schedule", scheduleRoutes);
app.use("/api/instructor/materials", materialsRoutes);
app.use("/api/instructor/analytics", instructorAnalyticsRoutes);
app.use("/api/system-admin/institutions/analytics", systemAdminInstitutionAnalyticsRoutes);
app.use("/api/system-admin", Systemadminextendedroutes);
app.use("/api/assessments", assessmentRoutes);
app.use("/api/system-admin", securityRoute);
app.use(errorHandler);

export default app;