// @ts-nocheck

import multer from "multer"
import path from "path"
import fs from "fs"
import type { Request } from "express"
import type { File } from "express"

const allowedExtensions = {
  images: [
    ".jpg", ".jpeg", ".png", ".gif", ".tif", ".webp",
    ".bmp", ".svg", ".ico", ".heic", ".tiff", ".psd",
    ".ai", ".eps", ".raw", ".avif", ".jp2"
  ],
  audio: [
    ".mp3", ".wav", ".flac", ".aac", ".ogg", ".wma",
    ".m4a", ".opus", ".aiff", ".alac", ".amr", ".mid",
    ".midi", ".mp2", ".mpa", ".ra", ".weba"
  ],
  video: [
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv",
    ".wmv", ".m4v", ".3gp", ".mpg", ".mpeg", ".m2v",
    ".m4p", ".m4v", ".mp2", ".mpe", ".mpv", ".mxf",
    ".nsv", ".ogv", ".qt", ".rm", ".rmvb", ".svi",
    ".vob", ".yuv", ".ts", ".m2ts", ".mts", ".divx",
    ".xvid", ".h264", ".h265", ".hevc", ".av1"
  ],
  documents: [
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt",
    ".pptx", ".txt", ".rtf", ".csv", ".zip", ".rar",
    ".7z", ".gz", ".tar", ".bz2", ".dmg", ".iso",
    ".epub", ".mobi", ".pages", ".numbers", ".key",
    ".odt", ".ods", ".odp", ".md", ".json", ".xml",
    ".html", ".htm", ".log", ".sql", ".db", ".dat",
    ".apk", ".exe", ".dll", ".msi"
  ],
  fonts: [
    ".ttf", ".otf", ".woff", ".woff2", ".eot", ".sfnt"
  ],
  archives: [
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2",
    ".xz", ".iso", ".dmg", ".pkg", ".deb", ".rpm"
  ],
  executables: [
    ".exe", ".msi", ".dmg", ".pkg", ".deb", ".rpm",
    ".apk", ".app", ".bat", ".cmd", ".sh", ".bin"
  ],
  code: [
    ".js", ".ts", ".jsx", ".tsx", ".py", ".java",
    ".c", ".cpp", ".h", ".cs", ".php", ".rb",
    ".go", ".swift", ".kt", ".scala", ".sh", ".pl",
    ".lua", ".sql", ".json", ".xml", ".yml", ".yaml",
    ".ini", ".cfg", ".conf", ".env"
  ]
}

const allAllowedExtensions = [
  ...allowedExtensions.images,
  ...allowedExtensions.audio,
  ...allowedExtensions.video,
  ...allowedExtensions.documents,
  ...allowedExtensions.fonts,
  ...allowedExtensions.archives,
  ...allowedExtensions.executables,
  ...allowedExtensions.code
]

