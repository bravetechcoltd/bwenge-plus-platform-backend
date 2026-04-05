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

  let lastError: any;

  // Pre-upload validation
  
  if (!fs.existsSync(file.path)) {
    throw new Error(`File not found at path: ${file.path}`);
  }

  const fileStats = fs.statSync(file.path);

  if (fileStats.size !== file.size) {
  }

  try {
    fs.accessSync(file.path, fs.constants.R_OK);
  } catch (error: any) {
    throw new Error(`File is not readable: ${error.message}`);
  }

  if (!process.env.CLOUDINARYNAME || !process.env.APIKEY || !process.env.APISECRET) {
    throw new Error("Cloudinary configuration is incomplete");
  }

  try {
    await cloudinary.api.ping();
  } catch (connectionError: any) {
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {

      let uploadResponse;
      const baseUploadOptions: any = {
        use_filename: true,
        unique_filename: true,
        timeout: 120000,
        chunk_size: 6000000,
        overwrite: false,
        invalidate: true,
      };


      if (file.mimetype.startsWith("image/")) {
        const imageOptions = {
          ...baseUploadOptions,
          folder: "task_images/",
          transformation: [
            { quality: "auto:good" },
            { fetch_format: "auto" },
          ],
          allowed_formats: ["jpg", "png", "gif", "webp", "bmp", "tiff"]
        };
        
        uploadResponse = await cloudinary.uploader.upload(file.path, imageOptions);
        
      } else if (file.mimetype.startsWith("audio/")) {
        const audioOptions = {
          ...baseUploadOptions,
          folder: "task_audio/",
          resource_type: "video",
        };
        
        uploadResponse = await cloudinary.uploader.upload(file.path, audioOptions);
        
      } else if (file.mimetype.startsWith("video/")) {
        const videoOptions = {
          ...baseUploadOptions,
          folder: "task_videos/",
          resource_type: "video",
          transformation: [
            { quality: "auto:good" },
          ],
        };
        
        uploadResponse = await cloudinary.uploader.upload(file.path, videoOptions);
        
      } else {
        const documentOptions = {
          ...baseUploadOptions,
          folder: "task_documents/",
          resource_type: "raw",
        };
        
        uploadResponse = await cloudinary.uploader.upload(file.path, documentOptions);
      }



      if (!uploadResponse.secure_url) {
        throw new Error("Cloudinary upload succeeded but no secure_url returned");
      }

      try {
        const https = require('https');
        const http = require('http');
        const urlModule = require('url');
        
        const parsedUrl = urlModule.parse(uploadResponse.secure_url);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        
        const testPromise = new Promise((resolve, reject) => {
          const req = client.request({
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            method: 'HEAD',
            timeout: 10000
          }, (res: any) => {
            if (res.statusCode === 200) {
              resolve(true);
            } else {
              reject(new Error(`URL test failed with status: ${res.statusCode}`));
            }
          });
          
          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('URL test timeout'));
          });
          
          req.end();
        });
        
        await testPromise;
      } catch (urlTestError: any) {
      }

      const result = {
        secure_url: uploadResponse.secure_url,
        public_id: uploadResponse.public_id,
        resource_type: uploadResponse.resource_type,
        format: uploadResponse.format,
        bytes: uploadResponse.bytes,
        original_filename: file.originalname,
        upload_timestamp: new Date().toISOString(),
        width: uploadResponse.width,
        height: uploadResponse.height,
        version: uploadResponse.version,
        created_at: uploadResponse.created_at
      };

      return result;

    } catch (error: any) {
      lastError = error;

      if (error.error) {
      }

      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
      }


      const retryableErrors = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'TimeoutError'];
      const isRetryable = retryableErrors.includes(error.name) || 
                         retryableErrors.includes(error.code) || 
                         error.http_code === 499 ||
                         (error.message && error.message.includes('timeout'));

      if (attempt < retries && isRetryable) {
        const waitTime = Math.min(attempt * 2000, 10000);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }

      if (attempt === retries) {
        break;
      } else {
      }
    }
  }


  throw new Error(
    `Failed to upload ${file.originalname} after ${retries} attempts: ${lastError?.message || "Unknown error"}`
  );
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
      errors.push({ file: file.originalname, error: error.message })
    }
  }

  if (errors.length > 0) {
  }

  return results
}
