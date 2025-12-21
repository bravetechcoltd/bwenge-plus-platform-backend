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
    ".vob", ".yuv"
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

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, 
    files: 15,
    fieldSize: 10 * 1024 * 1024,
  },
})

export const handleMulterError = (error: any, req: any, res: any, next: any) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return res.status(400).json({
          success: false,
          message: "File too large. Maximum size is 10MB.",
          error: error.message,
          details: `File '${error.field}' exceeded size limit`
        })
      case "LIMIT_FILE_COUNT":
        return res.status(400).json({
          success: false,
          message: "Too many files. Maximum 15 files allowed.",
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

  if (error.message.includes("Invalid file type")) {
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
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 10 // Maximum 10 files
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
export const uploadFields = upload.fields([
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
  { name: "code", maxCount: 10 }
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