const ensureDirectoryExists = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export const uploadAssessmentFileFrontend = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/jpg',
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'application/json',
      'text/x-python',
      'text/x-java',
      'text/x-c++',
      'text/x-c',
      'text/x-php',
      'text/html',
      'text/css',
      'application/javascript',
      'application/typescript',
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'audio/mpeg',
      'audio/wav',
    ];

    const allowedExtensionsList = [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt',
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp',
      '.zip', '.rar', '.7z', '.tar', '.gz',
      '.json', '.py', '.java', '.cpp', '.c', '.php',
      '.html', '.htm', '.css', '.js', '.ts', '.jsx', '.tsx',
      '.mp4', '.mov', '.avi', '.mkv', '.mp3', '.wav'
    ];

    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(file.mimetype)) {
      return cb(null, true);
    }

    if (allowedExtensionsList.includes(ext)) {
      return cb(null, true);
    }

    const error = new Error(
      `Invalid file type: ${file.mimetype}. Allowed types: PDF, DOC, DOCX, XLS, XLSX, images, videos, audio, code files, and compressed files.`
    );
    cb(error, false);
  },
}).single("file");


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = "uploads/others"

    if (file.mimetype.startsWith("image/")) {
      folder = "uploads/images"
    } else if (file.mimetype.startsWith("audio/")) {
      folder = "uploads/audio"
    } else if (file.mimetype.startsWith("video/")) {
      folder = "uploads/video"
    } else if (file.mimetype.startsWith("text/") ||
      file.mimetype.includes("document") ||
      file.mimetype.includes("pdf")) {
      folder = "uploads/documents"
    } else if (file.mimetype.includes("font")) {
      folder = "uploads/fonts"
    } else if (file.mimetype.includes("zip") ||
      file.mimetype.includes("compressed")) {
      folder = "uploads/archives"
    } else if (file.mimetype.includes("application/x-msdownload") ||
      file.mimetype.includes("application/x-executable")) {
      folder = "uploads/executables"
    } else if (file.mimetype.includes("application/javascript") ||
      file.mimetype.includes("text/x-")) {
      folder = "uploads/code"
    }

    ensureDirectoryExists(folder)
    cb(null, folder)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext}`
    cb(null, fileName)
  },
})

const fileFilter = (req: Request, file: File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase()

  if (allAllowedExtensions.includes(ext)) {
    return cb(null, true)
  }

  const error = new Error(
    `Invalid file type: ${ext}. Allowed types: ${Object.keys(allowedExtensions).join(", ")}.`
  )
  cb(error, false)
}

// ==================== STORAGE FOR LARGE FILES (videos up to 4GB) ====================
const largeFileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = "uploads/others"

    if (file.mimetype.startsWith("video/")) {
      folder = "uploads/video"
    } else if (file.mimetype.startsWith("image/")) {
      folder = "uploads/images"
    } else if (file.mimetype.startsWith("audio/")) {
      folder = "uploads/audio"
    } else {
      folder = "uploads/documents"
    }

    ensureDirectoryExists(folder)
    cb(null, folder)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext}`
    cb(null, fileName)
  },
})

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB for general files
    files: 15,
    fieldSize: 10 * 1024 * 1024,
  },
})

// ==================== LARGE UPLOAD INSTANCE FOR VIDEOS (up to 4GB) ====================
const uploadLarge = multer({
  storage: largeFileStorage,
  fileFilter,
  limits: {
    fileSize: 4 * 1024 * 1024 * 1024, // 4GB for video files
    // ⚠️ FIX: Increased files count to handle video + thumbnail + up to 10 materials per lesson
    // Formula: (1 video + 1 thumbnail + 10 materials) * 20 modules * 30 lessons + 20 other fields = ~720
    files: 800,
    fieldSize: 10 * 1024 * 1024,
  },
})

export const handleMulterError = (error: any, req: any, res: any, next: any) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return res.status(400).json({
          success: false,
          message: "File too large. Videos up to 4GB and other files up to 10MB are allowed.",
          error: error.message,
          details: `File '${error.field}' exceeded size limit`
        })
      case "LIMIT_FILE_COUNT":
        return res.status(400).json({
          success: false,
          message: "Too many files. Maximum 800 files allowed.",
          error: error.message,
          details: `Limit exceeded for field '${error.field}'`
        })
      case "LIMIT_UNEXPECTED_FILE":
        return res.status(400).json({
          success: false,
          message: "Unexpected file field.",
          error: error.message,
          details: `Field '${error.field}' was not expected`
        })
      case "LIMIT_FIELD_KEY":
        return res.status(400).json({
          success: false,
          message: "Field name too long.",
          error: error.message,
          details: `Field name exceeds maximum length`
        })
      case "LIMIT_FIELD_VALUE":
        return res.status(400).json({
          success: false,
          message: "Field value too large.",
          error: error.message,
          details: `Field '${error.field}' value exceeds size limit`
        })
      case "LIMIT_FIELD_COUNT":
        return res.status(400).json({
          success: false,
          message: "Too many fields.",
          error: error.message,
          details: "Maximum number of fields exceeded"
        })
      case "LIMIT_PART_COUNT":
        return res.status(400).json({
          success: false,
          message: "Too many parts.",
          error: error.message,
          details: "Maximum number of form parts exceeded"
        })
      default:
        return res.status(400).json({
          success: false,
          message: "File upload error.",
          error: error.message,
          details: `Multer error code: ${error.code}`
        })
    }
  }

  if (error.message && error.message.includes("Invalid file type")) {
    return res.status(400).json({
      success: false,
      message: error.message,
      error: "Invalid file type",
      details: `Allowed types: ${Object.keys(allowedExtensions).join(", ")}`,
      allowedExtensions: allowedExtensions
    })
  }

  next(error)
}

export const uploadContributionFiles = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 10
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/jpg'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, TXT, and images are allowed.'));
    }
  }
}).fields([
  { name: 'contribution_files', maxCount: 10 }
]);

