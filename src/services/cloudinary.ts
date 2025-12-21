// @ts-nocheck
import { v2 as cloudinary } from "cloudinary"
import dotenv from "dotenv"
import fs from 'fs';
dotenv.config()

cloudinary.config({
  cloud_name: process.env.CLOUDINARYNAME,
  api_key: process.env.APIKEY,
  api_secret: process.env.APISECRET,
  timeout: 120000,
})


export const UploadToCloud = async (file: Express.Multer.File, res?: Response, retries = 3) => {
  console.log("☁️ === ENHANCED CLOUDINARY UPLOAD DEBUG START ===");
  console.log("📅 Upload started at:", new Date().toISOString());
  console.log("📁 File to upload:", {
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    bufferSize: file.buffer?.length || 0,
    fieldname: file.fieldname
  });

  let lastError: any;

  // Check if file has buffer (from memory storage)
  const hasBuffer = file.buffer && file.buffer.length > 0;
  console.log("🔍 File source:", hasBuffer ? "Buffer (memory storage)" : "Disk path");

  // For assessment files, use a specific folder
  const folder = "assessment_submissions/";
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔄 === UPLOAD ATTEMPT ${attempt}/${retries} ===`);
      
      let uploadResponse;
      const baseUploadOptions: any = {
        folder: folder,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        invalidate: true,
        timeout: 120000,
        chunk_size: 6000000,
        resource_type: "auto", // Let Cloudinary detect the type
      };

      console.log("⚙️ Upload options:", baseUploadOptions);

      if (hasBuffer) {
        // Upload from buffer
        console.log("📦 Uploading from buffer...");
        uploadResponse = await cloudinary.uploader.upload(
          `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
          baseUploadOptions
        );
      } else {
        // Upload from disk path (existing code)
        console.log("📂 Uploading from disk path...");
        if (!fs.existsSync(file.path)) {
          throw new Error(`File not found at path: ${file.path}`);
        }
        uploadResponse = await cloudinary.uploader.upload(file.path, baseUploadOptions);
      }

      console.log(`✅ Upload successful on attempt ${attempt}!`);
      console.log("📊 Cloudinary response:", {
        secure_url: uploadResponse.secure_url,
        public_id: uploadResponse.public_id,
        resource_type: uploadResponse.resource_type,
        format: uploadResponse.format,
        bytes: uploadResponse.bytes
      });

      return {
        secure_url: uploadResponse.secure_url,
        public_id: uploadResponse.public_id,
        resource_type: uploadResponse.resource_type,
        format: uploadResponse.format,
        bytes: uploadResponse.bytes,
        original_filename: file.originalname,
        upload_timestamp: new Date().toISOString(),
        version: uploadResponse.version,
        created_at: uploadResponse.created_at
      };

    } catch (error: any) {
      lastError = error;
      console.error(`❌ Upload attempt ${attempt} failed:`, error.message);
      
      // Retry logic remains the same...
      if (attempt < retries && shouldRetry(error)) {
        const waitTime = Math.min(attempt * 2000, 10000);
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      break;
    }
  }

  throw new Error(
    `Failed to upload ${file.originalname} after ${retries} attempts: ${lastError?.message || "Unknown error"}`
  );
};

function shouldRetry(error: any): boolean {
  const retryableErrors = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'TimeoutError'];
  return retryableErrors.includes(error.name) || 
         retryableErrors.includes(error.code) || 
         error.http_code === 499 ||
         (error.message && error.message.includes('timeout'));
}
// Function to delete files from Cloudinary with retry
export const DeleteFromCloud = async (
  publicId: string,
  resourceType: "image" | "video" | "raw" = "image",
  retries = 3,
) => {
  let lastError: any

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const deleteResponse = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        timeout: 60000, // 1 minute timeout for delete
      })
      return deleteResponse
    } catch (error: any) {
      lastError = error
      console.error(`Delete attempt ${attempt}/${retries} failed for ${publicId}:`, error.message)

      if (attempt < retries) {
        const waitTime = attempt * 1000 // 1s, 2s, 3s
        await new Promise((resolve) => setTimeout(resolve, waitTime))
        continue
      }
    }
  }

  throw new Error(`Failed to delete ${publicId} after ${retries} attempts: ${lastError?.message || "Unknown error"}`)
}

