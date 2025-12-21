import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

// In production, this should be stored in environment variables
// Use a fixed secret for consistent encryption/decryption across server restarts
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || crypto.randomBytes(32).toString('hex');

/**
 * Derive a key from the secret using PBKDF2
 */
function deriveKey(salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(ENCRYPTION_SECRET, salt, 100000, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a string value
 */
export function encrypt(text: string): string {
  try {
    // Generate random salt and IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Derive key from secret and salt
    const key = deriveKey(salt);
    
    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    // Encrypt the text
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final()
    ]);
    
    // Get the auth tag
    const tag = cipher.getAuthTag();
    
    // Combine salt + iv + tag + encrypted data
    const result = Buffer.concat([salt, iv, tag, encrypted]);
    
    return result.toString('base64');
  } catch (error) {
    console.error('❌ Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt an encrypted string
 */
export function decrypt(encryptedData: string): string {
  try {
    // Decode from base64
    const data = Buffer.from(encryptedData, 'base64');
    
    // Extract components
    const salt = data.subarray(0, SALT_LENGTH);
    const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    
    // Derive key using the same salt
    const key = deriveKey(salt);
    
    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('❌ Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Hash a value (one-way, for passwords or API keys)
 */
export function hash(value: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(value, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a hashed value
 */
export function verifyHash(value: string, hashedValue: string): boolean {
  const [salt, originalHash] = hashedValue.split(':');
  const hash = crypto.pbkdf2Sync(value, salt, 100000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

/**
 * Generate a random token
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a random API key with prefix
 */
export function generateApiKey(prefix: string = 'bw'): string {
  const randomPart = crypto.randomBytes(24).toString('hex');
  return `${prefix}_${randomPart}`;
}

/**
 * Mask sensitive data (for logging)
 */
export function maskSensitive(data: string, visibleChars: number = 4): string {
  if (!data || data.length <= visibleChars) return '****';
  const visible = data.slice(-visibleChars);
  return `****${visible}`;
}