export const uploadSingle = upload.single("document")
export const uploadMultiple = upload.array("documents", 15)
export const uploadPropertyImages = upload.array("images", 10)

// ==================== GENERATE DYNAMIC LESSON VIDEO/THUMBNAIL/MATERIAL FIELDS ====================
// Support up to 20 modules × 30 lessons = 600 potential lesson combinations
// Each lesson can have: 1 video + 1 thumbnail + 10 materials = 12 files
const generateLessonVideoFields = () => {
  const fields: { name: string; maxCount: number }[] = []
  for (let modIdx = 0; modIdx < 20; modIdx++) {
    for (let lesIdx = 0; lesIdx < 30; lesIdx++) {
      // ── Video ──────────────────────────────────────────────────────────────
      fields.push({ name: `modules[${modIdx}].lessons[${lesIdx}].video`, maxCount: 1 })
      // Alternate bracket pattern (legacy)
      fields.push({ name: `modules[${modIdx}][lessons][${lesIdx}][video]`, maxCount: 1 })

      // ── Thumbnail ──────────────────────────────────────────────────────────
      fields.push({ name: `modules[${modIdx}].lessons[${lesIdx}].thumbnail`, maxCount: 1 })

      // ── Resources (link-based, kept for legacy compat) ─────────────────────
      fields.push({ name: `modules[${modIdx}].lessons[${lesIdx}].resources`, maxCount: 5 })
      fields.push({ name: `modules[${modIdx}].lessons[${lesIdx}].files`, maxCount: 5 })

      // ── Lesson Materials (NEW — PDF, DOCX, ZIP, etc.) ──────────────────────
      // Register up to 10 material slots per lesson so multer accepts the files.
      // Frontend sends them as modules[M].lessons[L].materials[N] (one file per slot).
      for (let matIdx = 0; matIdx < 10; matIdx++) {
        fields.push({
          name: `modules[${modIdx}].lessons[${lesIdx}].materials[${matIdx}]`,
          maxCount: 1,
        })
      }
    }
  }
  return fields
}

// ==================== MAIN uploadFields USING LARGE UPLOAD INSTANCE ====================
export const uploadFields = uploadLarge.fields([
  { name: "cv", maxCount: 1 },
  { name: "contractDocument", maxCount: 1 },
  { name: "academic_documents", maxCount: 5 },
  { name: "identification_card", maxCount: 1 },
  { name: "criminal_record", maxCount: 1 },
  { name: "clinical_record", maxCount: 1 },
  { name: "profile_picture", maxCount: 1 },
  { name: "other_documents", maxCount: 10 },
  { name: "documents", maxCount: 10 },
  { name: "images", maxCount: 5 },
  { name: "attachments", maxCount: 10 },
  { name: "videos", maxCount: 3 },
  { name: "audio", maxCount: 5 },
  { name: "fonts", maxCount: 5 },
  { name: "archives", maxCount: 5 },
  { name: "code", maxCount: 10 },
  { name: "video", maxCount: 1 },
  { name: "thumbnail", maxCount: 1 },
  { name: "thumbnail_url", maxCount: 1 },
  { name: "resources", maxCount: 10 },
  { name: "logoFile", maxCount: 1 },
  { name: "logo_url", maxCount: 1 },
  { name: "files", maxCount: 5 },
  // ==================== LESSON VIDEO / THUMBNAIL / MATERIAL FIELDS ====================
  ...generateLessonVideoFields(),
])

export const uploadSpecificDocument = upload.single("document");

export const uploadUserDocuments = upload.fields([
  { name: "cv", maxCount: 1 },
  { name: "academic_documents", maxCount: 5 },
  { name: "identification_card", maxCount: 1 },
  { name: "criminal_record", maxCount: 1 },
  { name: "clinical_record", maxCount: 1 },
  { name: "profile_picture", maxCount: 1 },
  { name: "other_documents", maxCount: 10 }
])

export const uploadResearchFiles = upload.fields([
  { name: "project_file", maxCount: 1 },
  { name: "cover_image", maxCount: 1 },
  { name: "post_image", maxCount: 1 },
  { name: "additional_files", maxCount: 5 }
])

export const getAllowedExtensions = () => ({ ...allowedExtensions })
export const isExtensionAllowed = (ext: string) => allAllowedExtensions.includes(ext.toLowerCase())
export const uploadContractDocument = upload.single("contractDocument");
export default upload