// @ts-nocheck
import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { createReadStream } from 'fs';
import stream from 'stream';
import crypto from 'crypto';

const pipeline = promisify(stream.pipeline);

interface S3Config {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  cacheControl?: string;
  acl?: 'private' | 'public-read' | 'public-read-write' | 'authenticated-read';
}

interface UploadResult {
  key: string;
  url: string;
  etag: string;
  size: number;
  bucket: string;
  location: string;
}

class S3Service {
  private s3: AWS.S3;
  private bucket: string;
  private publicUrlBase: string;
  private isConfigured: boolean = false;

  constructor() {
    this.isConfigured = this.loadConfiguration();
  }

  /**
   * Load S3 configuration from environment variables
   */
  private loadConfiguration(): boolean {
    try {
      // Check if S3 is configured
      if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.AWS_S3_BUCKET) {
        console.warn('⚠️ S3 not configured: Missing AWS credentials or bucket');
        return false;
      }

      const config: S3Config = {
        region: process.env.AWS_REGION || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        bucket: process.env.AWS_S3_BUCKET,
      };

      // Optional: Custom endpoint for compatible services (MinIO, DigitalOcean Spaces, etc.)
      if (process.env.AWS_S3_ENDPOINT) {
        config.endpoint = process.env.AWS_S3_ENDPOINT;
        config.forcePathStyle = process.env.AWS_S3_FORCE_PATH_STYLE === 'true';
      }

      // Initialize AWS SDK
      AWS.config.update({
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      });

      // Create S3 instance
      this.s3 = new AWS.S3({
        endpoint: config.endpoint,
        s3ForcePathStyle: config.forcePathStyle,
        signatureVersion: 'v4',
      });

      this.bucket = config.bucket;

      // Set public URL base
      if (process.env.AWS_S3_PUBLIC_URL) {
        this.publicUrlBase = process.env.AWS_S3_PUBLIC_URL;
      } else if (config.endpoint) {
        // For custom endpoints (MinIO, etc.)
        this.publicUrlBase = `${config.endpoint}/${this.bucket}`;
      } else {
        // Standard AWS S3 URL
        this.publicUrlBase = `https://${this.bucket}.s3.${config.region}.amazonaws.com`;
      }

      console.log('✅ S3 service initialized with bucket:', this.bucket);
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize S3 service:', error);
      return false;
    }
  }

  /**
   * Check if S3 is configured and accessible
   */
  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured || !this.s3) {
      return false;
    }

    try {
      await this.s3.headBucket({ Bucket: this.bucket }).promise();
      return true;
    } catch (error) {
      console.error('❌ S3 bucket not accessible:', error);
      return false;
    }
  }

  /**
   * Upload a file to S3
   */
  async uploadFile(
    filePath: string,
    key?: string,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      // Generate key if not provided
      const finalKey = key || this.generateKey(filePath);

      // Read file
      const fileContent = await fs.promises.readFile(filePath);
      const fileStats = await fs.promises.stat(filePath);

      // Determine content type
      const contentType = options.contentType || this.getContentType(filePath);

      // Set up upload parameters
      const params: AWS.S3.PutObjectRequest = {
        Bucket: this.bucket,
        Key: finalKey,
        Body: fileContent,
        ContentType: contentType,
        Metadata: options.metadata,
        ACL: options.acl || 'private',
      };

      if (options.cacheControl) {
        params.CacheControl = options.cacheControl;
      }

      // Upload to S3
      const result = await this.s3.upload(params).promise();

      console.log(`✅ File uploaded to S3: ${finalKey} (${fileStats.size} bytes)`);

      return {
        key: result.Key,
        url: this.getPublicUrl(result.Key),
        etag: result.ETag.replace(/"/g, ''),
        size: fileStats.size,
        bucket: result.Bucket,
        location: result.Location,
      };
    } catch (error:any) {
      console.error('❌ S3 upload failed:', error);
      throw new Error(`Failed to upload file to S3: ${error.message}`);
    }
  }

  /**
   * Upload a buffer to S3
   */
  async uploadBuffer(
    buffer: Buffer,
    key: string,
    options: UploadOptions & { filename?: string } = {}
  ): Promise<UploadResult> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      const params: AWS.S3.PutObjectRequest = {
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: options.contentType || 'application/octet-stream',
        Metadata: options.metadata,
        ACL: options.acl || 'private',
      };

      if (options.cacheControl) {
        params.CacheControl = options.cacheControl;
      }

      const result = await this.s3.upload(params).promise();

      console.log(`✅ Buffer uploaded to S3: ${key} (${buffer.length} bytes)`);

      return {
        key: result.Key,
        url: this.getPublicUrl(result.Key),
        etag: result.ETag.replace(/"/g, ''),
        size: buffer.length,
        bucket: result.Bucket,
        location: result.Location,
      };
    } catch (error) {
      console.error('❌ S3 buffer upload failed:', error);
      throw new Error(`Failed to upload buffer to S3: ${error.message}`);
    }
  }

  /**
   * Upload a stream to S3
   */
  async uploadStream(
    fileStream: stream.Readable,
    key: string,
    options: UploadOptions & { contentLength?: number } = {}
  ): Promise<UploadResult> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      const pass = new stream.PassThrough();
      
      const params: AWS.S3.PutObjectRequest = {
        Bucket: this.bucket,
        Key: key,
        Body: pass,
        ContentType: options.contentType || 'application/octet-stream',
        Metadata: options.metadata,
        ACL: options.acl || 'private',
      };

      if (options.contentLength) {
        params.ContentLength = options.contentLength;
      }

      if (options.cacheControl) {
        params.CacheControl = options.cacheControl;
      }

      const uploadPromise = this.s3.upload(params).promise();
      
      // Pipe the stream to the upload
      await pipeline(fileStream, pass);

      const result = await uploadPromise;

      console.log(`✅ Stream uploaded to S3: ${key}`);

      return {
        key: result.Key,
        url: this.getPublicUrl(result.Key),
        etag: result.ETag.replace(/"/g, ''),
        size: 0, // Size unknown for stream
        bucket: result.Bucket,
        location: result.Location,
      };
    } catch (error) {
      console.error('❌ S3 stream upload failed:', error);
      throw new Error(`Failed to upload stream to S3: ${error.message}`);
    }
  }

  /**
   * Download a file from S3
   */
  async downloadFile(key: string, downloadPath: string): Promise<void> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      const params = {
        Bucket: this.bucket,
        Key: key,
      };

      // Create write stream
      const writeStream = fs.createWriteStream(downloadPath);

      // Get object from S3
      const s3Stream = this.s3.getObject(params).createReadStream();

      // Pipe to file
      await pipeline(s3Stream, writeStream);

      console.log(`✅ File downloaded from S3: ${key} -> ${downloadPath}`);
    } catch (error) {
      console.error('❌ S3 download failed:', error);
      throw new Error(`Failed to download file from S3: ${error.message}`);
    }
  }

  /**
   * Get file as buffer from S3
   */
  async getFileAsBuffer(key: string): Promise<Buffer> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      const params = {
        Bucket: this.bucket,
        Key: key,
      };

      const result = await this.s3.getObject(params).promise();
      
      return result.Body as Buffer;
    } catch (error) {
      console.error('❌ S3 get file failed:', error);
      throw new Error(`Failed to get file from S3: ${error.message}`);
    }
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(key: string): Promise<void> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      const params = {
        Bucket: this.bucket,
        Key: key,
      };

      await this.s3.deleteObject(params).promise();

      console.log(`✅ File deleted from S3: ${key}`);
    } catch (error) {
      console.error('❌ S3 delete failed:', error);
      throw new Error(`Failed to delete file from S3: ${error.message}`);
    }
  }

  /**
   * Delete multiple files
   */
  async deleteFiles(keys: string[]): Promise<void> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    if (keys.length === 0) return;

    try {
      const params = {
        Bucket: this.bucket,
        Delete: {
          Objects: keys.map(key => ({ Key: key })),
          Quiet: false,
        },
      };

      const result = await this.s3.deleteObjects(params).promise();

      if (result.Errors && result.Errors.length > 0) {
        console.error('❌ Some files failed to delete:', result.Errors);
        throw new Error(`Failed to delete some files: ${result.Errors.map(e => e.Key).join(', ')}`);
      }

      console.log(`✅ ${keys.length} files deleted from S3`);
    } catch (error) {
      console.error('❌ S3 bulk delete failed:', error);
      throw new Error(`Failed to delete files from S3: ${error.message}`);
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(key: string): Promise<boolean> {
    if (!this.isConfigured) {
      return false;
    }

    try {
      const params = {
        Bucket: this.bucket,
        Key: key,
      };

      await this.s3.headObject(params).promise();
      return true;
    } catch (error) {
      if (error.code === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(key: string): Promise<AWS.S3.HeadObjectOutput> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      const params = {
        Bucket: this.bucket,
        Key: key,
      };

      return await this.s3.headObject(params).promise();
    } catch (error) {
      console.error('❌ S3 get metadata failed:', error);
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  }

  /**
   * List files in a prefix
   */
  async listFiles(prefix: string, maxKeys: number = 1000): Promise<AWS.S3.Object[]> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      const params = {
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      };

      const result = await this.s3.listObjectsV2(params).promise();
      
      return result.Contents || [];
    } catch (error) {
      console.error('❌ S3 list files failed:', error);
      throw new Error(`Failed to list files: ${error.message}`);
    }
  }

  /**
   * Copy file within S3
   */
  async copyFile(sourceKey: string, destinationKey: string): Promise<void> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      const params = {
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: destinationKey,
      };

      await this.s3.copyObject(params).promise();

      console.log(`✅ File copied: ${sourceKey} -> ${destinationKey}`);
    } catch (error) {
      console.error('❌ S3 copy failed:', error);
      throw new Error(`Failed to copy file: ${error.message}`);
    }
  }

  /**
   * Move file (copy then delete)
   */
  async moveFile(sourceKey: string, destinationKey: string): Promise<void> {
    await this.copyFile(sourceKey, destinationKey);
    await this.deleteFile(sourceKey);
  }

  /**
   * Get a signed URL for temporary access
   */
  async getSignedUrl(key: string, expiresInSeconds: number = 3600): Promise<string> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      const params = {
        Bucket: this.bucket,
        Key: key,
        Expires: expiresInSeconds,
      };

      return await this.s3.getSignedUrlPromise('getObject', params);
    } catch (error) {
      console.error('❌ S3 signed URL generation failed:', error);
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }
  }

  /**
   * Get a signed URL for upload (POST)
   */
  async getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds: number = 3600
  ): Promise<string> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      const params = {
        Bucket: this.bucket,
        Fields: {
          key: key,
          'Content-Type': contentType,
        },
        Conditions: [
          ['content-length-range', 0, 100 * 1024 * 1024], // Max 100MB
          ['starts-with', '$Content-Type', contentType],
        ],
        Expires: expiresInSeconds,
      };

      return await this.s3.createPresignedPost(params);
    } catch (error) {
      console.error('❌ S3 signed upload URL generation failed:', error);
      throw new Error(`Failed to generate signed upload URL: ${error.message}`);
    }
  }

  /**
   * Get public URL for a file
   */
  getPublicUrl(key: string): string {
    return `${this.publicUrlBase}/${key}`;
  }

  /**
   * Generate a unique key for a file
   */
  generateKey(filePath: string, prefix?: string): string {
    const ext = path.extname(filePath);
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const filename = `${timestamp}-${random}${ext}`;
    
    if (prefix) {
      return `${prefix}/${filename}`;
    }
    
    return filename;
  }

  /**
   * Generate a key with date-based folder structure
   */
  generateDatedKey(filePath: string, basePrefix: string = 'uploads'): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    const ext = path.extname(filePath);
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const filename = `${timestamp}-${random}${ext}`;
    
    return `${basePrefix}/${year}/${month}/${day}/${filename}`;
  }

  /**
   * Get content type from file extension
   */
  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.zip': 'application/zip',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Create a folder (by uploading an empty object)
   */
  async createFolder(folderPath: string): Promise<void> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      const key = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
      
      const params = {
        Bucket: this.bucket,
        Key: key,
        Body: '',
      };

      await this.s3.putObject(params).promise();
      
      console.log(`✅ Folder created: ${key}`);
    } catch (error) {
      console.error('❌ S3 folder creation failed:', error);
      throw new Error(`Failed to create folder: ${error.message}`);
    }
  }

  /**
   * Get bucket stats
   */
  async getBucketStats(): Promise<{
    totalObjects: number;
    totalSize: number;
    lastModified: Date | null;
  }> {
    if (!this.isConfigured) {
      throw new Error('S3 is not configured');
    }

    try {
      let totalObjects = 0;
      let totalSize = 0;
      let lastModified: Date | null = null;
      let continuationToken: string | undefined;

      do {
        const params: AWS.S3.ListObjectsV2Request = {
          Bucket: this.bucket,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        };

        const result = await this.s3.listObjectsV2(params).promise();
        
        totalObjects += result.KeyCount || 0;
        
        result.Contents?.forEach(obj => {
          totalSize += obj.Size || 0;
          if (obj.LastModified && (!lastModified || obj.LastModified > lastModified)) {
            lastModified = obj.LastModified;
          }
        });

        continuationToken = result.NextContinuationToken;
      } while (continuationToken);

      return {
        totalObjects,
        totalSize,
        lastModified,
      };
    } catch (error) {
      console.error('❌ S3 bucket stats failed:', error);
      throw new Error(`Failed to get bucket stats: ${error.message}`);
    }
  }
}

// Export singleton instance
export const s3Service = new S3Service();