// Function to get file info from Cloudinary with retry
export const GetCloudinaryFileInfo = async (
  publicId: string,
  resourceType: "image" | "video" | "raw" = "image",
  retries = 3,
) => {
  let lastError: any

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await cloudinary.api.resource(publicId, {
        resource_type: resourceType,
        timeout: 30000, // 30 seconds timeout
      })
      return result
    } catch (error: any) {
      lastError = error
      console.error(`Get file info attempt ${attempt}/${retries} failed for ${publicId}:`, error.message)

      if (attempt < retries) {
        const waitTime = attempt * 1000
        await new Promise((resolve) => setTimeout(resolve, waitTime))
        continue
      }
    }
  }

  throw new Error(
    `Failed to get file info for ${publicId} after ${retries} attempts: ${lastError?.message || "Unknown error"}`,
  )
}

// Utility function to validate file before upload
export const validateFileForUpload = (file: Express.Multer.File): { isValid: boolean; error?: string } => {
  const maxSize = 10 * 1024 * 1024 // 10MB
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/avi",
    "video/mov",
    "video/wmv",
    "audio/mp3",
    "audio/wav",
    "audio/ogg",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "application/zip",
    "application/x-rar-compressed",
  ]

  if (file.size > maxSize) {
    return { isValid: false, error: `File ${file.originalname} exceeds 10MB limit` }
  }

  if (!allowedTypes.includes(file.mimetype)) {
    return { isValid: false, error: `File type ${file.mimetype} is not allowed` }
  }

  return { isValid: true }
}

// Batch upload function for multiple files with sequential processing
export const UploadMultipleToCloud = async (files: Express.Multer.File[]): Promise<any[]> => {
  const results: any[] = []
  const errors: any[] = []

  // Process files sequentially to avoid overwhelming Cloudinary
  for (const file of files) {
    try {
      // Validate file before upload
      const validation = validateFileForUpload(file)
      if (!validation.isValid) {
        errors.push({ file: file.originalname, error: validation.error })
        continue
      }

      const result = await UploadToCloud(file)
      results.push(result)
    } catch (error: any) {
      console.error(`Failed to upload ${file.originalname}:`, error.message)
      errors.push({ file: file.originalname, error: error.message })
    }
  }

  if (errors.length > 0) {
    console.warn("Some files failed to upload:", errors)
  }

  return results
}


export const uploadToCloudinary = (filePath: string): Promise<any> => {
  return cloudinary.uploader.upload(filePath, { folder: 'profile_pics' });
};

export const uploadToCloud = (filePath: string): Promise<any> => {
  return cloudinary.uploader.upload(filePath, { folder: 'thumbnails' });
};

export const uploadLessonImageToCloud = (filePath: string): Promise<any> => {
  return cloudinary.uploader.upload(filePath, { folder: 'lessons', resource_type: 'image' });
};

export const uploadLessonVideoToCloud = (filePath: string): Promise<any> => {
  return cloudinary.uploader.upload(filePath, { folder: 'lessons', resource_type: 'video' });
};

export const uploadDoc = (filePath: string): Promise<any> => {
  return cloudinary.uploader.upload(filePath, { folder: 'docs', resource_type: 'raw' });
};

export const uploadDocImage = (filePath: string): Promise<any> => {
  return cloudinary.uploader.upload(filePath, { folder: 'docs', resource_type: 'image' });
};

export const uploadDocVideo = (filePath: string): Promise<any> => {
  return cloudinary.uploader.upload(filePath, { folder: 'docs', resource_type: 'video' });
};
